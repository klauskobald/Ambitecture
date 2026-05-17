import WebSocket from 'ws';
import { buildRegisterPayload } from './registerPayload';

export const defaultArgs: string[] = [];

function envelope(type: string, location: [number, number], payload: unknown): string {
  return JSON.stringify({ message: { type, location, payload } });
}

interface WsMessageInner {
  type?: string;
  payload?: unknown;
}

function waitForType(
  ws: WebSocket,
  type: string,
  timeoutMs: number,
): Promise<WsMessageInner> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`timeout waiting for ${type}`));
    }, timeoutMs);

    const onMessage = (data: WebSocket.RawData): void => {
      try {
        const parsed = JSON.parse(String(data)) as { message?: WsMessageInner };
        const m = parsed.message;
        if (m?.type === type) {
          clearTimeout(t);
          ws.off('message', onMessage);
          resolve(m);
        }
      } catch {
        /* keep listening */
      }
    };
    ws.on('message', onMessage);
  });
}

function waitForTypeOrTimeout(
  ws: WebSocket,
  type: string,
  timeoutMs: number,
): Promise<WsMessageInner | null> {
  return waitForType(ws, type, timeoutMs).catch(() => null);
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function intentGuidFromGraphInit(payload: Record<string, unknown> | undefined): string {
  const intents = payload?.['intents'];
  if (!Array.isArray(intents) || intents.length === 0) {
    throw new Error('graph:init has no intents for test controller');
  }
  const first = intents[0] as Record<string, unknown>;
  const guid = first['guid'];
  if (typeof guid !== 'string' || guid.length === 0) {
    throw new Error('first intent missing guid');
  }
  return guid;
}

export async function main(
  data: { args: string[]; timeout: number },
  options: { url: string; testconfig: Record<string, unknown> },
): Promise<void> {
  const location = (options.testconfig['location'] as [number, number] | undefined) ?? [0, 0];
  const controllerGuidA = String(options.testconfig['controllerGuidA'] ?? 'controller-web-test-001');
  const controllerGuidB = String(options.testconfig['controllerGuidB'] ?? 'test-runtime-subscribe-b');
  const waitMs = Math.min(data.timeout * 1000, 8000);

  const rejectWs = new WebSocket(options.url);
  await new Promise<void>((resolve, reject) => {
    rejectWs.once('open', () => resolve());
    rejectWs.once('error', reject);
  });
  rejectWs.send(envelope('register', location, {
    role: 'controller',
    guid: 'test-runtime-subscribe-reject',
    scope: [],
  }));
  const noInit = await waitForTypeOrTimeout(rejectWs, 'graph:init', 2000);
  if (noInit !== null) {
    rejectWs.close();
    throw new Error('register without subscribe must not receive graph:init');
  }
  rejectWs.close();

  const wsA = await connect(options.url);
  const wsB = await connect(options.url);

  wsA.send(envelope('register', location, buildRegisterPayload(
    'controller',
    controllerGuidA,
    { runtime: true },
    { scope: [] },
  )));
  wsB.send(envelope('register', location, buildRegisterPayload(
    'controller',
    controllerGuidB,
    { runtime: false },
    { scope: [] },
  )));

  const initA = await waitForType(wsA, 'graph:init', waitMs);
  await waitForType(wsB, 'graph:init', waitMs);

  const intentGuid = intentGuidFromGraphInit(initA.payload as Record<string, unknown> | undefined);

  wsA.send(envelope('runtime:command', location, {
    entityType: 'intent',
    guid: intentGuid,
    patch: { position: [2, 0, 3] },
  }));

  const rtA = await waitForType(wsA, 'runtime:update', waitMs);
  const updatesA = Array.isArray(rtA.payload) ? rtA.payload : [rtA.payload];
  const matchA = updatesA.some(
    u => u && typeof u === 'object' && String((u as Record<string, unknown>)['guid']) === intentGuid,
  );
  if (!matchA) {
    throw new Error('controller A (runtime:true) did not receive matching runtime:update');
  }

  const rtB = await waitForTypeOrTimeout(wsB, 'runtime:update', 1500);
  if (rtB !== null) {
    throw new Error('controller B (runtime:false) must not receive runtime:update from A');
  }

  wsB.send(envelope('runtime:command', location, {
    entityType: 'intent',
    guid: intentGuid,
    patch: { position: [3, 0, 4] },
  }));

  const rtBSelf = await waitForTypeOrTimeout(wsB, 'runtime:update', 1500);
  if (rtBSelf !== null) {
    throw new Error('controller B (runtime:false) must not receive runtime:update for own command');
  }

  const rendererNoEvents = await connect(options.url);
  rendererNoEvents.send(envelope('register', location, buildRegisterPayload(
    'renderer',
    'test-runtime-subscribe-renderer-off',
    { events: false },
    { boundingBox: [0, 0, 0, 10, 5, 10] },
  )));
  await waitForType(rendererNoEvents, 'config', waitMs);

  const rendererWithEvents = await connect(options.url);
  rendererWithEvents.send(envelope('register', location, buildRegisterPayload(
    'renderer',
    'test-runtime-subscribe-renderer-on',
    { events: true },
    { boundingBox: [0, 0, 0, 10, 5, 10] },
  )));
  await waitForType(rendererWithEvents, 'config', waitMs);

  wsA.send(envelope('runtime:command', location, {
    entityType: 'intent',
    guid: intentGuid,
    patch: { position: [4, 0, 5] },
  }));

  const evOff = await waitForTypeOrTimeout(rendererNoEvents, 'events', 2000);
  if (evOff !== null) {
    throw new Error('renderer (events:false) must not receive events');
  }

  await waitForType(rendererWithEvents, 'events', waitMs);

  wsA.close();
  wsB.close();
  rendererNoEvents.close();
  rendererWithEvents.close();
}
