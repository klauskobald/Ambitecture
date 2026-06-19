/**
 * Three intermediate points that lag toward the straight line between the rope's endpoints, giving a
 * loose, sagging look. Purely visual — it holds no physics and only eases its points each frame.
 */
class RopeChain {
    constructor() {
        this._pts = null;
    }

    /**
     * @returns {Array<[number, number]>} 5 points: endpoint A, three eased midpoints, endpoint B.
     */
    points(ax, ay, bx, by, sagPx, ease) {
        const ts = [0.25, 0.5, 0.75];
        const targets = ts.map((t) => ({
            x: ax + (bx - ax) * t,
            y: ay + (by - ay) * t + sagPx * Math.sin(Math.PI * t)
        }));
        if (!this._pts) {
            this._pts = targets.map((p) => ({ ...p }));
        } else {
            for (let i = 0; i < targets.length; i++) {
                this._pts[i].x += (targets[i].x - this._pts[i].x) * ease;
                this._pts[i].y += (targets[i].y - this._pts[i].y) * ease;
            }
        }
        return [
            [ax, ay],
            [this._pts[0].x, this._pts[0].y],
            [this._pts[1].x, this._pts[1].y],
            [this._pts[2].x, this._pts[2].y],
            [bx, by]
        ];
    }
}
