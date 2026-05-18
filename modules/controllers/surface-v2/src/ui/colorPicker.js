import { detectFormat } from '../core/color.js'

/**
 * @typedef {{ id: string, label: string, mount: (container: HTMLElement, onChange: (color: unknown) => void) => { setColor: (colorObj: unknown) => void, destroy: () => void } }} PaletteDescriptor
 */

export class ColorPicker {
  /**
   * @param {PaletteDescriptor[]} palettes
   */
  constructor (palettes) {
    this._palettes = palettes
    /** @type {PaletteDescriptor | null} */
    this._activePalette = null
    /** @type {{ setColor: (c: unknown) => void, destroy: () => void } | null} */
    this._activePaletteInstance = null
    /** @type {unknown} */
    this._currentColor = null
    /** @type {((color: unknown) => void) | null} */
    this._onChange = null

    this._buildDOM()
  }

  _buildDOM () {
    this._overlay = document.createElement('div')
    this._overlay.className = 'color-picker-overlay'
    // Don't use hidden attribute — display:flex in author CSS overrides UA display:none

    const modal = document.createElement('div')
    modal.className = 'color-picker-modal'
    // Stop clicks inside modal from closing via overlay listener
    modal.addEventListener('click', ev => ev.stopPropagation())

    const header = document.createElement('div')
    header.className = 'color-picker-header'

    this._tabs = document.createElement('div')
    this._tabs.className = 'color-picker-tabs'

    for (const palette of this._palettes) {
      const btn = document.createElement('button')
      btn.className = 'btn color-picker-tab'
      btn.textContent = palette.label
      btn.dataset.paletteId = palette.id
      btn.addEventListener('click', () => this._switchPalette(palette))
      this._tabs.appendChild(btn)
    }

    const closeBtn = document.createElement('button')
    closeBtn.className = 'btn color-picker-close'
    closeBtn.setAttribute('aria-label', 'Close')
    closeBtn.textContent = '×'
    closeBtn.addEventListener('click', () => this.close())

    header.appendChild(this._tabs)
    header.appendChild(closeBtn)

    this._body = document.createElement('div')
    this._body.className = 'color-picker-body'

    modal.appendChild(header)
    modal.appendChild(this._body)
    this._overlay.appendChild(modal)

    this._overlay.addEventListener('click', () => this.close())

    document.body.appendChild(this._overlay)
  }

  /**
   * @param {unknown} initialColor  raw params.color object (any format)
   * @param {(color: unknown) => void} onChange  called immediately on every interaction
   */
  open (initialColor, onChange) {
    this._currentColor = initialColor
    this._onChange = onChange

    // Pick the best matching palette tab for the initial color format
    const fmt = detectFormat(initialColor)
    const preferredId = fmt === 'hsl' ? 'hsl' : (this._palettes[0]?.id ?? null)
    const preferred = this._palettes.find(p => p.id === preferredId) ?? this._palettes[0]

    if (preferred) this._switchPalette(preferred)

    this._overlay.classList.add('is-open')
  }

  close () {
    this._overlay.classList.remove('is-open')
    this._activePaletteInstance?.destroy()
    this._activePaletteInstance = null
    this._activePalette = null
    this._onChange = null
  }

  /** @param {PaletteDescriptor} palette */
  _switchPalette (palette) {
    if (this._activePaletteInstance) {
      this._activePaletteInstance.destroy()
      this._activePaletteInstance = null
    }

    this._activePalette = palette

    // Update tab highlight
    for (const btn of this._tabs.querySelectorAll('.color-picker-tab')) {
      btn.classList.toggle('btn--active', /** @type {HTMLElement} */ (btn).dataset.paletteId === palette.id)
    }

    this._activePaletteInstance = palette.mount(this._body, color => {
      this._currentColor = color
      this._onChange?.(color)
    })

    // Initialize the palette crosshair with the current color
    if (this._currentColor !== null) {
      this._activePaletteInstance.setColor(this._currentColor)
    }
  }
}
