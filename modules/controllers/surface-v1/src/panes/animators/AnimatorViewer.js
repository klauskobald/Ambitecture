export class AnimatorViewer {
  /** @returns {string} */
  getName () { throw new Error(`${this.constructor.name} must implement getName()`) }
}
