import { registerProtocol, getProtocolHandler } from './protocols/registry.js'
import { httpProtocol } from './protocols/http.js'
import { internalProtocol } from './protocols/internal.js'
import { registerDisplayPlugin, getDisplayPlugin } from './display/registry.js'

// --- side-effect: register built-in display plugins ---
import './display/listView.js'

// --- built-in protocol registration ---

registerProtocol('http', httpProtocol)
registerProtocol('https', httpProtocol)
registerProtocol('internal', internalProtocol)

// --- regexes ---

/** Matches [display text](url) where url contains no whitespace. */
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g

/** Matches ${displayPlugin:functionName(args)} */
const PLACEHOLDER_RE = /\$\{(\w+):(\w+)\(([^)]*)\)\}/g

// --- URL classification ---

/**
 * Classify a raw URL from a markdown link into a scheme and canonical URL.
 * - Contains "://" → split on first occurrence; scheme is left of ://
 * - No "://"     → internal (bare topic key)
 *
 * @param {string} rawUrl
 * @returns {{ scheme: string, url: string }}
 */
function classifyUrl (rawUrl) {
  const protoIdx = rawUrl.indexOf('://')
  if (protoIdx >= 0) {
    return { scheme: rawUrl.slice(0, protoIdx), url: rawUrl }
  }
  return { scheme: 'internal', url: rawUrl }
}

// --- text rendering ---

/**
 * Append plain text to a fragment, converting \n to <br>.
 * @param {DocumentFragment} fragment
 * @param {string} text
 */
function appendTextWithBreaks (fragment, text) {
  const parts = text.split('\n')
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) fragment.appendChild(document.createElement('br'))
    fragment.appendChild(document.createTextNode(parts[i]))
  }
}

/**
 * @typedef {object} RenderCtx
 * @property {(key: string) => void} showTopic
 * @property {{ callFunction: (name: string, args: string) => any } | null} [conduit]
 */

// --- public API ---

/**
 * Render raw help text into safe DOM nodes.
 * Handles \n → <br>, ${displayPlugin:fnName(args)} placeholders, [text](url) links.
 *
 * @param {string} rawText
 * @param {RenderCtx} ctx
 * @returns {DocumentFragment}
 */
export function renderHelpText (rawText, ctx) {
  const fragment = document.createDocumentFragment()

  if (!rawText) return fragment

  let pos = 0

  while (pos < rawText.length) {
    // Find the next placeholder and the next link from current position
    PLACEHOLDER_RE.lastIndex = pos
    LINK_RE.lastIndex = pos

    const phMatch = PLACEHOLDER_RE.exec(rawText)
    const liMatch = LINK_RE.exec(rawText)

    const nextPh = phMatch ? phMatch.index : Infinity
    const nextLi = liMatch ? liMatch.index : Infinity

    if (nextPh === Infinity && nextLi === Infinity) {
      // No more matches — append remaining text and finish
      appendTextWithBreaks(fragment, rawText.slice(pos))
      break
    }

    if (nextPh < nextLi) {
      // Placeholder comes first
      appendTextWithBreaks(fragment, rawText.slice(pos, nextPh))

      const [, displayName, fnName, args] = /** @type {string[]} */ (phMatch)
      const display = getDisplayPlugin(displayName)

      if (display) {
        const conduit = ctx.conduit ?? null
        const data = conduit ? conduit.callFunction(fnName, args) : null
        const el = display(data, ctx)
        if (el instanceof Node) {
          fragment.appendChild(el)
        }
      } else {
        // Unknown display plugin — leave placeholder as plain text
        fragment.appendChild(document.createTextNode(phMatch[0]))
      }

      PLACEHOLDER_RE.lastIndex = 0
      pos = nextPh + phMatch[0].length
    } else {
      // Link comes first
      appendTextWithBreaks(fragment, rawText.slice(pos, nextLi))

      const [, linkText, rawUrl] = /** @type {string[]} */ (liMatch)
      const { scheme, url } = classifyUrl(rawUrl)
      const handler = getProtocolHandler(scheme)

      if (handler) {
        const el = handler(url, linkText, ctx)
        if (el instanceof Node) {
          fragment.appendChild(el)
        }
      } else {
        fragment.appendChild(document.createTextNode(linkText))
      }

      LINK_RE.lastIndex = 0
      pos = nextLi + liMatch[0].length
    }
  }

  return fragment
}

// Re-exports for extensibility
export { registerProtocol, registerDisplayPlugin }
