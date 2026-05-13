import { isActiveTriggerValue } from './merge';

export type AnimationTriggerPlan =
  | { ok: true; kind: 'trigger'; timescale?: number }
  | { ok: true; kind: 'stop' }
  | { ok: true; kind: 'pause' }
  | { ok: true; kind: 'settimescale'; timescale: number }
  | { ok: false; reason: string };

function plainObjectRecord(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

function normalizedCommandFromRecord(r: Record<string, unknown> | undefined): string {
  const raw = r?.['command'];
  if (typeof raw !== 'string') {
    return 'start';
  }
  const t = raw.trim().toLowerCase();
  if (t === 'run') {
    return 'start';
  }
  return t.length > 0 ? t : 'start';
}

function readCommandFromMerged(merged: Record<string, unknown>): string | undefined {
  const top = merged['command'];
  if (typeof top === 'string') return top;
  const inner = plainObjectRecord(merged['args']);
  const c = inner?.['command'];
  if (typeof c === 'string') return c;
  return undefined;
}

function readTimescaleFromMerged(merged: Record<string, unknown>): number | undefined {
  const top = merged['timescale'];
  if (typeof top === 'number' && Number.isFinite(top) && top > 0) return top;
  const inner = plainObjectRecord(merged['args']);
  const ts = inner?.['timescale'];
  if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) return ts;
  return undefined;
}

/**
 * Animations: primary path is trigger `args.value` — active → start (trigger), inactive → stop.
 * Optional `timescale` on the merged bag (top-level or under `args`) applies when starting.
 * If `value` is absent, `command` (+ optional timescale) is used for headless tests (pause, setTimescale, explicit start/stop).
 */
export function planAnimationTrigger(merged: Record<string, unknown>): AnimationTriggerPlan {
  if (Object.prototype.hasOwnProperty.call(merged, 'value')) {
    const ts = readTimescaleFromMerged(merged);
    if (isActiveTriggerValue(merged['value'])) {
      return ts !== undefined ? { ok: true, kind: 'trigger', timescale: ts } : { ok: true, kind: 'trigger' };
    }
    return { ok: true, kind: 'stop' };
  }

  const cmdRaw = readCommandFromMerged(merged);
  if (typeof cmdRaw === 'string') {
    const cmd = normalizedCommandFromRecord({ command: cmdRaw });
    const ts = readTimescaleFromMerged(merged);
    switch (cmd) {
      case 'stop':
        return { ok: true, kind: 'stop' };
      case 'pause':
        return { ok: true, kind: 'pause' };
      case 'settimescale': {
        if (ts === undefined) {
          return { ok: false, reason: 'animation setTimescale requires timescale on merged bag' };
        }
        return { ok: true, kind: 'settimescale', timescale: ts };
      }
      case 'start':
        return ts !== undefined ? { ok: true, kind: 'trigger', timescale: ts } : { ok: true, kind: 'trigger' };
      default:
        return ts !== undefined ? { ok: true, kind: 'trigger', timescale: ts } : { ok: true, kind: 'trigger' };
    }
  }

  return { ok: false, reason: 'animation trigger requires args.value or command' };
}
