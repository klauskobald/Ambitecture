import { createPaneRenderer } from './paneRendererRegistry.js'
import {
  resolveLeafChrome,
  notifyLeafChromeLayoutRebuild
} from './leafChromeRegistry.js'
import { attachSplitResize } from './splitResize.js'
import {
  loadActiveLayoutId,
  saveActiveLayoutId
} from './layoutSplitState.js'

/** @typedef {import('./loadLayoutCatalog.js').LayoutNode} LayoutNode */
/** @typedef {import('./loadLayoutCatalog.js').LayoutDefinition} LayoutDefinition */

/**
 * @typedef {object} LeafPaneEntry
 * @property {import('./paneRendererRegistry.js').PaneRenderer} instance
 * @property {HTMLElement} mountEl
 * @property {boolean} mounted
 */

/**
 * @typedef {object} LeafState
 * @property {string[]} paneIds
 * @property {string | null} activePaneId
 * @property {Map<string, LeafPaneEntry>} cache
 * @property {HTMLElement} bodyEl
 * @property {import('./leafChromeRegistry.js').LeafChromeAdapter | null} [leafChrome]
 * @property {HTMLElement | null} [leafChromeRowEl]
 */

/** @type {Record<string, LayoutDefinition> | null} */
let catalog = null

/** @type {HTMLElement | null} */
let stageEl = null

/** @type {HTMLElement | null} */
let toolbarEl = null

/** @type {string | null} */
let activeLayoutId = null

/** @type {Map<HTMLElement, LeafState>} */
const leafStateByEl = new WeakMap()

/**
 * @param {object} opts
 * @param {HTMLElement} opts.toolbar
 * @param {HTMLElement} opts.stage
 * @param {Record<string, LayoutDefinition>} opts.catalog
 * @param {string} [opts.defaultLayoutId]
 */
export function init (opts) {
  catalog = opts.catalog
  stageEl = opts.stage
  toolbarEl = opts.toolbar
  toolbarEl.replaceChildren()

  for (const [layoutId, def] of Object.entries(catalog)) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'layout-toggle'
    btn.textContent = def.label
    btn.setAttribute('aria-pressed', 'false')
    btn.dataset.layoutId = layoutId
    btn.addEventListener('click', () => select(layoutId))
    toolbarEl.appendChild(btn)
  }

  const storedId = loadActiveLayoutId()
  const defaultId =
    (storedId && catalog[storedId] && storedId) ||
    (opts.defaultLayoutId && catalog[opts.defaultLayoutId]
      ? opts.defaultLayoutId
      : Object.keys(catalog)[0])
  if (defaultId) select(defaultId)
}

/**
 * @param {string} layoutId
 */
export function select (layoutId) {
  if (!catalog || !stageEl) return
  const def = catalog[layoutId]
  if (!def) return

  activeLayoutId = layoutId
  saveActiveLayoutId(layoutId)
  stageEl.replaceChildren()

  for (let i = 0; i < def.children.length; i++) {
    const nodeEl = buildNode(def.children[i], String(i), layoutId)
    stageEl.appendChild(nodeEl)
  }

  syncToolbarPressed(layoutId)
  notifyLeafChromeLayoutRebuild()
}

/**
 * @returns {string | null}
 */
export function getActiveLayoutId () {
  return activeLayoutId
}

/**
 * @param {LeafState} state
 * @param {string} activePaneId
 * @param {string} paneId
 * @returns {boolean}
 */
function isPaneMountVisible (state, activePaneId, paneId) {
  if (paneId === activePaneId) return true
  if (state.leafChrome?.keepMountVisible(activePaneId, paneId, state.paneIds)) {
    return true
  }
  return false
}

function applyLayoutTags (el, tags) {
  if (!tags || tags.length === 0) return
  el.dataset.layoutTag = tags.join(' ')
  for (const tag of tags) {
    el.classList.add(`layout-tag-host--${tag}`)
  }
}

function syncToolbarPressed (layoutId) {
  if (!toolbarEl) return
  for (const btn of toolbarEl.querySelectorAll('.layout-toggle')) {
    const id = /** @type {HTMLElement} */ (btn).dataset.layoutId
    btn.setAttribute('aria-pressed', id === layoutId ? 'true' : 'false')
  }
}

/**
 * @param {LayoutNode} node
 * @param {string} nodePath
 * @param {string} layoutId
 * @returns {HTMLElement}
 */
function buildNode (node, nodePath, layoutId) {
  switch (node.type) {
    case 'hbox':
      return buildBox(node, nodePath, layoutId, 'horizontal')
    case 'vbox':
      return buildBox(node, nodePath, layoutId, 'vertical')
    case 'leaf':
      return buildLeaf(node, nodePath)
  }
}

/**
 * @param {import('./loadLayoutCatalog.js').LayoutBoxNode} node
 * @param {string} nodePath
 * @param {string} layoutId
 * @param {'horizontal' | 'vertical'} axis
 * @returns {HTMLElement}
 */
function buildBox (node, nodePath, layoutId, axis) {
  const box = document.createElement('div')
  box.className = axis === 'horizontal' ? 'layout-hbox' : 'layout-vbox'

  /** @type {HTMLElement[]} */
  const panels = []

  for (let i = 0; i < node.children.length; i++) {
    const childPath = `${nodePath}/${i}`
    const panel = document.createElement('div')
    panel.className = 'layout-panel'
    panel.appendChild(buildNode(node.children[i], childPath, layoutId))
    panels.push(panel)
  }

  const useResize = node.resizable === true && panels.length >= 2

  for (let i = 0; i < panels.length; i++) {
    box.appendChild(panels[i])
    if (useResize && i < panels.length - 1) {
      const grip = document.createElement('div')
      grip.className =
        axis === 'horizontal'
          ? 'layout-split-grip layout-split-grip--ew'
          : 'layout-split-grip layout-split-grip--ns'
      grip.setAttribute('aria-label', 'Resize panel')
      box.appendChild(grip)
    }
  }

  if (useResize) {
    for (const panel of panels) {
      panel.style.flex = '1 1 0%'
    }
    attachSplitResize({
      axis,
      container: box,
      panels,
      layoutId,
      nodePath
    })
  } else {
    for (const panel of panels) {
      panel.style.flex = '1 1 0%'
    }
  }

  applyLayoutTags(box, node.tags)
  return box
}

/**
 * @param {import('./loadLayoutCatalog.js').LayoutLeafNode} node
 * @param {string} nodePath
 * @returns {HTMLElement}
 */
function buildLeaf (node, nodePath) {
  const leaf = document.createElement('div')
  leaf.className = 'layout-leaf'
  leaf.dataset.nodePath = nodePath

  const header = document.createElement('div')
  header.className = 'layout-leaf-header'
  header.setAttribute('role', 'tablist')

  const body = document.createElement('div')
  body.className = 'layout-leaf-body'

  const leafChrome = resolveLeafChrome(node.panes)
  /** @type {HTMLElement | null} */
  let leafChromeRowEl = null
  if (leafChrome) {
    leafChromeRowEl = leafChrome.createRow(leaf, node.panes)
    if (leafChrome.bodyClass) body.classList.add(leafChrome.bodyClass)
  }

  const state = /** @type {LeafState} */ ({
    paneIds: [...node.panes],
    activePaneId: null,
    cache: new Map(),
    bodyEl: body,
    leafChrome: leafChrome ?? null,
    leafChromeRowEl
  })
  leafStateByEl.set(leaf, state)

  for (const paneId of node.panes) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'layout-leaf-toggle'
    btn.textContent = paneId
    btn.setAttribute('role', 'tab')
    btn.dataset.paneId = paneId
    btn.addEventListener('click', () => activateLeafPane(leaf, paneId))
    header.appendChild(btn)
  }

  leaf.appendChild(header)
  if (leafChromeRowEl) leaf.appendChild(leafChromeRowEl)
  leaf.appendChild(body)
  applyLayoutTags(leaf, node.tags)
  activateLeafPane(leaf, node.panes[0])
  return leaf
}

/**
 * @param {HTMLElement} leafEl
 * @param {string} paneId
 */
function activateLeafPane (leafEl, paneId) {
  const state = leafStateByEl.get(leafEl)
  if (!state || !state.paneIds.includes(paneId)) return

  if (state.activePaneId === paneId) return

  const prevId = state.activePaneId
  if (prevId) {
    if (
      state.leafChrome &&
      state.leafChromeRowEl &&
      prevId === state.leafChrome.ownerPaneId
    ) {
      state.leafChrome.getRenderer(state.leafChromeRowEl).deactivate?.()
    } else {
      const prev = state.cache.get(prevId)
      prev?.instance.deactivate?.()
    }
  }

  state.activePaneId = paneId

  for (const btn of leafEl.querySelectorAll('.layout-leaf-toggle')) {
    const id = /** @type {HTMLElement} */ (btn).dataset.paneId
    btn.setAttribute('aria-pressed', id === paneId ? 'true' : 'false')
  }

  if (state.leafChromeRowEl && state.leafChrome) {
    state.leafChromeRowEl.hidden = !state.leafChrome.isChromeVisible(paneId)
  }

  for (const [id, entry] of state.cache) {
    entry.mountEl.hidden = !isPaneMountVisible(state, paneId, id)
  }

  if (
    state.leafChrome &&
    state.leafChromeRowEl &&
    paneId === state.leafChrome.ownerPaneId
  ) {
    state.bodyEl.dataset.activePane = paneId
    state.leafChrome.getRenderer(state.leafChromeRowEl).activate?.()
    return
  }

  let entry = state.cache.get(paneId)
  if (!entry) {
    const mountEl = document.createElement('div')
    mountEl.className = 'layout-leaf-pane-mount'
    mountEl.dataset.paneId = paneId
    state.bodyEl.appendChild(mountEl)
    entry = {
      instance: createPaneRenderer(paneId),
      mountEl,
      mounted: false
    }
    state.cache.set(paneId, entry)
  }

  entry.mountEl.hidden = false

  if (!entry.mounted) {
    entry.instance.mount(entry.mountEl)
    entry.mounted = true
  }

  state.bodyEl.dataset.activePane = paneId
  entry.instance.activate?.()
}

export const LayoutManager = {
  init,
  select,
  getActiveLayoutId
}
