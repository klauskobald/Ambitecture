import { HelpManager } from '../core/help/HelpManager.js'

/**
 * Application-layer glue: a single delegated click listener that turns the
 * `data-help="<topicKey>"` attribute convention into help. The reusable help
 * core knows nothing about `data-help`; this convention is an app decision.
 *
 * Any element (or ancestor of the click target) carrying `data-help` shows its
 * topic. `quiet` makes an unauthored key a silent no-op, so authors can tag a
 * button before its topic exists without popping the "no help available" card.
 */
export function attachDataHelp () {
  // Capture phase so help still fires even if a handler calls stopPropagation.
  document.addEventListener('click', onClick, true)
}

/** @param {MouseEvent} e */
function onClick (e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const el = target.closest('[data-help]')
  if (!(el instanceof HTMLElement)) return
  const key = el.dataset.help
  if (!key) return
  void HelpManager.show(key, { quiet: true })
}
