import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { ProjectManager, ControllerIntent } from '../ProjectManager';
import { EventQueue } from '../EventQueue';
import { Color } from '../color';

function normalizeIntentColor(intent: ControllerIntent): ControllerIntent {
  if (!intent.params || intent.params['color'] === undefined) return intent;
  return { ...intent, params: { ...intent.params, color: Color.createFromObject(intent.params['color']).toXYY(4) } };
}

function intentToEvent(intent: ControllerIntent, scheduledAt: number): object {
  return { class: intent.class, scheduled: scheduledAt, position: intent.position, params: intent.params };
}

function isIntentArray(payload: unknown): payload is ControllerIntent[] {
  return Array.isArray(payload) && payload.every(
    (item) => item !== null && typeof item === 'object' && typeof (item as Record<string, unknown>)['class'] === 'string'
  );
}

export class IntentsHandler implements MessageHandler {
  constructor(
    private registry: ConnectionRegistry,
    private projectManager: ProjectManager,
    private eventQueue: EventQueue,
  ) {}

  handle(ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    const info = this.registry.get(ws);
    if (info?.role !== 'controller') {
      Logger.warn('[intents] ignored — sender is not a controller');
      return;
    }
    if (!isIntentArray(message.payload)) {
      Logger.warn('[intents] payload is not a valid intent array');
      return;
    }

    const intents = message.payload;
    this.projectManager.updateIntents(info.guid, intents);

    const now = Date.now();
    const entries = intents.map(normalizeIntentColor).map(intent => ({
      event: intentToEvent(intent, now + (intent.scheduled ?? 0)),
      scheduledAt: now + (intent.scheduled ?? 0),
    }));

    this.eventQueue.schedule(entries, message.location);

    Logger.info(`[intents] ${intents.length} intent(s) from ${info.guid} queued`);
  }
}
