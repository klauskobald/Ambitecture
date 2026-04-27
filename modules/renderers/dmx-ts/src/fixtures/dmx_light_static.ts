import { Color } from '../color';
import { DmxUniverse } from '../DmxUniverse';
import { ConfiguredFixture } from '../handlers/ConfigHandler';
import { RendererEvent } from './IFixtureClass';
import { DmxFixtureBase } from './DmxFixtureBase';
import { LightParams, MasterParams } from './lightEventParams';

class DmxLightStatic extends DmxFixtureBase {

    private masterBrightness: number = 1;
    private masterBlackout: boolean = false;

    handleEvent(event: RendererEvent, fixture: ConfiguredFixture, dmxUniverse: DmxUniverse): void {
        switch (event.class) {
            case 'light':
                this.handleLightEvent(event, fixture, dmxUniverse);
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
        }

    }

    private handleLightEvent(event: RendererEvent, fixture: ConfiguredFixture, dmxUniverse: DmxUniverse): void {
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

        this.writeFunction(fixture, 'red', r / 255, dmxUniverse);
        this.writeFunction(fixture, 'green', g / 255, dmxUniverse);
        this.writeFunction(fixture, 'blue', b / 255, dmxUniverse);
        this.writeFunction(fixture, 'brightness', colorData.Y * this.masterBrightness * (this.masterBlackout ? 0 : 1), dmxUniverse);
    }
}

export default new DmxLightStatic();
