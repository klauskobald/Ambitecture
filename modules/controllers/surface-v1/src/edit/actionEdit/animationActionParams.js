/**
 * @typedef {object} AnimationActionParamsState
 * @property {string} animationActionGuidForParams
 * @property {string} animationGuidForParams
 * @property {boolean} hasAnimationCommands
 * @property {{ command: string, hint: string, params: Record<string, unknown> }[] | null} animationCommands
 * @property {{ command?: string, [key: string]: unknown }} animationParamsDraft
 */

/**
 * @param {HTMLElement} paramHost
 * @param {AnimationActionParamsState} state
 */
export function renderAnimationActionParams (paramHost, state) {
  const { animationCommands, animationParamsDraft } = state
  if (!animationCommands) return

  paramHost.replaceChildren()

  const curCmd = typeof animationParamsDraft.command === 'string'
    ? animationParamsDraft.command
    : (animationCommands[0]?.command ?? '')

  const cmdLabel = document.createElement('label')
  cmdLabel.className = 'input-assign-modal__label'
  cmdLabel.textContent = 'Command'
  const cmdSelect = document.createElement('select')
  cmdSelect.className = 'modal-input modal-select-capitalize'
  for (const c of animationCommands) {
    const opt = document.createElement('option')
    opt.value = c.command
    opt.textContent = c.hint
      ? `${c.command} — ${c.hint}`
      : c.command
    cmdSelect.appendChild(opt)
  }
  cmdSelect.value = curCmd
  cmdLabel.appendChild(cmdSelect)
  paramHost.appendChild(cmdLabel)

  const paramsHost = document.createElement('div')
  paramsHost.className = 'input-assign-modal__anim-params'

  const renderCmdParams = () => {
    paramsHost.replaceChildren()
    const selected = animationCommands.find(c => c.command === cmdSelect.value)
    const cmdParams = selected?.params
    if (!cmdParams || typeof cmdParams !== 'object' || Array.isArray(cmdParams)) return

    for (const [pk, pd] of Object.entries(cmdParams)) {
      if (!pd || typeof pd !== 'object' || Array.isArray(pd)) continue
      const pdef = /** @type {Record<string, unknown>} */ (pd)
      const ptype = typeof pdef.type === 'string' ? pdef.type : 'string'

      const lab = document.createElement('label')
      lab.className = 'input-assign-modal__label'
      lab.textContent = pk

      if (ptype === 'number') {
        const inp = document.createElement('input')
        inp.type = 'number'
        inp.className = 'modal-input'
        const step = typeof pdef.step === 'number' ? pdef.step : 1
        const defVal = typeof pdef.default === 'number' ? pdef.default : 0
        inp.step = String(step)
        inp.value = String(
          typeof animationParamsDraft[pk] === 'number'
            ? animationParamsDraft[pk]
            : defVal
        )
        inp.addEventListener('input', () => {
          const n = Number(inp.value)
          animationParamsDraft[pk] = Number.isFinite(n) ? n : defVal
        })
        lab.appendChild(inp)
      } else {
        const inp = document.createElement('input')
        inp.type = 'text'
        inp.className = 'modal-input'
        const defVal = typeof pdef.default === 'string' ? pdef.default : ''
        inp.value = String(animationParamsDraft[pk] ?? defVal)
        inp.addEventListener('input', () => {
          animationParamsDraft[pk] = inp.value
        })
        lab.appendChild(inp)
      }
      paramsHost.appendChild(lab)
    }
  }

  cmdSelect.addEventListener('change', () => {
    const fresh = { command: cmdSelect.value }
    Object.keys(animationParamsDraft).forEach(k => {
      delete animationParamsDraft[k]
    })
    Object.assign(animationParamsDraft, fresh)
    renderCmdParams()
  })

  paramHost.appendChild(paramsHost)
  renderCmdParams()
}

/**
 * @param {AnimationActionParamsState} state
 * @returns {boolean}
 */
export function canEmitAnimationActionPatch (state) {
  return (
    state.animationActionGuidForParams.length > 0 &&
    state.animationGuidForParams.length > 0 &&
    state.hasAnimationCommands &&
    typeof state.animationParamsDraft.command === 'string' &&
    state.animationParamsDraft.command.length > 0
  )
}

/**
 * @param {AnimationActionParamsState} state
 * @returns {{ type: 'animation', guid: string, params: Record<string, unknown> } | null}
 */
export function buildAnimationExecutePatch (state) {
  if (!canEmitAnimationActionPatch(state)) return null
  return {
    type: 'animation',
    guid: state.animationGuidForParams,
    params: { ...state.animationParamsDraft }
  }
}
