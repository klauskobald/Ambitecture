import { FsStorage } from './FsStorage';

const STORAGE_KEY = 'activeProject';

export interface ActiveProjectRecord {
  spec: string;
}

const hubDataStorage = (): FsStorage => new FsStorage('hub');

export function readActiveProjectSpec(): string | null {
  const record = hubDataStorage().getItemSync<ActiveProjectRecord>(STORAGE_KEY);
  if (record === null) {
    return null;
  }
  const spec = typeof record.spec === 'string' ? record.spec.trim() : '';
  if (spec.length === 0) {
    return null;
  }
  return spec;
}

export function writeActiveProjectSpec(spec: string): void {
  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    throw new Error('[project] cannot persist empty active project specifier');
  }
  hubDataStorage().setItemSync(STORAGE_KEY, { spec: trimmed } satisfies ActiveProjectRecord);
}
