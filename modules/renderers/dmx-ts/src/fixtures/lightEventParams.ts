export interface LightColor {
    x: number;
    y: number;
    Y: number;
}

export interface LightParams {
    color?: LightColor;
    aux?: Record<string, number>;
    layer?: number;
    blend?: string;
    alpha?: number;
}

export interface MasterParams {
    brightness?: number;
    blackout?: boolean;
}
