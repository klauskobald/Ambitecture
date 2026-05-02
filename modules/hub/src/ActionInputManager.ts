import { randomUUID } from 'crypto';
import { ActionDefinition, InputDefinition, ProjectManager, Scene } from './ProjectManager';
import { GraphCommand } from './GraphProtocol';

type SceneTarget = {
  type: 'scene';
  guid: string;
};

export type ActionInputCommand =
  | { command: 'ensureSceneButton'; sceneGuid: string }
  | { command: 'disableSceneButton'; sceneGuid: string }
  | { command: 'renameInput'; inputGuid: string; name: string };

export class ActionInputManager {
  constructor(private projectManager: ProjectManager) {}

  buildCommands(command: ActionInputCommand): GraphCommand[] {
    switch (command.command) {
      case 'ensureSceneButton':
        return this.ensureSceneButtonCommands(command.sceneGuid);
      case 'disableSceneButton':
        return this.disableSceneButtonCommands(command.sceneGuid);
      case 'renameInput':
        return this.renameInputCommands(command.inputGuid, command.name);
    }
  }

  getAction(guid: string): ActionDefinition | undefined {
    return this.projectManager.getActionByGuid(guid);
  }

  getSceneForAction(action: ActionDefinition): Scene | undefined {
    const execute = Array.isArray(action.execute)
      ? action.execute.find(item => item.type === 'scene')
      : undefined;
    return execute ? this.projectManager.getSceneByGuid(execute.guid) : undefined;
  }

  private ensureSceneButtonCommands(sceneGuid: string): GraphCommand[] {
    const scene = this.projectManager.getSceneByGuid(sceneGuid);
    if (!scene?.guid) return [];

    const existingAction = this.findSceneAction(scene.guid);
    const existingInput = this.findSceneInput(scene.guid, existingAction?.guid);
    const actionGuid = existingAction?.guid ?? `action-${randomUUID()}`;
    const inputGuid = existingInput?.guid ?? `input-${randomUUID()}`;

    const action: ActionDefinition = {
      guid: actionGuid,
      name: scene.name,
      execute: [{ type: 'scene', guid: scene.guid }],
    };
    const input: InputDefinition = {
      guid: inputGuid,
      name: existingInput?.name || scene.name,
      type: 'button',
      action: actionGuid,
      target: { type: 'scene', guid: scene.guid },
      display: { type: 'button' },
    };

    return [
      this.upsertCommand('action', actionGuid, action as unknown as Record<string, unknown>),
      this.upsertCommand('input', inputGuid, input as unknown as Record<string, unknown>),
    ];
  }

  private disableSceneButtonCommands(sceneGuid: string): GraphCommand[] {
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

    for (const input of this.projectManager.getInputsWirePayload()) {
      if (!input.guid) continue;
      const hasSceneTarget = input.target?.type === 'scene' && input.target.guid === sceneGuid;
      const pointsAtSceneAction = typeof input.action === 'string' && actionGuidSet.has(input.action);
      if (!hasSceneTarget && !pointsAtSceneAction) continue;
      const next = { ...input };
      delete next.action;
      next.target = { type: 'scene', guid: sceneGuid };
      next.display = next.display ?? { type: 'button' };
      commands.push(this.upsertCommand('input', input.guid, next as unknown as Record<string, unknown>));
    }

    return commands;
  }

  private renameInputCommands(inputGuid: string, name: string): GraphCommand[] {
    const nextName = name.trim();
    const input = this.projectManager.getInputByGuid(inputGuid);
    if (!input?.guid || nextName.length === 0 || input.name === nextName) return [];
    return [
      this.upsertCommand('input', input.guid, {
        ...(input as unknown as Record<string, unknown>),
        name: nextName,
      }),
    ];
  }

  buildSceneCleanupCommands(sceneGuid: string): GraphCommand[] {
    const actionGuids = this.projectManager.getActionsWirePayload()
      .filter(action => this.actionTargetsScene(action, sceneGuid))
      .map(action => action.guid)
      .filter((guid): guid is string => typeof guid === 'string' && guid.length > 0);
    const actionGuidSet = new Set(actionGuids);
    const commands: GraphCommand[] = [];

    for (const input of this.projectManager.getInputsWirePayload()) {
      if (!input.guid) continue;
      const hasSceneTarget = input.target?.type === 'scene' && input.target.guid === sceneGuid;
      const pointsAtSceneAction = typeof input.action === 'string' && actionGuidSet.has(input.action);
      if (!hasSceneTarget && !pointsAtSceneAction) continue;
      commands.push({
        op: 'remove',
        entityType: 'input',
        guid: input.guid,
        persistence: 'runtimeAndDurable',
      });
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

  private findSceneInput(sceneGuid: string, actionGuid?: string): InputDefinition | undefined {
    return this.projectManager.getInputsWirePayload()
      .find(input => {
        const hasSceneTarget = input.target?.type === 'scene' && input.target.guid === sceneGuid;
        const pointsAtSceneAction = actionGuid !== undefined && input.action === actionGuid;
        return hasSceneTarget || pointsAtSceneAction;
      });
  }

  private actionTargetsScene(action: ActionDefinition, sceneGuid: string): boolean {
    if (!Array.isArray(action.execute)) return false;
    return action.execute.some(item => item.type === 'scene' && item.guid === sceneGuid);
  }

  private upsertCommand(entityType: 'action' | 'input', guid: string, value: Record<string, unknown>): GraphCommand {
    return {
      op: 'upsert',
      entityType,
      guid,
      value,
      persistence: 'runtimeAndDurable',
    };
  }
}
