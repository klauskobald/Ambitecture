import { sendPulseTap } from '../../core/outboundQueue.js'
import { getPulseConfig } from '../../core/systemCapabilities.js'

/**
 * @param {EventTarget | null} el
 * @returns {boolean}
 */
function isTypingContext (el) {
  if (!el || !(el instanceof Element)) return false
  if (el.closest('[contenteditable="true"]')) return true
  if (el.closest('textarea')) return true
  if (el.closest('select')) return true
  const inp = el.closest('input')
  if (inp instanceof HTMLInputElement) {
    const type = inp.type.toLowerCase()
    if (
      type === 'button' ||
      type === 'submit' ||
      type === 'reset' ||
      type === 'checkbox' ||
      type === 'radio' ||
      type === 'range' ||
      type === 'file' ||
      type === 'color' ||
      type === 'hidden'
    ) {
      return false
    }
    return true
  }
  return false
}

/** @type {(() => string | null) | null} */
let globalResolveSetupGuid = null

/** @type {((ev: KeyboardEvent) => void) | null} */
let globalKeyHandler = null

/**
 * @param {() => string | null} resolveSetupGuid
 */
export function mountPulseTapGlobalShortcut (resolveSetupGuid) {
  globalResolveSetupGuid = resolveSetupGuid
  if (globalKeyHandler) return
  globalKeyHandler = ev => {
    if (ev.defaultPrevented) return
    if (isTypingContext(document.activeElement)) return
    const isCtrlT =
      ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.toLowerCase() === 't'
    if (!isCtrlT) return
    ev.preventDefault()
    firePulseTap(resolveSetupGuid)
  }
  window.addEventListener('keydown', globalKeyHandler, true)
}

export function unmountPulseTapGlobalShortcut () {
  globalResolveSetupGuid = null
  if (globalKeyHandler) {
    window.removeEventListener('keydown', globalKeyHandler, true)
    globalKeyHandler = null
  }
}

/**
 * @param {() => string | null} resolveSetupGuid
 */
function firePulseTap (resolveSetupGuid) {
  const setupGuid = resolveSetupGuid()
  if (!setupGuid) return
  sendPulseTap({ setupGuid, atMs: Date.now() })
}

/**
 * @param {{
 *   resolveSetupGuid: () => string | null,
 *   className?: string,
 *   title?: string
 * }} opts
 * @returns {HTMLButtonElement}
 */
export function createPulseTapButton ({
  resolveSetupGuid,
  className = 'perform-pulse-tap-btn',
  title
}) {
  const tapCfg = getPulseConfig().tapTempo
  const label =
    typeof title === 'string' && title.length > 0 ? title : 'Tap tempo (Ctrl+T)'

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = className
  btn.textContent = 'T'
  btn.setAttribute('aria-label', label)
  btn.title = label

  btn.addEventListener('pointerdown', event => {
    event.preventDefault()
    btn.classList.add('perform-input--pressed')
    firePulseTap(resolveSetupGuid)
  })
  btn.addEventListener('pointerup', () => {
    btn.classList.remove('perform-input--pressed')
  })
  btn.addEventListener('pointercancel', () => {
    btn.classList.remove('perform-input--pressed')
  })
  btn.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
  })

  if (tapCfg && typeof tapCfg.minBpm === 'number' && typeof tapCfg.maxBpm === 'number') {
    btn.dataset.pulseTapRange = `${tapCfg.minBpm}-${tapCfg.maxBpm}`
  }

  return btn
}
