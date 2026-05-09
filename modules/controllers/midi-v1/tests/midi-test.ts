import { MidiManager } from '../src/MidiManager';

const ts = (): string => new Date().toISOString();
const log = (msg: string): void => { console.log(`[${ts()}] ${msg}`); };
const warn = (msg: string): void => { console.warn(`[${ts()}] ${msg}`); };

const manager = new MidiManager({
  onDeviceConnected:    (name)    => log(`+ ${name}`),
  onDeviceDisconnected: (name)    => log(`- ${name}`),
  onPortError:          (name, e) => warn(`! ${name} open failed: ${e.message}`),
  onNoteOn:        (n, e) => log(`${n} noteOn  ch=${e.channel} note=${e.note} v=${e.velocity}`),
  onNoteOff:       (n, e) => log(`${n} noteOff ch=${e.channel} note=${e.note} v=${e.velocity}`),
  onControlChange: (n, e) => log(`${n} cc      ch=${e.channel} ctl=${e.controller} v=${e.value}`),
  onPitchBend:     (n, e) => log(`${n} bend    ch=${e.channel} v=${e.value}`),
  onProgramChange: (n, e) => log(`${n} program ch=${e.channel} p=${e.program}`),
  onAftertouch:    (n, e) => log(`${n} touch   ch=${e.channel} p=${e.pressure}${e.note !== undefined ? ` note=${e.note}` : ''}`),
  onMessage:       (n, r) => log(`${n} raw     [${r.join(',')}]`),
});

const shutdown = (): void => { manager.stop(); process.exit(0); };
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

manager.start();
log('midi-test running — Ctrl-C to exit');
