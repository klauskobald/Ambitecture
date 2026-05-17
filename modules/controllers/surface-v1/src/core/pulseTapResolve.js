import { projectGraph } from './projectGraph.js'
import { getActivePulseSetupGuid } from './pulsePlayRegistry.js'

/** @returns {string | null} */
export function resolvePulseTapSetupGuid () {
  const active = getActivePulseSetupGuid()
  if (active) return active
  const setups = projectGraph.getPulseSetups()
  const first = setups[0]
  const guid = first && typeof first.guid === 'string' ? first.guid : ''
  return guid.length > 0 ? guid : null
}
