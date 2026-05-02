export class Logger {
  constructor(private readonly source: string) {}

  info(message: string): void {
    this.write('info', message);
  }

  warn(message: string): void {
    this.write('warn', message);
  }

  error(message: string, error?: unknown): void {
    const suffix = error instanceof Error ? `: ${error.message}` : '';
    this.write('error', `${message}${suffix}`);
  }

  private write(level: 'info' | 'warn' | 'error', message: string): void {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${this.source}] ${message}`;
    switch (level) {
      case 'info':
        console.log(line);
        break;
      case 'warn':
        console.warn(line);
        break;
      case 'error':
        console.error(line);
        break;
    }
  }
}
