/**
 * Comma-separated assign labels with max length (inline toggle pills).
 * @param {string[]} names
 * @param {number} [maxLen]
 * @returns {string}
 */
export function formatLinkedAssignLabel (names, maxLen = 25) {
  if (names.length === 0) return ''
  const joined = names.join(', ')
  if (joined.length <= maxLen) return joined
  if (maxLen <= 1) return joined.slice(0, maxLen)
  return `${joined.slice(0, maxLen - 1)}…`
}
