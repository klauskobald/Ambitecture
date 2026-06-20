import { registerProtocol, getProtocolHandler } from './protocols/registry.js'
import { httpProtocol } from './protocols/http.js'
import { internalProtocol } from './protocols/internal.js'

// --- built-in protocol registration (static, always needed) ---

registerProtocol('http', httpProtocol)
registerProtocol('https', httpProtocol)
registerProtocol('internal', internalProtocol)

// --- link parsing ---

/** Matches [display text](url) where url contains no whitespace. */
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g

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

// --- public API ---

/**
 * Render raw help text into safe DOM nodes.
 * - Plain text is inserted via text nodes (inherently HTML-safe).
 * - "\n" in plain text becomes <br>.
 * - "[text](url)" markdown links are delegated to protocol handlers.
 * - Unmatched text is never parsed as HTML.
 *
 * @param {string} rawText
 * @param {{ showTopic: (key: string) => void }} ctx
 * @returns {DocumentFragment}
 */
export function renderHelpText (rawText, ctx) {
  const fragment = document.createDocumentFragment()

  if (!rawText) return fragment

  let lastIndex = 0
  let match

  LINK_RE.lastIndex = 0
  while ((match = LINK_RE.exec(rawText)) !== null) {
    // Plain text before this match
    const before = rawText.slice(lastIndex, match.index)
    appendTextWithBreaks(fragment, before)

    // The link
    const [, linkText, rawUrl] = match
    const { scheme, url } = classifyUrl(rawUrl)
    const handler = getProtocolHandler(scheme)

    if (handler) {
      const el = handler(url, linkText, ctx)
      if (el instanceof Node) {
        fragment.appendChild(el)
      }
    } else {
      // Unknown scheme: render link text as plain escaped text
      fragment.appendChild(document.createTextNode(linkText))
    }

    lastIndex = LINK_RE.lastIndex
  }

  // Trailing plain text after final match
  const trailing = rawText.slice(lastIndex)
  appendTextWithBreaks(fragment, trailing)

  return fragment
}

export { registerProtocol }
