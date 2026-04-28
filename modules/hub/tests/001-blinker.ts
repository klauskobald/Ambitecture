import WebSocket from 'ws';

export const defaultArgs: string[] = [];

interface BlinkerConfig {
  location: [number, number];
  interval: number;
  intents: unknown[];
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

function buildIntentsPayload(location: [number, number], intents: unknown[]): string {
  return buildEnvelope('intents', location, intents);
}

function readConfig(testconfig: Record<string, unknown>): BlinkerConfig {
  const location = testconfig['location'] as [number, number];
  const interval = testconfig['interval'] as number;
  const intents = testconfig['intents'] as unknown[];
  return { location, interval, intents };
}

function maxRelativeScheduledMs(intents: unknown[]): number {
  let max = 0;
  for (const intent of intents) {
    if (intent === null || typeof intent !== 'object' || Array.isArray(intent)) continue;
    const raw = (intent as Record<string, unknown>)['scheduled'];
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > max) max = raw;
  }
  return max;
}

function computeTimeoutMs(
  dataTimeout: number,
  intentCount: number,
  interval: number,
  scheduleSpanMs: number
): number {
  const isFiniteTimeout = isFinite(dataTimeout);
  if (isFiniteTimeout) return dataTimeout * 1000;
  const perCycle = scheduleSpanMs + interval;
  return Math.max(3 * intentCount * interval, perCycle * 2);
}

export async function main(
  data: { args: string[]; timeout: number },
  options: { url: string; testconfig: Record<string, unknown> }
): Promise<void> {
  const config = readConfig(options.testconfig);
  const { location, interval, intents } = config;
  const scheduleSpanMs = maxRelativeScheduledMs(intents);
  const timeoutMs = computeTimeoutMs(data.timeout, intents.length, interval, scheduleSpanMs);

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(options.url);
    const startedAt = Date.now();

    ws.on('open', async () => {
      try {
        ws.send(buildRegisterPayload(location));

        while (Date.now() - startedAt < timeoutMs) {
          ws.send(buildIntentsPayload(location, intents));
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
