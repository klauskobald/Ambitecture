import { notification } from './notification.js'
import * as statusLogger from './statusLogger.js'

export function info (message, key) {
  statusLogger.info(message, key)
  notification.info(message, key)
}

export function warn (message, key) {
  statusLogger.warn(message, key)
  notification.warn(message, key)
}

export function error (message, key) {
  statusLogger.error(message, key)
  notification.error(message, key)
}
