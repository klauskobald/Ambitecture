import WebSocket from 'ws';

export const defaultArgs: string[] = [];

interface IntentActionConfig {
  location: [number, number];
  sceneName: string;
  actionGuid: string;
  intentGuid: string;
  expectedParams: Record<string, unknown>;
}

function buildEnvelope(type: string, location: [number, number], payload: unknown): string {
  return JSON.stringify({ message: { type, location, payload } });
}

function readConfig(testconfig: Record<string, unknown>): IntentActionConfig {
  return {
    location: testconfig['location'] as [number, number],
    sceneName: String(testconfig['sceneName'] ?? ''),
    actionGuid: String(testconfig['actionGuid'] ?? ''),
    intentGuid: String(testconfig['intentGuid'] ?? ''),
    expectedParams: testconfig['expectedParams'] as Record<string, unknown>,
  };
}

function registerController(ws: WebSocket, location: [number, number]): void {
  ws.send(buildEnvelope('register', location, {
    role: 'controller',
    guid: 'test-intent-action-controller',
    scope: [],
  }));
}

function registerRenderer(ws: WebSocket, location: [number, number]): void {
  ws.send(buildEnvelope('register', location, {
    role: 'renderer',
    guid: 'test-intent-action-renderer',
    boundingBox: [0, 0, 0, 10, 5, 10],
  }));
}

function activateScene(ws: WebSocket, location: [number, number], sceneName: string): void {
  ws.send(buildEnvelope('graph:command', location, {
    op: 'patch',
    entityType: 'project',
    guid: 'active',
    patch: { activeSceneName: sceneName },
    persistence: 'runtimeAndDurable',
  }));
}

function upsertIntentAction(ws: WebSocket, location: [number, number], actionGuid: string, intentGuid: string): void {
  ws.send(buildEnvelope('graph:command', location, {
    op: 'upsert',
    entityType: 'action',
    guid: actionGuid,
    value: {
      guid: actionGuid,
      name: 'Strobe Off',
      execute: [
        {
          type: 'intent',
          guid: intentGuid,
          params: {
            strobe: 0,
            alpha: 0,
          },
        },
      ],
    },
    persistence: 'runtimeAndDurable',
  }));
}

function triggerAction(ws: WebSocket, location: [number, number], actionGuid: string): void {
  ws.send(buildEnvelope('action:trigger', location, { actionGuid }));
}

function messageHasExpectedIntentEvent(
  raw: WebSocket.RawData,
  intentGuid: string,
  expectedParams: Record<string, unknown>
): boolean {
  const decoded = JSON.parse(raw.toString()) as { message?: { type?: string; payload?: unknown } };
  const message = decoded.message;
  if (message?.type !== 'events' || !Array.isArray(message.payload)) return false;

  return message.payload.some(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const event = item as Record<string, unknown>;
    if (event['guid'] !== intentGuid) return false;
    const params = event['params'];
    if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
    return Object.entries(expectedParams).every(([key, value]) =>
      (params as Record<string, unknown>)[key] === value
    );
  });
}

export async function main(
  data: { args: string[]; timeout: number },
  options: { url: string; testconfig: Record<string, unknown> }
): Promise<void> {
  const config = readConfig(options.testconfig);
  const timeoutMs = data.timeout * 1000;

  return new Promise<void>((resolve, reject) => {
    const controller = new WebSocket(options.url);
    const renderer = new WebSocket(options.url);
    const timer = setTimeout(() => {
      controller.close();
      renderer.close();
      reject(new Error('intent action event not observed'));
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      controller.close();
      renderer.close();
    };

    let controllerReady = false;
    let rendererReady = false;
    let actionTriggered = false;

    const maybeRun = (): void => {
      if (!controllerReady || !rendererReady || actionTriggered) return;
      upsertIntentAction(controller, config.location, config.actionGuid, config.intentGuid);
      setTimeout(() => {
        activateScene(controller, config.location, config.sceneName);
        setTimeout(() => {
          actionTriggered = true;
          triggerAction(controller, config.location, config.actionGuid);
        }, 100);
      }, 100);
    };

    controller.on('open', () => {
      registerController(controller, config.location);
      controllerReady = true;
      maybeRun();
    });

    renderer.on('open', () => {
      registerRenderer(renderer, config.location);
      rendererReady = true;
      maybeRun();
    });

    renderer.on('message', raw => {
      try {
        if (!actionTriggered) return;
        if (!messageHasExpectedIntentEvent(raw, config.intentGuid, config.expectedParams)) return;
        cleanup();
        resolve();
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    controller.on('error', err => {
      cleanup();
      reject(err);
    });
    renderer.on('error', err => {
      cleanup();
      reject(err);
    });
  });
}
