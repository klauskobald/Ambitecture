import { projectGraph } from '../core/projectGraph.js'
import { sendPulseControlCommand } from '../core/outboundQueue.js'
import { pickChoice } from '../core/Modal.js'
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
 * Slim toolbar: `SYNC` · restart [value] · lerp [knob] (one row from 400px up).
 *
 * @returns {{ el: HTMLElement, refresh: () => void }}
 */
export function createPerformPulseSyncColumn () {
  const el = document.createElement('aside')
  el.className = 'perform-pulse-sync-col'
  el.setAttribute('aria-label', 'Pulse sync')

  const title = document.createElement('span')
  title.className = 'perform-pulse-sync-col__title'
  title.textContent = 'Sync'

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
      { selected: restart }
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

  el.appendChild(title)
  el.appendChild(restartGroup)
  el.appendChild(lerpGroup)

  function refresh () {
    const { restart, lerp } = projectGraph.getPulseSync()
    currentLerp = lerp
    restartValue.textContent = restartLabelForWire(restart)
    lerpKnob.syncFromExternal()
  }

  return { el, refresh }
}
