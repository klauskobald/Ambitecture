import 'dotenv/config';
import { Logger } from './Logger';
import { Config } from './Config';
import { HubConnection } from './HubConnection';

Logger.info(`[renderer] starting name=${Config.rendererName} hub=${Config.hubWsUrl} guid=${Config.guid}`);
const connection = new HubConnection();
connection.connect();
