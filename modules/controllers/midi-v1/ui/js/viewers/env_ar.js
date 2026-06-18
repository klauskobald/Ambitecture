import { createToggleButton } from '../components/toggleButton.js'

/**
 * @param {HTMLElement} parent
 * @param {{
 *   getParams: () => Record<string, unknown>,
 *   onChange: () => void
 * }} api
 * @returns {{ syncFromModel: () => void, teardown: () => void }}
 */
export function mountEnvArRow (parent, api) {
  const row = document.createElement('div')
  row.className = 'modal__row modal__row--compact'

  const enToggle = createToggleButton({
    label: 'Envelope',
    getValue: () => getEnvelopeObj().enabled === true,
    onToggle: next => {
      getEnvelopeObj().enabled = next
      setDisabled(!next)
      commit()
    }
  })

  const atkLabel = document.createElement('span')
  atkLabel.className = 'modal__field-label'
  atkLabel.textContent = 'Atk ms:'

  const atkIn = document.createElement('input')
  atkIn.type = 'number'
  atkIn.className = 'modal__input-num modal__input-num--3'
  atkIn.min = '0'
  atkIn.step = '1'
  atkIn.title = 'attackMs'

  const relLabel = document.createElement('span')
  relLabel.className = 'modal__field-label'
  relLabel.textContent = 'Rel ms:'

  const relIn = document.createElement('input')
  relIn.type = 'number'
  relIn.className = 'modal__input-num modal__input-num--3'
  relIn.min = '0'
  relIn.step = '1'
  relIn.title = 'releaseMs'

  function getEnvelopeObj () {
    const p = api.getParams()
    if (!p.envelope || typeof p.envelope !== 'object' || Array.isArray(p.envelope)) {
      p.envelope = {
        type: 'env_ar',
        enabled: true,
        attackMs: 0,
        releaseMs: 0
      }
    }
    return /** @type {Record<string, unknown>} */ (p.envelope)
  }

  function commit () {
    const env = getEnvelopeObj()
    env.type = 'env_ar'
    const a = Math.round(Number(atkIn.value))
    const r = Math.round(Number(relIn.value))
    env.attackMs = Number.isFinite(a) ? Math.max(0, a) : 0
    env.releaseMs = Number.isFinite(r) ? Math.max(0, r) : 0
    atkIn.value = String(env.attackMs)
    relIn.value = String(env.releaseMs)
    api.onChange()
  }

  function setDisabled (disabled) {
    atkIn.disabled = disabled
    relIn.disabled = disabled
  }

  atkIn.addEventListener('change', commit)
  relIn.addEventListener('change', commit)

  row.appendChild(enToggle.el)
  row.appendChild(atkLabel)
  row.appendChild(atkIn)
  row.appendChild(relLabel)
  row.appendChild(relIn)

  parent.appendChild(row)

  function syncFromModel () {
    const env = getEnvelopeObj()
    const en =
      typeof env.enabled === 'boolean' ? env.enabled : true
    enToggle.sync()
    setDisabled(!en)
    const atk =
      typeof env.attackMs === 'number' && Number.isFinite(env.attackMs)
        ? Math.max(0, Math.round(env.attackMs))
        : 0
    const rel =
      typeof env.releaseMs === 'number' && Number.isFinite(env.releaseMs)
        ? Math.max(0, Math.round(env.releaseMs))
        : 0
    atkIn.value = String(atk)
    relIn.value = String(rel)
  }

  syncFromModel()

  return {
    syncFromModel,
    teardown: () => {
      row.remove()
    }
  }
}
