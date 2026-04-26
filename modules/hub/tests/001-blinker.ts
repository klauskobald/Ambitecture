import WebSocket from 'ws';

export const defaultArgs: string[] = [];

interface BlinkerConfig {
  location: [number, number];
  interval: number;
  events: unknown[];
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

function buildEventsPayload(location: [number, number], event: unknown): string {
  return buildEnvelope('events', location, [event]);
}

function readConfig(testconfig: Record<string, unknown>): BlinkerConfig {
  const location = testconfig['location'] as [number, number];
  const interval = testconfig['interval'] as number;
  const events = testconfig['events'] as unknown[];
  return { location, interval, events };
}

function computeTimeoutMs(dataTimeout: number, eventCount: number, interval: number): number {
  const isFiniteTimeout = isFinite(dataTimeout);
  return isFiniteTimeout ? dataTimeout * 1000 : 3 * eventCount * interval;
}

export async function main(
  data: { args: string[]; timeout: number },
  options: { url: string; testconfig: Record<string, unknown> }
): Promise<void> {
  const config = readConfig(options.testconfig);
  const { location, interval, events } = config;
  const timeoutMs = computeTimeoutMs(data.timeout, events.length, interval);

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(options.url);
    const startedAt = Date.now();

    ws.on('open', async () => {
      try {
        ws.send(buildRegisterPayload(location));

        let eventIndex = 0;

        while (Date.now() - startedAt < timeoutMs) {
          const event = events[eventIndex % events.length];
          ws.send(buildEventsPayload(location, event));
          eventIndex++;
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
