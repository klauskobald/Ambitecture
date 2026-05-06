import { AnimatorViewer } from './AnimatorViewer.js'

export class KeyframeAnimatorViewer extends AnimatorViewer {
  getClassName () { return 'keyframeAnimator' }
  getName () { return 'Keyframe' }

  shouldWarnOnClassSwitch (record) {
    const steps = record?.content?.steps
    return Array.isArray(steps) && steps.length > 0
  }
}
