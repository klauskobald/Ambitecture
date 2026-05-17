import { projectGraph } from '../core/projectGraph.js'
import { sendPulseControlCommand } from '../core/outboundQueue.js'
import { ScalarRadialKnobSvg } from '../edit/components/ScalarRadialKnobSvg.js'

/** @type {ReadonlyArray<{ wire: 'never' | 'bar' | 'onset', label: string }>} */
const RESTART_OPTIONS = [
  { wire: 'never', label: 'none' },
  { wire: 'bar', label: 'bar' },
  { wire: 'onset', label: 'beat' }
]

/**
 * Left column: durable `pulses.sync` settings (restart pills + lerp knob).
 *
 * @returns {{ el: HTMLElement, refresh: () => void }}
 */
export function createPerformPulseSyncColumn () {
  const el = document.createElement('aside')
  el.className = 'perform-pulse-sync-col'

  const title = document.createElement('h3')
  title.className = 'perform-pulse-sync-col__title'
  title.textContent = 'Sync'

  const restartBlock = document.createElement('div')
  restartBlock.className = 'perform-pulse-sync-col__field'

  const restartLabel = document.createElement('span')
  restartLabel.className = 'perform-pulse-sync-col__label'
  restartLabel.textContent = 'Restart'

  const pills = document.createElement('div')
  pills.className = 'prop-pills perform-pulse-sync-col__pills'

  /** @type {HTMLButtonElement[]} */
  const pillButtons = []

  for (const opt of RESTART_OPTIONS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'prop-pill intent-toggle'
    btn.textContent = opt.label
    btn.dataset.restart = opt.wire
    btn.addEventListener('click', () => {
      sendPulseControlCommand({ command: 'setSyncConfig', restart: opt.wire })
    })
    pills.appendChild(btn)
    pillButtons.push(btn)
  }

  restartBlock.appendChild(restartLabel)
  restartBlock.appendChild(pills)

  const lerpBlock = document.createElement('div')
  lerpBlock.className = 'perform-pulse-sync-col__lerp'

  let currentLerp = 0.35

  const knobWrap = document.createElement('div')
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

  lerpBlock.appendChild(knobWrap)

  el.appendChild(title)
  el.appendChild(restartBlock)
  el.appendChild(lerpBlock)

  function refresh () {
    const { restart, lerp } = projectGraph.getPulseSync()
    currentLerp = lerp
    for (const btn of pillButtons) {
      const wire = btn.dataset.restart
      const isActive = wire === restart
      btn.classList.toggle('prop-pill--active', isActive)
      btn.classList.toggle('intent-toggle--enabled', isActive)
    }
    lerpKnob.syncFromExternal()
  }

  return { el, refresh }
}
