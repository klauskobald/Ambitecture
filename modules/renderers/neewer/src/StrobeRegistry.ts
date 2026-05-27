import { StrobeConfig, StrobeScheduler } from './StrobeScheduler';

/**
 * Holds one StrobeScheduler per fixture (keyed by fixture name). Fixture classes are
 * singletons, so the per-instance strobe timers cannot live on them; this shared registry
 * keeps that state and lets the config lifecycle tear every timer down on reload.
 */
class StrobeRegistry {
    private readonly byFixture = new Map<string, StrobeScheduler>();

    acquire(key: string, makeConfig: () => StrobeConfig): StrobeScheduler {
        let scheduler = this.byFixture.get(key);
        if (!scheduler) {
            scheduler = new StrobeScheduler(makeConfig());
            this.byFixture.set(key, scheduler);
        }
        return scheduler;
    }

    release(key: string): void {
        const scheduler = this.byFixture.get(key);
        if (!scheduler) return;
        scheduler.stop();
        this.byFixture.delete(key);
    }

    stopAll(): void {
        for (const scheduler of this.byFixture.values()) {
            scheduler.stop();
        }
        this.byFixture.clear();
    }
}

export const strobeRegistry = new StrobeRegistry();
