/**
 * Perform intent filter chip (funnel icon + intent/snapshot name) for layout leaf headers.
 * Shown while Animate or plugin (e.g. MIDI) panes are active and a filter is set.
 */

import { projectGraph } from '../core/projectGraph.js'
import {
  getPerformIntentFilter,
  setPerformIntentFilter,
  subscribePerformIntentFilter
} from '../core/performIntentFilter.js'

/** @type {HTMLButtonElement | null} */
let filterChip = null

/** @type {HTMLSpanElement | null} */
let filterChipLabel = null

/** @type {number} */
let filterablePaneDepth = 0

/** @type {(() => void) | null} */
let unsubscribeFilter = null

/** @type {(() => void) | null} */
let unsubscribeGraph = null

/**
 * @param {string} guid
 * @returns {string}
 */
function resolveFilterLabel (guid) {
  const intent = /** @type {Record<string, unknown> | undefined} */ (
    projectGraph.getIntents().get(guid)
  )
  if (typeof intent?.name === 'string' && intent.name) return intent.name
  for (const snap of projectGraph.getSnapshotsList()) {
    if (snap.guid === guid) {
      const n = snap.name
      if (typeof n === 'string' && n) return n
      break
    }
  }
  return guid
}

function ensureFilterChip () {
  if (filterChip) return

  const chip = document.createElement('button')
  chip.type = 'button'
  chip.className = 'perform-subnav-filter'
  chip.hidden = true
  chip.setAttribute('aria-label', 'Clear filter')

  const filterIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  filterIcon.setAttribute('class', 'perform-subnav-filter__icon')
  filterIcon.setAttribute('viewBox', '0 0 16 16')
  filterIcon.setAttribute('aria-hidden', 'true')
  const filterPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  filterPath.setAttribute('d', 'M2 3h12l-4.5 5.5V13l-3 1.5V8.5z')
  filterPath.setAttribute('fill', 'currentColor')
  filterIcon.appendChild(filterPath)
  chip.appendChild(filterIcon)

  const label = document.createElement('span')
  label.className = 'perform-subnav-filter__label'
  chip.appendChild(label)

  chip.addEventListener('click', () => {
    setPerformIntentFilter(null)
  })

  filterChip = chip
  filterChipLabel = label

  unsubscribeFilter = subscribePerformIntentFilter(() => {
    renderFilterChipFromState()
  })
  unsubscribeGraph = projectGraph.subscribe(
    ['intents:def', 'snapshots'],
    () => {
      renderFilterChipFromState()
    }
  )
}

function renderFilterChipFromState () {
  if (!filterChip || !filterChipLabel) return

  const guid = getPerformIntentFilter()
  if (!guid || filterablePaneDepth <= 0) {
    filterChip.hidden = true
    return
  }

  const name = resolveFilterLabel(guid)
  filterChipLabel.textContent = name
  filterChip.setAttribute('aria-label', `Clear filter (${name})`)
  filterChip.title = `Filtering by ${name} — tap to clear`
  filterChip.hidden = false
}

/**
 * Mount or move the chip into a layout leaf tab header.
 * @param {HTMLElement} leafEl `.layout-leaf` element
 */
function mountFilterChipInLeafHeader (leafEl) {
  ensureFilterChip()
  if (!filterChip) return
  const header = leafEl.querySelector('.layout-leaf-header')
  if (!header) return
  if (filterChip.parentElement !== header) {
    header.appendChild(filterChip)
  }
}

/**
 * Call from Animate / plugin pane `activate`.
 * @param {HTMLElement} paneMount pane renderer mount element
 */
export function enterPerformIntentFilterPane (paneMount) {
  const leaf = paneMount.closest('.layout-leaf')
  if (!leaf) return
  filterablePaneDepth++
  mountFilterChipInLeafHeader(/** @type {HTMLElement} */ (leaf))
  renderFilterChipFromState()
}

/**
 * Call from Animate / plugin pane `deactivate`.
 */
export function leavePerformIntentFilterPane () {
  if (filterablePaneDepth > 0) filterablePaneDepth--
  renderFilterChipFromState()
}
