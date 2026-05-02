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
 * Clone an object and set a nested property using dot-notation path.
 * @param {Record<string, unknown>} obj
 * @param {string} dotKey
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function cloneAndSetAtDotPath (obj, dotKey, value) {
  const keys = dotKey.split('.')
  const cloned = { ...obj }
  let cursor = cloned
  for (let i = 0; i < keys.length - 1; i++) {
    const key = /** @type {string} */ (keys[i])
    const child = cursor[key]
    const clonedChild = (child && typeof child === 'object' && !Array.isArray(child))
      ? { .../** @type {Record<string, unknown>} */ (child) }
      : {}
    cursor[key] = clonedChild
    cursor = clonedChild
  }
  const leafKey = /** @type {string} */ (keys[keys.length - 1])
  cursor[leafKey] = value
  return cloned
}

/**
 * Clone an object and remove a nested property using dot-notation path.
 * Parent objects are preserved even if they become empty.
 * @param {Record<string, unknown>} obj
 * @param {string} dotKey
 * @returns {Record<string, unknown>}
 */
export function cloneAndDeleteAtDotPath (obj, dotKey) {
  const keys = dotKey.split('.')
  const cloned = { ...obj }
  let cursor = cloned
  for (let i = 0; i < keys.length - 1; i++) {
    const key = /** @type {string} */ (keys[i])
    const child = cursor[key]
    if (!child || typeof child !== 'object' || Array.isArray(child)) return cloned
    const clonedChild = { .../** @type {Record<string, unknown>} */ (child) }
    cursor[key] = clonedChild
    cursor = clonedChild
  }
  const leafKey = /** @type {string} */ (keys[keys.length - 1])
  delete cursor[leafKey]
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
