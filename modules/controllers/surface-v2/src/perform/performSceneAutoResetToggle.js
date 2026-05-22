import {
  isSceneAutoResetOnLoadEnabled,
  setSceneAutoResetOnLoadEnabled
} from './sceneAutoResetPreference.js'
import { maybeClearRuntimeOverlayForActiveScene } from './sceneAutoResetOnLoad.js'

/**
 * Control-panel toggle (↺): auto-apply runtime scene reset after each scene load.
 * @returns {HTMLButtonElement}
 */
export function createSceneAutoResetToggleButton () {
  const button = document.createElement('button')
  button.type = 'button'
  button.className =
    'btn perform-input perform-input--button perform-scene-auto-reset-toggle'
  button.setAttribute('role', 'switch')

  const labelEl = document.createElement('span')
  labelEl.className = 'perform-input__label'
  labelEl.textContent = '↺'
  button.appendChild(labelEl)

  const syncUi = () => {
    const on = isSceneAutoResetOnLoadEnabled()
    button.classList.toggle('btn--active', on)
    button.setAttribute('aria-pressed', on ? 'true' : 'false')
    button.title = on
      ? 'Auto-reset on scene change (on)'
      : 'Auto-reset on scene change (off)'
  }

  button.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    setSceneAutoResetOnLoadEnabled(!isSceneAutoResetOnLoadEnabled())
    syncUi()
    if (isSceneAutoResetOnLoadEnabled()) {
      maybeClearRuntimeOverlayForActiveScene()
    }
  })

  syncUi()
  return button
}
