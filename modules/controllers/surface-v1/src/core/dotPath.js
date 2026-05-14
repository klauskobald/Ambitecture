/**
 * Read a value from an object using dot-notation path.
 * @param {Record<string, unknown>} obj
 * @param {string} dotKey
 * @returns {unknown}
 */
export function readAtDotPath (obj, dotKey) {
  return dotKey.split('.').reduce((/** @type {unknown} */ current, key) => {
    if (current === null || current === undefined || typeof current !== 'object' || Array.isArray(current)) return undefined
    return /** @type {Record<string, unknown>} */ (current)[key]
  }, /** @type {unknown} */ (obj))
}

/**
 * @param {string} segment
 * @returns {number | null}
 */
function parseArrayIndex (segment) {
  if (!/^\d+$/.test(segment)) return null
  const index = Number(segment)
  if (!Number.isInteger(index) || index < 0) return null
  return index
}

/** @param {unknown} value */
function isContainer (value) {
  return !!value && typeof value === 'object'
}

/**
 * Clone an object and set a nested property using dot-notation path.
 * Array containers along the path are preserved as arrays; numeric segments
 * index into them. Missing intermediate containers are auto-created as `[]`
 * when the next segment is a numeric index, otherwise as `{}`.
 * @param {Record<string, unknown>} obj
 * @param {string} dotKey
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function cloneAndSetAtDotPath (obj, dotKey, value) {
  const segments = dotKey.split('.')
  const cloned = { ...obj }
  /** @type {Record<string, unknown> | unknown[]} */
  let cursor = cloned
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = /** @type {string} */ (segments[i])
    const nextSegment = /** @type {string} */ (segments[i + 1])
    if (Array.isArray(cursor)) {
      const index = parseArrayIndex(segment)
      if (index === null) return cloned
      const existing = cursor[index]
      const clonedChild = isContainer(existing)
        ? (Array.isArray(existing)
            ? [.../** @type {unknown[]} */ (existing)]
            : { .../** @type {Record<string, unknown>} */ (existing) })
        : (parseArrayIndex(nextSegment) !== null ? [] : {})
      cursor[index] = clonedChild
      cursor = /** @type {Record<string, unknown> | unknown[]} */ (clonedChild)
      continue
    }
    const existing = cursor[segment]
    const clonedChild = isContainer(existing)
      ? (Array.isArray(existing)
          ? [.../** @type {unknown[]} */ (existing)]
          : { .../** @type {Record<string, unknown>} */ (existing) })
      : (parseArrayIndex(nextSegment) !== null ? [] : {})
    cursor[segment] = clonedChild
    cursor = /** @type {Record<string, unknown> | unknown[]} */ (clonedChild)
  }
  const last = /** @type {string} */ (segments[segments.length - 1])
  if (Array.isArray(cursor)) {
    const index = parseArrayIndex(last)
    if (index === null) return cloned
    cursor[index] = value
    return cloned
  }
  cursor[last] = value
  return cloned
}

/**
 * Clone an object and remove a nested property using dot-notation path.
 * Parent containers are preserved even if they become empty. Array elements
 * are deleted (slot becomes a hole), matching hub-side `removeAtDotPath`.
 * @param {Record<string, unknown>} obj
 * @param {string} dotKey
 * @returns {Record<string, unknown>}
 */
export function cloneAndDeleteAtDotPath (obj, dotKey) {
  const segments = dotKey.split('.')
  const cloned = { ...obj }
  /** @type {Record<string, unknown> | unknown[]} */
  let cursor = cloned
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = /** @type {string} */ (segments[i])
    if (Array.isArray(cursor)) {
      const index = parseArrayIndex(segment)
      if (index === null) return cloned
      const existing = cursor[index]
      if (!isContainer(existing)) return cloned
      const clonedChild = Array.isArray(existing)
        ? [.../** @type {unknown[]} */ (existing)]
        : { .../** @type {Record<string, unknown>} */ (existing) }
      cursor[index] = clonedChild
      cursor = /** @type {Record<string, unknown> | unknown[]} */ (clonedChild)
      continue
    }
    const existing = cursor[segment]
    if (!isContainer(existing)) return cloned
    const clonedChild = Array.isArray(existing)
      ? [.../** @type {unknown[]} */ (existing)]
      : { .../** @type {Record<string, unknown>} */ (existing) }
    cursor[segment] = clonedChild
    cursor = /** @type {Record<string, unknown> | unknown[]} */ (clonedChild)
  }
  const last = /** @type {string} */ (segments[segments.length - 1])
  if (Array.isArray(cursor)) {
    const index = parseArrayIndex(last)
    if (index === null) return cloned
    delete cursor[index]
    return cloned
  }
  delete cursor[last]
  return cloned
}

/**
 * Clone an object and apply dot-key patch/remove operations.
 * @param {Record<string, unknown>} obj
 * @param {Record<string, unknown>} patch
 * @param {string[]} [remove]
 * @returns {Record<string, unknown>}
 */
export function applyDotPathPatch (obj, patch, remove = []) {
  let next = JSON.parse(JSON.stringify(obj))
  for (const [key, value] of Object.entries(patch)) {
    next = cloneAndSetAtDotPath(next, key, value)
  }
  for (const key of remove) {
    next = cloneAndDeleteAtDotPath(next, key)
  }
  return next
}
