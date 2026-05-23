import WebSocket from 'ws';
import { buildRegisterPayload } from './registerPayload';

export const defaultArgs: string[] = [];

interface SnapshotTestConfig {
  location: [number, number];
}

function buildEnvelope(type: string, location: [number, number], payload: unknown): string {
  return JSON.stringify({ message: { type, location, payload } });
}

function readConfig(testconfig: Record<string, unknown>): SnapshotTestConfig {
  return {
    location: testconfig['location'] as [number, number],
  };
}

function isSnapshotRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const recall = row['recall'];
  const recallOk = Boolean(
    recall && typeof recall === 'object' && !Array.isArray(recall)
    && typeof (recall as Record<string, unknown>)['scene'] === 'boolean'
    && typeof (recall as Record<string, unknown>)['pulse'] === 'boolean'
    && typeof (recall as Record<string, unknown>)['animations'] === 'boolean',
  );
  return typeof row['guid'] === 'string'
    && typeof row['name'] === 'string'
    && typeof row['activeSceneGuid'] === 'string'
    && Array.isArray(row['pulses'])
    && Array.isArray(row['animations'])
    && recallOk;
}

function findSnapshotUpsert(raw: WebSocket.RawData): Record<string, unknown> | undefined {
  const decoded = JSON.parse(raw.toString()) as { message?: { type?: string; payload?: unknown } };
  const message = decoded.message;
  if (message?.type !== 'graph:delta') return undefined;
  const deltas = Array.isArray(message.payload) ? message.payload : [message.payload];
  for (const delta of deltas) {
    if (!delta || typeof delta !== 'object' || Array.isArray(delta)) continue;
    const row = delta as Record<string, unknown>;
    if (row['entityType'] !== 'snapshot' || row['op'] !== 'upsert') continue;
    const value = row['value'];
    if (isSnapshotRecord(value)) return value;
  }
  return undefined;
}

function readGraphInitScenes(raw: WebSocket.RawData): Array<{ guid: string; name: string }> {
  const decoded = JSON.parse(raw.toString()) as { message?: { type?: string; payload?: unknown } };
  const payload = decoded.message?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const scenes = (payload as Record<string, unknown>)['scenes'];
  if (!Array.isArray(scenes)) return [];
  return scenes.flatMap(s => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return [];
    const row = s as Record<string, unknown>;
    const guid = typeof row['guid'] === 'string' ? row['guid'] : '';
    const name = typeof row['name'] === 'string' ? row['name'] : '';
    if (!guid || !name) return [];
    return [{ guid, name }];
  });
}

function activateScene(ws: WebSocket, location: [number, number], sceneGuid: string): void {
  ws.send(buildEnvelope('graph:command', location, {
    op: 'patch',
    entityType: 'project',
    guid: 'active',
    patch: { activeSceneGuid: sceneGuid },
    persistence: 'runtime',
  }));
}

export async function main(
  data: { args: string[]; timeout: number },
  options: { url: string; testconfig: Record<string, unknown> }
): Promise<void> {
  const config = readConfig(options.testconfig);
  const timeoutMs = data.timeout * 1000;

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(options.url);
    let snapshotGuid: string | undefined;
    let targetSceneGuid: string | undefined;
    let captureSent = false;
    let captured = false;
    let recalled = false;

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('snapshot capture/recall timed out'));
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
    };

    ws.on('open', () => {
      ws.send(buildEnvelope('register', config.location, buildRegisterPayload(
        'controller',
        'test-snapshot-controller',
        { runtime: true },
        { scope: [] },
      )));
    });

    ws.on('message', (raw) => {
      const decoded = JSON.parse(raw.toString()) as { message?: { type?: string; payload?: unknown } };
      const type = decoded.message?.type;

      if (type === 'graph:init' && !captureSent) {
        const scenes = readGraphInitScenes(raw);
        if (scenes.length < 2) {
          cleanup();
          ws.close();
          reject(new Error('snapshot test needs at least 2 scenes in project'));
          return;
        }
        targetSceneGuid = scenes[1]!.guid;
        activateScene(ws, config.location, targetSceneGuid);
        ws.send(buildEnvelope('snapshot:capture', config.location, {
          name: 'Test Snapshot',
          recall: { scene: true, pulse: true, animations: true },
        }));
        captureSent = true;
        return;
      }

      if (!captured) {
        const snap = findSnapshotUpsert(raw);
        if (snap && typeof snap['guid'] === 'string') {
          if (snap['activeSceneGuid'] !== targetSceneGuid) {
            cleanup();
            ws.close();
            reject(new Error(
              `snapshot activeSceneGuid ${String(snap['activeSceneGuid'])} !== live scene ${String(targetSceneGuid)}`,
            ));
            return;
          }
          captured = true;
          snapshotGuid = snap['guid'];
          ws.send(buildEnvelope('action:trigger', config.location, {
            actionGuid: snapshotGuid,
          }));
          return;
        }
      }

      if (captured && !recalled && type === 'graph:delta') {
        recalled = true;
        cleanup();
        ws.close();
        resolve();
      }
    });

    ws.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}
