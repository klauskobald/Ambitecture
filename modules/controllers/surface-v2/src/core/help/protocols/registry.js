/**
 * @callback ProtocolHandler
 * @param {string} url   — raw URL from the markdown link
 * @param {string} text  — display text from inside the brackets
 * @param {{ showTopic: (key: string) => void }} ctx — rendering context bridge
 * @returns {HTMLElement | null} a safe DOM element, or null to skip
 */

/** @type {Map<string, ProtocolHandler>} */
const handlers = new Map()

/**
 * @param {string} scheme
 * @param {ProtocolHandler} handler
 */
export function registerProtocol (scheme, handler) {
  handlers.set(scheme, handler)
}

/**
 * @param {string} scheme
 * @returns {ProtocolHandler | undefined}
 */
export function getProtocolHandler (scheme) {
  return handlers.get(scheme)
}
