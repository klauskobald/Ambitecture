class EventQueue {
    /**
     * @param {(events: unknown[]) => void} callback
     * @param {(() => void) | undefined} onAfterBatch
     */
    constructor(callback, onAfterBatch) {
        this.callback = callback;
        this._onAfterBatch = onAfterBatch;
        this.queue = [];
        this.timer = null;
        this.insertCounter = 0;
    }

    enqueue(events) {
        if (!Array.isArray(events) || events.length === 0) return;
        const now = Date.now();
        for (const event of events) {
            const scheduled = event.scheduled ?? 0;
            const scheduledAt = scheduled > now ? scheduled : now;
            const entry = { event, scheduledAt, insertOrder: this.insertCounter++ };
            this._insertSorted(entry);
        }
        this._drainDue();
        this._reschedule();
    }

    _drainDue() {
        const now = Date.now();
        const batch = [];
        while (this.queue.length > 0 && this.queue[0].scheduledAt <= now) {
            batch.push(this.queue.shift().event);
        }
        if (batch.length > 0) {
            this.callback(batch);
            if (this._onAfterBatch) {
                this._onAfterBatch();
            }
        }
    }

    _insertSorted(entry) {
        let lo = 0, hi = this.queue.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            const m = this.queue[mid];
            const before =
                m.scheduledAt < entry.scheduledAt ||
                (m.scheduledAt === entry.scheduledAt && m.insertOrder < entry.insertOrder);
            if (before) lo = mid + 1;
            else hi = mid;
        }
        this.queue.splice(lo, 0, entry);
    }

    _reschedule() {
        if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
        if (this.queue.length === 0) return;
        const delay = Math.max(0, this.queue[0].scheduledAt - Date.now());
        this.timer = setTimeout(() => this._fire(), delay);
    }

    _fire() {
        this.timer = null;
        this._drainDue();
        this._reschedule();
    }
}
