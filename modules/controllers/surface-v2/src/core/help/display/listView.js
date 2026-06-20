import { registerDisplayPlugin } from './registry.js'

/**
 * Display plugin for flat lists of {name, entity} objects.
 * Renders a <ul> where each item is a button linking to "entity.name".
 *
 * @type {import('./registry.js').DisplayPlugin}
 */
function listView (data, ctx) {
  const root = document.createElement('ul')
  root.className = 'help-list'

  const items = Array.isArray(data) ? data : []
  if (items.length === 0) {
    const p = document.createElement('p')
    p.textContent = 'None connected.'
    return p
  }

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const name = typeof item.name === 'string' ? item.name : ''
    const entity = typeof item.entity === 'string' ? item.entity : ''
    if (!name || !entity) continue

    const li = document.createElement('li')
    li.className = 'help-list__item'

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'help-link help-link--internal'
    btn.textContent = `${name}`
    const topicKey = `${entity}.${name}`
    btn.addEventListener('click', () => {
      ctx.showTopic(topicKey)
    })

    li.appendChild(btn)
    root.appendChild(li)
  }

  return root
}

registerDisplayPlugin('listView', listView)
