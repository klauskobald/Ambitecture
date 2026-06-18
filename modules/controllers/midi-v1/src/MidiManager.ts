import { Input } from '@julusian/midi';

export interface MidiNoteEvent       { channel: number; note: number; velocity: number; device: string; }
export interface MidiCcEvent         { channel: number; controller: number; value: number; device: string; }
export interface MidiPitchBendEvent  { channel: number; value: number; }
export interface MidiProgramEvent    { channel: number; program: number; }
export interface MidiAftertouchEvent { channel: number; pressure: number; note?: number; }

export interface MidiManagerCallbacks {
  onDeviceConnected?:    (deviceName: string) => void;
  onDeviceDisconnected?: (deviceName: string) => void;
  onPortError?:          (deviceName: string, error: Error) => void;
  onNoteOn?:        (deviceName: string, e: MidiNoteEvent) => void;
  onNoteOff?:       (deviceName: string, e: MidiNoteEvent) => void;
  onControlChange?: (deviceName: string, e: MidiCcEvent) => void;
  onPitchBend?:     (deviceName: string, e: MidiPitchBendEvent) => void;
  onProgramChange?: (deviceName: string, e: MidiProgramEvent) => void;
  onAftertouch?:    (deviceName: string, e: MidiAftertouchEvent) => void;
  onMessage?:       (deviceName: string, raw: number[]) => void;
}

const POLL_INTERVAL_MS = 2000;

interface DiscoveredPort { key: string; index: number; }

export class MidiManager {
  private readonly enumerator = new Input();
  private readonly openPorts = new Map<string, Input>();
  private readonly failedPorts = new Set<string>();
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(private readonly callbacks: MidiManagerCallbacks) {}

  start(): void {
    if (this.pollTimer !== null) return;
    this.scan();
    this.pollTimer = setInterval(() => this.scan(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const [name, input] of this.openPorts) {
      // closePort can throw if the device was yanked mid-message; ignore.
      try { input.closePort(); } catch { /* ignore */ }
      this.callbacks.onDeviceDisconnected?.(name);
    }
    this.openPorts.clear();
    this.failedPorts.clear();
  }

  private scan(): void {
    const present = this.enumerate();
    const presentKeys = new Set(present.map(p => p.key));

    for (const [name, input] of [...this.openPorts.entries()]) {
      if (presentKeys.has(name)) continue;
      try { input.closePort(); } catch { /* ignore */ }
      this.openPorts.delete(name);
      this.callbacks.onDeviceDisconnected?.(name);
    }

    for (const failedKey of [...this.failedPorts]) {
      if (!presentKeys.has(failedKey)) this.failedPorts.delete(failedKey);
    }

    for (const port of present) {
      if (this.openPorts.has(port.key)) continue;
      if (this.failedPorts.has(port.key)) continue;
      this.tryOpen(port);
    }
  }

  private enumerate(): DiscoveredPort[] {
    const count = this.enumerator.getPortCount();
    const result: DiscoveredPort[] = [];
    // Same-named ports get a #N suffix per occurrence so multi-port hardware
    // (Launchpad, MPK) does not collapse to a single key.
    const seen = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      const name = this.enumerator.getPortName(i);
      const occurrence = seen.get(name) ?? 0;
      seen.set(name, occurrence + 1);
      const key = occurrence === 0 ? name : `${name}#${occurrence}`;
      result.push({ key, index: i });
    }
    return result;
  }

  private tryOpen(port: DiscoveredPort): void {
    const input = new Input();
    // Drop sysex, MIDI clock (24 ppq), and active-sensing (~300 ms) so the
    // message stream stays signal, not heartbeat.
    input.ignoreTypes(true, true, true);
    input.on('message', (_dt, message) => this.dispatch(port.key, message));
    try {
      input.openPort(port.index);
    } catch (error) {
      this.failedPorts.add(port.key);
      const err = error instanceof Error ? error : new Error(String(error));
      this.callbacks.onPortError?.(port.key, err);
      return;
    }
    this.openPorts.set(port.key, input);
    this.callbacks.onDeviceConnected?.(port.key);
  }

  private dispatch(deviceName: string, message: number[]): void {
    const status = message[0];
    if (status === undefined) return;
    const channel = status & 0x0f;
    const cb = this.callbacks;

    switch (status & 0xf0) {
      case 0x80: {
        const note = message[1] ?? 0;
        const velocity = message[2] ?? 0;
        cb.onNoteOff?.(deviceName, { channel, note, velocity, device: deviceName });
        return;
      }
      case 0x90: {
        const note = message[1] ?? 0;
        const velocity = message[2] ?? 0;
        if (velocity === 0) cb.onNoteOff?.(deviceName, { channel, note, velocity, device: deviceName });
        else cb.onNoteOn?.(deviceName, { channel, note, velocity, device: deviceName });
        return;
      }
      case 0xa0: {
        const note = message[1] ?? 0;
        const pressure = message[2] ?? 0;
        cb.onAftertouch?.(deviceName, { channel, note, pressure });
        return;
      }
      case 0xb0: {
        const controller = message[1] ?? 0;
        const value = message[2] ?? 0;
        cb.onControlChange?.(deviceName, { channel, controller, value, device: deviceName });
        return;
      }
      case 0xc0: {
        const program = message[1] ?? 0;
        cb.onProgramChange?.(deviceName, { channel, program });
        return;
      }
      case 0xd0: {
        const pressure = message[1] ?? 0;
        cb.onAftertouch?.(deviceName, { channel, pressure });
        return;
      }
      case 0xe0: {
        const lsb = message[1] ?? 0;
        const msb = message[2] ?? 0;
        const value = (lsb | (msb << 7)) - 8192;
        cb.onPitchBend?.(deviceName, { channel, value });
        return;
      }
      default:
        cb.onMessage?.(deviceName, message);
        return;
    }
  }
}
