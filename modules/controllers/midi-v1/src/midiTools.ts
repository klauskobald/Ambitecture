const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * MIDI note number to a short label. Middle C (60) → `C3` (Yamaha / many DAW octave numbering).
 */
export function noteAsString(midiNote: number): string {
  const n = Math.round(midiNote);
  const name = NOTE_NAMES[((n % 12) + 12) % 12];
  const octave = Math.floor(n / 12) - 2;
  return `${name}${octave}`;
}

/**
 * Operator-facing source-filter label for a list bracket: `device:channel`.
 * `any` on either side means "matches everything". Device name is truncated to
 * 20 chars (with an ellipsis) so the list stays compact.
 */
export function bracketLabel(a: {
  device: string;
  deviceAny: boolean;
  channel: number;
  channelAny: boolean;
}): string {
  const dev = a.deviceAny || !a.device ? 'any' : truncate(a.device, 20);
  const ch = a.channelAny || a.channel === 0 ? 'any' : String(a.channel);
  return `${dev}:${ch}`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export const midiTools = {
  noteAsString,
  bracketLabel,
};
