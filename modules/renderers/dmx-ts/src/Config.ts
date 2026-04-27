import 'dotenv/config';

export class Config {
    static get hubWsUrl(): string {
        const url = process.env['AMBITECTURE_HUB_URL'] ?? 'http://localhost:3000';
        return url.replace(/^http/, 'ws');
    }
    static get guid(): string { return process.env['GUID'] ?? 'renderer-unknown'; }
    static get rendererName(): string { return (process.env['NAME'] ?? 'DMX Renderer').replace(/'/g, ''); }
    static get geoLocation(): [number, number] {
        const raw = (process.env['GEO_LOCATION'] ?? '0 0').trim();
        const parts = raw.split(/\s+/).map(Number);
        return [parts[0] ?? 0, parts[1] ?? 0];
    }
    static get boundingBox(): [number, number, number, number, number, number] {
        const raw = (process.env['BOUNDING_BOX'] ?? '0 0 0 10 4 10').replace(/'/g, '').trim();
        const parts = raw.split(/\s+/).map(Number);
        return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 10, parts[4] ?? 4, parts[5] ?? 10];
    }
    static get dmxDriver(): string { return (process.env['DMX_DRIVER'] ?? 'null').replace(/'/g, ''); }
    static get dmxPort(): string { return (process.env['DMX_DEVICE'] ?? '').replace(/'/g, ''); }
    static get dmxUniverseName(): string { return process.env['DMX_UNIVERSE'] ?? 'main'; }
    static get dmxFrameRate(): number { return parseInt(process.env['DMX_FRAME_RATE'] ?? '30', 10); }
}
