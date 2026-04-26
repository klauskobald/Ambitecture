import { FixtureChannelDef, FixtureProfile } from '../handlers/ConfigHandler';

export interface DmxChannel {
    offset: number;
    def: FixtureChannelDef;
}

export class DmxMap {
    private readonly map: Map<string, DmxChannel>;

    constructor(profile: FixtureProfile) {
        this.map = new Map();
        for (const [offsetStr, defs] of Object.entries(profile.params.dmx)) {
            const offset = parseInt(offsetStr, 10);
            for (const def of defs) {
                this.map.set(def.function, { offset, def });
            }
        }
    }

    lookup(functionName: string): DmxChannel | null {
        return this.map.get(functionName) ?? null;
    }
}
