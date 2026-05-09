/**
 * Compact input + Learn button. Sends learnStart with field + capture (noteOn / controlChange).
 */

/**
 * @param {{
 *   field: string,
 *   capture: 'noteOn' | 'controlChange',
 *   maxLen: number,
 *   inputMode?: string,
 *   getValue: () => string,
 *   setValue: (s: string) => void,
 *   commit: () => void,
 *   requestLearn: (payload: { field: string, capture: 'noteOn' | 'controlChange' }) => void,
 *   onLearnArmed?: (armed: boolean) => void
 * }} opts
 */
export function createLearnFieldRow (opts) {
  const row = document.createElement('div')
  row.className = 'learn-field-row'

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'learn-field-row__input'
  input.maxLength = opts.maxLen
  input.size = opts.maxLen
  if (opts.inputMode) input.inputMode = opts.inputMode
  input.value = opts.getValue()
  input.addEventListener('input', () => {
    opts.setValue(input.value)
    opts.commit()
  })
  input.addEventListener('change', () => opts.commit())

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'btn btn--compact'
  btn.textContent = 'Learn'
  btn.addEventListener('click', () => {
    opts.onLearnArmed?.(true)
    opts.requestLearn({ field: opts.field, capture: opts.capture })
  })

  row.appendChild(input)
  row.appendChild(btn)

  return {
    row,
    input,
    learnButton: btn,
    syncInput () {
      input.value = opts.getValue()
    },
    setLearnArmed (armed) {
      btn.disabled = armed
      input.classList.toggle('learn-field-row__input--armed', armed)
    }
  }
}
