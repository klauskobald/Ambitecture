const SAVE_DEBOUNCE_MS = 280

/**
 * @typedef {{ guid: string, name: string }} IntentRow
 */

/**
 * @typedef {{ filterIntentGuid: string | null, intents: IntentRow[] }} EditorContext
 */

/**
 * @typedef {{
 *   assignments: unknown[],
 *   intents: IntentRow[],
 *   filterIntentGuid: string | null,
 *   systemCapabilities: unknown,
 *   intentClasses: Record<string, string>,
 *   getIntentClass: (guid: string) => string | null,
 *   getEditorContext: () => EditorContext,
 *   scheduleSave: () => void,
 *   sendSave: () => void,
 *   pushAssignment: (row: Record<string, unknown>) => void,
 *   mergeEditingIntoAssignments: (editing: Record<string, unknown>) => void,
 *   deleteAssignment: (guid: string) => void,
 *   sendLearnStart: (assignmentGuid: string, field: string, capture: 'noteOn'|'controlChange'|'any') => void
 * }} AssignSessionApi
 */

/**
 * @param {{
 *   filterIntentGuid: string | null,
 *   onState: () => void,
 *   onOnline?: () => void,
 *   onOffline?: () => void,
 *   onAssignmentTrigger?: (assignmentGuid: string, input: number | null, result: number | null) => void,
 *   onAssignmentEngaged?: (assignmentGuid: string, engaged: boolean) => void,
 *   getModal: () => { applyLearnValue: (m: Record<string, unknown>) => void } | null
 * }} opts
 * @returns {AssignSessionApi}
 */
export function createAssignSession (opts) {
  /** @type {unknown[]} */
  let assignments = []
  /** @type {IntentRow[]} */
  let intents = []
  /** @type {unknown} */
  let systemCapabilities = null
  /** @type {Record<string, string>} */
  let intentClasses = {}
  let ws = null
  let reconnectTimer = null
  /** @type {ReturnType<typeof setTimeout> | null} */
  let saveTimer = null

  function wsUrlFromPage () {
    const { protocol, host } = window.location
    const wsProto = protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProto}//${host}/ws`
  }

  function sendSave () {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'save', assignments }))
    }
  }

  function scheduleSave () {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      sendSave()
    }, SAVE_DEBOUNCE_MS)
  }

  function connect () {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    ws = new WebSocket(wsUrlFromPage())

    ws.onopen = () => {
      opts.onOnline?.()
    }

    ws.onclose = () => {
      ws = null
      opts.onOffline?.()
      reconnectTimer = window.setTimeout(connect, 1500)
    }

    ws.onerror = () => {}

    ws.onmessage = ev => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.type === 'state' && Array.isArray(msg.assignments)) {
        assignments = msg.assignments.map(a => JSON.parse(JSON.stringify(a)))
        intents = Array.isArray(msg.intents)
          ? msg.intents
              .filter(
                x =>
                  x &&
                  typeof x === 'object' &&
                  typeof /** @type {Record<string, unknown>} */ (x).guid ===
                    'string'
              )
              .map(x => {
                const r = /** @type {Record<string, unknown>} */ (x)
                const guid = /** @type {string} */ (r.guid)
                const name =
                  typeof r.name === 'string' && r.name ? r.name : guid
                return { guid, name }
              })
          : []
        if ('systemCapabilities' in msg) {
          systemCapabilities = msg.systemCapabilities
        }
        const ic = msg.intentClasses
        if (ic && typeof ic === 'object' && !Array.isArray(ic)) {
          intentClasses = /** @type {Record<string, string>} */ (
            JSON.parse(JSON.stringify(ic))
          )
        } else {
          intentClasses = {}
        }
        opts.onState()
      }
      if (msg.type === 'learnValue') {
        const modal = opts.getModal()
        modal?.applyLearnValue(/** @type {Record<string, unknown>} */ (msg))
      }
      if (msg.type === 'assignmentTrigger') {
        const g = msg.assignmentGuid
        if (typeof g === 'string' && g) {
          const input =
            typeof msg.input === 'number' && Number.isFinite(msg.input)
              ? msg.input
              : null
          const result =
            typeof msg.result === 'number' && Number.isFinite(msg.result)
              ? msg.result
              : null
          opts.onAssignmentTrigger?.(g, input, result)
        }
      }
      if (msg.type === 'assignmentEngaged') {
        const g = msg.assignmentGuid
        const engaged = msg.engaged === true
        if (typeof g === 'string' && g) opts.onAssignmentEngaged?.(g, engaged)
      }
    }
  }

  connect()

  return {
    get assignments () {
      return assignments
    },
    get intents () {
      return intents
    },
    get systemCapabilities () {
      return systemCapabilities
    },
    get intentClasses () {
      return intentClasses
    },
    getIntentClass (guid) {
      if (typeof guid !== 'string' || !guid) return null
      const c = intentClasses[guid]
      return typeof c === 'string' && c ? c : null
    },
    get filterIntentGuid () {
      return opts.filterIntentGuid
    },
    getEditorContext () {
      return { filterIntentGuid: opts.filterIntentGuid, intents }
    },
    scheduleSave,
    sendSave,
    pushAssignment (row) {
      assignments.push(row)
    },
    mergeEditingIntoAssignments (editing) {
      const g = typeof editing.guid === 'string' ? editing.guid : ''
      if (!g) return
      const idx = assignments.findIndex(
        x =>
          x &&
          typeof x === 'object' &&
          /** @type {Record<string, unknown>} */ (x).guid === g
      )
      const copy = JSON.parse(JSON.stringify(editing))
      if (idx >= 0) assignments[idx] = copy
    },
    deleteAssignment (guid) {
      assignments = assignments.filter(
        x =>
          !(
            x &&
            typeof x === 'object' &&
            /** @type {Record<string, unknown>} */ (x).guid === guid
          )
      )
    },
    sendLearnStart (assignmentGuid, field, capture) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'learnStart',
            assignmentGuid,
            field,
            capture
          })
        )
      }
    }
  }
}
