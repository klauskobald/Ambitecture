import * as fs from 'fs';
/**
 * Simple logger class with static methods
 */
export class Logger {
    private static level: string = "debug";
    private static showTimestamp: boolean = false;
    private static outputFile: string | null = null;
    private static icons = {
        info: 'ℹ️',
        warn: '⚠️',
        error: '❌',
        debug: '🐛'
    };

    static setOutputFile(outputFile: string | null): void {
        this.outputFile = outputFile;
        if (this.outputFile) {
            fs.writeFileSync(this.outputFile, '');
        }
    }

    static setLevel(level: string): void {
        this.level = level;
    }

    private static shouldLog(level: string): boolean {
        const levels = { error: 0, warn: 1, info: 2, debug: 3 };
        return levels[level as keyof typeof levels] <= levels[this.level as keyof typeof levels];
    }

    private static _formatMessage(level: string, message: string, ...args: any[]): string {
        const timestamp = this.showTimestamp ? `[${new Date().toISOString().substring(11, 5)}] ` : "";
        const formattedArgs = args.length > 0 ? ` ${args.map(arg => {
            if (arg instanceof Error) {
                return `${arg.message}\n${arg.stack}`;
            }
            return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
        }).join(' ')}` : '';
        return `${timestamp}${level.toUpperCase()} ${message}${formattedArgs}`;
    }

    private static formatMessage(level: string, message: string, ...args: any[]): string {
        const formattedMessage = this._formatMessage(level, message, ...args);
        if (this.outputFile) {
            fs.appendFileSync(this.outputFile, formattedMessage + '\n');
        }
        return formattedMessage;
    }



    static info(message: string, ...args: any[]): void {
        if (this.shouldLog("info")) {
            console.log(this.formatMessage(this.icons.info, message, ...args));
        }
    }

    static warn(message: string, ...args: any[]): void {
        if (this.shouldLog("warn")) {
            console.warn(this.formatMessage(this.icons.warn, message, ...args));
        }
    }

    static error(message: string, ...args: any[]): void {
        if (this.shouldLog("error")) {
            console.error(this.formatMessage(this.icons.error, message, ...args));
        }
    }

    static exception(error: any, ...args: any[]): void {
        if (this.shouldLog("error")) {
            console.error(this.formatMessage(this.icons.error, error.message, ...args, error.stack));
        }
    }

    static debug(message: string, ...args: any[]): void {
        if (this.shouldLog("debug")) {
            console.log(this.formatMessage(this.icons.debug, message, ...args));
        }
    }
}
