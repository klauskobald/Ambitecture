/**
 * Assignment class → editor factory (plugin UI). Add new receiver classes here.
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   createDefault: (ctx: import('./assignSession.js').EditorContext) => Record<string, unknown>,
 *   mountEditor: (container: HTMLElement, api: object) => { teardown: () => void, syncFromModel: () => void }
 * }} AssignmentClassDef
 */

/** @type {Map<string, AssignmentClassDef>} */
const registry = new Map()

/**
 * @param {AssignmentClassDef} def
 */
export function registerAssignmentClass (def) {
  registry.set(def.id, def)
}

/**
 * @returns {{ id: string, label: string }[]}
 */
export function listAssignmentClasses () {
  return [...registry.values()].map(d => ({ id: d.id, label: d.label }))
}

/**
 * @param {string} id
 * @returns {AssignmentClassDef | undefined}
 */
export function getAssignmentClass (id) {
  return registry.get(id)
}
