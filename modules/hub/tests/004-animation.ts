import WebSocket from 'ws';
import { isDeepStrictEqual } from 'node:util';

import type { DotPathRecord } from '../src/dotPath';
import { readAtDotPath } from '../src/dotPath';

export const defaultArgs: string[] = [];

interface AnimationKeyframeStep {
  time: number;
  args?: Record<string, unknown>;
}

interface AnimationKeyframeContentRead {
  repeat: number;
  length: number;
  steps: AnimationKeyframeStep[];
  /** Full `content` object for hub upsert (`lerp`, etc. preserved alongside normalized steps). */
  contentForUpsert: Record<string, unknown>;
}

interface AnimationTestConfig {
  location: [number, number];
  sceneName: string;
  /** Passed to hub as `action:trigger` payload `args.timescale` (default 1). */
  timescale: number;
  intentGuid: string;
  class: string;
  repeat: number;
  length: number;
  steps: AnimationKeyframeStep[];
  animationGuid: string;
  contentForUpsert: Record<string, unknown>;
}

function parseKeyframeStepsStrict(raw: unknown): AnimationKeyframeStep[] {
  if (!Array.isArray(raw)) {
    throw new Error('004-animation test.yml: content.steps must be an array');
  }

  const out: AnimationKeyframeStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const time = Number(row['time']);
    if (!Number.isFinite(time)) continue;
    const args = row['args'];
    if (
      args !== undefined &&
      (typeof args !== 'object' || args === null || Array.isArray(args))
    ) {
      continue;
    }

    if (args !== undefined) {
      out.push({ time, args: args as Record<string, unknown> });
    } else {
      out.push({ time });
    }
  }

  if (out.length === 0) {
    throw new Error('004-animation test.yml: content.steps must contain at least one valid step');
  }
  return out;
}

function readKeyframeContentFromParams(testconfig: Record<string, unknown>): AnimationKeyframeContentRead {
  const rawContent = testconfig['content'];
  if (rawContent === undefined || typeof rawContent !== 'object' || rawContent === null || Array.isArray(rawContent)) {
    throw new Error(
      '004-animation test.yml: required `content` object (keyframeAnimator: repeat, length, steps)',
    );
  }
  const content = rawContent as Record<string, unknown>;

  const repeatRaw = content['repeat'];
  if (typeof repeatRaw !== 'number' || !Number.isFinite(repeatRaw) || repeatRaw < 0) {
    throw new Error('004-animation test.yml: content.repeat must be a finite number ≥ 0');
  }

  const lengthRaw = content['length'];
  if (typeof lengthRaw !== 'number' || !Number.isFinite(lengthRaw) || lengthRaw <= 0) {
    throw new Error('004-animation test.yml: content.length must be a finite number > 0');
  }

  const steps = parseKeyframeStepsStrict(content['steps']);

  const contentForUpsert: Record<string, unknown> = { ...content };
  contentForUpsert['repeat'] = repeatRaw;
  contentForUpsert['length'] = lengthRaw;
  contentForUpsert['steps'] = steps;

  return { repeat: repeatRaw, length: lengthRaw, steps, contentForUpsert };
}

function buildEnvelope(type: string, location: [number, number], payload: unknown): string {
  return JSON.stringify({ message: { type, location, payload } });
}

function readConfig(testconfig: Record<string, unknown>): AnimationTestConfig {
  const animClass = String(testconfig['class'] ?? '').trim();
  if (animClass.length === 0) {
    throw new Error('004-animation test.yml: required non-empty string "class" (e.g. keyframeAnimator)');
  }
  if (animClass !== 'keyframeAnimator') {
    throw new Error(
      `004-animation: this integration test only supports class "keyframeAnimator" (got "${animClass}")`,
    );
  }

  const keyframe = readKeyframeContentFromParams(testconfig);

  const tsRaw = testconfig['timescale'];
  let timescale = 1;
  if (tsRaw !== undefined) {
    if (typeof tsRaw !== 'number' || !Number.isFinite(tsRaw) || tsRaw <= 0) {
      throw new Error('004-animation test.yml: timescale must be a finite number > 0 when set');
    }
    timescale = tsRaw;
  }

  return {
    location: testconfig['location'] as [number, number],
    sceneName: String(testconfig['sceneName'] ?? ''),
    timescale,
    intentGuid: String(testconfig['intentGuid'] ?? ''),
    class: animClass,
    repeat: keyframe.repeat,
    length: keyframe.length,
    steps: keyframe.steps,
    animationGuid: String(testconfig['animationGuid'] ?? ''),
    contentForUpsert: keyframe.contentForUpsert,
  };
}

/**
 * Steps the hub `keyframeAnimator` actually fires: sorted by `time`, then those with `time < length`.
 * Matches hub keyframeAnimator `parseSteps` when `length` is set on the animation.
 */
function effectiveKeyframeSteps(config: AnimationTestConfig): AnimationKeyframeStep[] {
  const sorted = [...config.steps].sort((a, b) => (a.time === b.time ? 0 : a.time - b.time));
  return sorted.filter(s => s.time < config.length);
}

function registerController(ws: WebSocket, location: [number, number]): void {
  ws.send(buildEnvelope('register', location, {
    role: 'controller',
    guid: 'test-animation-controller',
    scope: [],
  }));
}

function registerRenderer(ws: WebSocket, location: [number, number]): void {
  ws.send(buildEnvelope('register', location, {
    role: 'renderer',
    guid: 'test-animation-renderer',
    boundingBox: [0, 0, 0, 10, 5, 10],
  }));
}

function upsertTestAnimation(ws: WebSocket, location: [number, number], config: AnimationTestConfig): void {
  ws.send(buildEnvelope('graph:command', location, {
    op: 'upsert',
    entityType: 'animation',
    guid: config.animationGuid,
    value: {
      guid: config.animationGuid,
      name: 'Integration animation',
      class: config.class,
      targetIntent: config.intentGuid,
      content: config.contentForUpsert,
    },
    persistence: 'runtimeAndDurable',
  }));
}

function activateScene(ws: WebSocket, location: [number, number], sceneName: string): void {
  if (sceneName.length === 0) return;
  ws.send(buildEnvelope('graph:command', location, {
    op: 'patch',
    entityType: 'project',
    guid: 'active',
    patch: { activeSceneName: sceneName },
    persistence: 'runtimeAndDurable',
  }));
}

function triggerAction(
  ws: WebSocket,
  location: [number, number],
  actionGuid: string,
  timescale: number,
): void {
  ws.send(buildEnvelope('action:trigger', location, {
    actionGuid,
    args: { timescale },
  }));
}

const numericTolerance = 0.02;

function valuesRoughlyEqual(got: unknown, wanted: unknown): boolean {
  if (
    typeof wanted === 'number' &&
    typeof got === 'number' &&
    Number.isFinite(wanted) &&
    Number.isFinite(got)
  ) {
    return Math.abs(got - wanted) < numericTolerance;
  }
  return isDeepStrictEqual(got, wanted);
}

/** Event fields at each dot-path key must match YAML `args`; empty/absent args → snapshot only needs matching intentGuid. */
function snapshotMatchesKeyframeArgs(event: DotPathRecord, patch: Record<string, unknown> | undefined): boolean {
  if (patch === undefined || Object.keys(patch).length === 0) return true;
  for (const [dotPath, wanted] of Object.entries(patch)) {
    const got = readAtDotPath(event, dotPath);
    if (!valuesRoughlyEqual(got, wanted)) return false;
  }
  return true;
}

function firstMatchingIntentEvent(raw: WebSocket.RawData, intentGuid: string): DotPathRecord | undefined {
  const decoded = JSON.parse(raw.toString()) as { message?: { type?: string; payload?: unknown } };
  const message = decoded.message;
  if (message?.type !== 'events' || !Array.isArray(message.payload)) return undefined;
  for (const item of message.payload) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const ev = item as Record<string, unknown>;
    if (ev['guid'] !== intentGuid) continue;
    return ev as DotPathRecord;
  }
  return undefined;
}

export async function main(
  data: { args: string[]; timeout: number },
  options: { url: string; testconfig: Record<string, unknown> },
): Promise<void> {
  const config = readConfig(options.testconfig);
  const effectiveStepsForHub = effectiveKeyframeSteps(config);
  if (effectiveStepsForHub.length === 0) {
    throw new Error(
      '004-animation: no keyframe steps satisfy time < length; increase length or lower step times (same rule as hub keyframeAnimator).',
    );
  }

  const timeoutMs = data.timeout * 1000;

  return new Promise<void>((resolve, reject) => {
    const controller = new WebSocket(options.url);
    const renderer = new WebSocket(options.url);

    const hubStatusLog: string[] = [];
    let finalized = false;

    const failTest = (err: Error): void => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timer);
      controller.close();
      renderer.close();
      reject(err);
    };

    const timer = setTimeout(() => {
      if (finalized) return;
      finalized = true;
      console.log('004-animation: timeout (--timeout hub:status lines were streamed live above)');
      clearTimeout(timer);
      controller.close();
      renderer.close();
      reject(new Error('004-animation timeout'));
    }, timeoutMs);

    const finishPass = (): void => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timer);
      controller.close();
      renderer.close();
      resolve();
    };

    let controllerReady = false;
    let rendererReady = false;
    let started = false;
    let actionTriggered = false;
    let firstKeyframeSamplesValidated = false;
    const seenSnapshots: DotPathRecord[] = [];

    const maybeRun = (): void => {
      if (!controllerReady || !rendererReady || started) return;
      started = true;
      upsertTestAnimation(controller, config.location, config);
      setTimeout(() => {
        activateScene(controller, config.location, config.sceneName);
        setTimeout(() => {
          actionTriggered = true;
          triggerAction(controller, config.location, config.animationGuid, config.timescale);
        }, 150);
      }, 150);
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

    controller.on('message', raw => {
      try {
        const decoded = JSON.parse(raw.toString()) as {
          message?: {
            type?: string;
            payload?: {
              kind?: string;
              animationGuid?: string;
              status?: string;
              message?: { text?: string };
              data?: Record<string, unknown>;
            };
          };
        };
        const type = decoded.message?.type;
        const payload = decoded.message?.payload;
        if (type !== 'hub:status' || payload?.kind !== 'animation') return;
        const animGuid =
          typeof payload.animationGuid === 'string' ? payload.animationGuid : undefined;
        if (animGuid !== config.animationGuid) return;

        const text = payload.message?.text ?? '';
        const line = `[hub:status animation] ${text}`;
        hubStatusLog.push(line);
        console.log(line);

        if (
          firstKeyframeSamplesValidated &&
          payload.status === 'stopped' &&
          text === 'Animation finished'
        ) {
          finishPass();
        }
      } catch {
        /* ignore */
      }
    });

    renderer.on('message', raw => {
      try {
        if (!actionTriggered) return;
        const snapshot = firstMatchingIntentEvent(raw, config.intentGuid);
        if (snapshot === undefined) return;
        seenSnapshots.push(snapshot);

        const anchorsFoundInOrder = (): boolean => {
          let searchFrom = 0;
          for (let i = 0; i < effectiveStepsForHub.length; i++) {
            const step = effectiveStepsForHub[i]!;
            const rel = seenSnapshots.slice(searchFrom).findIndex(s =>
              snapshotMatchesKeyframeArgs(s, step.args),
            );
            if (rel < 0) return false;
            searchFrom += rel + 1;
          }
          return true;
        };

        if (!firstKeyframeSamplesValidated && anchorsFoundInOrder()) {
          if (hubStatusLog.length === 0) {
            failTest(new Error('expected at least one hub:status animation line on controller'));
            return;
          }
          firstKeyframeSamplesValidated = true;
        }
      } catch (err) {
        failTest(err instanceof Error ? err : new Error(String(err)));
      }
    });

    controller.on('error', err => {
      failTest(err instanceof Error ? err : new Error(String(err)));
    });
    renderer.on('error', err => {
      failTest(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
