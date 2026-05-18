import * as statusDisplay from '../app/statusDisplay.js'

/**
 * @typedef {'hbox' | 'vbox' | 'leaf'} LayoutNodeType
 */

/**
 * @typedef {object} LayoutBoxNode
 * @property {'hbox' | 'vbox'} type
 * @property {boolean} [resizable]
 * @property {LayoutNode[]} children
 */

/**
 * @typedef {object} LayoutLeafNode
 * @property {'leaf'} type
 * @property {string[]} panes
 */

/**
 * @typedef {LayoutBoxNode | LayoutLeafNode} LayoutNode
 */

/**
 * @typedef {object} LayoutDefinition
 * @property {string} label
 * @property {LayoutNode[]} children
 */

/**
 * @returns {Promise<Record<string, LayoutDefinition> | null>}
 */
export async function loadLayoutCatalog () {
  const { loadAppConfig } = await import('../app/config.js')
  const cfg = await loadAppConfig()
  return cfg?.layoutCatalog ?? null
}

/**
 * @param {unknown} raw
 * @returns {Record<string, LayoutDefinition> | null}
 */
export function parseLayoutCatalog (raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    statusDisplay.error('LAYOUT_MANAGER must be a map.', 'layout')
    return null
  }
  const o = /** @type {Record<string, unknown>} */ (raw)
  /** @type {Record<string, LayoutDefinition>} */
  const catalog = {}
  for (const [layoutId, entry] of Object.entries(o)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      statusDisplay.error(`layout "${layoutId}" must be a map.`, 'layout')
      return null
    }
    const e = /** @type {Record<string, unknown>} */ (entry)
    const label = e.label
    if (typeof label !== 'string' || label.trim() === '') {
      statusDisplay.error(`layout "${layoutId}" missing label.`, 'layout')
      return null
    }
    const children = validateNodeList(e.children, `${layoutId}.children`)
    if (!children) return null
    catalog[layoutId] = { label: label.trim(), children }
  }
  if (Object.keys(catalog).length === 0) {
    statusDisplay.error('LAYOUT_MANAGER has no layouts.', 'layout')
    return null
  }
  return catalog
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {LayoutNode[] | null}
 */
function validateNodeList (value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    statusDisplay.error(`${path} must be a non-empty list.`, 'layout')
    return null
  }
  /** @type {LayoutNode[]} */
  const nodes = []
  for (let i = 0; i < value.length; i++) {
    const node = validateNode(value[i], `${path}[${i}]`)
    if (!node) return null
    nodes.push(node)
  }
  return nodes
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {LayoutNode | null}
 */
function validateNode (value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    statusDisplay.error(`${path} must be a map.`, 'layout')
    return null
  }
  const n = /** @type {Record<string, unknown>} */ (value)
  const type = n.type
  if (type === 'hbox' || type === 'vbox') {
    const children = validateNodeList(n.children, `${path}.children`)
    if (!children) return null
    const resizable = n.resizable === undefined ? false : n.resizable === true
    if (n.resizable !== undefined && typeof n.resizable !== 'boolean') {
      statusDisplay.error(`${path}.resizable must be boolean.`, 'layout')
      return null
    }
    return { type, resizable, children }
  }
  if (type === 'leaf') {
    const panes = validatePaneList(n.panes, `${path}.panes`)
    if (!panes) return null
    return { type: 'leaf', panes }
  }
  statusDisplay.error(`${path}.type must be hbox, vbox, or leaf.`, 'layout')
  return null
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {string[] | null}
 */
function validatePaneList (value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    statusDisplay.error(`${path} must be a non-empty list.`, 'layout')
    return null
  }
  /** @type {string[]} */
  const panes = []
  for (let i = 0; i < value.length; i++) {
    const p = value[i]
    if (typeof p !== 'string' || p.trim() === '') {
      statusDisplay.error(`${path}[${i}] must be a non-empty string.`, 'layout')
      return null
    }
    panes.push(p.trim())
  }
  return panes
}
