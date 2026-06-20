import { WebSocket } from 'ws';
import { ConnectionRegistry } from './ConnectionRegistry';
import { statsTool } from './statsTool';

function byteLengthOfSendData(data: unknown): number {
  if (typeof data === 'string') {
    return Buffer.byteLength(data, 'utf8');
  }
  if (Buffer.isBuffer(data)) {
    return data.length;
  }
  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }
  if (ArrayBuffer.isView(data)) {
    return data.byteLength;
  }
  if (Array.isArray(data)) {
    let sum = 0;
    for (const chunk of data) {
      sum += byteLengthOfSendData(chunk);
    }
    return sum;
  }
  return 0;
}

/**
 * Wraps `ws.send` to sample outbound payload size (rounded KB) for statsTool.
 */
export function attachHubWebSocketStats(ws: WebSocket): void {
  const originalSend = ws.send.bind(ws) as (data: unknown, ...args: unknown[]) => void;
  ws.send = ((data: unknown, ...rest: unknown[]) => {
    statsTool.sample('Out kb', byteLengthOfSendData(data), 1 / 1024, 's');
    originalSend(data, ...rest);
  }) as WebSocket['send'];
}

export interface InboundRoutedMessage {
  type: string;
  payload?: unknown;
}

/**
 * One routed inbound message with a registered handler (caller must ensure that).
 */
export function recordInboundRoutedMessage(
  registry: ConnectionRegistry,
  ws: WebSocket,
  message: InboundRoutedMessage,
): void {
  const info = registry.get(ws);
  let role = info?.role;

  if (
    message.type === 'register' &&
    message.payload !== undefined &&
    typeof message.payload === 'object' &&
    message.payload !== null
  ) {
    const r = (message.payload as Record<string, unknown>)['role'];
    if (r === 'controller' || r === 'renderer') {
      role = r;
    }
  }

  if (role === 'controller') {
    statsTool.sample('Controller', 1, 1, 's');
  }
}

/**
 * Hub → renderer `events` fan-out: total event deliveries (payload length × open renderer sockets).
 */
export function recordRendererEventDeliveries(eventsInPayload: number, recipientCount: number): void {
  if (eventsInPayload <= 0 || recipientCount <= 0) {
    return;
  }
  statsTool.sample('Renderers', eventsInPayload * recipientCount, 1, 's');
}
