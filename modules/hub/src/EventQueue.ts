import { WebSocket } from 'ws';
import { ConnectionRegistry } from './ConnectionRegistry';
import { Logger } from './Logger';

export interface ScheduledEvent {
  event: object;
  scheduledAt: number;
}

export class EventQueue {
  constructor(private registry: ConnectionRegistry) {}

  schedule(entries: ScheduledEvent[], location?: [number, number]): void {
    const groups = new Map<number, object[]>();
    for (const { event, scheduledAt } of entries) {
      const bucket = groups.get(scheduledAt) ?? [];
      bucket.push(event);
      groups.set(scheduledAt, bucket);
    }

    const now = Date.now();
    for (const [scheduledAt, group] of groups) {
      const delay = Math.max(0, scheduledAt - now);
      const outbound = JSON.stringify({
        message: {
          type: 'events',
          ...(location !== undefined ? { location } : {}),
          payload: group,
        },
      });
      if (delay === 0) {
        this.dispatch(outbound, group.length);
      } else {
        setTimeout(() => this.dispatch(outbound, group.length), delay);
      }
    }
  }

  private dispatch(outbound: string, eventCount: number): void {
    const renderers = this.registry.getByRole('renderer');
    const openRenderers = renderers.filter(r => r.readyState === WebSocket.OPEN);
    for (const rendererWs of openRenderers) {
      rendererWs.send(outbound);
    }
    Logger.info(`[queue] ${eventCount} event(s) → ${openRenderers.length} renderer(s)`);
  }
}
