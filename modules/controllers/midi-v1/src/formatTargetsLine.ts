import { TargetRecord } from './GraphReplica';

/**
 * Operator-facing target labels for plugin list summaries.
 * Intent → `Name.key`; action → `snap|scene|anim|action Name`.
 */
export function formatTargetsLine(
  targets: TargetRecord[],
  resolveName: (guid: string) => string | undefined,
  resolveExecuteType?: (guid: string) => string | undefined,
): string[] {
  const bits: string[] = [];
  for (const t of targets) {
    const n = resolveName(t.guid);
    const label = n !== undefined && n !== '' ? n : '?';
    if (t.type === 'intent') {
      bits.push(`${label}.${t.key}`);
      continue;
    }
    if (t.type === 'action') {
      const exec = resolveExecuteType?.(t.guid);
      let prefix = 'action';
      switch (exec) {
        case 'snapshot':
          prefix = 'snap';
          break;
        case 'scene':
          prefix = 'scene';
          break;
        case 'animation':
          prefix = 'anim';
          break;
        case 'intent':
          prefix = 'intent';
          break;
        default:
          break;
      }
      bits.push(`${prefix}\u00A0${label}`);
      continue;
    }
  }
  return bits;
}
