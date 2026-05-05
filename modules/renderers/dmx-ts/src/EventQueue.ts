interface QueueEntry<T> {
    event: T;
    scheduledAt: number;
    insertOrder: number;
}

export class EventQueue<T extends { scheduled?: number }> {
    private queue: QueueEntry<T>[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private insertCounter = 0;
    private readonly callback: (events: T[]) => void;

    constructor(callback: (events: T[]) => void) {
        this.callback = callback;
    }

    enqueue(events: T[]): void {
        if (events.length === 0) return;
        const now = Date.now();
        for (const event of events) {
            const scheduled = event.scheduled ?? 0;
            const scheduledAt = scheduled > now ? scheduled : now;
            this.insertSorted({
                event,
                scheduledAt,
                insertOrder: this.insertCounter++,
            });
        }
        this.drainDue();
        this.reschedule();
    }

    private drainDue(): void {
        const now = Date.now();
        const batch: T[] = [];
        while (this.queue.length > 0 && this.queue[0]!.scheduledAt <= now) {
            batch.push(this.queue.shift()!.event);
        }
        if (batch.length > 0) {
            this.callback(batch);
        }
    }

    private insertSorted(entry: QueueEntry<T>): void {
        let lo = 0;
        let hi = this.queue.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            const m = this.queue[mid]!;
            const before =
                m.scheduledAt < entry.scheduledAt ||
                (m.scheduledAt === entry.scheduledAt && m.insertOrder < entry.insertOrder);
            if (before) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        this.queue.splice(lo, 0, entry);
    }

    private reschedule(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.queue.length === 0) return;

        const delay = Math.max(0, this.queue[0]!.scheduledAt - Date.now());
        this.timer = setTimeout(() => this.fire(), delay);
    }

    private fire(): void {
        this.timer = null;
        this.drainDue();
        this.reschedule();
    }
}
