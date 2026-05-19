import { randomUUID } from 'crypto';
import {
  ProjectManager,
  PulseSetup,
  PulseSlot,
  PulseSlotMode,
  PulseSyncRestartMode,
} from '../ProjectManager';
import { Logger } from '../Logger';
import { clampPulseSetupSpeed } from './pulseSetupSpeed';

const MIN_SLOT_COUNT = 1;
const MAX_SLOT_COUNT = 32;
const DEFAULT_BPM = 120;
const DEFAULT_METER = 4;
const DEFAULT_SLOT_COUNT = 4;

export type PulseControlCommand =
  | { command: 'selectSetup'; setupGuid: string }
  | { command: 'createSetup'; name?: string; bpm?: number; slotCount?: number }
  | { command: 'deleteSetup'; setupGuid: string }
  | { command: 'renameSetup'; setupGuid: string; name: string }
  | { command: 'setSetupBpm'; setupGuid: string; bpm: number }
  | { command: 'setSetupSpeed'; setupGuid: string; speed: number }
  | { command: 'setSetupSlotCount'; setupGuid: string; count: number }
  | { command: 'setSetupMode'; setupGuid: string; mode: PulseSlotMode }
  | { command: 'assignSlotBucket'; setupGuid: string; slotIdx: number; bucketGuid: string | null }
  | { command: 'setSlotActive'; setupGuid: string; slotIdx: number; active: boolean }
  | { command: 'setSyncConfig'; enabled?: boolean; restart?: PulseSyncRestartMode; lerp?: number };

export type PulseControlResult = {
  pulsesChanged: boolean;
  /** Setup guid affected by a durable mutation (for runtime sync). */
  setupGuid?: string;
};

export class PulseSetupManager {
  constructor(private projectManager: ProjectManager) {}

  /**
   * After project load: ensure `pulses.setups` has at least one row and `activePulseGuid`
   * references an existing setup (defaults to the first setup when missing or stale).
   */
  ensureLoadedProjectPulseDefaults(): { pulsesChanged: boolean } {
    const config = this.projectManager.ensurePulsesConfig();
    if (config.setups.length === 0) {
      const created = this.build({ command: 'createSetup' });
      if (created.setupGuid) {
        this.projectManager.setActivePulseGuid(created.setupGuid);
      }
      return { pulsesChanged: created.pulsesChanged };
    }
    const active = this.projectManager.getActivePulseGuid();
    if (!active || !this.projectManager.getPulseSetup(active)) {
      const g = config.setups[0]?.guid;
      if (typeof g === 'string' && g.length > 0) {
        this.projectManager.setActivePulseGuid(g);
        return { pulsesChanged: true };
      }
    }
    return { pulsesChanged: false };
  }

  build(command: PulseControlCommand): PulseControlResult {
    switch (command.command) {
      case 'selectSetup':
        return { pulsesChanged: false, setupGuid: command.setupGuid };
      case 'createSetup':
        return this.createSetup(command.name, command.bpm, command.slotCount);
      case 'deleteSetup':
        return this.deleteSetup(command.setupGuid);
      case 'renameSetup':
        return this.renameSetup(command.setupGuid, command.name);
      case 'setSetupBpm':
        return this.setSetupBpm(command.setupGuid, command.bpm);
      case 'setSetupSpeed':
        return this.setSetupSpeed(command.setupGuid, command.speed);
      case 'setSetupSlotCount':
        return this.setSetupSlotCount(command.setupGuid, command.count);
      case 'setSetupMode':
        return this.setSetupMode(command.setupGuid, command.mode);
      case 'assignSlotBucket':
        return this.assignSlotBucket(command.setupGuid, command.slotIdx, command.bucketGuid);
      case 'setSlotActive':
        return this.setSlotActive(command.setupGuid, command.slotIdx, command.active);
      case 'setSyncConfig':
        return this.setSyncConfig(command.enabled, command.restart, command.lerp);
    }
  }

  private createSetup(name?: string, bpm?: number, slotCount?: number): PulseControlResult {
    const config = this.projectManager.ensurePulsesConfig();
    const count = this.clampSlotCount(slotCount ?? DEFAULT_SLOT_COUNT);
    const setupGuid = `pulse-${randomUUID()}`;
    const label =
      typeof name === 'string' && name.trim().length > 0
        ? name.trim()
        : `Pulse ${config.setups.length + 1}`;
    const nextBpm = this.clampBpm(bpm ?? DEFAULT_BPM);
    const setup: PulseSetup = {
      guid: setupGuid,
      name: label,
      bpm: nextBpm,
      meter: DEFAULT_METER,
      mode: 'forward',
      slots: this.buildEmptySlots(count),
    };
    config.setups.push(setup);
    this.persistPulses();
    Logger.info(`[pulse] created setup ${setupGuid} (${label})`);
    return { pulsesChanged: true, setupGuid };
  }

  private deleteSetup(setupGuid: string): PulseControlResult {
    if (setupGuid.length === 0) {
      return { pulsesChanged: false };
    }
    const config = this.projectManager.ensurePulsesConfig();
    const idx = config.setups.findIndex(s => s.guid === setupGuid);
    if (idx === -1) {
      Logger.warn(`[pulse] deleteSetup: unknown setup ${setupGuid}`);
      return { pulsesChanged: false };
    }
    config.setups.splice(idx, 1);
    if (this.projectManager.getActivePulseGuid() === setupGuid) {
      this.projectManager.setActivePulseGuid(undefined);
    }
    this.persistPulses();
    Logger.info(`[pulse] deleted setup ${setupGuid}`);
    return { pulsesChanged: true, setupGuid };
  }

  private renameSetup(setupGuid: string, name: string): PulseControlResult {
    const setup = this.projectManager.getPulseSetup(setupGuid);
    if (!setup) {
      Logger.warn(`[pulse] renameSetup: unknown setup ${setupGuid}`);
      return { pulsesChanged: false };
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return { pulsesChanged: false };
    }
    setup.name = trimmed;
    this.persistPulses();
    return { pulsesChanged: true, setupGuid };
  }

  private setSetupBpm(setupGuid: string, bpm: number): PulseControlResult {
    const setup = this.projectManager.getPulseSetup(setupGuid);
    if (!setup) {
      Logger.warn(`[pulse] setSetupBpm: unknown setup ${setupGuid}`);
      return { pulsesChanged: false };
    }
    setup.bpm = this.clampBpm(bpm);
    this.persistPulses();
    return { pulsesChanged: true, setupGuid };
  }

  private setSetupSpeed(setupGuid: string, speed: number): PulseControlResult {
    const setup = this.projectManager.getPulseSetup(setupGuid);
    if (!setup) {
      Logger.warn(`[pulse] setSetupSpeed: unknown setup ${setupGuid}`);
      return { pulsesChanged: false };
    }
    setup.speed = clampPulseSetupSpeed(speed);
    this.persistPulses();
    return { pulsesChanged: true, setupGuid };
  }

  private setSetupSlotCount(setupGuid: string, count: number): PulseControlResult {
    const setup = this.projectManager.getPulseSetup(setupGuid);
    if (!setup) {
      Logger.warn(`[pulse] setSetupSlotCount: unknown setup ${setupGuid}`);
      return { pulsesChanged: false };
    }
    const nextCount = this.clampSlotCount(count);
    const prev = setup.slots;
    const next: PulseSlot[] = [];
    for (let i = 0; i < nextCount; i += 1) {
      const existing = prev[i];
      const nextSlot: PulseSlot = {};
      if (existing?.bucket) {
        nextSlot.bucket = existing.bucket;
      }
      if (existing?.active === true) {
        nextSlot.active = true;
      }
      next.push(nextSlot);
    }
    setup.slots = next;
    this.persistPulses();
    return { pulsesChanged: true, setupGuid };
  }

  private setSetupMode(setupGuid: string, mode: PulseSlotMode): PulseControlResult {
    const setup = this.projectManager.getPulseSetup(setupGuid);
    if (!setup) {
      Logger.warn(`[pulse] setSetupMode: unknown setup ${setupGuid}`);
      return { pulsesChanged: false };
    }
    setup.mode = this.normalizeSetupMode(mode);
    this.persistPulses();
    return { pulsesChanged: true, setupGuid };
  }

  private assignSlotBucket(
    setupGuid: string,
    slotIdx: number,
    bucketGuid: string | null,
  ): PulseControlResult {
    const setup = this.projectManager.getPulseSetup(setupGuid);
    if (!setup) {
      Logger.warn(`[pulse] assignSlotBucket: unknown setup ${setupGuid}`);
      return { pulsesChanged: false };
    }
    if (slotIdx < 0 || slotIdx >= setup.slots.length) {
      Logger.warn(`[pulse] assignSlotBucket: slot ${slotIdx} out of range`);
      return { pulsesChanged: false };
    }
    if (bucketGuid !== null && bucketGuid.length > 0) {
      if (!this.projectManager.getPulseBucket(bucketGuid)) {
        Logger.warn(`[pulse] assignSlotBucket: unknown bucket ${bucketGuid}`);
        return { pulsesChanged: false };
      }
    }
    const slot = setup.slots[slotIdx];
    if (!slot) {
      return { pulsesChanged: false };
    }
    if (bucketGuid === null || bucketGuid.length === 0) {
      delete slot.bucket;
    } else {
      slot.bucket = bucketGuid;
    }
    this.persistPulses();
    return { pulsesChanged: true, setupGuid };
  }

  private setSlotActive(
    setupGuid: string,
    slotIdx: number,
    active: boolean,
  ): PulseControlResult {
    const setup = this.projectManager.getPulseSetup(setupGuid);
    if (!setup) {
      Logger.warn(`[pulse] setSlotActive: unknown setup ${setupGuid}`);
      return { pulsesChanged: false };
    }
    if (slotIdx < 0 || slotIdx >= setup.slots.length) {
      Logger.warn(`[pulse] setSlotActive: slot ${slotIdx} out of range`);
      return { pulsesChanged: false };
    }
    const slot = setup.slots[slotIdx];
    if (!slot) {
      return { pulsesChanged: false };
    }
    if (active) {
      slot.active = true;
    } else {
      delete slot.active;
    }
    this.persistPulses();
    return { pulsesChanged: true, setupGuid };
  }

  private setSyncConfig(
    enabled?: boolean,
    restart?: PulseSyncRestartMode,
    lerp?: number,
  ): PulseControlResult {
    const config = this.projectManager.ensurePulsesConfig();
    const prev = config.sync ?? {};
    const next = { ...prev };
    if (enabled !== undefined) {
      next.enabled = enabled;
    }
    if (restart !== undefined) {
      next.restart = restart;
    }
    if (lerp !== undefined) {
      next.lerp = this.clampLerp(lerp);
    }
    config.sync = next;
    this.persistPulses();
    return { pulsesChanged: true };
  }

  private persistPulses(): void {
    this.projectManager.setProjectData('pulses', this.projectManager.getPulsesWirePayload());
  }

  private normalizeSetupMode(mode: PulseSlotMode): PulseSlotMode {
    if (mode === 'backward' || mode === 'random') {
      return mode;
    }
    return 'forward';
  }

  private clampLerp(lerp: number): number {
    if (!Number.isFinite(lerp)) return 0.35;
    return Math.min(1, Math.max(0.1, lerp));
  }

  private clampBpm(bpm: number): number {
    if (!Number.isFinite(bpm)) return DEFAULT_BPM;
    return Math.min(300, Math.max(20, bpm));
  }

  private clampSlotCount(count: number): number {
    if (!Number.isFinite(count)) return DEFAULT_SLOT_COUNT;
    return Math.min(MAX_SLOT_COUNT, Math.max(MIN_SLOT_COUNT, Math.round(count)));
  }

  private buildEmptySlots(count: number): PulseSlot[] {
    const slots: PulseSlot[] = [];
    for (let i = 0; i < count; i += 1) {
      slots.push({});
    }
    return slots;
  }
}
