import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './Logger';
import { Config } from './Config';

/**
 * File system storage implementation
 * Uses system.yml > dataPath as storage base
 */
export class FsStorage {
    private basePath: string;
    private filetype: string;
    private config: Config;
    private debounceTimeouts: Map<string, NodeJS.Timeout> = new Map();
    constructor(basePath: string, filetype: string = 'json') {
        this.config = new Config('system');
        this.basePath = path.join(this.config.get('dataDir'), basePath);
        this.filetype = filetype;
        this.ensureDirectoryExists(this.basePath);
    }

    /**
     * Ensure directory exists, create if not
     */
    private ensureDirectoryExists(dirPath: string): void {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            Logger.info(`Created directory: ${dirPath}`);
        }
    }

    /**
     * Set item (write file)
     * @param key File path relative to base
     * @param data Data to write
     */
    async setItem(key: string, data: any, debounceSeconds: number = 0): Promise<void> {
        if (debounceSeconds > 0) {
            if (this.debounceTimeouts.has(key)) {
                clearTimeout(this.debounceTimeouts.get(key)!);
            }
            this.debounceTimeouts.set(key, setTimeout(async () => {
                await this._setItem(key, data);
            }, debounceSeconds * 1000));
        } else {
            await this._setItem(key, data);
        }
    }

    private async _setItem(key: string, data: any): Promise<void> {
        const filePath = path.join(this.basePath, key) + '.' + this.filetype;
        const dirPath = path.dirname(filePath);
        this.ensureDirectoryExists(dirPath);
        fs.writeFileSync(filePath, this.filetype === 'json' ? JSON.stringify(data, null, 2) : data);
    }

    /**
     * Get item (read file)
     * @param key File path relative to base
     * @returns Parsed data or null if not found
     */
    async getItem<T>(key: string): Promise<T | null> {
        const filePath = path.join(this.basePath, key) + '.' + this.filetype;

        try {
            if (!fs.existsSync(filePath)) {
                return null;
            }

            const content = await fs.promises.readFile(filePath, 'utf8');
            const data = this.filetype === 'json' ? JSON.parse(content) : content;
            // Logger.debug(`Read file: ${key}`);
            return data as T;
        } catch (error) {
            Logger.error(`Failed to read file ${key}:`, error);
            return null;
        }
    }

    /**
     * Check if item exists
     * @param key File path relative to base
     * @returns True if file exists
     */
    hasItem(key: string): boolean {
        const filePath = path.join(this.basePath, key) + '.' + this.filetype;
        return fs.existsSync(filePath);
    }

    /**
     * Remove item (delete file)
     * @param key File path relative to base
     */
    async removeItem(key: string): Promise<void> {
        const filePath = path.join(this.basePath, key) + '.' + this.filetype;

        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                Logger.debug(`Deleted file: ${filePath}`);
            }
        } catch (error) {
            Logger.error(`Failed to delete file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * List files in directory
     * @param dir Directory path relative to base
     * @returns Array of file names
     */
    async listItems(dir: string): Promise<string[]> {
        const dirPath = path.join(this.basePath, dir);

        try {
            if (!fs.existsSync(dirPath)) {
                return [];
            }

            const items = await fs.promises.readdir(dirPath);
            const files = items.filter(item => {
                const itemPath = path.join(dirPath, item);
                return fs.statSync(itemPath).isFile();
            });
            // Sort to ensure deterministic order (filesystem order is not guaranteed)
            const sortedFiles = files.map(file => file.replace('.' + this.filetype, '')).sort();
            return sortedFiles;
        } catch (error) {
            Logger.error(`Failed to list directory ${dir}:`, error);
            return [];
        }
    }

    async deleteAll(): Promise<void> {
        const files = await this.listItems('');
        for (const file of files) {
            await this.removeItem(file);
        }
    }

    /**
     * List subdirectories
     * @param dir Directory path relative to base
     * @returns Array of directory names
     */
    async listDirectories(dir: string): Promise<string[]> {
        const dirPath = path.join(this.basePath, dir);

        try {
            if (!fs.existsSync(dirPath)) {
                return [];
            }

            const items = await fs.promises.readdir(dirPath);
            const directories: string[] = [];

            for (const item of items) {
                const itemPath = path.join(dirPath, item);
                if (fs.statSync(itemPath).isDirectory()) {
                    directories.push(item);
                }
            }

            return directories;
        } catch (error) {
            Logger.error(`Failed to list directories in ${dir}:`, error);
            return [];
        }
    }

    /**
     * Get full path for a key
     * @param key File path relative to base
     * @returns Absolute file path
     */
    getFullPath(key: string): string {
        return path.join(this.basePath, key);
    }
}