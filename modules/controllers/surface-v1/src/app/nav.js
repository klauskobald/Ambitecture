/**
 * Collapsible navigation.
 *
 * Mobile: hamburger toggle shows/hides the nav.
 * Desktop (CSS breakpoint): nav is always visible, toggle is hidden.
 *
 * Calls `onNavigate(paneName)` when a nav link is clicked.
 *
 * @param {(paneName: string) => void} onNavigate
 */
export function initNav (onNavigate) {
  const toggle = document.getElementById('nav-toggle')
  const nav = document.getElementById('app-nav')
  const links = /** @type {NodeListOf<HTMLAnchorElement>} */ (
    document.querySelectorAll('.nav-link[data-pane]')
  )

  toggle?.addEventListener('click', () => {
    const isOpen = document.body.classList.toggle('nav-open')
    toggle.setAttribute('aria-expanded', String(isOpen))
  })

  for (const link of links) {
    link.addEventListener('click', ev => {
      ev.preventDefault()
      document.body.classList.remove('nav-open')
      toggle?.setAttribute('aria-expanded', 'false')
      setActiveLink(link)
      onNavigate(link.dataset.pane ?? '')
    })
  }
}

/** @param {HTMLElement} activeLink */
function setActiveLink (activeLink) {
  for (const link of document.querySelectorAll('.nav-link[data-pane]')) {
    link.classList.toggle('nav-link--active', link === activeLink)
  }
}

/** Activate the first nav link programmatically (used on first load). */
export function activateDefaultNav (onNavigate) {
  const first = /** @type {HTMLAnchorElement | null} */ (
    document.querySelector('.nav-link[data-pane]')
  )
  if (!first) return
  setActiveLink(first)
  onNavigate(first.dataset.pane ?? '')
}
