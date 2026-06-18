import { EnvAr } from '../envelope/env_ar';
import { ReceiverBase } from './ReceiverBase';
import { Logger } from '../Logger';
import { AssignmentRecord, TargetRecord } from '../GraphReplica';
import { MidiCcEvent, MidiNoteEvent } from '../MidiManager';
import { midiTools } from '../midiTools';
import { TargetBase } from '../targets/TargetBase';

interface EnvArParsed {
  enabled: boolean;
  attackMs: number;
  releaseMs: number;
}

interface NoteOnOffParams {
  note: number;
  velocityMin: number;
  velocityMax: number;
  velocityOffset: number;
  velocityScale: number;
  envelope: EnvArParsed | null;
}

function readEnvelope(raw: Record<string, unknown>): EnvArParsed | null {
  const env = raw['envelope'];
  if (env === null) return null;
  if (env === undefined) {
    return { enabled: true, attackMs: 0, releaseMs: 0 };
  }
  if (typeof env !== 'object' || Array.isArray(env)) return null;
  const o = env as Record<string, unknown>;
  if (o['type'] !== 'env_ar') return null;
  const enabled = typeof o['enabled'] === 'boolean' ? o['enabled'] : true;
  const attackMs =
    typeof o['attackMs'] === 'number' && Number.isFinite(o['attackMs'])
      ? Math.max(0, o['attackMs'])
      : 0;
  const releaseMs =
    typeof o['releaseMs'] === 'number' && Number.isFinite(o['releaseMs'])
      ? Math.max(0, o['releaseMs'])
      : 0;
  return { enabled, attackMs, releaseMs };
}

function readParams(raw: Record<string, unknown>): NoteOnOffParams | null {
  const note = raw['note'];
  const range = raw['velocityRange'];
  if (typeof note !== 'number') return null;
  let velocityMin = 0;
  let velocityMax = 127;
  if (Array.isArray(range) && range.length === 2 && typeof range[0] === 'number' && typeof range[1] === 'number') {
    velocityMin = range[0];
    velocityMax = range[1];
  }
  const velocityOffset = typeof raw['velocityOffset'] === 'number' ? raw['velocityOffset'] : 0;
  const velocityScale = typeof raw['velocityScale'] === 'number' ? raw['velocityScale'] : 1;
  const envelope = readEnvelope(raw);
  return { note, velocityMin, velocityMax, velocityOffset, velocityScale, envelope };
}

function formatIntentTargetsLine(
  targets: TargetRecord[],
  intentName: (guid: string) => string | undefined,
): string[] {
  const bits: string[] = [];
  for (const t of targets) {
    if (t.type !== 'intent') continue;
    const n = intentName(t.guid);
    const label = n !== undefined && n !== '' ? n : '?';
    bits.push(`${label}.${t.key}`);
  }
  return bits;
}

function envelopeSummary(env: EnvArParsed | null): string {
  if (env === null || !env.enabled) return 'env off';
  return `env_ar ${env.attackMs}/${env.releaseMs}ms`;
}

export class ReceiverNoteOnOff extends ReceiverBase {
  private triggerVelocity = 0;
  private readonly envelopes = new Map<number, EnvAr>();

  constructor(
    assignment: AssignmentRecord,
    targets: TargetBase[],
    logger: Logger,
    private readonly params: NoteOnOffParams,
    onAssignmentActivity?: (input?: number, result?: number) => void,
  ) {
    super(assignment, targets, logger, onAssignmentActivity);
  }

  dispose(): void {
    for (const env of this.envelopes.values()) env.dispose();
    this.envelopes.clear();
  }

  static formatPluginListLine(
    a: AssignmentRecord,
    intentName: (guid: string) => string | undefined,
  ): string | null {
    if (a.class !== 'noteOnOff') return null;
    const params = readParams(a.params);
    if (params === null) return null;
    const chLabel = a.channelAny || a.channel === 0 ? 'any' : String(a.channel);
    const targetBits = formatIntentTargetsLine(a.targets, guid => {
      const n = intentName(guid);
      // Replace ASCII spaces (U+0020) with hard space (U+00A0)
      return typeof n === 'string' ? n.replace(/ /g, '\u00A0') : n;
    });
    const targetsJoined = targetBits.length > 0 ? targetBits.join(', ') : '—';
    const noteLabel = midiTools.noteAsString(params.note);
    // const envBit = envelopeSummary(params.envelope);
    return `[${chLabel}] ${noteLabel} (${params.velocityMin}–${params.velocityMax}) ${params.velocityOffset > 0 ? '+' + params.velocityOffset : params.velocityOffset}${params.velocityScale > 1 ? '×' + params.velocityScale : ''}${params.velocityScale < 1 ? '/' + params.velocityScale : ''} ⮕ ${targetsJoined}`;
  }

  static build(
    assignment: AssignmentRecord,
    targets: TargetBase[],
    logger: Logger,
    onAssignmentActivity?: (input?: number, result?: number) => void,
  ): ReceiverNoteOnOff | null {
    const params = readParams(assignment.params);
    if (params === null) {
      logger.warn(`assignment ${assignment.guid} missing required noteOnOff params`);
      return null;
    }
    return new ReceiverNoteOnOff(assignment, targets, logger, params, onAssignmentActivity);
  }

  private ensureEnvelope(note: number): EnvAr {
    let env = this.envelopes.get(note);
    const ep = this.params.envelope;
    if (!ep?.enabled) {
      throw new Error('ReceiverNoteOnOff.ensureEnvelope without enabled envelope');
    }
    if (!env) {
      env = new EnvAr({
        attackMs: ep.attackMs,
        releaseMs: ep.releaseMs,
        onValue: env01 => {
          const adjusted =
            (this.triggerVelocity * env01 + this.params.velocityOffset) * this.params.velocityScale;
          this.fanOut(adjusted / 127);
        },
      });
      this.envelopes.set(note, env);
    } else {
      env.setParams(ep.attackMs, ep.releaseMs);
    }
    return env;
  }

  handleNoteOn(e: MidiNoteEvent): void {
    if (!this.deviceMatches(e.device)) return;
    if (!this.channelMatches(e.channel)) return;
    if (e.note !== this.params.note) return;
    if (e.velocity < this.params.velocityMin || e.velocity > this.params.velocityMax) return;

    this.triggerVelocity = e.velocity;

    const envCfg = this.params.envelope;
    if (envCfg === null || !envCfg.enabled) {
      const adjusted = ((e.velocity + this.params.velocityOffset) * this.params.velocityScale) / 127;
      this.signalAssignmentActivity(e.velocity, adjusted);
      this.fanOut(adjusted);
      return;
    }

    // Envelope ramps the actual fan-out from 0 → peak; report the peak so the UI shows the target value.
    const peakAdjusted = (e.velocity + this.params.velocityOffset) * this.params.velocityScale / 127;
    this.signalAssignmentActivity(e.velocity, peakAdjusted);
    this.ensureEnvelope(e.note).noteOn();
  }

  handleNoteOff(e: MidiNoteEvent): void {
    if (!this.deviceMatches(e.device)) return;
    if (!this.channelMatches(e.channel)) return;
    if (e.note !== this.params.note) return;

    const envCfg = this.params.envelope;
    if (envCfg === null || !envCfg.enabled) {
      this.signalAssignmentActivity();
      this.fanOut(0);
      return;
    }

    this.signalAssignmentActivity();
    const env = this.envelopes.get(e.note);
    if (env) env.noteOff();
    else this.fanOut(0);
  }

  handleCc(_e: MidiCcEvent): void { }
}
