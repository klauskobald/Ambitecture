const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** @type {Record<string, number>} */
const FLAT_TO_PC = {
  Db: 1,
  Eb: 3,
  Gb: 6,
  Ab: 8,
  Bb: 10,
  Cb: 11,
  Fb: 4
}

/**
 * MIDI note number to label (Yamaha-style: middle C = C3 = 60).
 * @param {number} midiNote
 * @returns {string}
 */
export function noteAsString (midiNote) {
  const n = Math.round(Number(midiNote))
  if (!Number.isFinite(n)) return ''
  const name = NOTE_NAMES[((n % 12) + 12) % 12]
  const octave = Math.floor(n / 12) - 2
  return `${name}${octave}`
}

/**
 * Parse "C3", "A#4", "Db4", or plain integer 0..127 → MIDI note or null.
 * @param {string} raw
 * @returns {number | null}
 */
export function parseNoteInput (raw) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return null
  if (/^\d{1,3}$/.test(s)) {
    const n = Number(s)
    return n >= 0 && n <= 127 ? n : null
  }
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(s)
  if (!m) return null
  const letter = m[1].toUpperCase()
  const acc = m[2]
  const oct = Number(m[3])
  if (!Number.isFinite(oct)) return null

  let pc = -1
  if (acc === 'b') {
    const key = `${letter}b`
    if (Object.prototype.hasOwnProperty.call(FLAT_TO_PC, key)) pc = FLAT_TO_PC[key]
  } else {
    const nameStr = acc === '#' ? `${letter}#` : letter
    pc = NOTE_NAMES.indexOf(nameStr)
  }
  if (pc < 0) return null
  const n = (oct + 2) * 12 + pc
  return n >= 0 && n <= 127 ? n : null
}
