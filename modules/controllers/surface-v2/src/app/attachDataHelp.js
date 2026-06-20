import { HelpManager } from '../core/help/HelpManager.js'

/**
 * Application-layer glue: turns the `data-help="<topicKey>"` attribute convention
 * into help. The reusable help core knows nothing about `data-help`; this
 * convention is an app decision.
 *
 * Fires on `pointerdown` (the earliest, most reliable signal — a synthesized
 * `click` can be dropped by controls that re-render or handle pointers
 * themselves). The listener is **passive and never preventDefault/stopPropagation**,
 * and `show()` is async (it awaits before touching the DOM), so the control's own
 * behaviour is completely unaffected — we only observe.
 */
export function attachDataHelp () {
  document.addEventListener('pointerdown', onPointerDown, {
    // capture: true,
    // passive: true
  })
}

/** @param {PointerEvent} e */
function onPointerDown (e) {
  e.passThrough = true
  const t = e.target
  if (!(t instanceof Element)) return
  const el = t.closest('[data-help]')
  if (!(el instanceof HTMLElement) || !el.dataset.help) return
  // passThrough: the panel must never intercept taps meant for the UI underneath.
  void HelpManager.show(el.dataset.help, { quiet: true, passThrough: true })
}
