import { FixtureProfile } from '../handlers/ConfigHandler';

export interface DmxChannel {
    offset: number;
    functionName: string;
    rangeMin: number;
    rangeMax: number;
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
                this.map.set(def.function, { offset, functionName: def.function, rangeMin, rangeMax });
            }
        }
    }

    lookup(functionName: string): DmxChannel | null {
        return this.map.get(functionName) ?? null;
    }
}
