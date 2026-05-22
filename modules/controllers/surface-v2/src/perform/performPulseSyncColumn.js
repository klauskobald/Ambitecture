import { projectGraph } from '../core/projectGraph.js'
import { sendPulseControlCommand } from '../core/outboundQueue.js'
import { pickChoice } from '../core/Modal.js'
import { subscribePulseSyncReceived } from '../core/pulseSyncActivity.js'
import { formatPulseBpmDisplay } from '../core/pulseFormat.js'
import { ScalarRadialKnobSvg } from '../edit/components/ScalarRadialKnobSvg.js'

/** @type {ReadonlyArray<{ wire: 'never' | 'bar' | 'onset', label: string }>} */
const RESTART_OPTIONS = [
  { wire: 'never', label: 'none' },
  { wire: 'bar', label: 'bar' },
  { wire: 'onset', label: 'beat' }
]

/**
 * @param {'never' | 'bar' | 'onset'} wire
 * @returns {string}
 */
function restartLabelForWire (wire) {
  const opt = RESTART_OPTIONS.find(o => o.wire === wire)
  return opt?.label ?? 'none'
}

/**
 * Slim toolbar: row 1 — on/off · `Sync` · BPM; row 2 — restart [value] beside lerp [knob].
 *
 * @returns {{ el: HTMLElement, refresh: () => void }}
 */
export function createPerformPulseSyncColumn () {
  const el = document.createElement('aside')
  el.className = 'perform-pulse-sync-col'
  el.setAttribute('aria-label', 'Pulse sync')

  const heading = document.createElement('span')
  heading.className = 'perform-pulse-sync-col__heading'

  const title = document.createElement('span')
  title.className = 'perform-pulse-sync-col__title'
  title.textContent = 'Sync'

  const titleBpm = document.createElement('span')
  titleBpm.className = 'perform-pulse-sync-col__title-bpm'
  titleBpm.setAttribute('aria-hidden', 'true')
  titleBpm.hidden = true

  const enabledToggle = document.createElement('button')
  enabledToggle.type = 'button'
  enabledToggle.className =
    'perform-pulse-sync-col__enabled-toggle intent-toggle'
  enabledToggle.setAttribute('aria-label', 'External pulse sync')
  enabledToggle.addEventListener('click', () => {
    const { enabled } = projectGraph.getPulseSync()
    sendPulseControlCommand({ command: 'setSyncConfig', enabled: !enabled })
  })

  heading.appendChild(enabledToggle)
  heading.appendChild(title)
  heading.appendChild(titleBpm)

  function restartRxFlash (el) {
    el.classList.remove('perform-pulse-sync-col__title--rx')
    void el.offsetWidth
    el.classList.add('perform-pulse-sync-col__title--rx')
  }

  /** @param {number | undefined} bpm */
  function blinkSyncTitle (bpm) {
    restartRxFlash(title)
    if (typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0) {
      titleBpm.textContent = formatPulseBpmDisplay(bpm)
      titleBpm.hidden = false
      restartRxFlash(titleBpm)
    }
  }

  subscribePulseSyncReceived(blinkSyncTitle)

  const restartGroup = document.createElement('span')
  restartGroup.className = 'perform-pulse-sync-col__group'

  const restartLabel = document.createElement('span')
  restartLabel.className = 'perform-pulse-sync-col__label'
  restartLabel.textContent = 'restart'

  const restartValue = document.createElement('button')
  restartValue.type = 'button'
  restartValue.className = 'perform-pulse-sync-col__restart-value'
  restartValue.addEventListener('click', async () => {
    const { restart } = projectGraph.getPulseSync()
    const choice = await pickChoice(
      'Restart',
      RESTART_OPTIONS.map(o => ({ value: o.wire, label: o.label })),
      { selected: restart, scrollKey: 'pulse.sync.restart' }
    )
    if (!choice) return
    sendPulseControlCommand({
      command: 'setSyncConfig',
      restart: /** @type {'never' | 'bar' | 'onset'} */ (choice)
    })
  })

  restartGroup.appendChild(restartLabel)
  restartGroup.appendChild(restartValue)

  const lerpGroup = document.createElement('span')
  lerpGroup.className = 'perform-pulse-sync-col__group perform-pulse-sync-col__group--lerp'

  const lerpLabel = document.createElement('span')
  lerpLabel.className = 'perform-pulse-sync-col__label'
  lerpLabel.textContent = 'lerp'

  let currentLerp = 0.35

  const knobWrap = document.createElement('span')
  knobWrap.className = 'perform-pulse-sync-col__lerp-knob'

  const lerpKnob = new ScalarRadialKnobSvg({
    descriptor: {
      name: '',
      range: [0.1, 1],
      step: 0.01,
      defaultValue: 0.35,
      stepFunction: 'linear'
    },
    intentGuid: '__pulse_sync_lerp__',
    readValue: () => currentLerp,
    onCommit: domain => {
      if (!Number.isFinite(domain)) return
      const next = Math.min(1, Math.max(0.1, domain))
      currentLerp = next
      sendPulseControlCommand({ command: 'setSyncConfig', lerp: next })
    },
    showInnerSvgTitle: false
  })
  lerpKnob.mount(knobWrap)

  lerpGroup.appendChild(lerpLabel)
  lerpGroup.appendChild(knobWrap)

  const controlsRow = document.createElement('div')
  controlsRow.className = 'perform-pulse-sync-col__controls-row'
  controlsRow.appendChild(restartGroup)
  controlsRow.appendChild(lerpGroup)

  el.appendChild(heading)
  el.appendChild(controlsRow)

  function refresh () {
    const { enabled, restart, lerp } = projectGraph.getPulseSync()
    currentLerp = lerp
    const syncActive = enabled === true
    el.classList.toggle('perform-pulse-sync-col--off', !syncActive)
    enabledToggle.textContent = syncActive ? 'On' : 'Off'
    enabledToggle.classList.toggle('intent-toggle--enabled', syncActive)
    enabledToggle.setAttribute('aria-pressed', String(syncActive))
    restartValue.disabled = !syncActive
    restartValue.tabIndex = syncActive ? 0 : -1
    restartValue.textContent = restartLabelForWire(restart)
    lerpKnob.syncFromExternal()
  }

  return { el, refresh }
}
