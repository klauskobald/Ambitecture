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

export const midiTools = {
  noteAsString,
};
