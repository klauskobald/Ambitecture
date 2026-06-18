/**
 * Rounded pill on/off toggle (surface-v2 style): grey when off, blue when on.
 *
 * @param {{
 *   label: string,
 *   getValue: () => boolean,
 *   onToggle: (next: boolean) => void
 * }} opts
 * @returns {{ el: HTMLButtonElement, sync: () => void }}
 */
export function createToggleButton (opts) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'midi-toggle'
  btn.textContent = opts.label
  btn.addEventListener('click', () => {
    opts.onToggle(!opts.getValue())
    sync()
  })

  function sync () {
    const on = opts.getValue() === true
    btn.classList.toggle('midi-toggle--on', on)
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
  }

  sync()
  return { el: btn, sync }
}
