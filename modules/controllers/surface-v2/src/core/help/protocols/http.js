/**
 * Protocol handler for http:// and https:// URLs.
 * Renders a standard <a> tag with target="_blank" and rel="noopener noreferrer".
 *
 * @type {import('./registry.js').ProtocolHandler}
 */
export function httpProtocol (url, text) {
  if (!/^https?:\/\//i.test(url)) return null

  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.className = 'help-link help-link--external'
  a.textContent = text
  return a
}
