/**
 * @typedef {object} HelpTopic
 * @property {string} heading
 * @property {string} text
 */

/** @typedef {Record<string, HelpTopic>} HelpContent */

/** @type {HelpContent | null} */
let cached = null
/** @type {Promise<HelpContent | null> | null} */
let inflight = null

/**
 * Fetch and cache `help.json`. Domain-free: failures are reported via `console.warn`
 * (no app-level status display), and the parsed dictionary is memoized for the session.
 * @returns {Promise<HelpContent | null>}
 */
export async function loadHelpContent () {
  if (cached) return cached
  if (inflight) return inflight
  inflight = fetchHelpContent().then(content => {
    if (content) cached = content
    inflight = null
    return content
  })
  return inflight
}

/**
 * @returns {Promise<HelpContent | null>}
 */
async function fetchHelpContent () {
  let res
  try {
    res = await fetch('./help.json', { cache: 'no-store' })
  } catch (e) {
    console.warn(`HelpManager: could not load help.json (${String(e)})`)
    return null
  }
  if (!res.ok) {
    console.warn(`HelpManager: help.json HTTP ${res.status}`)
    return null
  }
  let parsed
  try {
    parsed = await res.json()
  } catch {
    console.warn('HelpManager: help.json is not valid JSON')
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.warn('HelpManager: help.json root must be an object')
    return null
  }
  return /** @type {HelpContent} */ (parsed)
}

/**
 * @param {HelpContent | null} content
 * @param {string} key
 * @returns {HelpTopic | null}
 */
export function getHelpTopic (content, key) {
  if (!content) return null
  const topic = content[key]
  if (!topic || typeof topic !== 'object') return null
  const heading = typeof topic.heading === 'string' ? topic.heading : ''
  const text = typeof topic.text === 'string' ? topic.text : ''
  if (!heading && !text) return null
  return { heading, text }
}
