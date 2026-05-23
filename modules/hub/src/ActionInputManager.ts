import { randomUUID } from 'crypto';
import {
  ActionDefinition,
  ActionExecuteItem,
  InputDefinition,
  inputActionGuids,
  isCompanionAnimationRunnerAction,
  isCompanionSnapshotRunnerAction,
  ProjectManager,
  Scene,
} from './ProjectManager';
import { cloneRecord } from './dotPath';
import { GraphCommand } from './GraphProtocol';
import { Logger } from './Logger';
import {
  composeInputParamsFromCapabilities,
  hasCapabilityDisplayTypes,
  hasCapabilityInputTypes,
  isKnownDisplayType,
  isKnownInputType,
  resolveDefaultPerformTypes,
} from './inputAssignment/composeInputParams';
import { composeDefaultAnimationExecuteParams } from './inputAssignment/composeAnimationExecuteParams';

type AssignTargetType = 'scene' | 'intent' | 'sequence' | string;

export type InputAssignConfig = {
  name?: string;
  type?: string;
  displayType?: string;
} & Record<string, unknown>;

export type ActionInputCommand =
  | { command: 'ensureInputAssignment'; targetType: AssignTargetType; targetGuid: string; input: InputAssignConfig }
  | { command: 'createInputAssignment'; targetType: AssignTargetType; targetGuid: string; input: InputAssignConfig }
  | { command: 'removeInputAssignment'; targetType: AssignTargetType; targetGuid: string }
  | { command: 'renameInput'; inputGuid: string; name: string }
  | { command: 'updateInput'; inputGuid: string; input: InputAssignConfig }
  | { command: 'updateAction'; actionGuid: string; patch: Record<string, unknown> }
  | { command: 'assignExistingInput'; targetType: AssignTargetType; targetGuid: string; inputGuid: string }
  | { command: 'unlinkInputFromTarget'; targetType: AssignTargetType; targetGuid: string; inputGuid: string }
  | { command: 'deleteInput'; inputGuid: string; expectedLinkedTargetCount?: number }
  | { command: 'setInputKeyChar'; inputGuid: string; keyChar?: string | null };

function actionTargets(
  action: ActionDefinition | undefined,
  targetType: AssignTargetType,
  targetGuid: string,
): boolean {
  if (!action?.execute) return false;
  const ex = action.execute as Record<string, unknown>;
  return ex['type'] === targetType && ex['guid'] === targetGuid;
}

export class ActionInputManager {
  constructor(
    private projectManager: ProjectManager,
    private getSystemCapabilities: () => unknown = () => ({}),
  ) {}

  buildCommands(command: ActionInputCommand, controllerGuid: string): GraphCommand[] {
    switch (command.command) {
      case 'ensureInputAssignment':
        return this.ensureInputAssignmentCommands(controllerGuid, command.targetType, command.targetGuid, command.input);
      case 'createInputAssignment':
        return this.createInputAssignmentCommands(controllerGuid, command.targetType, command.targetGuid, command.input);
      case 'removeInputAssignment':
        return this.removeInputAssignmentCommands(controllerGuid, command.targetType, command.targetGuid);
      case 'renameInput':
        return this.renameInputCommands(controllerGuid, command.inputGuid, command.name);
      case 'updateInput':
        return this.updateInputCommands(controllerGuid, command.inputGuid, command.input);
      case 'updateAction':
        return this.updateActionCommands(command.actionGuid, command.patch);
      case 'assignExistingInput':
        return this.assignExistingInputCommands(controllerGuid, command.targetType, command.targetGuid, command.inputGuid);
      case 'unlinkInputFromTarget':
        return this.unlinkInputFromTargetCommands(controllerGuid, command.inputGuid, command.targetType, command.targetGuid);
      case 'deleteInput':
        return this.deleteInputCommands(controllerGuid, command.inputGuid, command.expectedLinkedTargetCount);
      case 'setInputKeyChar':
        return this.setInputKeyCharCommands(controllerGuid, command.inputGuid, command.keyChar);
    }
  }

  getAction(guid: string): ActionDefinition | undefined {
    return this.projectManager.getActionByGuid(guid);
  }

  getSceneForAction(action: ActionDefinition): Scene | undefined {
    const ex = action.execute;
    if (ex && typeof ex === 'object' && !Array.isArray(ex) && ex.type === 'scene' && typeof ex.guid === 'string') {
      return this.projectManager.getSceneByGuid(ex.guid);
    }
    return undefined;
  }

  getExecuteItemForAction(action: ActionDefinition): ActionExecuteItem | undefined {
    const ex = action.execute;
    if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return undefined;
    return ex;
  }

  getSceneForExecuteItem(item: ActionExecuteItem): Scene | undefined {
    return item.type === 'scene' && typeof item.guid === 'string'
      ? this.projectManager.getSceneByGuid(item.guid)
      : undefined;
  }

  private ensureInputAssignmentCommands(
    controllerGuid: string,
    targetType: AssignTargetType,
    targetGuid: string,
    inputConfig: InputAssignConfig,
  ): GraphCommand[] {
    return this.buildInputAssignmentCommands(
      controllerGuid,
      targetType,
      targetGuid,
      inputConfig,
      { forceNew: false },
    );
  }

  private createInputAssignmentCommands(
    controllerGuid: string,
    targetType: AssignTargetType,
    targetGuid: string,
    inputConfig: InputAssignConfig,
  ): GraphCommand[] {
    return this.buildInputAssignmentCommands(
      controllerGuid,
      targetType,
      targetGuid,
      inputConfig,
      { forceNew: true },
    );
  }

  private buildExecuteItemForAssignment(
    targetType: AssignTargetType,
    targetGuid: string,
    existingAction: ActionDefinition | undefined,
    composedParams: Record<string, unknown> | undefined,
  ): ActionExecuteItem {
    const executeItem: Record<string, unknown> = { type: targetType, guid: targetGuid };
    const prevEx = existingAction?.execute;
    if (prevEx && typeof prevEx === 'object' && !Array.isArray(prevEx)) {
      const prev = prevEx as Record<string, unknown>;
      if (prev['params'] !== undefined && typeof prev['params'] === 'object' && !Array.isArray(prev['params'])) {
        executeItem['params'] = cloneRecord(prev['params'] as Record<string, unknown>);
      }
    }
    if (targetType === 'intent' && composedParams !== undefined) {
      executeItem['params'] = composedParams;
    }
    if (targetType === 'animation') {
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
          targetGuid,
          g => this.projectManager.getAnimationByGuid(g),
        );
        if (defaults) {
          executeItem['params'] = defaults;
        }
      }
    }
    return executeItem as ActionExecuteItem;
  }

  private buildInputAssignmentCommands(
    controllerGuid: string,
    targetType: AssignTargetType,
    targetGuid: string,
    inputConfig: InputAssignConfig,
    opts: { forceNew: boolean },
  ): GraphCommand[] {
    if (targetGuid.length === 0 || targetType.length === 0) return [];
    const logLabel = opts.forceNew ? 'createInputAssignment' : 'ensureInputAssignment';
    const caps = this.getSystemCapabilities();
    const defaults = resolveDefaultPerformTypes(caps);
    const fallbackType = defaults?.type ?? 'button';
    const fallbackDisplay = defaults?.displayType ?? 'button';
    if (!defaults) {
      Logger.warn(`[action] ${logLabel}: missing systemCapabilities inputTypes/displayTypes; using button/button`);
    }

    const configuredType = typeof inputConfig.type === 'string' && inputConfig.type.length > 0
      ? inputConfig.type
      : fallbackType;
    const configuredDisplayType = typeof inputConfig.displayType === 'string' && inputConfig.displayType.length > 0
      ? inputConfig.displayType
      : fallbackDisplay;
    const configuredName = typeof inputConfig.name === 'string' ? inputConfig.name.trim() : '';

    const cfgRecord = inputConfig as Record<string, unknown>;
    if (hasCapabilityInputTypes(caps) && !isKnownInputType(caps, configuredType)) {
      Logger.warn(`[action] ${logLabel}: unknown input type "${configuredType}"`);
      return [];
    }
    if (hasCapabilityDisplayTypes(caps) && !isKnownDisplayType(caps, configuredDisplayType)) {
      Logger.warn(`[action] ${logLabel}: unknown display type "${configuredDisplayType}"`);
      return [];
    }

    const composed = composeInputParamsFromCapabilities(caps, configuredType, cfgRecord);
    if (!composed.ok) {
      Logger.warn(`[action] ${logLabel}: ${composed.reason}`);
      return [];
    }

    const targetName = this.getTargetName(targetType, targetGuid);
    const existingAction = opts.forceNew
      ? undefined
      : this.findActionByTarget(targetType, targetGuid);
    const existingInput = opts.forceNew
      ? undefined
      : this.findInputByTarget(controllerGuid, targetType, targetGuid, existingAction?.guid);
    const actionGuid = existingAction?.guid ?? `action-${randomUUID()}`;
    const inputGuid = existingInput?.guid ?? `input-${randomUUID()}`;

    const executeItem = this.buildExecuteItemForAssignment(
      targetType,
      targetGuid,
      existingAction,
      composed.params,
    );

    const action: ActionDefinition = {
      guid: actionGuid,
      name: configuredName || existingAction?.name || targetName,
      execute: executeItem,
    };

    const nextActions = existingInput ? [...inputActionGuids(existingInput)] : [];
    if (!nextActions.includes(actionGuid)) {
      nextActions.push(actionGuid);
    }

    const input: InputDefinition = {
      guid: inputGuid,
      name: configuredName || existingInput?.name || targetName,
      type: configuredType,
      display: { type: configuredDisplayType },
      actions: nextActions,
    };

    return [
      this.upsertCommand('action', actionGuid, action as unknown as Record<string, unknown>),
      this.upsertCommand(
        'input',
        inputGuid,
        input as unknown as Record<string, unknown>,
        { entityType: 'controller', guid: controllerGuid },
      ),
    ];
  }

  private scrubActionGuidFromAllInputs(actionGuid: string): GraphCommand[] {
    const commands: GraphCommand[] = [];
    for (const ctrl of this.projectManager.getControllersWirePayload()) {
      const cg = ctrl.guid;
      if (!cg) continue;
      for (const input of this.projectManager.getInputsWirePayload(cg)) {
        if (!input.guid) continue;
        const guids = inputActionGuids(input);
        if (!guids.includes(actionGuid)) continue;
        const row = cloneRecord(input as unknown as Record<string, unknown>);
        row['actions'] = guids.filter(g => g !== actionGuid);
        row['guid'] = input.guid;
        commands.push(
          this.upsertCommand('input', input.guid, row, { entityType: 'controller', guid: cg }),
        );
      }
    }
    return commands;
  }

  private removeInputAssignmentCommands(
    controllerGuid: string,
    targetType: AssignTargetType,
    targetGuid: string,
  ): GraphCommand[] {
    if (targetGuid.length === 0 || targetType.length === 0) return [];
    const actionsTouchingTarget = this.projectManager.getActionsWirePayload()
      .filter(action => actionTargets(action, targetType, targetGuid));

    const commands: GraphCommand[] = [];
    for (const action of actionsTouchingTarget) {
      const ag = action.guid;
      if (!ag) continue;
      commands.push(...this.scrubActionGuidFromAllInputs(ag));
      const keepCompanionRunner =
        (targetType === 'animation' && isCompanionAnimationRunnerAction(action, targetGuid))
        || (targetType === 'snapshot' && isCompanionSnapshotRunnerAction(action, targetGuid));
      if (!keepCompanionRunner) {
        commands.push(this.removeActionCommand(ag));
      }
    }
    return commands;
  }

  private renameInputCommands(controllerGuid: string, inputGuid: string, name: string): GraphCommand[] {
    const nextName = name.trim();
    const input = this.projectManager.getInputByGuid(inputGuid);
    if (!input?.guid || nextName.length === 0 || input.name === nextName) return [];
    return [
      this.upsertCommand(
        'input',
        input.guid,
        {
          ...(input as unknown as Record<string, unknown>),
          name: nextName,
        },
        { entityType: 'controller', guid: controllerGuid },
      ),
    ];
  }

  private updateInputCommands(
    controllerGuid: string,
    inputGuid: string,
    patch: InputAssignConfig,
  ): GraphCommand[] {
    if (inputGuid.length === 0) return [];
    const owner = this.projectManager.findControllerGuidForInput(inputGuid);
    if (owner !== controllerGuid) {
      Logger.warn('[action] updateInput: input not owned by this controller');
      return [];
    }
    const existing = this.projectManager.getInputByGuid(inputGuid);
    if (!existing?.guid) return [];

    const caps = this.getSystemCapabilities();
    const patchRecord = patch as Record<string, unknown>;
    const nextNameRaw = typeof patchRecord['name'] === 'string' ? patchRecord['name'].trim() : '';
    const nextName = nextNameRaw.length > 0 ? nextNameRaw : existing.name;
    if (!nextName || String(nextName).trim().length === 0) return [];

    const configuredType =
      typeof patch.type === 'string' && patch.type.length > 0 ? patch.type : existing.type;

    const defaults = resolveDefaultPerformTypes(caps);
    const fallbackDisplay = defaults?.displayType ?? 'button';
    const prevDisplay =
      existing.display && typeof existing.display === 'object' && !Array.isArray(existing.display)
        ? { ...(existing.display as Record<string, unknown>) }
        : {};
    const prevDisplayType = typeof prevDisplay['type'] === 'string' ? prevDisplay['type'] : '';
    const configuredDisplayType =
      typeof patch.displayType === 'string' && patch.displayType.length > 0
        ? patch.displayType
        : (prevDisplayType || fallbackDisplay);

    if (hasCapabilityInputTypes(caps) && !isKnownInputType(caps, configuredType)) {
      Logger.warn(`[action] updateInput: unknown input type "${configuredType}"`);
      return [];
    }
    if (hasCapabilityDisplayTypes(caps) && !isKnownDisplayType(caps, configuredDisplayType)) {
      Logger.warn(`[action] updateInput: unknown display type "${configuredDisplayType}"`);
      return [];
    }

    const row = cloneRecord(existing as unknown as Record<string, unknown>);
    row['name'] = nextName;
    row['type'] = configuredType;
    prevDisplay['type'] = configuredDisplayType;
    row['display'] = prevDisplay;
    row['actions'] = inputActionGuids(existing);
    row['guid'] = existing.guid;

    return [
      this.upsertCommand('input', inputGuid, row, { entityType: 'controller', guid: controllerGuid }),
    ];
  }

  private updateActionCommands(actionGuid: string, patch: Record<string, unknown>): GraphCommand[] {
    if (actionGuid.length === 0) return [];
    const action = this.projectManager.getActionByGuid(actionGuid);
    if (!action?.guid) return [];
    const row = cloneRecord(action as unknown as Record<string, unknown>);
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'guid') continue;
      if (k === 'execute' && v && typeof v === 'object' && !Array.isArray(v)) {
        row['execute'] = cloneRecord(v as Record<string, unknown>);
      } else {
        row[k] = v;
      }
    }
    row['guid'] = action.guid;
    return [this.upsertCommand('action', action.guid, row)];
  }

  private setInputKeyCharCommands(
    controllerGuid: string,
    inputGuid: string,
    keyChar: string | null | undefined,
  ): GraphCommand[] {
    const input = this.projectManager.getInputByGuid(inputGuid);
    if (!input?.guid) return [];
    const row = cloneRecord(input as unknown as Record<string, unknown>);
    const prevRaw = row['keyChar'];
    const prevNorm =
      prevRaw === undefined || prevRaw === null ? '' : String(prevRaw).trim();
    const clear = keyChar === null || keyChar === undefined || keyChar === '';
    const nextNorm = clear ? '' : String(keyChar).trim();
    if (prevNorm === nextNorm) return [];
    if (clear) {
      delete row['keyChar'];
    } else {
      row['keyChar'] = nextNorm;
    }
    row['guid'] = input.guid;
    row['actions'] = inputActionGuids(input);
    return [
      this.upsertCommand(
        'input',
        input.guid,
        row,
        { entityType: 'controller', guid: controllerGuid },
      ),
    ];
  }

  private assignExistingInputCommands(
    controllerGuid: string,
    targetType: AssignTargetType,
    targetGuid: string,
    inputGuid: string,
  ): GraphCommand[] {
    if (targetGuid.length === 0 || targetType.length === 0 || inputGuid.length === 0) return [];
    const input = this.projectManager.getInputByGuid(inputGuid);
    if (!input?.guid) return [];

    const already = inputActionGuids(input).some(ag => {
      const a = this.projectManager.getActionByGuid(ag);
      return actionTargets(a, targetType, targetGuid);
    });
    if (already) return [];

    const targetName = this.getTargetName(targetType, targetGuid);
    const newActionGuid = `action-${randomUUID()}`;
    const baseName =
      typeof input.name === 'string' && input.name.trim().length > 0 ? input.name.trim() : targetName;
    const newAction: ActionDefinition = {
      guid: newActionGuid,
      name: baseName,
      execute: this.buildExecuteItemForAssignment(targetType, targetGuid, undefined, undefined),
    };

    const inputRecord = cloneRecord(input as unknown as Record<string, unknown>);
    const nextGuids = inputActionGuids(input).filter(ag => {
      const a = this.projectManager.getActionByGuid(ag);
      return !actionTargets(a, targetType, targetGuid);
    });
    if (!nextGuids.includes(newActionGuid)) {
      nextGuids.push(newActionGuid);
    }
    inputRecord['actions'] = nextGuids;
    inputRecord['guid'] = input.guid;

    return [
      this.upsertCommand('action', newActionGuid, newAction as unknown as Record<string, unknown>),
      this.upsertCommand(
        'input',
        input.guid,
        inputRecord,
        { entityType: 'controller', guid: controllerGuid },
      ),
    ];
  }

  private unlinkInputFromTargetCommands(
    controllerGuid: string,
    inputGuid: string,
    targetType: AssignTargetType,
    targetGuid: string,
  ): GraphCommand[] {
    if (targetGuid.length === 0 || targetType.length === 0 || inputGuid.length === 0) return [];
    const owner = this.projectManager.findControllerGuidForInput(inputGuid);
    if (owner !== controllerGuid) {
      Logger.warn('[action] unlinkInputFromTarget: input not owned by this controller');
      return [];
    }
    const input = this.projectManager.getInputByGuid(inputGuid);
    if (!input?.guid) return [];

    const guids = inputActionGuids(input);
    let actionGuidToRemove: string | null = null;
    for (const ag of guids) {
      const a = this.projectManager.getActionByGuid(ag);
      if (actionTargets(a, targetType, targetGuid)) {
        actionGuidToRemove = ag;
        break;
      }
    }
    if (!actionGuidToRemove) return [];

    const nextGuids = guids.filter(g => g !== actionGuidToRemove);
    const row = cloneRecord(input as unknown as Record<string, unknown>);
    row['actions'] = nextGuids;
    row['guid'] = input.guid;

    const commands: GraphCommand[] = [
      this.upsertCommand('input', inputGuid, row, { entityType: 'controller', guid: controllerGuid }),
    ];

    const keep = this.isActionReferencedInGraph(actionGuidToRemove, {
      excludingInputGuids: new Set([inputGuid]),
    });
    if (!keep) {
      const action = this.projectManager.getActionByGuid(actionGuidToRemove);
      if (
        action
        && (
          (targetType === 'animation' && isCompanionAnimationRunnerAction(action, targetGuid))
          || (targetType === 'snapshot' && isCompanionSnapshotRunnerAction(action, targetGuid))
        )
      ) {
        return commands;
      }
      commands.push(this.removeActionCommand(actionGuidToRemove));
    }
    return commands;
  }

  private deleteInputCommands(
    controllerGuid: string,
    inputGuid: string,
    expectedLinkedTargetCount?: number,
  ): GraphCommand[] {
    if (inputGuid.length === 0) return [];
    const input = this.projectManager.getInputByGuid(inputGuid);
    if (!input?.guid) return [];
    const linkedCount = inputActionGuids(input).length;
    if (
      expectedLinkedTargetCount !== undefined
      && Number.isFinite(expectedLinkedTargetCount)
      && expectedLinkedTargetCount >= 0
      && linkedCount !== expectedLinkedTargetCount
    ) {
      Logger.warn(
        `[action] deleteInput aborted: stale linked action count for ${inputGuid} (expected ${expectedLinkedTargetCount}, actual ${linkedCount})`,
      );
      return [];
    }

    const actionGuids = inputActionGuids(input);
    const commands: GraphCommand[] = [{
      op: 'remove',
      entityType: 'input',
      guid: inputGuid,
      persistence: 'runtimeAndDurable',
      parent: { entityType: 'controller', guid: controllerGuid },
    }];

    for (const ag of actionGuids) {
      const keep = this.isActionReferencedInGraph(ag, {
        excludingInputGuids: new Set([inputGuid]),
      });
      if (!keep) {
        commands.push(this.removeActionCommand(ag));
      }
    }
    return commands;
  }

  buildSceneCleanupCommands(sceneGuid: string): GraphCommand[] {
    const actionsTouchingScene = this.projectManager.getActionsWirePayload()
      .filter(action => this.actionTargetsScene(action, sceneGuid));

    const commands: GraphCommand[] = [];
    for (const action of actionsTouchingScene) {
      const ag = action.guid;
      if (!ag) continue;
      commands.push(...this.scrubActionGuidFromAllInputs(ag));
      commands.push(this.removeActionCommand(ag));
    }
    return commands;
  }

  buildAnimationCleanupCommands(animationGuid: string): GraphCommand[] {
    const action = this.projectManager.getActionByGuid(animationGuid);
    if (!action) return [];
    const stillReferenced = this.isActionReferencedInGraph(animationGuid, {
      excludingActionGuids: new Set([animationGuid]),
    });
    if (stillReferenced) return [];
    return [this.removeActionCommand(animationGuid)];
  }

  buildSnapshotCleanupCommands(snapshotGuid: string): GraphCommand[] {
    const actionsTouchingSnapshot = this.projectManager.getActionsWirePayload()
      .filter(action => actionTargets(action, 'snapshot', snapshotGuid));

    const commands: GraphCommand[] = [];
    for (const action of actionsTouchingSnapshot) {
      const ag = action.guid;
      if (!ag) continue;
      commands.push(...this.scrubActionGuidFromAllInputs(ag));
      commands.push(this.removeActionCommand(ag));
    }
    return commands;
  }

  private actionTargetsScene(action: ActionDefinition, sceneGuid: string): boolean {
    return actionTargets(action, 'scene', sceneGuid);
  }

  private findActionByTarget(targetType: AssignTargetType, targetGuid: string): ActionDefinition | undefined {
    return this.projectManager.getActionsWirePayload()
      .find(action => actionTargets(action, targetType, targetGuid));
  }

  private findInputByTarget(
    controllerGuid: string,
    targetType: AssignTargetType,
    targetGuid: string,
    actionGuid?: string,
  ): InputDefinition | undefined {
    const inputs = this.projectManager.getInputsWirePayload(controllerGuid);
    if (actionGuid !== undefined) {
      const byAction = inputs.find(inp => inputActionGuids(inp).includes(actionGuid));
      if (byAction) return byAction;
    }
    return inputs.find(inp =>
      inputActionGuids(inp).some(ag => {
        const a = this.projectManager.getActionByGuid(ag);
        return actionTargets(a, targetType, targetGuid);
      }),
    );
  }

  private getTargetName(targetType: AssignTargetType, targetGuid: string): string {
    switch (targetType) {
      case 'scene':
        return this.projectManager.getSceneByGuid(targetGuid)?.name ?? targetGuid;
      case 'snapshot':
        return this.projectManager.getSnapshotByGuid(targetGuid)?.name ?? targetGuid;
      case 'intent':
        return this.projectManager.getIntentDefinition(targetGuid)?.name ?? targetGuid;
      default:
        return targetGuid;
    }
  }

  private isActionReferencedInGraph(
    actionGuid: string,
    opts: {
      excludingInputGuids?: Set<string>;
      excludingActionGuids?: Set<string>;
    } = {},
  ): boolean {
    const excludingInputGuids = opts.excludingInputGuids ?? new Set<string>();
    const excludingActionGuids = opts.excludingActionGuids ?? new Set<string>();
    const graph = {
      controllers: this.projectManager.getControllersWirePayload(),
      scenes: this.projectManager.getScenesWirePayload(),
      actions: this.projectManager.getActionsWirePayload(),
      animations: this.projectManager.getAnimationsWirePayload(),
      snapshots: this.projectManager.getSnapshotsWirePayload(),
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
      if (scope === 'inputs') {
        const inputGuid = typeof row.guid === 'string' ? row.guid : '';
        if (inputGuid && excludingInputGuids.has(inputGuid)) return false;
      }
      if (scope === 'actions') {
        const rowGuid = typeof row.guid === 'string' ? row.guid : '';
        if (rowGuid && excludingActionGuids.has(rowGuid)) return false;
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
    entityType: 'action' | 'input',
    guid: string,
    value: Record<string, unknown>,
    parent?: { entityType: 'controller'; guid: string },
  ): GraphCommand {
    return {
      op: 'upsert',
      entityType,
      guid,
      value,
      persistence: 'runtimeAndDurable',
      ...(parent !== undefined ? { parent } : {}),
    };
  }
}
