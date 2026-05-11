export type ResolverFn = (params: string[]) => unknown;

class ConfigResolverRegistry {
    private resolvers = new Map<string, ResolverFn>();

    register(name: string, fn: ResolverFn): void {
        this.resolvers.set(name, fn);
    }

    resolve(name: string, params: string[]): unknown {
        const fn = this.resolvers.get(name);
        if (!fn) {
            throw new Error(`No RUNTIME resolver registered for '${name}'`);
        }
        return fn(params);
    }

    has(name: string): boolean {
        return this.resolvers.has(name);
    }
}

export const configResolver = new ConfigResolverRegistry();

export function resolveRuntimeReferences(value: unknown): unknown {
    if (typeof value === 'string' && value.startsWith('RUNTIME:')) {
        const parts = value.split(':');
        const name = parts[1];
        if (!name) {
            throw new Error(`Invalid RUNTIME reference format: ${value}. Expected: RUNTIME:name[:param...]`);
        }
        return configResolver.resolve(name, parts.slice(2));
    }

    if (Array.isArray(value)) {
        return value.map(item => resolveRuntimeReferences(item));
    }

    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = resolveRuntimeReferences(v);
        }
        return out;
    }

    return value;
}
