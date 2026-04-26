import WebSocket from 'ws';

export const defaultArgs: string[] = [];

interface BlinkerConfig {
  location: [number, number];
  interval: number;
  events: unknown[];
}

/** YAML `scheduled` is ms relative to `baseMs`; hub/renderer receive absolute epoch ms. */
function withAbsoluteScheduled(event: unknown, baseMs: number): unknown {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    return event;
  }
  const e = event as Record<string, unknown>;
  const raw = e['scheduled'];
  const rel =
    typeof raw === 'number' && Number.isFinite(raw)
      ? raw
      : 0;
  return { ...e, scheduled: baseMs + rel };
}

function buildEnvelope(type: string, location: [number, number], payload: unknown): string {
  return JSON.stringify({ message: { type, location, payload } });
}

function buildRegisterPayload(location: [number, number]): string {
  return buildEnvelope('register', location, {
    role: 'controller',
    guid: 'test-blinker-001',
    scope: [],
  });
}

function buildEventsPayload(location: [number, number], eventsPayload: unknown[]): string {
  return buildEnvelope('events', location, eventsPayload);
}

function readConfig(testconfig: Record<string, unknown>): BlinkerConfig {
  const location = testconfig['location'] as [number, number];
  const interval = testconfig['interval'] as number;
  const events = testconfig['events'] as unknown[];
  return { location, interval, events };
}

function maxRelativeScheduledMs(events: unknown[]): number {
  let max = 0;
  for (const ev of events) {
    if (ev === null || typeof ev !== 'object' || Array.isArray(ev)) continue;
    const raw = (ev as Record<string, unknown>)['scheduled'];
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > max) max = raw;
  }
  return max;
}

function computeTimeoutMs(
  dataTimeout: number,
  eventCount: number,
  interval: number,
  scheduleSpanMs: number
): number {
  const isFiniteTimeout = isFinite(dataTimeout);
  if (isFiniteTimeout) return dataTimeout * 1000;
  const perCycle = scheduleSpanMs + interval;
  return Math.max(3 * eventCount * interval, perCycle * 2);
}

export async function main(
  data: { args: string[]; timeout: number },
  options: { url: string; testconfig: Record<string, unknown> }
): Promise<void> {
  const config = readConfig(options.testconfig);
  const { location, interval, events } = config;
  const scheduleSpanMs = maxRelativeScheduledMs(events);
  const timeoutMs = computeTimeoutMs(data.timeout, events.length, interval, scheduleSpanMs);

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(options.url);
    const startedAt = Date.now();

    ws.on('open', async () => {
      try {
        ws.send(buildRegisterPayload(location));

        while (Date.now() - startedAt < timeoutMs) {
          const batchStart = Date.now();
          const absoluteEvents = events.map(ev => withAbsoluteScheduled(ev, batchStart));
          ws.send(buildEventsPayload(location, absoluteEvents));
          await new Promise<void>(res => setTimeout(res, interval));
        }

        ws.close();
        resolve();
      } catch (e) {
        ws.close();
        reject(e);
      }
    });

    ws.on('error', (err) => {
      reject(err);
    });
  });
}
