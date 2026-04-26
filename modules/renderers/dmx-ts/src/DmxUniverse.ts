import { Logger } from './Logger';
import { Config } from './Config';

type UniverseHandle = { update(channels: Record<number, number>): void };
type DmxInstance = {
    addUniverse(universe: string, driver: string, deviceId?: string): UniverseHandle;
};
type DmxConstructor = new () => DmxInstance;
const DmxLib = require('dmx') as DmxConstructor;

export class DmxUniverse {
    private universe: UniverseHandle | null = null;
    private channels: Record<number, number> = {};
    private flushTimer: ReturnType<typeof setInterval> | null = null;

    get isInitialized(): boolean {
        return this.universe !== null;
    }

    initialize(): void {
        const driver = Config.dmxDriver;
        const port = Config.dmxPort;
        const universeName = Config.dmxUniverseName;
        const frameRate = Config.dmxFrameRate;

        const dmx = new DmxLib();
        this.universe = dmx.addUniverse(universeName, driver, port);
        Logger.info(`[dmx] universe '${universeName}' on ${driver} ${port || '(no port)'} at ${frameRate}Hz`);

        this.flushTimer = setInterval(() => this.flush(), Math.round(1000 / frameRate));
    }

    setChannel(channel: number, value: number): void {
        this.channels[channel] = Math.max(0, Math.min(255, Math.round(value)));
    }

    private flush(): void {
        if (this.universe !== null) {
            this.universe.update({ ...this.channels });
        }
    }

    shutdown(): void {
        if (this.flushTimer !== null) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
    }
}
