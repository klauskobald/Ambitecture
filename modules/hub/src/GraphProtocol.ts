export type GraphEntityType = string;
export type GraphPersistence = 'runtime' | 'durable' | 'runtimeAndDurable';
export type GraphDeltaOp = 'upsert' | 'patch' | 'remove';

export interface GraphEntityRef {
  entityType: GraphEntityType;
  guid: string;
}

export interface GraphDelta {
  op: GraphDeltaOp;
  entityType: GraphEntityType;
  guid: string;
  parent?: GraphEntityRef;
  patch?: Record<string, unknown>;
  remove?: string[];
  value?: Record<string, unknown>;
  persistence: GraphPersistence;
  revision: number;
}

export interface GraphCommand {
  op: GraphDeltaOp;
  entityType: GraphEntityType;
  guid: string;
  parent?: GraphEntityRef;
  patch?: Record<string, unknown>;
  remove?: string[];
  value?: Record<string, unknown>;
  persistence?: GraphPersistence;
}

export interface GraphInitPayload {
  projectName: string;
  revision: number;
  controllerGuid: string;
  activeSceneName: string | null;
  zoneToRenderer: Record<string, string[]>;
  zones: unknown[];
  intents: unknown[];
  scenes: unknown[];
  controllerState?: Record<string, unknown>;
  interactionPolicies?: Record<string, unknown>;
  entities: Record<string, Record<string, Record<string, unknown>>>;
}

export interface GraphMutationResult {
  revision: number;
  controllerDeltas: GraphDelta[];
  rendererEvents: object[];
  rendererConfigChangedFor: string[];
  durableChanged: boolean;
}

export function isGraphCommand(payload: unknown): payload is GraphCommand {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const p = payload as Record<string, unknown>;
  const op = p['op'];
  const persistence = p['persistence'];
  const hasValidPersistence = persistence === undefined
    || persistence === 'runtime'
    || persistence === 'durable'
    || persistence === 'runtimeAndDurable';
  return (op === 'upsert' || op === 'patch' || op === 'remove')
    && typeof p['entityType'] === 'string'
    && p['entityType'].length > 0
    && typeof p['guid'] === 'string'
    && p['guid'].length > 0
    && hasValidPersistence;
}

export function emptyMutationResult(revision: number): GraphMutationResult {
  return {
    revision,
    controllerDeltas: [],
    rendererEvents: [],
    rendererConfigChangedFor: [],
    durableChanged: false,
  };
}
