class Vector3 {
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    magnitude() {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }

    normalize() {
        const m = this.magnitude();
        if (m === 0) return new Vector3(0, 0, 0);
        return new Vector3(this.x / m, this.y / m, this.z / m);
    }

    dot(other) {
        return this.x * other.x + this.y * other.y + this.z * other.z;
    }

    static fromTo(from, to) {
        return new Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    }
}
