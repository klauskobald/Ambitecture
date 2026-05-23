import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { Config } from '../Config';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { ProjectGraphStore } from '../ProjectGraphStore';
import { ProjectManager } from '../ProjectManager';
import { getAllAnimatorDescriptors, getAllAnimatorCommandDescriptors } from '../animation/animatorRegistry';
import { recordRendererEventDeliveries } from '../hubWebSocketStats';
import { DiscoveryService, parseDiscoveryFromRegisterPayload } from '../DiscoveryService';
import { resolveRuntimeReferences } from '../ConfigResolver';
import { PulseManager } from '../pulse/PulseManager';
import { HubStatusDispatcher } from '../hubStatusTypes';
import { parseSubscribe, toClientSubscribeState } from '../SubscribeProtocol';

interface RegisterPayload {
  role: 'renderer' | 'controller';
  guid: string;
  location?: [number, number];
  boundingBox?: unknown;
  scope?: unknown;
  subscribe?: unknown;
}

function isRegisterPayload(payload: unknown): payload is RegisterPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const p = payload as Record<string, unknown>;
  return (p['role'] === 'renderer' || p['role'] === 'controller') && typeof p['guid'] === 'string';
}

export class RegisterHandler implements MessageHandler {
  private registry: ConnectionRegistry;
  private graphStore: ProjectGraphStore;
  private projectManager: ProjectManager;
  private rateLimitEventsPerSecond: number;
  private systemConfig: Config;
  private discovery: DiscoveryService;
  private pulseManager: PulseManager | undefined;
  private hubStatus: HubStatusDispatcher | undefined;

  constructor(
    registry: ConnectionRegistry,
    graphStore: ProjectGraphStore,
    projectManager: ProjectManager,
    rateLimitEventsPerSecond: number,
    systemConfig: Config,
    discovery: DiscoveryService,
    pulseManager?: PulseManager,
    hubStatus?: HubStatusDispatcher,
  ) {
    this.registry = registry;
    this.graphStore = graphStore;
    this.projectManager = projectManager;
    this.rateLimitEventsPerSecond = rateLimitEventsPerSecond;
    this.systemConfig = systemConfig;
    this.discovery = discovery;
    this.pulseManager = pulseManager;
    this.hubStatus = hubStatus;
  }

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    if (!isRegisterPayload(message.payload)) {
      Logger.warn('[register] Invalid register payload');
      return;
    }

    const { role, guid, location, boundingBox, scope } = message.payload;

    const parsedSubscribe = parseSubscribe(role, message.payload.subscribe);
    if (parsedSubscribe === null) {
      const key = role === 'controller' ? 'subscribe.runtime' : 'subscribe.events';
      Logger.warn(`[register] rejected — ${key} required (boolean) for ${guid}`);
      return;
    }
    const subscribe = toClientSubscribeState(role, parsedSubscribe);

    const meta: Record<string, unknown> = {};
    if (boundingBox !== undefined) {
      meta['boundingBox'] = boundingBox;
    }
    if (scope !== undefined) {
      meta['scope'] = scope;
    }

    const update: Parameters<ConnectionRegistry['update']>[1] = { role, guid, meta, subscribe };
    if (location !== undefined) {
      update.location = location;
    }

    this.registry.update(ws, update);
    if (role === 'controller') {
      Logger.info(`[register] controller ${guid} runtime=${String(subscribe.runtime)}`);
    } else {
      Logger.info(`[register] renderer ${guid} events=${String(subscribe.events)}`);
    }

    if (role === 'controller') {
      const discoveryEntry = parseDiscoveryFromRegisterPayload(message.payload);
      if (discoveryEntry) {
        this.discovery.onControllerRegistered(ws, discoveryEntry);
      }
    }

    if (ws.readyState !== ws.OPEN) {
      return;
    }

    if (role === 'renderer') {
      const config = this.graphStore.buildRendererConfig(guid);
      ws.send(JSON.stringify({ message: { type: 'config', payload: config } }));
      Logger.info(`[register] pushed config to renderer ${guid}`);

      if (subscribe.events) {
        const events = this.graphStore.getActiveSceneEvents();
        if (events.length > 0) {
          recordRendererEventDeliveries(events.length, 1);
          ws.send(JSON.stringify({ message: { type: 'events', payload: events } }));
          Logger.info(`[register] pushed ${events.length} active scene event(s) to renderer ${guid}`);
        }
      }
    } else if (role === 'controller') {
      const graphInit = {
        ...this.graphStore.buildControllerInit(guid),
        rateLimitEventsPerSecond: this.rateLimitEventsPerSecond,
      };
      ws.send(JSON.stringify({ message: { type: 'graph:init', payload: graphInit } }));
      Logger.info(`[register] pushed graph:init to controller ${guid}`);

      const pulses = this.projectManager.getPulsesWirePayload();
      ws.send(JSON.stringify({
        message: { type: 'projectPatch', payload: { key: 'pulses', data: pulses } },
      }));
      Logger.info(`[register] pushed projectPatch pulses to controller ${guid}`);

      const pulseSnapshots = this.pulseManager?.getStatusSnapshots() ?? [];
      if (pulseSnapshots.length > 0 && this.hubStatus) {
        for (const pulseSnapshot of pulseSnapshots) {
          this.hubStatus.sendPulseStatusTo(ws, pulseSnapshot);
        }
        Logger.info(
          `[register] pushed ${pulseSnapshots.length} hub:status pulse snapshot(s) to controller ${guid}`,
        );
      }

      const capabilitiesRaw = this.systemConfig.getOrDefault<unknown>('systemCapabilities', null);
      if (capabilitiesRaw !== null) {
        const capabilities = resolveRuntimeReferences(capabilitiesRaw);
        const pulseCfg = this.systemConfig.getOrDefault<unknown>('pulse', null);
        const mergedCaps =
          pulseCfg !== null && typeof pulseCfg === 'object' && !Array.isArray(pulseCfg)
            ? { ...(mergeAnimatorDescriptors(capabilities) as Record<string, unknown>), pulse: pulseCfg }
            : mergeAnimatorDescriptors(capabilities);
        ws.send(JSON.stringify({ message: { type: 'systemCapabilities', payload: mergedCaps } }));
        Logger.info(`[register] pushed systemCapabilities to controller ${guid}`);
      }
    }
  }
}

/**
 * Merges each registered animator's `uiDescriptor` into the matching
 * `systemCapabilities.animations[]` entry as a `descriptor` map, and
 * each animator's `commandDescriptors()` as a `commands` array.
 * The descriptor keys use the content-relative form (no `content.` prefix).
 * Class→descriptor mappings come from {@link getAllAnimatorDescriptors} /
 * {@link getAllAnimatorCommandDescriptors} — never hardcoded here.
 */
function mergeAnimatorDescriptors(caps: unknown): unknown {
  if (!caps || typeof caps !== 'object' || Array.isArray(caps)) return caps;
  const c = caps as Record<string, unknown>;
  const animations = c['animations'];
  if (!Array.isArray(animations)) return caps;
  return {
    ...c,
    animations: animations.map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
      const e = entry as Record<string, unknown>;
      const cls = typeof e['class'] === 'string' ? e['class'] : '';
      const descriptors = getAllAnimatorDescriptors();
      const commandDescriptors = getAllAnimatorCommandDescriptors();
      const descriptor = cls ? descriptors[cls] : undefined;
      const commands = cls ? commandDescriptors[cls] : undefined;
      const out = descriptor ? { ...e, descriptor } : e;
      return commands ? { ...out, commands } : out;
    }),
  };
}
