import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as dotenv from 'dotenv';
import { Logger } from './Logger';
dotenv.config();
const CONFIG_PATH = process.env.CONFIG_PATH || 'config';
Logger.info(`USING CONFIG_PATH: ${CONFIG_PATH}`);
/**
 * Configuration manager for loading YAML config files
 */
export class Config {
    private config: any;
    private configName: string;
    private subscribers: ((config: any) => void)[] = [];

    private isOptional: boolean;

    constructor(configName: string, isOptional: boolean = false) {
        this.configName = configName;
        this.isOptional = isOptional;
        this.loadConfig();
    }

    subscribeToChanges(callback: (config: any) => void): void {
        this.subscribers.push(callback);
        fs.watch(this.configpath(), (eventType, filename) => {
            if (eventType === 'change') {
                Logger.info(`Config ${this.configName} changed, reloading...`);
                this.loadConfig();
                this.subscribers.forEach(callback => callback(this.config));
            }
        });
        this.loadConfig()
        callback(this.config);
    }

    private configpath() {
        if (this.configName.endsWith('.yml') || this.configName.endsWith('.yaml')) {
            if (path.isAbsolute(this.configName)) {
                return this.configName;
            }
            return path.join(process.cwd(), this.configName);
        }
        switch (this.configName) {
            case 'env':
                return path.join(process.cwd(), '.env');
            default:
                return path.join(CONFIG_PATH, `${this.configName}.yml`);
        }
    }

    private loadConfig(): void {
        try {
            const configPath = this.configpath();
            if (!fs.existsSync(configPath)) {
                if (this.isOptional) {
                    this.config = {};
                    return;
                }
                throw new Error(`Config file not found: ${configPath}`);
            }
            const configContent = fs.readFileSync(configPath, 'utf8');
            switch (this.configName) {
                case 'env':
                    this.config = dotenv.parse(configContent);
                    break;
                default:
                    const config = yaml.load(configContent);
                    this.config = config || {};
                    this.config = this.processConfigReferences(this.config);
                    break;
            }

            // Logger.info(`Loaded config: ${this.configName}`);
        } catch (error) {
            if (this.isOptional) {
                this.config = {};
                return;
            }
            Logger.error(`Failed to load config ${this.configName}:`, error);
            throw new Error(`Config ${this.configName} not found or invalid: ${error}`);
        }
    }

    /**
     * Recursively traverse config object and replace CONFIG references
     * @param obj Configuration object or value to process
     * @returns Processed configuration with CONFIG references resolved
     */
    private processConfigReferences(obj: any): any {
        if (typeof obj === 'string' && obj.startsWith('CONFIG:')) {
            return this.resolveConfigReference(obj);
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.processConfigReferences(item));
        }

        if (obj && typeof obj === 'object') {
            const processed: any = {};
            for (const [key, value] of Object.entries(obj)) {
                processed[key] = this.processConfigReferences(value);
            }
            return processed;
        }

        return obj;
    }

    /**
     * Resolve a CONFIG reference (e.g., "CONFIG:env:EXECUTOR_API_KEY")
     * @param configRef CONFIG reference string
     * @returns Resolved value
     */
    private resolveConfigReference(configRef: string): any {
        const parts = configRef.split(':');
        if (parts.length !== 3 || parts[0] !== 'CONFIG') {
            throw new Error(`Invalid CONFIG reference format: ${configRef}. Expected: CONFIG:configName:key`);
        }

        const targetConfigName = parts[1];
        const targetKey = parts[2];

        // Always create a fresh config instance to get latest values
        const targetConfig = targetConfigName === this.configName ? this : new Config(targetConfigName);

        try {
            return targetConfig.get(targetKey);
        } catch (error) {
            throw new Error(`Failed to resolve CONFIG reference ${configRef}: ${error}`);
        }
    }

    /**
     * Get configuration value by key
     * @param key Dot-notation key (e.g., "server.port")
     * @returns Configuration value
     */
    get<T>(key: string): T {
        const keys = key.split('.');
        let value: any = this.config;

        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                throw new Error(`Config key '${key}' not found in ${this.configName}`);
            }
        }

        return value as T;
    }

    /**
     * Get configuration value with default fallback
     * @param key Dot-notation key
     * @param defaultValue Default value if key not found
     * @returns Configuration value or default
     */
    getOrDefault<T>(key: string, defaultValue: T): T {
        try {
            return this.get<T>(key);
        } catch {
            return defaultValue;
        }
    }

    /**
     * Check if configuration key exists
     * @param key Dot-notation key
     * @returns True if key exists
     */
    has(key: string): boolean {
        try {
            this.get(key);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get entire configuration object
     * @returns Full configuration
     */
    getAll(): any {
        return this.config;
    }

    /**
     * Reload configuration from file
     */
    reload(): void {
        this.loadConfig();
    }
}
