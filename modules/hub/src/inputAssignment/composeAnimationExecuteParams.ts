import type { AnimationDefinition } from '../ProjectManager';
import { getAllAnimatorCommandDescriptors } from '../animation/animatorRegistry';
import { Logger } from '../Logger';

export type AnimationCommandDescriptor = {
  command: string;
  hint: string;
  params: Record<string, unknown>;
};

function resolveAnimationCommandsFromCapabilities(
  capabilities: unknown,
  animClass: string,
): AnimationCommandDescriptor[] | null {
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return null;
  const animations = (capabilities as Record<string, unknown>)['animations'];
  if (!Array.isArray(animations)) return null;
  for (const entry of animations) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (e['class'] !== animClass) continue;
    const commands = e['commands'];
    if (!Array.isArray(commands)) return null;
    return commands as AnimationCommandDescriptor[];
  }
  return null;
}

function flatParamsForCommand(entry: AnimationCommandDescriptor): Record<string, unknown> {
  const flat: Record<string, unknown> = { command: entry.command };
  const cmdParams = entry.params;
  if (!cmdParams || typeof cmdParams !== 'object' || Array.isArray(cmdParams)) {
    return flat;
  }
  for (const [pk, pd] of Object.entries(cmdParams)) {
    if (!pd || typeof pd !== 'object' || Array.isArray(pd)) continue;
    const pdef = pd as Record<string, unknown>;
    if (typeof pdef['default'] === 'number' || typeof pdef['default'] === 'string') {
      flat[pk] = pdef['default'];
    }
  }
  return flat;
}

/**
 * Default `execute.params` for a manual-run animation action (first command + param defaults).
 */
export function composeDefaultAnimationExecuteParams(
  capabilities: unknown,
  animationGuid: string,
  getAnimationByGuid: (guid: string) => AnimationDefinition | undefined,
): Record<string, unknown> | undefined {
  if (animationGuid.length === 0) return undefined;
  const anim = getAnimationByGuid(animationGuid);
  if (!anim) return undefined;
  const runmode = typeof anim.runmode === 'string' ? anim.runmode : 'auto';
  if (runmode !== 'manual') return undefined;
  const cls = typeof anim.class === 'string' && anim.class.length > 0 ? anim.class : '';
  if (!cls) return undefined;

  const fromCaps = resolveAnimationCommandsFromCapabilities(capabilities, cls);
  const fromRegistry = getAllAnimatorCommandDescriptors()[cls];
  const commands = fromCaps ?? fromRegistry ?? null;
  if (!commands || commands.length === 0) {
    Logger.warn(`[action] no animation commands for class "${cls}"`);
    return undefined;
  }
  return flatParamsForCommand(commands[0]!);
}
