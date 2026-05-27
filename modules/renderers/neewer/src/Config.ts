import 'dotenv/config';

export class Config {
    static get hubWsUrl(): string {
        const url = process.env['AMBITECTURE_HUB_URL'] ?? 'http://localhost:3000';
        return url.replace(/^http/, 'ws');
    }
    static get guid(): string { return process.env['GUID'] ?? 'renderer-neewer-unknown'; }
    static get rendererName(): string { return (process.env['NAME'] ?? 'Neewer Renderer').replace(/'/g, ''); }
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
    static get scanRestartMs(): number { return parseInt(process.env['NEEWER_SCAN_RESTART_MS'] ?? '30000', 10); }
    static get connectRetryInitialMs(): number { return parseInt(process.env['NEEWER_CONNECT_RETRY_MS'] ?? '2000', 10); }
    static get connectRetryMaxMs(): number { return parseInt(process.env['NEEWER_CONNECT_RETRY_MAX_MS'] ?? '30000', 10); }
    static get writeMinIntervalMs(): number { return parseInt(process.env['NEEWER_WRITE_MIN_INTERVAL_MS'] ?? '30', 10); }
}
