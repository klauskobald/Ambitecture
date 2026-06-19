import { PropertyPanel } from '../PropertyPanel.js'
import { projectGraph } from '../../core/projectGraph.js'
import { getCapabilities } from '../../core/systemCapabilities.js'
import { queueFixturePropertyUpdate } from '../../core/outboundQueue.js'
import { findLayoutTagHost } from '../../stage/layoutTagHost.js'
import { getStageOverlay } from '../../stage/stageOverlayHost.js'
import { loadFixtureEditor } from './loadFixtureEditor.js'

/**
 * Floating editor for a fixture instance — the fixture twin of {@link IntentParamsHost}. Docks
 * into the same `stage-edit`-tagged layout region, builds its surface generically from the
 * fixture's root fields and YAML `instance` descriptors, and delegates display/validation hooks
 * to a {@link FixtureEditDefault} (or a per-class subclass). Keyed by fixture `guid` so it
 * survives `name` edits. Writes go out as durable `graph:command` fixture patches on commit.
 */
export class FixtureParamsHost {
  constructor () {
    /** @type {HTMLElement | null} */
    this._overlayEl = null
    /** @type {HTMLElement | null} */
    this._body = null
    /** @type {HTMLElement | null} */
    this._title = null
    /** @type {PropertyPanel[]} */
    this._panels = []
    /** @type {(() => void) | null} */
    this._graphUnsub = null
    /** @type {string | null} */
    this._currentGuid = null
    /** @type {import('./FixtureEditDefault.js').FixtureEditDefault | null} */
    this._editor = null
    /** @type {import('../controls/PropertyControl.js').PropertyControl['_writeTarget']} */
    this._writeTarget = null
  }

  /** @returns {boolean} */
  isOpen () {
    return this._overlayEl != null && !this._overlayEl.hidden
  }

  _ensureOverlay () {
    const host = findLayoutTagHost()
    if (!host) return false
    if (this._overlayEl && this._overlayEl.parentElement === host) return true

    this._overlayEl = document.createElement('div')
    this._overlayEl.className = 'stage-edit-params-overlay'
    this._overlayEl.hidden = true
    this._overlayEl.setAttribute('aria-hidden', 'true')

    const header = document.createElement('div')
    header.className = 'stage-edit-params-overlay__header'

    this._title = document.createElement('span')
    this._title.className = 'stage-edit-params-overlay__title'

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'stage-edit-params-overlay__close'
    closeBtn.setAttribute('aria-label', 'Close')
    closeBtn.textContent = '×'
    closeBtn.addEventListener('click', () => this.close())

    header.appendChild(this._title)
    header.appendChild(closeBtn)

    this._body = document.createElement('div')
    this._body.className = 'stage-edit-params-overlay__body'

    this._overlayEl.appendChild(header)
    this._overlayEl.appendChild(this._body)
    host.appendChild(this._overlayEl)
    return true
  }

  /** @param {string} guid */
  async openForFixtureGuid (guid) {
    const profile = projectGraph.getFixtureProfile(guid)
    if (!profile) return
    const editor = await loadFixtureEditor(profile.class)
    this._editor = editor
    this._currentGuid = guid
    this._writeTarget = this._buildWriteTarget(guid, editor)

    if (!this._ensureOverlay() || !this._body || !this._overlayEl) return
    this._overlayEl.hidden = false
    this._overlayEl.setAttribute('aria-hidden', 'false')
    this._rebuild(guid, editor, profile)
    getStageOverlay()?.setEditHighlight({ kind: 'fixture', id: guid })

    if (!this._graphUnsub) {
      this._graphUnsub = projectGraph.subscribe(['fixtures', 'project'], () =>
        this._onGraphChange()
      )
    }
  }

  close () {
    if (!this._overlayEl) return
    this._overlayEl.hidden = true
    this._overlayEl.setAttribute('aria-hidden', 'true')
    for (const panel of this._panels) panel.destroy()
    this._panels = []
    if (this._body) this._body.replaceChildren()
    if (this._graphUnsub) {
      this._graphUnsub()
      this._graphUnsub = null
    }
    this._currentGuid = null
    getStageOverlay()?.setEditHighlight(null)
  }

  /**
   * @param {string} guid
   * @param {import('./FixtureEditDefault.js').FixtureEditDefault} editor
   */
  _buildWriteTarget (guid, editor) {
    /** @type {Map<string, unknown>} */
    const pending = new Map()
    /** @type {Set<string>} */
    const pendingRemove = new Set()
    return {
      read: (_guid, dotKey) => projectGraph.getEffectiveFixtureProperty(guid, dotKey),
      update: (_guid, dotKey, value) => {
        const result = editor.validate(dotKey, value, projectGraph.getEffectiveFixture(guid))
        if (result && result.ok === false) return
        const next =
          result && Object.prototype.hasOwnProperty.call(result, 'value')
            ? result.value
            : value
        projectGraph.updateFixtureProperty(guid, dotKey, next)
        pendingRemove.delete(dotKey)
        pending.set(dotKey, next)
      },
      remove: (_guid, dotKey) => {
        projectGraph.removeFixtureProperty(guid, dotKey)
        pending.delete(dotKey)
        pendingRemove.add(dotKey)
      },
      // Slider drags stream `update` (local only); the durable patch is flushed once on commit.
      save: () => {
        if (pending.size === 0 && pendingRemove.size === 0) return
        const patch = Object.fromEntries(pending)
        const remove = [...pendingRemove]
        queueFixturePropertyUpdate(
          guid,
          Object.keys(patch).length > 0 ? patch : undefined,
          remove.length > 0 ? remove : undefined
        )
        pending.clear()
        pendingRemove.clear()
        editor.onSaved()
      }
    }
  }

  /**
   * @param {string} guid
   * @param {import('./FixtureEditDefault.js').FixtureEditDefault} editor
   * @param {{ class: string, instance: unknown[] }} profile
   */
  _rebuild (guid, editor, profile) {
    if (!this._body) return
    for (const panel of this._panels) panel.destroy()
    this._panels = []
    this._body.replaceChildren()
    this._refreshTitle(guid)

    const guids = new Set([guid])
    this._appendSection(null, editor.rootDescriptors(), guids)
    const paramDescriptors = editor.paramDescriptors(profile)
    if (paramDescriptors.length > 0) {
      this._appendSection('Parameters', paramDescriptors, guids)
    }
    editor.decorate(this._body, {
      guid,
      profile,
      record: projectGraph.getEffectiveFixture(guid)
    })
  }

  /**
   * @param {string | null} title  heading label; `null` renders the panel with no heading box
   * @param {unknown[]} descriptors
   * @param {Set<string>} guids
   */
  _appendSection (title, descriptors, guids) {
    if (!this._body) return
    const section = document.createElement('section')
    section.className = 'prop-panel-section'

    if (title !== null) {
      const heading = document.createElement('div')
      heading.className = 'prop-row prop-row--group-heading'
      const label = document.createElement('span')
      label.className = 'prop-row__label'
      label.textContent = title
      heading.appendChild(label)
      section.appendChild(heading)
    }

    // Resolve optionsRef for fixture descriptors (they bypass resolveDescriptorsForClass). Mirrors
    // the one-liner in systemCapabilities.resolveDescriptorsForClass: { ...d, options: caps[ref] }.
    const caps = getCapabilities()
    const resolved = descriptors.map(d => {
      const row = /** @type {Record<string, unknown>} */ (d)
      if (typeof row.optionsRef === 'string' && caps) {
        return { ...row, options: caps[row.optionsRef] ?? [] }
      }
      return row
    })

    const panel = new PropertyPanel(resolved, guids.size, guids, this._writeTarget)
    section.appendChild(panel.buildElement())
    panel.refresh(guids)
    this._panels.push(panel)
    this._body.appendChild(section)
  }

  /** @param {string} guid */
  _refreshTitle (guid) {
    if (!this._title) return
    const record = projectGraph.getEffectiveFixture(guid)
    const name = record && typeof record.name === 'string' ? record.name : guid
    this._title.textContent = `Fixture: ${name}`
  }

  _onGraphChange () {
    if (!this.isOpen() || !this._currentGuid) return
    if (!projectGraph.getEffectiveFixture(this._currentGuid)) {
      this.close()
      return
    }
    const guids = new Set([this._currentGuid])
    for (const panel of this._panels) panel.refresh(guids)
    this._refreshTitle(this._currentGuid)
  }

  /** Re-dock after a layout-preset change so the overlay attaches to the new tagged host. */
  rebindHost () {
    const wasOpen = this.isOpen()
    const guid = this._currentGuid
    if (this._overlayEl) {
      this._overlayEl.remove()
      this._overlayEl = null
      this._body = null
      this._title = null
    }
    if (wasOpen && guid) void this.openForFixtureGuid(guid)
  }
}
