export const SERVICE_UUID = '69400001b5a3f393e0a9e50e24dcca99';
export const WRITE_UUID = '69400002b5a3f393e0a9e50e24dcca99';
export const NOTIFY_UUID = '69400003b5a3f393e0a9e50e24dcca99';

export const NAME_HINTS = ['neewer', 'nwr', 'nw-', 'nee', 'sl'];

const PREFIX = 0x78;
const TAG_POWER = 0x81;
const TAG_HSV = 0x86;
const TAG_CCT = 0x87;
const TAG_SCENE = 0x88;

export function buildPacket(tag: number, payload: number[]): Buffer {
    const head = [PREFIX, tag, payload.length, ...payload];
    const checksum = head.reduce((s, b) => s + b, 0) & 0xff;
    return Buffer.from([...head, checksum]);
}

export function powerOn(): Buffer {
    return buildPacket(TAG_POWER, [0x01]);
}

export function powerOff(): Buffer {
    return buildPacket(TAG_POWER, [0x02]);
}

export function hsv(hue: number, sat: number, bri: number): Buffer {
    const h = Math.max(0, Math.min(360, Math.round(hue)));
    const s = Math.max(0, Math.min(100, Math.round(sat)));
    const b = Math.max(0, Math.min(100, Math.round(bri)));
    return buildPacket(TAG_HSV, [h & 0xff, (h >> 8) & 0xff, s, b]);
}

export function cct(kelvin: number, bri: number): Buffer {
    const k = Math.max(3200, Math.min(5600, Math.round(kelvin)));
    const b = Math.max(0, Math.min(100, Math.round(bri)));
    return buildPacket(TAG_CCT, [b, Math.round(k / 100)]);
}

export function scene(effect: number, bri: number): Buffer {
    const e = Math.max(1, Math.min(9, Math.round(effect)));
    const b = Math.max(0, Math.min(100, Math.round(bri)));
    return buildPacket(TAG_SCENE, [b, e]);
}

export function looksLikeNeewer(name: string | undefined): boolean {
    if (!name) return false;
    const lower = name.toLowerCase();
    return NAME_HINTS.some((h) => lower.includes(h));
}
