export function showConfigError (message) {
  const el = document.getElementById('config-error')
  if (el) {
    el.textContent = message
    el.hidden = false
  }
  console.error('surface-v1:', message)
}

export function setSpatialReadout (text) {
  const el = document.getElementById('spatial-readout')
  if (!el) return
  el.textContent = text
  el.hidden = text === ''
}
