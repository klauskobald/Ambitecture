const INFO_TTL_MS = 2600
const WARN_TTL_MS = 4200

/** @typedef {'info' | 'warn' | 'error'} NotificationLevel */

/** @type {HTMLElement | null} */
let container = null

/** @type {Map<string, Set<string>>} */
const notificationsByKey = new Map()

/** @type {Map<string, { el: HTMLElement, timerId: number | null, key: string | undefined }>} */
const notificationState = new Map()

function ensureContainer () {
  if (container) return container
  const el = document.createElement('div')
  el.className = 'status-notification-stack'
  document.body.appendChild(el)
  container = el
  return el
}

function nextId () {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * @param {NotificationLevel} level
 * @returns {number | null}
 */
function ttlForLevel (level) {
  switch (level) {
    case 'warn': return WARN_TTL_MS
    case 'error': return null
    case 'info':
    default:
      return INFO_TTL_MS
  }
}

/**
 * @param {string} id
 */
function dismissById (id) {
  const state = notificationState.get(id)
  if (!state) return
  if (state.timerId !== null) window.clearTimeout(state.timerId)
  state.el.remove()
  notificationState.delete(id)
  if (!state.key) return
  const idSet = notificationsByKey.get(state.key)
  if (!idSet) return
  idSet.delete(id)
  if (idSet.size === 0) notificationsByKey.delete(state.key)
}

/**
 * @param {string} key
 */
function dismissByKey (key) {
  const ids = notificationsByKey.get(key)
  if (!ids) return
  for (const id of ids) dismissById(id)
}

/**
 * @param {NotificationLevel} level
 * @param {string} message
 * @param {string | undefined} key
 */
function show (level, message, key) {
  if (key) dismissByKey(key)

  const id = nextId()
  const stack = ensureContainer()
  const bubble = document.createElement('div')
  bubble.className = `status-notification status-notification--${level}`
  bubble.textContent = message
  stack.appendChild(bubble)

  let timerId = null
  const ttl = ttlForLevel(level)
  if (ttl !== null) {
    timerId = window.setTimeout(() => dismissById(id), ttl)
  }

  notificationState.set(id, { el: bubble, timerId, key })
  if (key) {
    const ids = notificationsByKey.get(key) ?? new Set()
    ids.add(id)
    notificationsByKey.set(key, ids)
  }
}

export const notification = {
  /**
   * @param {string} message
   * @param {string} [key]
   */
  info (message, key) {
    show('info', message, key)
  },
  /**
   * @param {string} message
   * @param {string} [key]
   */
  warn (message, key) {
    show('warn', message, key)
  },
  /**
   * @param {string} message
   * @param {string} [key]
   */
  error (message, key) {
    show('error', message, key)
  }
}
