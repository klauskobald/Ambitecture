import * as path from 'path';
import { Config } from './Config';
import { Logger } from './Logger';

export interface FixtureChannelDef {
  function: string;
  range: string;
}

export interface FixtureProfile {
  name: string;
  class: string;
  params: {
    dmx: Record<string, FixtureChannelDef>;
  };
}

interface FixtureInstance {
  name: string;
  fixture: string;
  dmxBaseChannel: number;
  location: [number, number, number];
  target?: [number, number, number];
  rotation?: [number, number, number];
  range: number;
}

interface Zone {
  name: string;
  rendererGUID: string;
  fixtures: FixtureInstance[];
}

interface Project {
  name: string;
  zones: Zone[];
}

export class ProjectManager {
  private projectsPath: string;
  private fixturesPath: string;
  private project: Project;
  private fixtureProfiles: Map<string, FixtureProfile> = new Map();

  constructor(serverConfig: Config) {
    this.projectsPath = serverConfig.get<string>('projectsPath');
    this.fixturesPath = serverConfig.get<string>('fixturesPath');
    const defaultProject = serverConfig.get<string>('defaultProject');
    this.project = this.loadProject(defaultProject);
    this.loadReferencedFixtures();
    Logger.info(`[project] loaded "${this.project.name}" with ${this.project.zones.length} zone(s)`);
  }

  private resolvePath(base: string, file: string): string {
    const resolvedBase = path.isAbsolute(base)
      ? base
      : path.resolve(process.cwd(), base);
    return path.join(resolvedBase, file);
  }

  private loadProject(name: string): Project {
    const filePath = this.resolvePath(this.projectsPath, `${name}.yml`);
    return new Config(filePath).getAll() as Project;
  }

  private loadReferencedFixtures(): void {
    const fixtureNames = new Set<string>();
    for (const zone of this.project.zones) {
      for (const fi of zone.fixtures) {
        fixtureNames.add(fi.fixture);
      }
    }
    for (const name of fixtureNames) {
      const filePath = this.resolvePath(this.fixturesPath, `${name}.yml`);
      this.fixtureProfiles.set(name, new Config(filePath).getAll() as FixtureProfile);
      Logger.info(`[project] loaded fixture profile "${name}"`);
    }
  }

  buildRendererConfig(rendererGuid: string): object {
    const zones = this.project.zones.filter(z => z.rendererGUID === rendererGuid);
    return {
      zones: zones.map(zone => ({
        name: zone.name,
        fixtures: zone.fixtures.map(fi => {
          const entry: Record<string, unknown> = {
            name: fi.name,
            fixtureProfile: this.fixtureProfiles.get(fi.fixture),
            dmxBaseChannel: fi.dmxBaseChannel,
            location: fi.location,
            range: fi.range,
          };
          if (fi.target !== undefined) entry['target'] = fi.target;
          if (fi.rotation !== undefined) entry['rotation'] = fi.rotation;
          return entry;
        }),
      })),
    };
  }
}
