import { loadConfig } from './Config';
import { Logger } from './Logger';
import { MidiController } from './MidiController';

const logger = new Logger('midi-v1');

try {
  const config = loadConfig();
  logger.info(`starting "${config.name}" (${config.guid})`);
  const controller = new MidiController(config, logger);
  const shutdown = (): void => { controller.stop(); process.exit(0); };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
  controller.start();
} catch (error) {
  logger.error('failed to start', error);
  process.exit(1);
}
