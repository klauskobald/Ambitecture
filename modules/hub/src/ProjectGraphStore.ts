import { ProjectManager, ControllerIntent, FixtureMoveUpdate } from './ProjectManager';
import {
  GraphCommand,
  GraphDelta,
  GraphInitPayload,
  GraphMutationResult,
  GraphPersistence,
  emptyMutationResult,
} from './GraphProtocol';
import { normalizeIntentColor, intentRemovalEvent, intentToEvent } from './handlers/intentHelpers';
import { Logger } from './Logger';

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function setAtDotPath(target: Record<string, unknown>, dotKey: string, value: unknown): void {
  const segments = dotKey.split('.');
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const existing = cursor[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]!] = value;
}

function removeAtDotPath(target: Record<string, unknown>, dotKey: string): void {
  const segments = dotKey.split('.');
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const existing = cursor[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return;
    cursor = existing as Record<string, unknown>;
  }
  delete cursor[segments[segments.length - 1]!];
}

function applyPatch(target: Record<string, unknown>, patch: Record<string, unknown>, remove: string[] = []): Record<string, unknown> {
  const next = cloneRecord(target);
  for (const [key, value] of Object.entries(patch)) {
    setAtDotPath(next, key, value);
  }
  for (const key of remove) {
    removeAtDotPath(next, key);
  }
  return next;
}

export class ProjectGraphStore {
  private revision = 0;

  constructor(private projectManager: ProjectManager) {}

  useProject(name: string, callback: () => void): void {
    this.projectManager.useProject(name, () => {
      this.revision += 1;
      callback();
    });
  }

  buildControllerInit(guid: string): GraphInitPayload {
    const config = this.projectManager.buildControllerConfig(guid);
    const intents = Array.isArray(config['intents']) ? config['intents'] : [];
    const zones = Array.isArray(config['zones']) ? config['zones'] : [];
    const scenes = Array.isArray(config['scenes']) ? config['scenes'] : [];
    const zoneToRenderer = config['zoneToRenderer'] && typeof config['zoneToRenderer'] === 'object'
      ? config['zoneToRenderer'] as Record<string, string[]>
      : {};
    const activeSceneName = typeof config['activeSceneName'] === 'string'
      ? config['activeSceneName']
      : null;
    return {
      projectName: this.projectManager.getWireProjectName(),
      revision: this.revision,
      controllerGuid: guid,
      activeSceneName,
      zoneToRenderer,
      zones,
      intents,
      scenes,
      interactionPolicies: this.projectManager.getControllerInteractionPolicies(guid),
      entities: this.projectManager.getGraphEntities(),
    };
  }

  buildRendererConfig(rendererGuid: string): object {
    return this.projectManager.buildRendererConfig(rendererGuid);
  }

  getActiveSceneEvents(now = Date.now()): object[] {
    return this.projectManager.getActiveSceneIntents()
      .map(normalizeIntentColor)
      .map(intent => intentToEvent(intent, now));
  }

  getActiveSceneName(): string | null {
    return this.projectManager.getActiveSceneName();
  }

  applyGraphCommand(command: GraphCommand): GraphMutationResult {
    switch (command.entityType) {
      case 'intent':
        return this.applyIntentCommand(command);
      case 'fixture':
        return this.applyFixtureCommand(command);
      case 'scene':
        return this.applySceneCommand(command);
      case 'project':
        if (command.patch && typeof command.patch['activeSceneName'] === 'string') {
          return this.activateScene(command.patch['activeSceneName']);
        }
        return this.applyOpaqueCommand(command);
      case 'controller':
        return this.applyControllerCommand(command);
      default:
        return this.applyOpaqueCommand(command);
    }
  }

  activateScene(sceneName: string, location?: [number, number]): GraphMutationResult {
    const newIntents = this.projectManager.setActiveScene(sceneName);
    const now = Date.now();
    const newGuids = new Set(newIntents.map(intent => intent.guid));
    const removalEvents = this.projectManager.getAllIntentDefinitionGuids()
      .filter(guid => !newGuids.has(guid))
      .map(guid => this.projectManager.getIntentDefinition(guid))
      .filter((intent): intent is ControllerIntent => intent !== undefined)
      .map(normalizeIntentColor)
      .map(intent => intentRemovalEvent(intent, now));
    const activeEvents = newIntents
      .map(normalizeIntentColor)
      .map(intent => intentToEvent(intent, now + (intent.scheduled ?? 0)));
    const delta = this.makeDelta({
      op: 'patch',
      entityType: 'project',
      guid: 'active',
      patch: { activeSceneName: sceneName },
      persistence: 'runtimeAndDurable',
    });
    Logger.info(`[graph] activated scene "${sceneName}" at ${location?.join(', ') ?? 'unknown location'}`);
    return {
      revision: this.revision,
      controllerDeltas: [delta],
      rendererEvents: [...removalEvents, ...activeEvents],
      rendererConfigChangedFor: [],
      durableChanged: true,
    };
  }

  private applyIntentCommand(command: GraphCommand): GraphMutationResult {
    const existing = this.projectManager.getIntentDefinition(command.guid);
    if (command.op === 'remove') {
      if (!existing) return emptyMutationResult(this.revision);
      const remaining = this.projectManager.getAllIntentDefinitions()
        .filter(intent => intent.guid !== command.guid);
      this.projectManager.setProjectData('intents', remaining);
      const now = Date.now();
      const delta = this.makeDelta({ ...command, persistence: 'runtimeAndDurable' });
      return {
        revision: this.revision,
        controllerDeltas: [delta],
        rendererEvents: [intentRemovalEvent(existing, now)],
        rendererConfigChangedFor: [],
        durableChanged: true,
      };
    }

    const base = cloneRecord((command.value ?? existing ?? { guid: command.guid }) as Record<string, unknown>);
    const next = command.patch || command.remove ? applyPatch(base, command.patch ?? {}, command.remove) : base;
    next['guid'] = command.guid;
    const intent = next as unknown as ControllerIntent;
    this.projectManager.updateIntents('', [intent]);

    const persistence = command.persistence ?? 'runtime';
    const durableChanged = persistence === 'durable' || persistence === 'runtimeAndDurable';
    if (durableChanged) {
      const intents = this.projectManager.getAllIntentDefinitions()
        .map(item => item.guid === command.guid ? intent : item);
      if (!this.projectManager.getIntentDefinition(command.guid)) {
        intents.push(intent);
      }
      this.projectManager.setProjectData('intents', intents);
    }

    const now = Date.now();
    const delta = this.makeDelta({ ...command, persistence });
    const rendererEvents = this.projectManager.isIntentInActiveScene(command.guid)
      ? [intentToEvent(normalizeIntentColor(intent), now + (intent.scheduled ?? 0))]
      : [];
    return {
      revision: this.revision,
      controllerDeltas: [delta],
      rendererEvents,
      rendererConfigChangedFor: [],
      durableChanged,
    };
  }

  private applyFixtureCommand(command: GraphCommand): GraphMutationResult {
    if (command.op === 'remove') {
      return this.applyOpaqueCommand(command);
    }
    const position = command.patch?.['position'] ?? command.value?.['position'];
    if (!Array.isArray(position) || position.length !== 3) {
      return this.applyOpaqueCommand(command);
    }
    const fixtureRef = this.findFixtureRef(command.guid);
    if (!fixtureRef) {
      Logger.warn(`[graph] fixture ${command.guid} not found`);
      return emptyMutationResult(this.revision);
    }
    const update: FixtureMoveUpdate = {
      zoneName: fixtureRef.zoneName,
      fixtureName: fixtureRef.fixtureName,
      position: [Number(position[0]), Number(position[1]), Number(position[2])],
    };
    const changed = this.projectManager.updateFixtures([update]);
    if (changed === 0) return emptyMutationResult(this.revision);
    const fixtureEntity = this.projectManager.getGraphEntities()['fixture']?.[command.guid];
    const delta = this.makeDelta({
      op: 'upsert',
      entityType: command.entityType,
      guid: command.guid,
      ...(fixtureEntity !== undefined ? { value: fixtureEntity } : {}),
      persistence: command.persistence ?? 'runtimeAndDurable',
    });
    return {
      revision: this.revision,
      controllerDeltas: [delta],
      rendererEvents: [],
      rendererConfigChangedFor: this.getAllRendererGuids(),
      durableChanged: true,
    };
  }

  private applySceneCommand(command: GraphCommand): GraphMutationResult {
    const scenes = this.projectManager.getScenesWirePayload();
    const nextScenes = command.op === 'remove'
      ? scenes.filter(scene => scene.guid !== command.guid)
      : scenes.map(scene => {
        if (scene.guid !== command.guid) return scene;
        const base = cloneRecord(scene as unknown as Record<string, unknown>);
        const next = command.patch || command.remove ? applyPatch(base, command.patch ?? {}, command.remove) : cloneRecord(command.value ?? base);
        next['guid'] = command.guid;
        return next as unknown as typeof scene;
      });
    const existing = scenes.some(scene => scene.guid === command.guid);
    if (!existing && command.op !== 'remove') {
      const value = cloneRecord(command.value ?? { guid: command.guid });
      value['guid'] = command.guid;
      nextScenes.push(value as unknown as typeof scenes[number]);
    }
    this.projectManager.setProjectData('scenes', nextScenes);
    const delta = this.makeDelta({ ...command, persistence: command.persistence ?? 'runtimeAndDurable' });
    return {
      revision: this.revision,
      controllerDeltas: [delta],
      rendererEvents: [],
      rendererConfigChangedFor: [],
      durableChanged: true,
    };
  }

  private applyControllerCommand(command: GraphCommand): GraphMutationResult {
    if (command.op === 'remove') {
      return this.applyOpaqueCommand(command);
    }
    const persistence = command.persistence ?? 'runtimeAndDurable';
    const durableChanged = persistence === 'durable' || persistence === 'runtimeAndDurable';
    if (durableChanged && (command.patch || command.remove)) {
      this.projectManager.updateControllerInteractionPolicies(
        command.guid,
        command.patch ?? {},
        command.remove ?? [],
      );
    }
    const delta = this.makeDelta({ ...command, persistence });
    return {
      revision: this.revision,
      controllerDeltas: [delta],
      rendererEvents: [],
      rendererConfigChangedFor: [],
      durableChanged,
    };
  }

  private applyOpaqueCommand(command: GraphCommand): GraphMutationResult {
    const persistence: GraphPersistence = command.persistence ?? 'durable';
    const durableChanged = persistence !== 'runtime';
    if (durableChanged) {
      if (command.op === 'remove') {
        this.projectManager.removeOpaqueGraphEntity(command.entityType, command.guid);
      } else {
        const base = cloneRecord(command.value ?? { guid: command.guid, entityType: command.entityType });
        const next = command.patch || command.remove ? applyPatch(base, command.patch ?? {}, command.remove) : base;
        this.projectManager.upsertOpaqueGraphEntity(command.entityType, command.guid, next);
      }
    }
    const delta = this.makeDelta({ ...command, persistence });
    Logger.info(`[graph] stored opaque delta for ${command.entityType}:${command.guid}`);
    return {
      revision: this.revision,
      controllerDeltas: [delta],
      rendererEvents: [],
      rendererConfigChangedFor: [],
      durableChanged,
    };
  }

  private makeDelta(command: GraphCommand & { persistence: GraphPersistence }): GraphDelta {
    this.revision += 1;
    return {
      op: command.op,
      entityType: command.entityType,
      guid: command.guid,
      ...(command.parent !== undefined ? { parent: command.parent } : {}),
      ...(command.patch !== undefined ? { patch: command.patch } : {}),
      ...(command.remove !== undefined ? { remove: command.remove } : {}),
      ...(command.value !== undefined ? { value: command.value } : {}),
      persistence: command.persistence,
      revision: this.revision,
    };
  }

  private findFixtureRef(guid: string): { zoneName: string; fixtureName: string } | null {
    for (const zone of this.projectManager.getSerializedRuntimeZones()) {
      if (!zone || typeof zone !== 'object' || Array.isArray(zone)) continue;
      const z = zone as Record<string, unknown>;
      const zoneName = String(z['name'] ?? '');
      const fixtures = z['fixtures'];
      if (!Array.isArray(fixtures)) continue;
      for (const fixture of fixtures) {
        if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) continue;
        const f = fixture as Record<string, unknown>;
        if (f['guid'] === guid) {
          return { zoneName, fixtureName: String(f['name'] ?? '') };
        }
      }
    }
    return null;
  }

  private getAllRendererGuids(): string[] {
    const guids = new Set<string>();
    for (const renderers of Object.values(this.projectManager.getZoneToRendererPayload())) {
      for (const guid of renderers) {
        guids.add(guid);
      }
    }
    return [...guids];
  }
}
