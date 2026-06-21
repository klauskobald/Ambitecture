import { HelpManager } from '../core/help/HelpManager.js'

/**
 * Application-layer glue: turns the `data-help="<topicKey>"` attribute convention
 * into help. The reusable help core knows nothing about `data-help`; this
 * convention is an app decision.
 *
 * The layout shell (framework, domain-free) draws the layout toggles and pane
 * tab buttons and cannot carry help keys. It already stamps each with its own
 * identity (`data-layout-id` / `data-pane-id`); this binder maps that identity to
 * a help topic so those buttons emit help too, without the layout code knowing
 * anything about help. Only the actual `<button>` toggles match — the pane mount
 * `<div>` also carries `data-pane-id` for bookkeeping and must not trigger help.
 *
 * Fires on `pointerdown` (the earliest, most reliable signal — a synthesized
 * `click` can be dropped by controls that re-render or handle pointers
 * themselves). The listener is **passive and never preventDefault/stopPropagation**,
 * and `show()` is async (it awaits before touching the DOM), so the control's own
 * behaviour is completely unaffected — we only observe.
 */
export function attachDataHelp () {
  document.addEventListener('pointerup', e => showhelp(e))
}

/**
 * Pane-class id (the part before any `:` args) → help topic key. Pane ids come
 * from the layout catalog `class` field; reuse existing section topics where one
 * already reads as the pane's overview rather than forking duplicate content.
 */
const PANE_HELP = {
  stage: 'stage.index',
  'stage-edit': 'stage.edit',
  scenes: 'scene.index',
  snapshot: 'snapshot.index',
  control: 'control.index',
  pulse: 'pulse.index',
  animation: 'animation.index',
  plugin: 'plugin.index'
}

/** @param {HTMLElement} el */
function helpKeyFor (el) {
  if (el.dataset.help) return el.dataset.help
  if (el.dataset.paneId) {
    const paneClass = el.dataset.paneId.split(':')[0]
    return PANE_HELP[paneClass] ?? `pane.${paneClass}`
  }
  if (el.dataset.layoutId) return 'layout.presets'
  return null
}

/** @param {PointerEvent} e */
function showhelp (e) {
  e.passThrough = true
  const t = e.target
  if (!(t instanceof Element)) return
  const el = t.closest(
    '[data-help], button[data-pane-id], button[data-layout-id]'
  )
  if (!(el instanceof HTMLElement)) return
  const key = helpKeyFor(el)
  if (!key) return
  setTimeout(() => {
    void HelpManager.show(key, { quiet: true })
  }, 300)
}
