/**
 * Hub-authoritative runtime intent overlay (perform).
 *
 * **Dumb-controller contract (parity intent):**
 * - Controllers send `runtime:command` deltas only; they apply `runtime:update`, `projectPatch`,
 *   `graph:init`, and `graph:delta` to stay in sync — no parallel merge authority.
 * - Parity checklist: perform drag moves fixtures in sim; scene switch keeps hub + HUD + sim aligned;
 *   second controller tab receives `runtime:update`.
 *
 * Runtime state is a **dot-path patch bag** on top of the **current** active-scene baseline
 * (`getActiveSceneIntent`: definition + scene ref overlay). `getEffectiveIntent` always
 * rebases on that baseline so fields never touched by runtime pick up the new scene after
 * a scene switch. Invalidation (`clear` / `evictMergeGuids`) mirrors `ProjectGraphStore` /
 * `IntentsHandler` triggers.
 */

import { ProjectManager, ControllerIntent } from './ProjectManager';
import { RuntimeUpdate } from './RuntimeProtocol';
import { applyDotPathPatch, cloneRecord, diffRecordsToPatch, removeAtDotPath, setAtDotPath } from './dotPath';
import { effectivePerformResetScene, intentToEvent } from './handlers/intentHelpers';
import { transformIntentToNormalized } from './intents';

function applyRuntimePatch(base: Record<string, unknown>, update: RuntimeUpdate): Record<string, unknown> {
  const next = cloneRecord(
    update.value && typeof update.value === 'object' && !Array.isArray(update.value)
      ? (update.value as Record<string, unknown>)
      : base,
  );
  next['guid'] = update.guid;
  for (const [key, value] of Object.entries(update.patch ?? {})) {
    setAtDotPath(next, key, value);
  }
  for (const key of update.remove ?? []) {
    removeAtDotPath(next, key);
  }
  return next;
}

type RuntimeOverlay = { patch: Record<string, unknown> };

function overlayHasKeys(overlay: RuntimeOverlay | undefined): boolean {
  return !!overlay && Object.keys(overlay.patch).length > 0;
}

export class RuntimeIntentStore {
  private runtimeOverlayByGuid = new Map<string, RuntimeOverlay>();

  constructor(private projectManager: ProjectManager) { }

  clear(): void {
    this.runtimeOverlayByGuid.clear();
  }

  /** Drop merge overlays for specific intent GUIDs; other cached merges stay intact. */
  evictMergeGuids(guids: Iterable<string>): void {
    for (const guid of guids) {
      if (guid.length > 0) {
        this.runtimeOverlayByGuid.delete(guid);
      }
    }
  }

  /**
   * Intent GUIDs present in the runtime overlay that also belong to `sceneIntentGuids`
   * (active scene baseline row set), and whose `perform.reset.scene` policy implies the UI
   * should offer clearing that merge overlay on scene transitions (effective default `true`).
   */
  listRuntimeOverlayGuidsInActiveScene(sceneIntentGuids: Iterable<string>): string[] {
    const list: string[] = [];
    for (const guid of sceneIntentGuids) {
      if (guid.length === 0 || !overlayHasKeys(this.runtimeOverlayByGuid.get(guid))) {
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
   * active-scene baseline (definition + scene overlay) plus runtime patch bag when present;
   * otherwise active-scene intent or bare definition for intents not in the active scene.
   */
  getEffectiveIntent(guid: string): ControllerIntent | undefined {
    const overlay = this.runtimeOverlayByGuid.get(guid);
    if (overlayHasKeys(overlay)) {
      const base = this.projectManager.getActiveSceneIntent(guid)
        ?? this.projectManager.getIntentDefinition(guid);
      if (!base) {
        return undefined;
      }
      return applyDotPathPatch(
        cloneRecord(base as unknown as Record<string, unknown>),
        overlay!.patch,
        [],
      ) as unknown as ControllerIntent;
    }
    const sceneIntent = this.projectManager.getActiveSceneIntent(guid);
    if (sceneIntent) {
      return sceneIntent;
    }
    return this.projectManager.getIntentDefinition(guid);
  }

  /**
   * Process `runtime:command` batches: update runtime overlay and build renderer `events` payloads.
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
    const sceneBaseline = cloneRecord(fromProject as unknown as Record<string, unknown>);
    const existing = this.runtimeOverlayByGuid.get(update.guid);
    const composed = applyDotPathPatch(sceneBaseline, existing?.patch ?? {});
    const after = applyRuntimePatch(composed, update);
    const patch = diffRecordsToPatch(sceneBaseline, after);
    if (Object.keys(patch).length === 0) {
      this.runtimeOverlayByGuid.delete(update.guid);
    } else {
      this.runtimeOverlayByGuid.set(update.guid, { patch });
    }
    const eff = this.getEffectiveIntent(update.guid);
    if (!eff) {
      return null;
    }
    return intentToEvent(transformIntentToNormalized(eff), now + (eff.scheduled ?? 0));
  }
}
