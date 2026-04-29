import { WebSocket } from 'ws';
import { Logger } from '../Logger';
import { ConnectionRegistry } from '../ConnectionRegistry';
import { MessageHandler, WsMessage } from '../MessageRouter';
import { Color } from '../color';

interface EventParams {
  color?: unknown;
  strobe?: unknown;
  aux?: Record<string, unknown>;
  layer?: number;
  blend?: string;
  alpha?: number;
}

interface LightEvent {
  class: string;
  scheduled?: number;
  position?: [number, number, number];
  params?: EventParams;
}

function isEventArray(payload: unknown): payload is LightEvent[] {
  return Array.isArray(payload);
}

function normalizeEventColor(event: LightEvent): LightEvent {
  if (!event.params || event.params.color === undefined) {
    return event;
  }

  const normalizedColor = Color.createFromObject(event.params.color).toXYY(4);
  return {
    ...event,
    params: { ...event.params, color: normalizedColor },
  };
}

export class EventsHandler implements MessageHandler {
  private registry: ConnectionRegistry;

  constructor(registry: ConnectionRegistry) {
    this.registry = registry;
  }

  handle(_ws: WebSocket, message: WsMessage, _registry: ConnectionRegistry): void {
    if (!isEventArray(message.payload)) {
      Logger.warn('[events] Payload is not an array');
      return;
    }

    const normalizedEvents = message.payload.map(normalizeEventColor);

    const outboundMessage = JSON.stringify({
      message: {
        type: message.type,
        ...(message.location !== undefined ? { location: message.location } : {}),
        payload: normalizedEvents,
      },
    });

    const renderers = this.registry.getByRole('renderer');
    const openRenderers = renderers.filter(ws => ws.readyState === WebSocket.OPEN);

    for (const rendererWs of openRenderers) {
      rendererWs.send(outboundMessage);
    }

    Logger.info(`[events] ${normalizedEvents.length} event(s) → ${openRenderers.length} renderer(s)`);
  }
}
