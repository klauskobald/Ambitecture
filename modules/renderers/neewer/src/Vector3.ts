export class Vector3 {
    constructor(readonly x: number, readonly y: number, readonly z: number) {}

    magnitude(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }

    normalize(): Vector3 {
        const m = this.magnitude();
        if (m === 0) return new Vector3(0, 0, 0);
        return new Vector3(this.x / m, this.y / m, this.z / m);
    }

    dot(other: Vector3): number {
        return this.x * other.x + this.y * other.y + this.z * other.z;
    }

    static fromTo(from: [number, number, number], to: [number, number, number]): Vector3 {
        return new Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    }
}
