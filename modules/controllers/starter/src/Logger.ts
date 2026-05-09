type Level = 'info' | 'warn' | 'error';

export class Logger {
  constructor(private readonly source: string) {}

  info(message: string): void {
    this.write('info', message);
  }

  warn(message: string): void {
    this.write('warn', message);
  }

  error(message: string, error?: unknown): void {
    const suffix = error instanceof Error ? `: ${error.message}` : error ? `: ${String(error)}` : '';
    this.write('error', `${message}${suffix}`);
  }

  private write(level: Level, message: string): void {
    const line = `[${new Date().toISOString()}] [${this.source}] ${message}`;
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    sink(line);
  }
}
