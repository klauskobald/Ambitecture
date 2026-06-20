/**
 * @callback DisplayPlugin
 * @param {any} data  — the data returned by conduit.callFunction()
 * @param {{ showTopic: (key: string) => void, conduit: import('../HelpManager.js').HelpConduit | null }} ctx
 * @returns {HTMLElement | DocumentFragment}
 */

/** @type {Map<string, DisplayPlugin>} */
const displays = new Map()

/**
 * @param {string} name
 * @param {DisplayPlugin} fn
 */
export function registerDisplayPlugin (name, fn) {
  displays.set(name, fn)
}

/**
 * @param {string} name
 * @returns {DisplayPlugin | undefined}
 */
export function getDisplayPlugin (name) {
  return displays.get(name)
}
