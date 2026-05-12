/**
 * Short lifecycle toasts: show 3s, then fade out.
 */
const VISIBLE_MS = 3000;
const FADE_MS = 400;

export class LifecycleHud {
  /**
   * @param {HTMLElement} root
   */
  constructor(root) {
    this._root = root;
    this._primary = root.querySelector('[data-hud-primary]');
    this._meta = root.querySelector('[data-hud-meta]');
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._hideTimer = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._fadeTimer = null;
    root.setAttribute('aria-hidden', 'true');
    if (this._primary) this._primary.textContent = '';
    if (this._meta) this._meta.textContent = '';
  }

  _clearTimers() {
    if (this._hideTimer !== null) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
    if (this._fadeTimer !== null) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
  }

  /**
   * Hide immediately and cancel pending show/fade.
   */
  clear() {
    this._clearTimers();
    this._root.classList.remove('is-visible', 'is-fading');
    this._root.setAttribute('aria-hidden', 'true');
    if (this._primary) this._primary.textContent = '';
    if (this._meta) this._meta.textContent = '';
  }

  /**
   * @param {'boot'|'connecting'|'open'|'registered'|'live'|'closed'|'reconnecting'|'failed'|'warn'} phase
   */
  setPhase(phase) {
    this._root.setAttribute('data-phase', phase);
  }

  /**
   * @param {string} primary
   * @param {string} [meta]
   */
  setLines(primary, meta = '') {
    if (this._primary) this._primary.textContent = primary;
    if (this._meta) this._meta.textContent = meta;
  }

  /**
   * Show message for {@link VISIBLE_MS}, then fade out over {@link FADE_MS}.
   * New call replaces any in-flight toast and restarts the timer.
   *
   * @param {string} primary
   * @param {string} [meta]
   * @param {'boot'|'connecting'|'open'|'registered'|'live'|'closed'|'reconnecting'|'failed'|'warn'} [phase]
   */
  showEphemeral(primary, meta = '', phase = 'live') {
    this._clearTimers();
    this.setPhase(phase);
    this.setLines(primary, meta);
    this._root.classList.remove('is-fading');
    this._root.classList.add('is-visible');
    this._root.setAttribute('aria-hidden', 'false');

    this._hideTimer = setTimeout(() => {
      this._hideTimer = null;
      this._root.classList.add('is-fading');
      this._fadeTimer = setTimeout(() => {
        this._fadeTimer = null;
        this._root.classList.remove('is-visible', 'is-fading');
        this._root.setAttribute('aria-hidden', 'true');
        this.setLines('', '');
      }, FADE_MS);
    }, VISIBLE_MS);
  }
}
