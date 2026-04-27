class EventQueue {
    constructor(callback) {
        this.callback = callback;
        this.queue = [];
        this.timer = null;
        this.insertCounter = 0;
    }

    enqueue(event) {
        const now = Date.now();
        const scheduled = event.scheduled ?? 0;
        const scheduledAt = scheduled > now ? scheduled : now;

        const entry = { event, scheduledAt, insertOrder: this.insertCounter++ };
        this._insertSorted(entry);
        this._reschedule();
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
        const now = Date.now();
        while (this.queue.length > 0 && this.queue[0].scheduledAt <= now) {
            this.callback(this.queue.shift().event);
        }
        this._reschedule();
    }
}
