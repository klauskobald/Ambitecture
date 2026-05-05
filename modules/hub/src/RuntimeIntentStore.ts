/**
 * Hub-authoritative runtime intent overlay (perform).
 *
 * **Dumb-controller contract (parity intent):**
 * - Controllers send `runtime:command` deltas only; they apply `runtime:update`, `projectPatch`,
 *   `graph:init`, and `graph:delta` to stay in sync — no parallel merge authority.
 * - Parity checklist: perform drag moves fixtures in sim; scene switch keeps hub + HUD + sim aligned;
 *   second controller tab receives `runtime:update`.
 *
 * Merge order matches the former `RuntimeUpdateDispatcher` cache: baseline
 * `getActiveSceneIntent` (YAML + scene ref overlay), then cumulative `runtime:command` patches.
 * Invalidation (`clear`) mirrors existing `ProjectGraphStore` / `IntentsHandler` triggers.
 */

import { ProjectManager, ControllerIntent } from './ProjectManager';
import { RuntimeUpdate } from './RuntimeProtocol';
import { cloneRecord, removeAtDotPath, setAtDotPath } from './dotPath';
import { effectivePerformResetScene, intentToEvent } from './handlers/intentHelpers';
import { transformIntentToNormalized } from './intents';

function applyRuntimePatch(base: Record<string, unknown>, update: RuntimeUpdate): Record<string, unknown> {
  const next = cloneRecord(update.value ?? base);
  next['guid'] = update.guid;
  for (const [key, value] of Object.entries(update.patch ?? {})) {
    setAtDotPath(next, key, value);
  }
  for (const key of update.remove ?? []) {
    removeAtDotPath(next, key);
  }
  return next;
}

export class RuntimeIntentStore {
  private mergeCache = new Map<string, Record<string, unknown>>();

  constructor(private projectManager: ProjectManager) { }

  clear(): void {
    this.mergeCache.clear();
  }

  /** Drop merge overlays for specific intent GUIDs; other cached merges stay intact. */
  evictMergeGuids(guids: Iterable<string>): void {
    for (const guid of guids) {
      if (guid.length > 0) {
        this.mergeCache.delete(guid);
      }
    }
  }

  /**
   * Intent GUIDs present in {@link mergeCache} that also belong to `sceneIntentGuids`
   * (active scene baseline row set), and whose `perform.reset.scene` policy implies the UI
   * should offer clearing that merge overlay on scene transitions (effective default `true`).
   */
  listRuntimeOverlayGuidsInActiveScene(sceneIntentGuids: Iterable<string>): string[] {
    const list: string[] = [];
    for (const guid of sceneIntentGuids) {
      if (guid.length === 0 || !this.mergeCache.has(guid)) {
        continue;
      }
      const row = this.projectManager.getActiveSceneIntent(guid);
      if (!effectivePerformResetScene(row)) {
        continue;
      }
      list.push(guid);
    }
    return list;
  }

  /**
   * Effective intent for controller wire payloads and snapshots:
   * runtime merge (if any) wins, else active-scene intent (definition + scene overlay),
   * else bare definition for intents not in the active scene.
   */
  getEffectiveIntent(guid: string): ControllerIntent | undefined {
    const cached = this.mergeCache.get(guid);
    if (cached) {
      return cached as unknown as ControllerIntent;
    }
    const sceneIntent = this.projectManager.getActiveSceneIntent(guid);
    if (sceneIntent) {
      return sceneIntent;
    }
    return this.projectManager.getIntentDefinition(guid);
  }

  /**
   * Process `runtime:command` batches: update merge cache and build renderer `events` payloads.
   */
  processRuntimeUpdates(updates: RuntimeUpdate[], now: number): object[] {
    const events: object[] = [];
    for (const update of updates) {
      if (update.entityType !== 'intent') {
        continue;
      }
      const event = this.intentRuntimeUpdateToEvent(update, now);
      if (event) {
        events.push(event);
      }
    }
    return events;
  }

  private intentRuntimeUpdateToEvent(update: RuntimeUpdate, now: number): object | null {
    if (!this.projectManager.isIntentInActiveScene(update.guid)) {
      return null;
    }
    const fromProject = this.projectManager.getActiveSceneIntent(update.guid);
    if (!fromProject) {
      return null;
    }
    const previous = this.mergeCache.get(update.guid);
    const baseline = previous ?? cloneRecord(fromProject as unknown as Record<string, unknown>);
    const intent = applyRuntimePatch(baseline, update) as unknown as ControllerIntent;
    this.mergeCache.set(update.guid, cloneRecord(intent as unknown as Record<string, unknown>));
    return intentToEvent(transformIntentToNormalized(intent), now + (intent.scheduled ?? 0));
  }
}
