import { loadConfig } from './Config';
import { Logger } from './Logger';
import { StarterController } from './StarterController';

const logger = new Logger('starter-controller');

try {
  const config = loadConfig();
  const controller = new StarterController(config, logger);

  process.on('SIGINT', () => {
    controller.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    controller.stop();
    process.exit(0);
  });

  controller.start();
} catch (error) {
  logger.error('failed to start', error);
  process.exit(1);
}
