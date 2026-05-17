import { randomUUID } from 'crypto';
import {
  ActionDefinition,
  ActionExecuteItem,
  ProjectManager,
  PulseBucket,
} from '../ProjectManager';
import { cloneRecord } from '../dotPath';
import { GraphCommand } from '../GraphProtocol';
import { Logger } from '../Logger';
import { composeDefaultAnimationExecuteParams } from '../inputAssignment/composeAnimationExecuteParams';

export type PulseAssignCommand =
  | { command: 'linkAnimationToBucket'; bucketGuid: string; animationGuid: string }
  | { command: 'unlinkAnimationFromBucket'; bucketGuid: string; animationGuid: string }
  | { command: 'createBucket'; name?: string }
  | { command: 'createBucketAssignment'; animationGuid: string; name?: string }
  | { command: 'renameBucket'; bucketGuid: string; name: string }
  | { command: 'deleteBucket'; bucketGuid: string };

export type PulseAssignResult = {
  graphCommands: GraphCommand[];
  pulsesChanged: boolean;
};

function actionTargetsAnimation(
  action: ActionDefinition | undefined,
  animationGuid: string,
): boolean {
  if (!action?.execute) return false;
  const ex = action.execute as Record<string, unknown>;
  return ex['type'] === 'animation' && ex['guid'] === animationGuid;
}

export class PulseBucketAssignManager {
  constructor(
    private projectManager: ProjectManager,
    private getSystemCapabilities: () => unknown = () => ({}),
  ) {}

  build(command: PulseAssignCommand): PulseAssignResult {
    switch (command.command) {
      case 'linkAnimationToBucket':
        return this.linkAnimationToBucket(command.bucketGuid, command.animationGuid);
      case 'unlinkAnimationFromBucket':
        return this.unlinkAnimationFromBucket(command.bucketGuid, command.animationGuid);
      case 'createBucket':
        return this.createBucket(command.name);
      case 'createBucketAssignment':
        return this.createBucketAssignment(command.animationGuid, command.name);
      case 'renameBucket':
        return this.renameBucket(command.bucketGuid, command.name);
      case 'deleteBucket':
        return this.deleteBucket(command.bucketGuid);
    }
  }

  private linkAnimationToBucket(bucketGuid: string, animationGuid: string): PulseAssignResult {
    if (bucketGuid.length === 0 || animationGuid.length === 0) {
      return { graphCommands: [], pulsesChanged: false };
    }
    const bucket = this.projectManager.getPulseBucket(bucketGuid);
    if (!bucket) {
      Logger.warn(`[pulse] linkAnimationToBucket: unknown bucket ${bucketGuid}`);
      return { graphCommands: [], pulsesChanged: false };
    }

    const existing = (bucket.actions ?? []).some(ag => {
      const a = this.projectManager.getActionByGuid(ag);
      return actionTargetsAnimation(a, animationGuid);
    });
    if (existing) {
      return { graphCommands: [], pulsesChanged: false };
    }

    const animName =
      this.projectManager.getAnimationByGuid(animationGuid)?.name ?? animationGuid;
    const bucketLabel =
      typeof bucket.name === 'string' && bucket.name.trim().length > 0
        ? bucket.name.trim()
        : bucketGuid;
    const newActionGuid = `action-${randomUUID()}`;
    const executeItem = this.buildAnimationExecuteItem(animationGuid, undefined);
    const newAction: ActionDefinition = {
      guid: newActionGuid,
      name: `${bucketLabel} → ${animName}`,
      execute: executeItem,
    };

    const nextActions = [...(bucket.actions ?? [])];
    if (!nextActions.includes(newActionGuid)) {
      nextActions.push(newActionGuid);
    }
    this.updateBucketActions(bucketGuid, nextActions);

    return {
      graphCommands: [
        this.upsertCommand('action', newActionGuid, newAction as unknown as Record<string, unknown>),
      ],
      pulsesChanged: true,
    };
  }

  private unlinkAnimationFromBucket(bucketGuid: string, animationGuid: string): PulseAssignResult {
    if (bucketGuid.length === 0 || animationGuid.length === 0) {
      return { graphCommands: [], pulsesChanged: false };
    }
    const bucket = this.projectManager.getPulseBucket(bucketGuid);
    if (!bucket) {
      return { graphCommands: [], pulsesChanged: false };
    }

    const toRemove: string[] = [];
    for (const ag of bucket.actions ?? []) {
      const a = this.projectManager.getActionByGuid(ag);
      if (actionTargetsAnimation(a, animationGuid)) {
        toRemove.push(ag);
      }
    }
    if (toRemove.length === 0) {
      return { graphCommands: [], pulsesChanged: false };
    }

    const removeSet = new Set(toRemove);
    const nextActions = (bucket.actions ?? []).filter(ag => !removeSet.has(ag));
    this.updateBucketActions(bucketGuid, nextActions);

    const commands: GraphCommand[] = [];
    for (const ag of toRemove) {
      const keep = this.isActionReferencedInGraph(ag, {
        excludingBucketGuids: new Set([bucketGuid]),
      });
      if (!keep) {
        commands.push(this.removeActionCommand(ag));
      }
    }

    return { graphCommands: commands, pulsesChanged: true };
  }

  private createBucket(name?: string): PulseAssignResult {
    const config = this.projectManager.ensurePulsesConfig();
    const bucketGuid = `bucket-${randomUUID()}`;
    const trimmed = typeof name === 'string' ? name.trim() : '';
    const bucket: PulseBucket = {
      guid: bucketGuid,
      name: trimmed.length > 0 ? trimmed : bucketGuid,
      actions: [],
    };
    config.buckets.push(bucket);
    this.persistPulses();
    return { graphCommands: [], pulsesChanged: true };
  }

  private createBucketAssignment(animationGuid: string, name?: string): PulseAssignResult {
    const created = this.createBucket(name);
    const config = this.projectManager.ensurePulsesConfig();
    const bucket = config.buckets[config.buckets.length - 1];
    const bucketGuid = bucket?.guid;
    if (!bucketGuid) {
      return created;
    }
    const linked = this.linkAnimationToBucket(bucketGuid, animationGuid);
    return {
      graphCommands: [...created.graphCommands, ...linked.graphCommands],
      pulsesChanged: created.pulsesChanged || linked.pulsesChanged,
    };
  }

  private renameBucket(bucketGuid: string, name: string): PulseAssignResult {
    if (bucketGuid.length === 0) {
      return { graphCommands: [], pulsesChanged: false };
    }
    const bucket = this.projectManager.getPulseBucket(bucketGuid);
    if (!bucket) {
      return { graphCommands: [], pulsesChanged: false };
    }
    const trimmed = name.trim();
    if (trimmed.length === 0 || bucket.name === trimmed) {
      return { graphCommands: [], pulsesChanged: false };
    }
    bucket.name = trimmed;
    this.persistPulses();
    return { graphCommands: [], pulsesChanged: true };
  }

  private deleteBucket(bucketGuid: string): PulseAssignResult {
    if (bucketGuid.length === 0) {
      return { graphCommands: [], pulsesChanged: false };
    }
    const config = this.projectManager.ensurePulsesConfig();
    const bucket = config.buckets.find(b => b.guid === bucketGuid);
    if (!bucket) {
      return { graphCommands: [], pulsesChanged: false };
    }

    for (const setup of config.setups) {
      for (const slot of setup.slots) {
        if (slot.bucket === bucketGuid) {
          delete slot.bucket;
        }
      }
    }

    const actionGuids = [...(bucket.actions ?? [])];
    config.buckets = config.buckets.filter(b => b.guid !== bucketGuid);

    const commands: GraphCommand[] = [];
    for (const ag of actionGuids) {
      const keep = this.isActionReferencedInGraph(ag, {
        excludingBucketGuids: new Set([bucketGuid]),
      });
      if (!keep) {
        commands.push(this.removeActionCommand(ag));
      }
    }

    this.persistPulses();
    return { graphCommands: commands, pulsesChanged: true };
  }

  private updateBucketActions(bucketGuid: string, nextActions: string[]): void {
    const config = this.projectManager.ensurePulsesConfig();
    const bucket = config.buckets.find(b => b.guid === bucketGuid);
    if (!bucket) return;
    bucket.actions = nextActions;
    this.persistPulses();
  }

  private persistPulses(): void {
    this.projectManager.setProjectData('pulses', this.projectManager.getPulsesWirePayload());
  }

  private buildAnimationExecuteItem(
    animationGuid: string,
    existingAction: ActionDefinition | undefined,
  ): ActionExecuteItem {
    const executeItem: Record<string, unknown> = { type: 'animation', guid: animationGuid };
    const prevEx = existingAction?.execute;
    if (prevEx && typeof prevEx === 'object' && !Array.isArray(prevEx)) {
      const prev = prevEx as Record<string, unknown>;
      if (prev['params'] !== undefined && typeof prev['params'] === 'object' && !Array.isArray(prev['params'])) {
        executeItem['params'] = cloneRecord(prev['params'] as Record<string, unknown>);
      }
    }
    const prevParams = executeItem['params'];
    const prevRec =
      prevParams && typeof prevParams === 'object' && !Array.isArray(prevParams)
        ? (prevParams as Record<string, unknown>)
        : undefined;
    const hasCommand =
      typeof prevRec?.['command'] === 'string' && prevRec['command'].length > 0;
    if (!hasCommand) {
      const defaults = composeDefaultAnimationExecuteParams(
        this.getSystemCapabilities(),
        animationGuid,
        g => this.projectManager.getAnimationByGuid(g),
      );
      if (defaults) {
        executeItem['params'] = defaults;
      }
    }
    return executeItem as ActionExecuteItem;
  }

  private isActionReferencedInGraph(
    actionGuid: string,
    opts: {
      excludingBucketGuids?: Set<string>;
    } = {},
  ): boolean {
    const excludingBucketGuids = opts.excludingBucketGuids ?? new Set<string>();
    const graph = {
      controllers: this.projectManager.getControllersWirePayload(),
      scenes: this.projectManager.getScenesWirePayload(),
      actions: this.projectManager.getActionsWirePayload(),
      animations: this.projectManager.getAnimationsWirePayload(),
      pulses: this.projectManager.getPulsesWirePayload(),
    } as Record<string, unknown>;

    const scan = (value: unknown, path: string[]): boolean => {
      if (value === actionGuid) return true;
      if (!value || typeof value !== 'object') return false;

      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (scan(value[i], [...path, String(i)])) return true;
        }
        return false;
      }

      const row = value as Record<string, unknown>;
      const scope = path[path.length - 2] ?? '';
      if (scope === 'buckets') {
        const bg = typeof row.guid === 'string' ? row.guid : '';
        if (bg && excludingBucketGuids.has(bg)) return false;
      }

      for (const [key, entry] of Object.entries(row)) {
        if (scan(entry, [...path, key])) return true;
      }
      return false;
    };

    return scan(graph, []);
  }

  private removeActionCommand(guid: string): GraphCommand {
    return {
      op: 'remove',
      entityType: 'action',
      guid,
      persistence: 'runtimeAndDurable',
    };
  }

  private upsertCommand(
    entityType: 'action',
    guid: string,
    value: Record<string, unknown>,
  ): GraphCommand {
    return {
      op: 'upsert',
      entityType,
      guid,
      value,
      persistence: 'runtimeAndDurable',
    };
  }
}
