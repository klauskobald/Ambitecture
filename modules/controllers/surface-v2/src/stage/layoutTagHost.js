const STAGE_EDIT_TAG = 'stage-edit'

/**
 * @param {string} [tag]
 * @returns {HTMLElement | null}
 */
export function findLayoutTagHost (tag = STAGE_EDIT_TAG) {
  return document.querySelector(`[data-layout-tag~="${tag}"]`)
}

export { STAGE_EDIT_TAG }
