import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { DmxUniverse } from '../DmxUniverse';
import { Vector3 } from '../Vector3';

export interface RendererEvent {
    class: string;
    scheduled?: number;
    position?: [number, number, number];
    params?: Record<string, unknown>;
}

export interface IFixtureClass {
    handleEvent(event: RendererEvent, fixture: ConfiguredFixture, dmxUniverse: DmxUniverse, spatial: Vector3 | null): void;
}
