const LS_PREFIX = 'ambitecture.screen.fixtureGuid.v1'

function storageKey (rendererGuid) {
  return `${LS_PREFIX}:${String(rendererGuid ?? '')}`
}

/**
 * @param {import('./handlers/ConfigHandler.js').ConfigHandler} configHandler
 * @returns {{ guid: string; name: string }[]}
 */
function collectScreenFixtureOptions (configHandler) {
  const zones = configHandler.getZones()
  const out = []
  for (const zone of zones) {
    for (const fixture of zone.fixtures) {
      const cls = String(fixture.fixtureProfile?.class ?? '').toLowerCase()
      if (cls !== 'screen') continue
      const guid =
        typeof fixture.guid === 'string' && fixture.guid.trim() !== ''
          ? fixture.guid.trim()
          : ''
      const name =
        typeof fixture.name === 'string' && fixture.name.trim() !== ''
          ? fixture.name.trim()
          : 'Screen'
      if (!guid) {
        console.warn(
          '[screen] screen fixture instance missing guid — omitting from picker'
        )
        continue
      }
      out.push({ guid, name })
    }
  }
  return out
}

export class ScreenFixturePicker {
  /**
   * @param {{
   *   rendererGuid: string;
   *   onSelect: (guid: string | null) => void;
   *   canvas: HTMLCanvasElement;
   *   configHandler: import('./handlers/ConfigHandler.js').ConfigHandler;
   * }} opts
   */
  constructor (opts) {
    this._rendererGuid = opts.rendererGuid
    this._onSelect = opts.onSelect
    this._canvas = opts.canvas
    this._configHandler = opts.configHandler

    this._backdrop = document.getElementById('fixture-picker')
    this._listEl = document.querySelector('[data-fixture-list]')
    this._setupWrap = document.getElementById('screen-setup-wrap')
    this._setupBtn = document.getElementById('screen-setup')

    if (!this._backdrop) {
      console.error('[screen] missing #fixture-picker in index.html')
    }

    if (this._setupBtn) {
      this._setupBtn.addEventListener('click', e => {
        e.preventDefault()
        e.stopPropagation()
        this.open()
      })
    }

    this._canvas.addEventListener(
      'pointerdown',
      () => {
        this._revealSetup()
      },
      { passive: true }
    )
  }

  _revealSetup () {
    if (this._setupWrap) {
      this._setupWrap.hidden = false
    }
  }

  _readSaved () {
    try {
      return localStorage.getItem(storageKey(this._rendererGuid))
    } catch {
      return null
    }
  }

  _writeSaved (guid) {
    try {
      localStorage.setItem(storageKey(this._rendererGuid), guid)
    } catch {
      /* ignore */
    }
  }

  syncAfterConfig () {
    const options = collectScreenFixtureOptions(this._configHandler)
    if (options.length === 0) {
      this.close()
      this._onSelect(null)
      return
    }

    if (options.length === 1) {
      const only = options[0].guid
      this._writeSaved(only)
      this._onSelect(only)
      this.close()
      return
    }

    const saved = this._readSaved()
    const savedOk = saved && options.some(o => o.guid === saved)
    if (saved && !savedOk) {
      try {
        localStorage.removeItem(storageKey(this._rendererGuid))
      } catch {
        /* ignore */
      }
    }
    if (savedOk) {
      this._onSelect(saved)
      this.close()
      return
    }

    this.open()
  }

  /**
   * @param {{ guid: string; name: string }[]} options
   */
  _renderList (options) {
    if (!this._listEl) return
    this._listEl.replaceChildren()
    if (options.length === 0) {
      const p = document.createElement('p')
      p.className = 'fixture-picker__empty'
      p.textContent =
        'No screen fixtures with guid in zones assigned to this renderer. Check project zone-to-renderer mapping and fixture guids.'
      this._listEl.appendChild(p)
      return
    }
    for (const opt of options) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'fixture-picker__choice'
      btn.dataset.guid = opt.guid
      btn.textContent = opt.name
      btn.addEventListener('click', () => {
        this._writeSaved(opt.guid)
        this._onSelect(opt.guid)
        window.location.reload()
      })
      this._listEl.appendChild(btn)
    }
  }

  open () {
    const options = collectScreenFixtureOptions(this._configHandler)
    this._renderList(options)
    if (this._backdrop) {
      this._backdrop.removeAttribute('hidden')
      this._backdrop.style.removeProperty('display')
      this._backdrop.setAttribute('aria-hidden', 'false')
    }
  }

  close () {
    if (this._backdrop) {
      this._backdrop.setAttribute('hidden', '')
      this._backdrop.style.removeProperty('display')
      this._backdrop.setAttribute('aria-hidden', 'true')
    }
  }
}
