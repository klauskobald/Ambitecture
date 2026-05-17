export type HubLocation = [number, number];

export interface WsMessage {
  type: string;
  location?: HubLocation;
  payload?: unknown;
}

export interface WsEnvelope {
  message: WsMessage;
}

export interface GraphInitPayload {
  controllerGuid?: string;
  transmit?: {
    minIntervalSeconds?: number;
  };
}

export interface PulseSyncPayload {
  bpm: number;
  beatAtMs: number;
  sentAtMs: number;
  kind: 'onset' | 'bar';
  phaseAdjustMs?: number;
  audioT?: number;
  spectrum?: number[];
}
