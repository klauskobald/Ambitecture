import { randomUUID } from 'crypto';
import { ActionDefinition, ActionExecuteItem, InputDefinition, ProjectManager, Scene } from './ProjectManager';
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

type SceneTarget = {
  type: 'scene';
  guid: string;
};

type AssignTargetType = 'scene' | 'intent' | 'sequence' | string;

export type InputAssignConfig = {
  name?: string;
  type?: string;
  displayType?: string;
} & Record<string, unknown>;

export type ActionInputCommand =
  | { command: 'ensureInputAssignment'; targetType: AssignTargetType; targetGuid: string; input: InputAssignConfig }
  | { command: 'removeInputAssignment'; targetType: AssignTargetType; targetGuid: string }
  | { command: 'ensureSceneButton'; sceneGuid: string }
  | { command: 'disableSceneButton'; sceneGuid: string }
  | { command: 'renameInput'; inputGuid: string; name: string };

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
      case 'ensureSceneButton':
        return this.ensureSceneButtonCommands(controllerGuid, command.sceneGuid);
      case 'disableSceneButton':
        return this.disableSceneButtonCommands(controllerGuid, command.sceneGuid);
      case 'renameInput':
        return this.renameInputCommands(controllerGuid, command.inputGuid, command.name);
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

  private ensureSceneButtonCommands(controllerGuid: string, sceneGuid: string): GraphCommand[] {
    const scene = this.projectManager.getSceneByGuid(sceneGuid);
    if (!scene?.guid) return [];
    const caps = this.getSystemCapabilities();
    const defaults = resolveDefaultPerformTypes(caps);
    const type = defaults?.type ?? 'button';
    const displayType = defaults?.displayType ?? 'button';
    if (!defaults) {
      Logger.warn('[action] ensureSceneButton: missing systemCapabilities inputTypes/displayTypes; using button/button');
    }
    return this.ensureInputAssignmentCommands(controllerGuid, 'scene', scene.guid, {
      name: scene.name,
      type,
      displayType,
    });
  }

  private disableSceneButtonCommands(controllerGuid: string, sceneGuid: string): GraphCommand[] {
    const actionGuids = this.projectManager.getActionsWirePayload()
      .filter(action => this.actionTargetsScene(action, sceneGuid))
      .map(action => action.guid)
      .filter((guid): guid is string => typeof guid === 'string' && guid.length > 0);
    const actionGuidSet = new Set(actionGuids);
    const commands: GraphCommand[] = actionGuids.map(guid => ({
      op: 'remove',
      entityType: 'action',
      guid,
      persistence: 'runtimeAndDurable',
    }));

    const caps = this.getSystemCapabilities();
    const displayFallback = resolveDefaultPerformTypes(caps)?.displayType ?? 'button';

    for (const input of this.projectManager.getInputsWirePayload(controllerGuid)) {
      if (!input.guid) continue;
      const hasSceneTarget = this.inputTargetsScene(input, sceneGuid);
      const pointsAtSceneAction = typeof input.action === 'string' && actionGuidSet.has(input.action);
      if (!hasSceneTarget && !pointsAtSceneAction) continue;
      const next = { ...input };
      delete next.action;
      next.context = sceneGuid;
      delete next.target;
      next.display = next.display ?? { type: displayFallback };
      commands.push(this.upsertCommand(
        'input',
        input.guid,
        next as unknown as Record<string, unknown>,
        { entityType: 'controller', guid: controllerGuid },
      ));
    }

    return commands;
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

  private removeInputAssignmentCommands(
    controllerGuid: string,
    targetType: AssignTargetType,
    targetGuid: string,
  ): GraphCommand[] {
    if (targetGuid.length === 0 || targetType.length === 0) return [];
    const targetActionGuids = this.projectManager.getActionsWirePayload()
      .filter(action => this.actionTargets(action, targetType, targetGuid))
      .map(action => action.guid)
      .filter((guid): guid is string => typeof guid === 'string' && guid.length > 0);
    const actionGuidSet = new Set(targetActionGuids);
    const controllerInputs = this.projectManager.getInputsWirePayload(controllerGuid);
    const matchingInputs = controllerInputs.filter(input => {
      const hasTarget = this.inputTargets(input, targetType, targetGuid);
      const pointsAtTargetAction = typeof input.action === 'string' && actionGuidSet.has(input.action);
      return hasTarget || pointsAtTargetAction;
    });
    const matchingInputGuidSet = new Set(
      matchingInputs
        .map(input => input.guid)
        .filter((guid): guid is string => typeof guid === 'string' && guid.length > 0),
    );
    const commands: GraphCommand[] = [];

    for (const input of matchingInputs) {
      if (!input.guid) continue;
      commands.push({
        op: 'remove',
        entityType: 'input',
        guid: input.guid,
        persistence: 'runtimeAndDurable',
        parent: { entityType: 'controller', guid: controllerGuid },
      });
    }

    for (const actionGuid of targetActionGuids) {
      const referencedElsewhere = this.isActionReferencedByInputs(actionGuid, matchingInputGuidSet);
      if (referencedElsewhere) continue;
      commands.push({
        op: 'remove',
        entityType: 'action',
        guid: actionGuid,
        persistence: 'runtimeAndDurable',
      });
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

  buildSceneCleanupCommands(sceneGuid: string): GraphCommand[] {
    const actionGuids = this.projectManager.getActionsWirePayload()
      .filter(action => this.actionTargetsScene(action, sceneGuid))
      .map(action => action.guid)
      .filter((guid): guid is string => typeof guid === 'string' && guid.length > 0);
    const actionGuidSet = new Set(actionGuids);
    const commands: GraphCommand[] = [];

    const controllers = this.projectManager.getControllersWirePayload();
    for (const controller of controllers) {
      const controllerGuid = controller.guid;
      if (!controllerGuid) continue;
      for (const input of this.projectManager.getInputsWirePayload(controllerGuid)) {
        if (!input.guid) continue;
        const hasSceneTarget = this.inputTargetsScene(input, sceneGuid);
        const pointsAtSceneAction = typeof input.action === 'string' && actionGuidSet.has(input.action);
        if (!hasSceneTarget && !pointsAtSceneAction) continue;
        commands.push({
          op: 'remove',
          entityType: 'input',
          guid: input.guid,
          persistence: 'runtimeAndDurable',
          parent: { entityType: 'controller', guid: controllerGuid },
        });
      }
    }
    for (const guid of actionGuids) {
      commands.push({
        op: 'remove',
        entityType: 'action',
        guid,
        persistence: 'runtimeAndDurable',
      });
    }

    return commands;
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

  private isActionReferencedByInputs(actionGuid: string, removedInputGuids: Set<string>): boolean {
    for (const controller of this.projectManager.getControllersWirePayload()) {
      for (const input of controller.inputs ?? []) {
        if (typeof input.guid === 'string' && removedInputGuids.has(input.guid)) continue;
        if (input.action === actionGuid) return true;
      }
    }
    return false;
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
