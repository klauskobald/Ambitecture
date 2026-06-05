import { FixtureProfile } from '../handlers/ConfigHandler';

export interface DmxChannel {
    offset: number;
    functionName: string;
    rangeMin: number;
    rangeMax: number;
    /** Physical span in degrees for positional channels (pan/tilt); undefined for others. */
    degrees?: number;
}

export class DmxMap {
    private readonly map: Map<string, DmxChannel>;

    constructor(profile: FixtureProfile) {
        this.map = new Map();
        for (const [offsetStr, defs] of Object.entries(profile.params.dmx)) {
            const offset = parseInt(offsetStr, 10);
            for (const def of defs) {
                const parts = def.range.split('-');
                const rangeMin = parseInt(parts[0] ?? '0', 10);
                const rangeMax = parseInt(parts[1] ?? '255', 10);
                const channel: DmxChannel = { offset, functionName: def.function, rangeMin, rangeMax };
                if (typeof def.degrees === 'number' && Number.isFinite(def.degrees)) {
                    channel.degrees = def.degrees;
                }
                this.map.set(def.function, channel);
            }
        }
    }

    lookup(functionName: string): DmxChannel | null {
        return this.map.get(functionName) ?? null;
    }
}
