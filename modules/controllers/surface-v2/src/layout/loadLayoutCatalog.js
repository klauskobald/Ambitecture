import * as statusDisplay from '../app/statusDisplay.js'

/**
 * @typedef {'hbox' | 'vbox' | 'leaf'} LayoutNodeType
 */

/**
 * @typedef {object} LayoutBoxNode
 * @property {'hbox' | 'vbox'} type
 * @property {boolean} [resizable]
 * @property {string[]} [tags]
 * @property {LayoutNode[]} children
 */

/**
 * @typedef {object} LayoutPane
 * @property {string} id stable key (`stage`, `plugin:midi-setup-1`, …)
 * @property {string} class renderer registration id
 * @property {string} label tab button text
 * @property {string[]} args constructor arguments (may be empty)
 */

/**
 * @typedef {object} LayoutLeafNode
 * @property {'leaf'} type
 * @property {LayoutPane[]} panes
 * @property {string[]} [tags]
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
 * @returns {string[] | undefined}
 */
function validateTags (value, path) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0) {
    statusDisplay.error(`${path}.tags must be a non-empty list.`, 'layout')
    return null
  }
  /** @type {string[]} */
  const tags = []
  for (let i = 0; i < value.length; i++) {
    const t = value[i]
    if (typeof t !== 'string' || t.trim() === '') {
      statusDisplay.error(`${path}.tags[${i}] must be a non-empty string.`, 'layout')
      return null
    }
    tags.push(t.trim())
  }
  return tags
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
    const tags = validateTags(n.tags, path)
    if (n.tags !== undefined && tags == null) return null
    return { type, resizable, children, tags }
  }
  if (type === 'leaf') {
    const panes = validatePaneList(n.panes, `${path}.panes`)
    if (!panes) return null
    const tags = validateTags(n.tags, path)
    if (n.tags !== undefined && tags == null) return null
    return { type: 'leaf', panes, tags }
  }
  statusDisplay.error(`${path}.type must be hbox, vbox, or leaf.`, 'layout')
  return null
}

/**
 * @param {string} className
 * @param {string[]} args
 * @returns {string}
 */
export function buildPaneId (className, args) {
  if (args.length === 0) return className
  return `${className}:${args.join(':')}`
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {LayoutPane | null}
 */
function validatePaneEntry (value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    statusDisplay.error(`${path} must be a map with class and label.`, 'layout')
    return null
  }
  const p = /** @type {Record<string, unknown>} */ (value)
  const className = p.class
  if (typeof className !== 'string' || className.trim() === '') {
    statusDisplay.error(`${path}.class must be a non-empty string.`, 'layout')
    return null
  }
  const label = p.label
  if (typeof label !== 'string' || label.trim() === '') {
    statusDisplay.error(`${path}.label must be a non-empty string.`, 'layout')
    return null
  }
  let args = []
  if (p.args !== undefined) {
    if (!Array.isArray(p.args) || p.args.length === 0) {
      statusDisplay.error(`${path}.args must be a non-empty list.`, 'layout')
      return null
    }
    /** @type {string[]} */
    const parsed = []
    for (let i = 0; i < p.args.length; i++) {
      const a = p.args[i]
      if (typeof a !== 'string' || a.trim() === '') {
        statusDisplay.error(
          `${path}.args[${i}] must be a non-empty string.`,
          'layout'
        )
        return null
      }
      parsed.push(a.trim())
    }
    args = parsed
  }
  const trimmedClass = className.trim()
  return {
    id: buildPaneId(trimmedClass, args),
    class: trimmedClass,
    label: label.trim(),
    args
  }
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {LayoutPane[] | null}
 */
function validatePaneList (value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    statusDisplay.error(`${path} must be a non-empty list.`, 'layout')
    return null
  }
  /** @type {LayoutPane[]} */
  const panes = []
  /** @type {Set<string>} */
  const seenIds = new Set()
  for (let i = 0; i < value.length; i++) {
    const pane = validatePaneEntry(value[i], `${path}[${i}]`)
    if (!pane) return null
    if (seenIds.has(pane.id)) {
      statusDisplay.error(
        `${path} has duplicate pane id "${pane.id}".`,
        'layout'
      )
      return null
    }
    seenIds.add(pane.id)
    panes.push(pane)
  }
  return panes
}
