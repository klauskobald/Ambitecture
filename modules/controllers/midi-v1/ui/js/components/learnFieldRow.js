/**
 * Compact input + Learn toggle. The button arms via the shared learn
 * coordinator; clicking again stops the learn (the button turns blue while
 * armed). Only one field is armed at a time across the whole editor.
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
 *   learn: import('../assignModal.js').LearnCoordinator
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
  btn.className = 'btn btn--compact midi-learn-btn'
  btn.textContent = 'Learn'
  btn.addEventListener('click', () => opts.learn.toggle(opts.field, opts.capture))

  const unregister = opts.learn.register(opts.field, armed => {
    btn.classList.toggle('midi-learn-btn--armed', armed)
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
    dispose () {
      unregister()
    }
  }
}
