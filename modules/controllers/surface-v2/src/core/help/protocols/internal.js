/**
 * Protocol handler for bare topic-name links (no :// — default internal).
 * Renders a button styled as a link that navigates to another help topic.
 *
 * @type {import('./registry.js').ProtocolHandler}
 */
export function internalProtocol (url, text, ctx) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'help-link help-link--internal'
  btn.textContent = text
  btn.addEventListener('click', () => {
    ctx.showTopic(url)
  })
  return btn
}
