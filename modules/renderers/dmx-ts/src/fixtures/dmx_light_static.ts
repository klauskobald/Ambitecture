import { Color } from '../color';
import { DmxUniverse } from '../DmxUniverse';
import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { RendererEvent } from './IFixtureClass';
import { DmxFixtureBase } from './DmxFixtureBase';
import { LightParams, MasterParams } from './lightEventParams';
import { Vector3 } from '../Vector3';

class DmxLightStatic extends DmxFixtureBase {

    private masterBrightness: number = 1;
    private masterBlackout: boolean = false;

    handleEvent(event: RendererEvent, fixture: ConfiguredFixture, dmxUniverse: DmxUniverse, spatial: Vector3 | null): void {
        switch (event.class) {
            case 'light':
                this.handleLightEvent(event, fixture, dmxUniverse, spatial);
                break;
            case 'master':
                this.handleMasterEvent(event, fixture, dmxUniverse);
                break;
            default:
                return;
        }
    }

    private handleMasterEvent(event: RendererEvent, fixture: ConfiguredFixture, dmxUniverse: DmxUniverse): void {
        const masterParams = (event.params as MasterParams | undefined);
        if (masterParams) {
            this.masterBrightness = masterParams.brightness || this.masterBrightness;
            this.masterBlackout = masterParams.blackout || this.masterBlackout;
            this.write(fixture, dmxUniverse, 1);
        }
    }

    private handleLightEvent(event: RendererEvent, fixture: ConfiguredFixture, dmxUniverse: DmxUniverse, spatial: Vector3 | null): void {
        const colorData = (event.params as LightParams | undefined)?.color;
        if (!colorData) return;

        const color = new Color(colorData.x, colorData.y, colorData.Y);
        const { r, g, b } = color.toRGB();
        const strobe = (event.params as LightParams | undefined)?.strobe;
        if (strobe !== undefined) {
            if (strobe == 0) {
                this.writeFunction(fixture, 'strobe-off', 0, dmxUniverse);
            } else {
                this.writeFunction(fixture, 'strobe-on', strobe, dmxUniverse);
            }
        }
        this.writeFunction(fixture, 'red', r, dmxUniverse);
        this.writeFunction(fixture, 'green', g, dmxUniverse);
        this.writeFunction(fixture, 'blue', b, dmxUniverse);

        const spatialFactor = this.computeSpatialFactor(spatial, fixture.range);
        this.write(fixture, dmxUniverse, spatialFactor);
    }

    private computeSpatialFactor(spatial: Vector3 | null, range: number): number {
        if (!spatial || range <= 0) return 1;
        const distance = spatial.magnitude();
        return Math.max(0, 1 - distance / range);
    }

    private write(fixture: ConfiguredFixture, dmxUniverse: DmxUniverse, spatialFactor: number): void {
        const brightness = this.masterBrightness * (this.masterBlackout ? 0 : 1) * spatialFactor;
        this.writeFunction(fixture, 'brightness', brightness, dmxUniverse);
    }
}

export default new DmxLightStatic();
