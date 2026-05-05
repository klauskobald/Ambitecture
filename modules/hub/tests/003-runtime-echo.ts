import WebSocket from 'ws';

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

export async function main(
  data: { args: string[]; timeout: number },
  options: { url: string; testconfig: Record<string, unknown> },
): Promise<void> {
  const location = (options.testconfig['location'] as [number, number] | undefined) ?? [0, 0];
  const controllerGuid = String(options.testconfig['controllerGuid'] ?? 'controller-web-test-001');
  const intentGuidOverride =
    typeof options.testconfig['intentGuid'] === 'string'
      ? (options.testconfig['intentGuid'] as string)
      : '';

  const ws = new WebSocket(options.url);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      resolve();
    });
    ws.once('error', reject);
  });

  ws.send(
    envelope('register', location, {
      role: 'controller',
      guid: controllerGuid,
      scope: [],
    }),
  );

  const graphInit = await waitForType(ws, 'graph:init', data.timeout * 1000);
  const payload = graphInit.payload as Record<string, unknown> | undefined;
  const intents = payload?.['intents'];
  let guid = intentGuidOverride;
  if (!guid && Array.isArray(intents) && intents.length > 0) {
    const first = intents[0] as Record<string, unknown>;
    guid = String(first['guid'] ?? '');
  }
  if (!guid) {
    throw new Error(
      'No intent guid — set testParams intentGuid or use a project where the controller has intent refs',
    );
  }

  ws.send(
    envelope('runtime:command', location, {
      entityType: 'intent',
      guid,
      patch: { position: [1, 0, 2] },
    }),
  );

  const rt = await waitForType(ws, 'runtime:update', Math.min(data.timeout * 1000, 15000));
  const batch = rt.payload;
  const updates = Array.isArray(batch) ? batch : [batch];
  const first = updates[0] as Record<string, unknown> | undefined;
  if (!first || String(first['guid']) !== guid) {
    throw new Error('runtime:update payload missing matching intent guid');
  }

  ws.close();
}
