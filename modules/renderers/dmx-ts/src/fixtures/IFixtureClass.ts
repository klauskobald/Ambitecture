import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { DmxUniverse } from '../DmxUniverse';

export interface RendererEvent {
    class: string;
    scheduled?: number;
    position?: [number, number, number];
    params?: Record<string, unknown>;
}

export interface IFixtureClass {
    handleEvent(event: RendererEvent, fixture: ConfiguredFixture, dmxUniverse: DmxUniverse): void;
}
