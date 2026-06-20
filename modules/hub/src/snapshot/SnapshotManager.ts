import { randomUUID } from 'crypto';
import type { AnimationManager } from '../animation/AnimationManager';
import { GraphMutationResult, GraphPersistence, emptyMutationResult } from '../GraphProtocol';
import { Logger } from '../Logger';
import type { ProjectGraphStore } from '../ProjectGraphStore';
import type {
  ProjectManager,
  SnapshotDefinition,
  SnapshotRecallFlags,
} from '../ProjectManager';
import type { PulseManager } from '../pulse/PulseManager';
import type { PulseSetupManager } from '../pulse/PulseSetupManager';

export type SnapshotCaptureInput = {
  name: string;
  recall: SnapshotRecallFlags;
  guid?: string;
};

export type SnapshotMetadataPatch = {
  name?: string;
  recall?: SnapshotRecallFlags;
};

export class SnapshotManager {
  /**
   * GUID of the most recently recalled snapshot, held in memory only (never persisted).
   * Broadcast to controllers as the "last recalled" highlight and replayed to controllers
   * on register so fresh/reloaded surfaces show the same highlight.
   */
  private lastRecalledSnapshotGuid: string | null = null;

  constructor(
    private projectManager: ProjectManager,
    private graphStore: ProjectGraphStore,
    private pulseManager: PulseManager,
    private pulseSetupManager: PulseSetupManager,
    private animationManager: AnimationManager,
  ) { }

  getLastRecalledSnapshotGuid(): string | null {
    return this.lastRecalledSnapshotGuid;
  }

  captureFromLive(input: SnapshotCaptureInput): GraphMutationResult {
    if (this.animationManager.hasOpenEditMode()) {
      Logger.warn('[snapshot] capture blocked — animation edit mode is open');
      return emptyMutationResult(this.graphStore.getRevision());
    }

    const activeSceneGuid = this.projectManager.getActiveSceneGuid() ?? '';
    const snapshot: SnapshotDefinition = {
      guid: input.guid ?? `snapshot-${randomUUID()}`,
      name: input.name.trim().length > 0 ? input.name.trim() : 'Snapshot',
      recall: { ...input.recall },
      activeSceneGuid,
      pulses: this.pulseManager.captureRunnerStates(),
      animations: this.animationManager.captureRunnerStates(),
    };

    const existing = this.projectManager.getSnapshotsWirePayload();
    const idx = existing.findIndex(s => s.guid === snapshot.guid);
    const next = [...existing];
    if (idx >= 0) {
      next[idx] = snapshot;
    } else {
      next.push(snapshot);
    }
    this.projectManager.setProjectData('snapshots', next);

    return this.graphStore.applySnapshotUpsert(snapshot);
  }

  updateMetadata(guid: string, patch: SnapshotMetadataPatch): GraphMutationResult {
    const row = this.projectManager.getSnapshotByGuid(guid);
    if (!row) {
      Logger.warn(`[snapshot] updateMetadata: unknown snapshot ${guid}`);
      return emptyMutationResult(this.graphStore.getRevision());
    }
    const next: SnapshotDefinition = {
      ...row,
      ...(patch.name !== undefined ? { name: patch.name.trim().length > 0 ? patch.name.trim() : row.name } : {}),
      ...(patch.recall !== undefined ? { recall: { ...patch.recall } } : {}),
    };
    const snapshots = this.projectManager.getSnapshotsWirePayload().map(s =>
      s.guid === guid ? next : s,
    );
    this.projectManager.setProjectData('snapshots', snapshots);
    return this.graphStore.applySnapshotMetadataPatch(guid, {
      name: next.name,
      recall: next.recall,
    });
  }

  recall(
    snapshotGuid: string,
    location?: [number, number],
    persistence: GraphPersistence = 'runtime',
  ): GraphMutationResult {
    const snapshot = this.projectManager.getSnapshotByGuid(snapshotGuid);
    if (!snapshot?.guid) {
      Logger.warn(`[snapshot] recall: unknown snapshot ${snapshotGuid}`);
      return emptyMutationResult(this.graphStore.getRevision());
    }

    this.lastRecalledSnapshotGuid = snapshot.guid;

    const results: GraphMutationResult[] = [];
    const { recall } = snapshot;

    if (recall.scene && snapshot.activeSceneGuid.length > 0) {
      results.push(this.graphStore.activateScene(
        snapshot.activeSceneGuid,
        location,
        persistence,
        { runtimeMergeClear: 'all' },
      ));
    }

    if (recall.animations) {
      this.animationManager.recallSnapshotAnimations(snapshot.animations, location);
    }

    if (recall.pulse) {
      this.pulseManager.recallSnapshotPulses(snapshot.pulses, this.pulseSetupManager);
    }

    return this.mergeMutationResults(results);
  }

  private mergeMutationResults(results: GraphMutationResult[]): GraphMutationResult {
    if (results.length === 0) {
      return emptyMutationResult(this.graphStore.getRevision());
    }
    return {
      revision: results[results.length - 1]!.revision,
      controllerDeltas: results.flatMap(r => r.controllerDeltas),
      rendererEvents: results.flatMap(r => r.rendererEvents),
      rendererConfigChangedFor: results.flatMap(r => r.rendererConfigChangedFor),
      durableChanged: results.some(r => r.durableChanged),
    };
  }
}
