/**
 * Forward surface design tokens into a plugin iframe (same variable names as `theme.css`).
 * @param {HTMLIFrameElement} iframe
 */
export function postThemeToIframe (iframe) {
  const win = iframe.contentWindow
  if (!win) return
  const styles = getComputedStyle(document.documentElement)
  /** @type {Record<string, string>} */
  const vars = {}
  for (let i = 0; i < styles.length; i++) {
    const name = styles.item(i)
    if (
      !name ||
      !name.startsWith('--') ||
      (!name.startsWith('--color-') &&
        !name.startsWith('--space-') &&
        !name.startsWith('--radius-'))
    ) {
      continue
    }
    vars[name] = styles.getPropertyValue(name).trim()
  }
  win.postMessage({ type: 'theme', vars }, '*')
}
