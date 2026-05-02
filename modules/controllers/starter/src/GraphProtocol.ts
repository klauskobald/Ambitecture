export type Position3 = [number, number, number];
export type HubLocation = [number, number];
export type GraphEntityType = string;
export type GraphPersistence = 'runtime' | 'durable' | 'runtimeAndDurable';
export type GraphDeltaOp = 'upsert' | 'patch' | 'remove';

export interface WsMessage {
  type: string;
  location?: HubLocation;
  payload?: unknown;
}

export interface WsEnvelope {
  message: WsMessage;
}

export interface GraphCommand {
  op: GraphDeltaOp;
  entityType: GraphEntityType;
  guid: string;
  patch?: Record<string, unknown>;
  remove?: string[];
  value?: Record<string, unknown>;
  persistence?: GraphPersistence;
}

export interface RuntimeCommand {
  entityType: GraphEntityType;
  guid: string;
  patch?: Record<string, unknown>;
  remove?: string[];
  value?: Record<string, unknown>;
  source?: string;
  class?: string;
  target?: string;
  scheduled?: number;
}

export interface GraphDelta extends GraphCommand {
  persistence: GraphPersistence;
  revision: number;
}

export interface IntentRecord extends Record<string, unknown> {
  guid: string;
  name?: string;
  position?: Position3;
}

export interface SceneRecord {
  guid: string;
  name: string;
  intents: string[];
}

export interface ZoneRecord {
  guid?: string;
  name: string;
  boundingBox?: [number, number, number, number, number, number];
}
