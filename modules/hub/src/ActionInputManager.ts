import { randomUUID } from 'crypto';
import { ActionDefinition, ActionExecuteItem, InputDefinition, ProjectManager, Scene } from './ProjectManager';
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

type AssignTargetType = 'scene' | 'intent' | 'sequence' | string;

export type InputAssignConfig = {
  name?: string;
  type?: string;
  displayType?: string;
} & Record<string, unknown>;

export type ActionInputCommand =
  | { command: 'ensureInputAssignment'; targetType: AssignTargetType; targetGuid: string; input: InputAssignConfig }
  | { command: 'removeInputAssignment'; targetType: AssignTargetType; targetGuid: string }
  | { command: 'renameInput'; inputGuid: string; name: string }
  | { command: 'assignExistingInput'; targetType: AssignTargetType; targetGuid: string; inputGuid: string }
  | { command: 'deleteInput'; inputGuid: string; expectedLinkedTargetCount?: number };

export class ActionInputManager {
  constructor(
    private projectManager: ProjectManager,
    private getSystemCapabilities: () => unknown = () => ({}),
  ) {}

  buildCommands(command: ActionInputCommand, controllerGuid: string): GraphCommand[] {
    switch (command.command) {
      case 'ensureInputAssignment':
        return this.ensureInputAssignmentCommands(controllerGuid, command.targetType, command.targetGuid, command.input);
      case 'removeInputAssignment':
        return this.removeInputAssignmentCommands(controllerGuid, command.targetType, command.targetGuid);
      case 'renameInput':
        return this.renameInputCommands(controllerGuid, command.inputGuid, command.name);
      case 'assignExistingInput':
        return this.assignExistingInputCommands(controllerGuid, command.targetType, command.targetGuid, command.inputGuid);
      case 'deleteInput':
        return this.deleteInputCommands(controllerGuid, command.inputGuid, command.expectedLinkedTargetCount);
    }
  }

  getAction(guid: string): ActionDefinition | undefined {
    return this.projectManager.getActionByGuid(guid);
  }

  getSceneForAction(action: ActionDefinition): Scene | undefined {
    const execute = Array.isArray(action.execute)
      ? action.execute.find(item => item.type === 'scene')
      : undefined;
    return execute ? this.getSceneForExecuteItem(execute) : undefined;
  }

  getExecuteItemsForAction(action: ActionDefinition): ActionExecuteItem[] {
    return Array.isArray(action.execute) ? action.execute : [];
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
    if (targetGuid.length === 0 || targetType.length === 0) return [];
    const caps = this.getSystemCapabilities();
    const defaults = resolveDefaultPerformTypes(caps);
    const fallbackType = defaults?.type ?? 'button';
    const fallbackDisplay = defaults?.displayType ?? 'button';
    if (!defaults) {
      Logger.warn('[action] ensureInputAssignment: missing systemCapabilities inputTypes/displayTypes; using button/button');
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
      Logger.warn(`[action] ensureInputAssignment: unknown input type "${configuredType}"`);
      return [];
    }
    if (hasCapabilityDisplayTypes(caps) && !isKnownDisplayType(caps, configuredDisplayType)) {
      Logger.warn(`[action] ensureInputAssignment: unknown display type "${configuredDisplayType}"`);
      return [];
    }

    const composed = composeInputParamsFromCapabilities(caps, configuredType, cfgRecord);
    if (!composed.ok) {
      Logger.warn(`[action] ensureInputAssignment: ${composed.reason}`);
      return [];
    }

    const targetName = this.getTargetName(targetType, targetGuid);
    const existingAction = this.findActionByTarget(targetType, targetGuid);
    const existingInput = this.findInputByTarget(controllerGuid, targetType, targetGuid, existingAction?.guid);
    const actionGuid = existingAction?.guid ?? `action-${randomUUID()}`;
    const inputGuid = existingInput?.guid ?? `input-${randomUUID()}`;
    const action: ActionDefinition = {
      guid: actionGuid,
      name: configuredName || existingAction?.name || targetName,
      execute: [{ type: targetType, guid: targetGuid }],
    };

    const params = composed.params;
    const input: InputDefinition = {
      guid: inputGuid,
      name: configuredName || existingInput?.name || targetName,
      type: configuredType,
      action: actionGuid,
      target: { type: targetType, guid: targetGuid },
      display: { type: configuredDisplayType },
      ...((targetType === 'scene'
        ? { context: targetGuid }
        : (typeof existingInput?.context === 'string' ? { context: existingInput.context } : {}))),
      ...(params !== undefined ? { params } : {}),
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

  /**
   * Drops linkage to a target: trims `action.execute`, or orphans inputs + removes action when empty.
   * Inputs are never removed — they become unassigned (no `target` / `action` / `context`).
   */
  private removeInputAssignmentCommands(
    controllerGuid: string,
    targetType: AssignTargetType,
    targetGuid: string,
  ): GraphCommand[] {
    if (targetGuid.length === 0 || targetType.length === 0) return [];
    const controllerInputs = this.projectManager.getInputsWirePayload(controllerGuid);
    const actionsTouchingTarget = this.projectManager.getActionsWirePayload()
      .filter(action => this.actionTargets(action, targetType, targetGuid));

    const commands: GraphCommand[] = [];
    const orphanedInputGuids = new Set<string>();

    for (const action of actionsTouchingTarget) {
      if (!action.guid || !Array.isArray(action.execute)) continue;
      const remainingExecute = action.execute.filter(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
        const record = item as Record<string, unknown>;
        return !(record['type'] === targetType && record['guid'] === targetGuid);
      });

      if (remainingExecute.length === action.execute.length) {
        continue;
      }

      if (remainingExecute.length > 0) {
        commands.push(
          this.upsertCommand('action', action.guid, {
            ...(action as unknown as Record<string, unknown>),
            execute: remainingExecute,
          }),
        );
        continue;
      }

      const inputsForAction = controllerInputs.filter(
        inp => typeof inp.action === 'string' && inp.action === action.guid,
      );
      const strippedForThisAction = new Set<string>();
      for (const input of inputsForAction) {
        if (!input.guid) continue;
        strippedForThisAction.add(input.guid);
        orphanedInputGuids.add(input.guid);
        commands.push(
          this.upsertCommand(
            'input',
            input.guid,
            this.inputStrippedOfAssignment(input),
            { entityType: 'controller', guid: controllerGuid },
          ),
        );
      }

      const referencedElsewhere = this.isActionReferencedInGraph(action.guid, {
        excludingInputGuids: strippedForThisAction,
        excludingActionGuids: new Set([action.guid]),
      });
      if (!referencedElsewhere) {
        commands.push(this.removeActionCommand(action.guid));
      }
    }

    for (const input of controllerInputs) {
      if (!input.guid || orphanedInputGuids.has(input.guid)) continue;
      if (!this.inputTargets(input, targetType, targetGuid)) continue;
      const ag = typeof input.action === 'string' ? input.action : '';
      if (ag.length > 0) continue;
      orphanedInputGuids.add(input.guid);
      commands.push(
        this.upsertCommand(
          'input',
          input.guid,
          this.inputStrippedOfAssignment(input),
          { entityType: 'controller', guid: controllerGuid },
        ),
      );
    }

    return commands;
  }

  private inputStrippedOfAssignment(input: InputDefinition): Record<string, unknown> {
    const row = cloneRecord(input as unknown as Record<string, unknown>);
    delete row['target'];
    delete row['action'];
    delete row['context'];
    if (typeof input.guid === 'string' && input.guid.length > 0) {
      row['guid'] = input.guid;
    }
    return row;
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

  private assignExistingInputCommands(
    controllerGuid: string,
    targetType: AssignTargetType,
    targetGuid: string,
    inputGuid: string,
  ): GraphCommand[] {
    if (targetGuid.length === 0 || targetType.length === 0 || inputGuid.length === 0) return [];
    const input = this.projectManager.getInputByGuid(inputGuid);
    if (!input?.guid) return [];
    const actionGuid = typeof input.action === 'string' ? input.action : '';
    const action = actionGuid ? this.projectManager.getActionByGuid(actionGuid) : undefined;

    if (!actionGuid || !action?.guid) {
      const targetName = this.getTargetName(targetType, targetGuid);
      const newActionGuid = `action-${randomUUID()}`;
      const baseName =
        typeof input.name === 'string' && input.name.trim().length > 0 ? input.name.trim() : targetName;
      const newAction: ActionDefinition = {
        guid: newActionGuid,
        name: baseName,
        execute: [{ type: targetType, guid: targetGuid }],
      };
      const inputRecord = cloneRecord(input as unknown as Record<string, unknown>);
      inputRecord['action'] = newActionGuid;
      inputRecord['target'] = { type: targetType, guid: targetGuid };
      if (targetType === 'scene') {
        inputRecord['context'] = targetGuid;
      } else {
        delete inputRecord['context'];
      }
      inputRecord['guid'] = input.guid;
      const clearPrevious = this.removeInputAssignmentCommands(controllerGuid, targetType, targetGuid);
      return [
        ...clearPrevious,
        this.upsertCommand('action', newActionGuid, newAction as unknown as Record<string, unknown>),
        this.upsertCommand(
          'input',
          input.guid,
          inputRecord,
          { entityType: 'controller', guid: controllerGuid },
        ),
      ];
    }

    const alreadyTargets = this.actionTargets(action, targetType, targetGuid);
    if (alreadyTargets) return [];

    const execute = Array.isArray(action.execute) ? action.execute : [];
    const nextExecute = [
      ...execute,
      { type: targetType, guid: targetGuid },
    ];

    const clearPrevious = this.removeInputAssignmentCommands(controllerGuid, targetType, targetGuid);
    return [
      ...clearPrevious,
      this.upsertCommand('action', action.guid, {
        ...(action as unknown as Record<string, unknown>),
        execute: nextExecute,
      }),
    ];
  }

  private deleteInputCommands(
    controllerGuid: string,
    inputGuid: string,
    expectedLinkedTargetCount?: number,
  ): GraphCommand[] {
    if (inputGuid.length === 0) return [];
    const input = this.projectManager.getInputByGuid(inputGuid);
    if (!input?.guid) return [];
    const actionGuid = typeof input.action === 'string' ? input.action : '';
    const linkedTargetCount = this.linkedTargetCountForAction(actionGuid);
    if (
      expectedLinkedTargetCount !== undefined
      && Number.isFinite(expectedLinkedTargetCount)
      && expectedLinkedTargetCount >= 0
      && linkedTargetCount !== expectedLinkedTargetCount
    ) {
      Logger.warn(
        `[action] deleteInput aborted: stale linked target count for ${inputGuid} (expected ${expectedLinkedTargetCount}, actual ${linkedTargetCount})`,
      );
      return [];
    }

    const commands: GraphCommand[] = [{
      op: 'remove',
      entityType: 'input',
      guid: inputGuid,
      persistence: 'runtimeAndDurable',
      parent: { entityType: 'controller', guid: controllerGuid },
    }];
    if (!actionGuid) return commands;
    const keepAction = this.isActionReferencedInGraph(actionGuid, {
      excludingInputGuids: new Set([inputGuid]),
      excludingActionGuids: new Set([actionGuid]),
    });
    if (!keepAction) {
      commands.push(this.removeActionCommand(actionGuid));
    }
    return commands;
  }

  buildSceneCleanupCommands(sceneGuid: string): GraphCommand[] {
    const actionsTouchingScene = this.projectManager.getActionsWirePayload()
      .filter(action => this.actionTargetsScene(action, sceneGuid));

    const commands: GraphCommand[] = [];
    const orphanedInputGuids = new Set<string>();
    const controllers = this.projectManager.getControllersWirePayload();

    for (const action of actionsTouchingScene) {
      if (!action.guid || !Array.isArray(action.execute)) continue;
      const remainingExecute = action.execute.filter(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
        const record = item as Record<string, unknown>;
        return !(record['type'] === 'scene' && record['guid'] === sceneGuid);
      });

      if (remainingExecute.length === action.execute.length) {
        continue;
      }

      if (remainingExecute.length > 0) {
        commands.push(
          this.upsertCommand('action', action.guid, {
            ...(action as unknown as Record<string, unknown>),
            execute: remainingExecute,
          }),
        );
        continue;
      }

      const strippedForThisAction = new Set<string>();
      for (const controller of controllers) {
        const controllerGuid = controller.guid;
        if (!controllerGuid) continue;
        for (const input of this.projectManager.getInputsWirePayload(controllerGuid)) {
          if (!input.guid) continue;
          if (typeof input.action !== 'string' || input.action !== action.guid) continue;
          strippedForThisAction.add(input.guid);
          orphanedInputGuids.add(input.guid);
          commands.push(
            this.upsertCommand(
              'input',
              input.guid,
              this.inputStrippedOfAssignment(input),
              { entityType: 'controller', guid: controllerGuid },
            ),
          );
        }
      }

      const referencedElsewhere = this.isActionReferencedInGraph(action.guid, {
        excludingInputGuids: strippedForThisAction,
        excludingActionGuids: new Set([action.guid]),
      });
      if (!referencedElsewhere) {
        commands.push(this.removeActionCommand(action.guid));
      }
    }

    for (const controller of controllers) {
      const controllerGuid = controller.guid;
      if (!controllerGuid) continue;
      for (const input of this.projectManager.getInputsWirePayload(controllerGuid)) {
        if (!input.guid || orphanedInputGuids.has(input.guid)) continue;
        if (!this.inputTargetsScene(input, sceneGuid)) continue;
        const ag = typeof input.action === 'string' ? input.action : '';
        if (ag.length > 0) continue;
        orphanedInputGuids.add(input.guid);
        commands.push(
          this.upsertCommand(
            'input',
            input.guid,
            this.inputStrippedOfAssignment(input),
            { entityType: 'controller', guid: controllerGuid },
          ),
        );
      }
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

  private findSceneAction(sceneGuid: string): ActionDefinition | undefined {
    return this.projectManager.getActionsWirePayload()
      .find(action => this.actionTargetsScene(action, sceneGuid));
  }

  private findSceneInput(controllerGuid: string, sceneGuid: string, actionGuid?: string): InputDefinition | undefined {
    return this.projectManager.getInputsWirePayload(controllerGuid)
      .find(input => {
        const hasSceneTarget = this.inputTargetsScene(input, sceneGuid);
        const pointsAtSceneAction = actionGuid !== undefined && input.action === actionGuid;
        return hasSceneTarget || pointsAtSceneAction;
      });
  }

  private inputTargetsScene(input: InputDefinition, sceneGuid: string): boolean {
    if (typeof input.context === 'string' && input.context === sceneGuid) return true;
    return input.target?.type === 'scene' && input.target.guid === sceneGuid;
  }

  private actionTargetsScene(action: ActionDefinition, sceneGuid: string): boolean {
    return this.actionTargets(action, 'scene', sceneGuid);
  }

  private findActionByTarget(targetType: AssignTargetType, targetGuid: string): ActionDefinition | undefined {
    return this.projectManager.getActionsWirePayload()
      .find(action => this.actionTargets(action, targetType, targetGuid));
  }

  private findInputByTarget(
    controllerGuid: string,
    targetType: AssignTargetType,
    targetGuid: string,
    actionGuid?: string,
  ): InputDefinition | undefined {
    return this.projectManager.getInputsWirePayload(controllerGuid)
      .find(input => {
        const hasTarget = this.inputTargets(input, targetType, targetGuid);
        const pointsAtAction = actionGuid !== undefined && input.action === actionGuid;
        return hasTarget || pointsAtAction;
      });
  }

  private inputTargets(input: InputDefinition, targetType: AssignTargetType, targetGuid: string): boolean {
    if (input.target?.type === targetType && input.target.guid === targetGuid) return true;
    if (targetType === 'scene' && typeof input.context === 'string' && input.context === targetGuid) return true;
    return false;
  }

  private actionTargets(action: ActionDefinition, targetType: AssignTargetType, targetGuid: string): boolean {
    if (!Array.isArray(action.execute)) return false;
    return action.execute.some(item => item.type === targetType && item.guid === targetGuid);
  }

  private linkedTargetCountForAction(actionGuid: string): number {
    if (actionGuid.length === 0) return 0;
    const action = this.projectManager.getActionByGuid(actionGuid);
    if (!action || !Array.isArray(action.execute)) return 0;
    const seen = new Set<string>();
    for (const item of action.execute) {
      if (!item || typeof item !== 'object') continue;
      const type = typeof item.type === 'string' ? item.type : '';
      const guid = typeof item.guid === 'string' ? item.guid : '';
      if (!type || !guid) continue;
      seen.add(`${type}:${guid}`);
    }
    return seen.size;
  }

  private getTargetName(targetType: AssignTargetType, targetGuid: string): string {
    switch (targetType) {
      case 'scene':
        return this.projectManager.getSceneByGuid(targetGuid)?.name ?? targetGuid;
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
