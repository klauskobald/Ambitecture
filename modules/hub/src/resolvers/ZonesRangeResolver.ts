import { ProjectManager } from '../ProjectManager';
import { configResolver } from '../ConfigResolver';

const AXIS_INDEX: Record<string, number> = { x: 0, y: 1, z: 2 };

export function registerZonesRangeResolver(pm: ProjectManager): void {
    configResolver.register('zones_range', (params) => {
        const axis = params[0];
        const idx = axis !== undefined ? AXIS_INDEX[axis] : undefined;
        if (idx === undefined) {
            throw new Error(`zones_range: invalid axis '${axis}'. Expected 'x', 'y', or 'z'.`);
        }

        let min = Infinity;
        let max = -Infinity;
        for (const z of pm.getSerializedRuntimeZones()) {
            if (!z || typeof z !== 'object') continue;
            const bb = (z as { boundingBox?: number[] }).boundingBox;
            if (!Array.isArray(bb) || bb.length < 6) continue;
            const lo = bb[idx];
            const hi = bb[idx + 3];
            if (typeof lo !== 'number' || typeof hi !== 'number') continue;
            if (lo < min) min = lo;
            if (hi > max) max = hi;
        }

        if (!isFinite(min) || !isFinite(max)) return [0, 0];
        return [min, max];
    });
}
