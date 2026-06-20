import { ConnectionRegistry } from '../ConnectionRegistry';
import { ProjectManager } from '../ProjectManager';
import { ProjectGraphStore } from '../ProjectGraphStore';

/**
 * Read-only dependency bag passed to every probe query. Extend this as new
 * queries need more hub state; the `system:probe` handler builds it per request.
 */
export interface ProbeContext {
  registry: ConnectionRegistry;
  projectManager: ProjectManager;
  graphStore: ProjectGraphStore;
}

/**
 * A probe query resolves a named read-only question about hub state into a
 * JSON-serializable result. Queries must not mutate anything.
 */
export type ProbeQuery = (ctx: ProbeContext, args: unknown) => unknown;

const queries = new Map<string, ProbeQuery>();

export function registerProbeQuery(name: string, query: ProbeQuery): void {
  queries.set(name, query);
}

export function getProbeQuery(name: string): ProbeQuery | undefined {
  return queries.get(name);
}
