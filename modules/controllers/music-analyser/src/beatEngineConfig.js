/** @typedef {import('./beatEngine').BeatEngineOptions} BeatEngineOptions */

/** @type {BeatEngineOptions} */
const DEFAULT_BEAT_ENGINE_OPTIONS = {
  syncToleranceSec: 0.045,
  onsetMinGapSec: 0.12,
  onsetFluxWindow: 48,
  onsetFluxSigma: 1.4,
  odfBufferDurationSec: 6,
  bpmUpdateIntervalMs: 1000,
  syncBarBeats: 4,
  initialBpm: 120,
  bpmMin: 60,
  bpmMax: 180,
  bpmSmoothNewWeight: 0.2,
  audioSilenceThreshold: 0.01,
  silentBpm: 1,
  silenceTimeoutSec: 10
}

function envTrimmed (key) {
  const value = process.env[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function parsePositiveNumber (key, fallback) {
  const raw = envTrimmed(key)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number (got "${raw}")`)
  }
  return value
}

function parsePositiveInt (key, fallback) {
  const value = parsePositiveNumber(key, fallback)
  if (!Number.isInteger(value)) {
    throw new Error(`${key} must be a positive integer (got "${envTrimmed(key)}")`)
  }
  return value
}

function parseUnitInterval (key, fallback) {
  const raw = envTrimmed(key)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error(`${key} must be a number between 0 and 1 exclusive (got "${raw}")`)
  }
  return value
}

function parseNonNegativeNumber (key, fallback) {
  const raw = envTrimmed(key)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${key} must be a non-negative number (got "${raw}")`)
  }
  return value
}

/**
 * Beat/onset detection tuning from environment (optional).
 * @returns {BeatEngineOptions}
 */
function loadBeatEngineConfig () {
  const bpmMin = parsePositiveNumber('BEAT_BPM_MIN', DEFAULT_BEAT_ENGINE_OPTIONS.bpmMin)
  const bpmMax = parsePositiveNumber('BEAT_BPM_MAX', DEFAULT_BEAT_ENGINE_OPTIONS.bpmMax)
  if (bpmMin >= bpmMax) {
    throw new Error('BEAT_BPM_MIN must be less than BEAT_BPM_MAX')
  }

  return {
    syncToleranceSec:
      parsePositiveNumber('BEAT_SYNC_TOLERANCE_MS', 45) / 1000,
    onsetMinGapSec:
      parsePositiveNumber('BEAT_ONSET_MIN_GAP_MS', 120) / 1000,
    onsetFluxWindow:
      parsePositiveInt('BEAT_ONSET_FLUX_WINDOW', DEFAULT_BEAT_ENGINE_OPTIONS.onsetFluxWindow),
    onsetFluxSigma:
      parsePositiveNumber('BEAT_ONSET_FLUX_SIGMA', DEFAULT_BEAT_ENGINE_OPTIONS.onsetFluxSigma),
    odfBufferDurationSec:
      parsePositiveNumber('BEAT_ODF_BUFFER_SECONDS', DEFAULT_BEAT_ENGINE_OPTIONS.odfBufferDurationSec),
    bpmUpdateIntervalMs:
      parsePositiveInt('BEAT_BPM_UPDATE_INTERVAL_MS', DEFAULT_BEAT_ENGINE_OPTIONS.bpmUpdateIntervalMs),
    syncBarBeats:
      parsePositiveInt('BEAT_SYNC_BAR_BEATS', DEFAULT_BEAT_ENGINE_OPTIONS.syncBarBeats),
    initialBpm:
      parsePositiveNumber('BEAT_INITIAL_BPM', DEFAULT_BEAT_ENGINE_OPTIONS.initialBpm),
    bpmMin,
    bpmMax,
    bpmSmoothNewWeight:
      parseUnitInterval('BEAT_BPM_SMOOTH_NEW_WEIGHT', DEFAULT_BEAT_ENGINE_OPTIONS.bpmSmoothNewWeight),
    audioSilenceThreshold:
      parseNonNegativeNumber(
        'AUDIO_SILENCE_THRESHOLD',
        DEFAULT_BEAT_ENGINE_OPTIONS.audioSilenceThreshold
      ),
    silentBpm:
      parsePositiveNumber('BEAT_SILENT_BPM', DEFAULT_BEAT_ENGINE_OPTIONS.silentBpm),
    silenceTimeoutSec:
      parsePositiveNumber(
        'AUDIO_SILENCE_TIMEOUT_SEC',
        DEFAULT_BEAT_ENGINE_OPTIONS.silenceTimeoutSec
      )
  }
}

module.exports = {
  DEFAULT_BEAT_ENGINE_OPTIONS,
  loadBeatEngineConfig
}
