import { loadConfig } from './Config';
import { Logger } from './Logger';
import { MusicAnalyserController } from './MusicAnalyserController';

const logger = new Logger('music-analyser');

try {
  const config = loadConfig();
  const controller = new MusicAnalyserController(config, logger);
  const shutdown = (): void => {
    controller.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  controller.start();
} catch (error) {
  logger.error('failed to start', error);
  process.exit(1);
}
