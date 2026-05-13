import WebSocket from 'ws';

export const defaultArgs: string[] = [];

function buildEnvelope(type: string, location: [number, number], payload: unknown): string {
  return JSON.stringify({ message: { type, location, payload } });
}

function registerController(ws: WebSocket, location: [number, number]): void {
  ws.send(buildEnvelope('register', location, {
    role: 'controller',
    guid: 'test-timescale-binding-controller',
    scope: [],
  }));
}

interface TimescaleBindingTestConfig {
  location: [number, number];
  intentGuid: string;
  animationGuid: string;
  sceneGuid: string;
  timescale: number;
  content: Record<string, unknown>;
}

function readConfig(testconfig: Record<string, unknown>): TimescaleBindingTestConfig {
  const animClass = String(testconfig['class'] ?? '').trim();
  if (animClass !== 'keyframeAnimator') {
    throw new Error('005-timescale-binding: requires class keyframeAnimator');
  }
  const content = testconfig['content'];
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new Error('005-timescale-binding: required content object');
  }
  const tsRaw = testconfig['timescale'];
  let timescale = 1;
  if (tsRaw !== undefined) {
    if (typeof tsRaw !== 'number' || !Number.isFinite(tsRaw) || tsRaw <= 0) {
      throw new Error('005-timescale-binding: timescale must be finite > 0 when set');
    }
    timescale = tsRaw;
  }
  return {
    location: testconfig['location'] as [number, number],
    intentGuid: String(testconfig['intentGuid'] ?? ''),
    animationGuid: String(testconfig['animationGuid'] ?? ''),
    sceneGuid: String(testconfig['sceneGuid'] ?? ''),
    timescale,
    content: content as Record<string, unknown>,
  };
}

function upsertAnimation(ws: WebSocket, location: [number, number], config: TimescaleBindingTestConfig): void {
  ws.send(buildEnvelope('graph:command', location, {
    op: 'upsert',
    entityType: 'animation',
    guid: config.animationGuid,
    value: {
      guid: config.animationGuid,
      name: 'Timescale binding test',
      class: 'keyframeAnimator',
      targetIntent: config.intentGuid,
      content: config.content,
    },
    persistence: 'runtimeAndDurable',
  }));
}

function activateScene(ws: WebSocket, location: [number, number], sceneGuid: string): void {
  if (sceneGuid.length === 0) return;
  ws.send(buildEnvelope('graph:command', location, {
    op: 'patch',
    entityType: 'project',
    guid: 'active',
    patch: { activeSceneGuid: sceneGuid },
    persistence: 'runtimeAndDurable',
  }));
}

function triggerAction(
  ws: WebSocket,
  location: [number, number],
  actionGuid: string,
  opts: { command: string; timescale?: number },
): void {
  const trimmed = opts.command.trim();
  const inner: Record<string, unknown> = {
    command: trimmed.length > 0 ? trimmed : 'start',
  };
  const ts = opts.timescale;
  if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
    inner.timescale = ts;
  }
  const args: Record<string, unknown> = { args: inner };
  ws.send(buildEnvelope('action:trigger', location, {
    actionGuid,
    args,
  }));
}

function subscribeBinding(ws: WebSocket, location: [number, number], key: string): void {
  ws.send(buildEnvelope('binding:subscribe', location, { key }));
}

export async function main(
  data: { args: string[]; timeout: number },
  options: { url: string; testconfig: Record<string, unknown> },
): Promise<void> {
  const config = readConfig(options.testconfig);
  const bindingKey = `${config.animationGuid}-timescale`;
  const timeoutMs = data.timeout * 1000;

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(options.url);
    let finalized = false;
    let sawNumericTimescale = false;

    const failTest = (err: Error): void => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timer);
      ws.close();
      reject(err);
    };

    const finishPass = (): void => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timer);
      ws.close();
      resolve();
    };

    const timer = setTimeout(() => {
      failTest(new Error('005-timescale-binding timeout'));
    }, timeoutMs);

    ws.on('open', () => {
      registerController(ws, config.location);
      upsertAnimation(ws, config.location, config);
      setTimeout(() => {
        activateScene(ws, config.location, config.sceneGuid);
        setTimeout(() => {
          triggerAction(ws, config.location, config.animationGuid, {
            command: 'start',
            timescale: config.timescale,
          });
          setTimeout(() => {
            subscribeBinding(ws, config.location, bindingKey);
            setTimeout(() => {
              triggerAction(ws, config.location, config.animationGuid, {
                command: 'stop',
              });
              setTimeout(() => {
                subscribeBinding(ws, config.location, bindingKey);
                setTimeout(() => {
                  if (!sawNumericTimescale) {
                    failTest(new Error(
                      '005-timescale-binding: expected at least one binding:value with finite numeric timescale',
                    ));
                    return;
                  }
                  finishPass();
                }, 200);
              }, 300);
            }, 400);
          }, 200);
        }, 150);
      }, 150);
    });

    ws.on('message', raw => {
      try {
        const decoded = JSON.parse(raw.toString()) as {
          message?: { type?: string; payload?: { key?: string; value?: unknown } };
        };
        if (decoded.message?.type !== 'binding:value') return;
        const payload = decoded.message.payload;
        if (payload?.key !== bindingKey) return;
        const value = payload.value;
        if (value === null) {
          failTest(new Error(
            '005-timescale-binding: hub sent timescale binding null — master should stay registered while animation exists',
          ));
          return;
        }
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          sawNumericTimescale = true;
        }
      } catch (err) {
        failTest(err instanceof Error ? err : new Error(String(err)));
      }
    });

    ws.on('error', err => {
      failTest(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
