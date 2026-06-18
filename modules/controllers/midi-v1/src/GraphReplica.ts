import { Logger } from './Logger';
import { WsMessage } from './HubSocket';

export interface TargetRecord {
  type: string;
  guid: string;
  key: string;
  function: string;
}

export interface AssignmentRecord {
  class: string;
  guid: string;
  channel: number;
  device: string;
  deviceAny: boolean;
  params: Record<string, unknown>;
  targets: TargetRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toTarget(raw: unknown): TargetRecord | null {
  if (!isRecord(raw)) return null;
  const type = raw['type'];
  const guid = raw['guid'];
  const key = raw['key'];
  const fn = raw['function'];
  if (typeof type !== 'string' || typeof guid !== 'string' || typeof key !== 'string') return null;
  return {
    type,
    guid,
    key,
    function: typeof fn === 'string' ? fn : 'linear',
  };
}

export function normalizeAssignmentsInput(raw: unknown[]): AssignmentRecord[] {
  const list: AssignmentRecord[] = [];
  for (const item of raw) {
    const a = toAssignment(item);
    if (a) list.push(a);
  }
  return list;
}

function toAssignment(raw: unknown): AssignmentRecord | null {
  if (!isRecord(raw)) return null;
  const cls = raw['class'];
  const guid = raw['guid'];
  if (typeof cls !== 'string' || typeof guid !== 'string') return null;
  const channel = typeof raw['channel'] === 'number' && Number.isFinite(raw['channel']) ? raw['channel'] : 0;
  const device = typeof raw['device'] === 'string' ? raw['device'] : '';
  const deviceAny = typeof raw['deviceAny'] === 'boolean' ? raw['deviceAny'] : true;
  const params = isRecord(raw['params']) ? raw['params'] : {};
  const targetsRaw = Array.isArray(raw['targets']) ? raw['targets'] : [];
  const targets: TargetRecord[] = [];
  for (const t of targetsRaw) {
    const target = toTarget(t);
    if (target) targets.push(target);
  }
  return { class: cls, guid, channel, device, deviceAny, params, targets };
}

export type AssignmentsChangedReason = 'init' | 'controller-changed' | 'controller-removed';

function extractIntentClass(raw: Record<string, unknown> | null): string | undefined {
  if (!raw) return undefined;
  const c = raw['class'];
  return typeof c === 'string' && c.length > 0 ? c : undefined;
}

export class GraphReplica {
  private intentGuids = new Set<string>();
  private intentNames = new Map<string, string>();
  private intentClasses = new Map<string, string>();
  private myAssignments: AssignmentRecord[] = [];

  constructor(
    private readonly ownGuid: string,
    private readonly logger: Logger,
    private readonly onAssignmentsChanged: (reason: AssignmentsChangedReason) => void,
  ) {}

  hasIntent(guid: string): boolean {
    return this.intentGuids.has(guid);
  }

  getIntentName(guid: string): string | undefined {
    return this.intentNames.get(guid);
  }

  getAssignments(): AssignmentRecord[] {
    return this.myAssignments;
  }

  /** Stable list for plugin UIs (intent picker / default targets). */
  listIntentsForPlugin(): { guid: string; name: string }[] {
    const rows: { guid: string; name: string }[] = [];
    for (const guid of this.intentGuids) {
      const name = this.intentNames.get(guid) ?? guid;
      rows.push({ guid, name });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return rows;
  }

  getIntentClass(guid: string): string | undefined {
    return this.intentClasses.get(guid);
  }

  getIntentClassesWire(): Record<string, string> {
    return Object.fromEntries(this.intentClasses);
  }

  /**
   * Apply assignments after a local `graph:command` save — the hub does not echo the sender's own
   * controller delta back on the same socket.
   */
  applyLocalAssignments(assignments: AssignmentRecord[]): void {
    this.myAssignments = assignments;
    this.onAssignmentsChanged('controller-changed');
  }

  apply(message: WsMessage): void {
    switch (message.type) {
      case 'graph:init':
        this.applyInit(message.payload);
        return;
      case 'graph:delta':
        this.applyDelta(message.payload);
        return;
      default:
        return;
    }
  }

  private applyInit(payload: unknown): void {
    if (!isRecord(payload)) return;
    const entities = isRecord(payload['entities']) ? payload['entities'] : {};

    const intentMap = isRecord(entities['intent']) ? entities['intent'] : {};
    this.intentGuids = new Set(Object.keys(intentMap));
    this.intentNames = new Map();
    this.intentClasses = new Map();
    for (const [iguid, raw] of Object.entries(intentMap)) {
      if (isRecord(raw)) {
        if (typeof raw['name'] === 'string' && raw['name']) {
          this.intentNames.set(iguid, raw['name']);
        }
        const cls = extractIntentClass(raw);
        if (cls !== undefined) this.intentClasses.set(iguid, cls);
      }
    }

    const controllers = isRecord(entities['controller']) ? entities['controller'] : {};
    const meRaw = controllers[this.ownGuid];
    const me = isRecord(meRaw) ? meRaw : null;
    this.myAssignments = this.parseAssignments(me);
    this.onAssignmentsChanged('init');
  }

  private applyDelta(payload: unknown): void {
    const deltas = Array.isArray(payload) ? payload : [payload];
    let assignmentsTouched: AssignmentsChangedReason | null = null;

    for (const raw of deltas) {
      if (!isRecord(raw)) continue;
      const entityType = raw['entityType'];
      const guid = raw['guid'];
      const op = raw['op'];
      if (typeof entityType !== 'string' || typeof guid !== 'string' || typeof op !== 'string') continue;

      if (entityType === 'intent') {
        if (op === 'remove') {
          this.intentGuids.delete(guid);
          this.intentNames.delete(guid);
          this.intentClasses.delete(guid);
        } else {
          this.intentGuids.add(guid);
          const val = isRecord(raw['value']) ? raw['value'] : null;
          const patch = isRecord(raw['patch']) ? raw['patch'] : null;
          let name: string | undefined;
          if (val && typeof val['name'] === 'string' && val['name']) name = val['name'];
          else if (patch && typeof patch['name'] === 'string' && patch['name']) name = patch['name'];
          if (name !== undefined) this.intentNames.set(guid, name);
          const clsFromVal = extractIntentClass(val);
          const clsFromPatch = extractIntentClass(patch);
          if (clsFromVal !== undefined) this.intentClasses.set(guid, clsFromVal);
          else if (clsFromPatch !== undefined) this.intentClasses.set(guid, clsFromPatch);
        }
        continue;
      }

      if (entityType === 'controller' && guid === this.ownGuid) {
        if (op === 'remove') {
          this.myAssignments = [];
          assignmentsTouched = 'controller-removed';
          continue;
        }
        const value = isRecord(raw['value']) ? raw['value'] : null;
        const patch = isRecord(raw['patch']) ? raw['patch'] : null;
        const next = this.mergeControllerDelta(value, patch);
        this.myAssignments = this.parseAssignments(next);
        assignmentsTouched = 'controller-changed';
      }
    }

    if (assignmentsTouched !== null) this.onAssignmentsChanged(assignmentsTouched);
  }

  private mergeControllerDelta(value: Record<string, unknown> | null, patch: Record<string, unknown> | null): Record<string, unknown> | null {
    if (value !== null) return value;
    if (patch !== null && Array.isArray(patch['assignments'])) return { assignments: patch['assignments'] };
    return null;
  }

  private parseAssignments(controllerRecord: Record<string, unknown> | null): AssignmentRecord[] {
    if (!controllerRecord) return [];
    const raw = Array.isArray(controllerRecord['assignments']) ? controllerRecord['assignments'] : [];
    const list: AssignmentRecord[] = [];
    for (const item of raw) {
      const a = toAssignment(item);
      if (a) list.push(a);
      else this.logger.warn('skipped malformed assignment in graph');
    }
    return list;
  }
}
