const recorder = require('node-record-lpcm16')
const Meyda = require('meyda')
const {
  DEFAULT_BEAT_ENGINE_OPTIONS,
  loadBeatEngineConfig
} = require('./beatEngineConfig')

const SAMPLE_RATE = 44100
const BUFFER_SIZE = 512
const BYTES_PER_FRAME = BUFFER_SIZE * 2
const HOP_DURATION_SEC = BUFFER_SIZE / SAMPLE_RATE

Meyda.bufferSize = BUFFER_SIZE
Meyda.sampleRate = SAMPLE_RATE

function roundSec (n) {
  return Math.round(n * 1000) / 1000
}

function roundBpm (n) {
  return Math.round(n * 10) / 10
}

function roundLevel (n) {
  return Math.round(n * 100000) / 100000
}

function mean (arr) {
  if (arr.length === 0) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function stddev (arr) {
  if (arr.length < 2) return 0
  const m = mean(arr)
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length
  return Math.sqrt(variance)
}

function frameRms (frame) {
  if (frame.length === 0) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) {
    sum += frame[i] * frame[i]
  }
  return Math.sqrt(sum / frame.length)
}

function pcm16BufferToFloat32 (pcmBytes) {
  const float32Array = new Float32Array(pcmBytes.length / 2)
  for (let i = 0; i < float32Array.length; i++) {
    const pcm16 = pcmBytes.readInt16LE(i * 2)
    float32Array[i] = pcm16 / 32768.0
  }
  return float32Array
}

function halfWaveRectifiedSpectralFlux (currentSpectrum, previousSpectrum) {
  let flux = 0
  for (let i = 0; i < currentSpectrum.length; i++) {
    const delta = currentSpectrum[i] - previousSpectrum[i]
    flux += (delta + Math.abs(delta)) / 2
  }
  return flux
}

/**
 * @param {{
 *   onSync: (event: { t: number, audioT: number, bpm: number, phaseAdjustMs: number, reason: 'onset' | 'bar' }) => void,
 *   onBeat?: (event: { t: number, audioT: number, beat: number, bpm: number, source: string }) => void,
 *   onBpm?: (event: { t: number, audioT: number, bpm: number, prevBpm: number }) => void,
 *   onError?: (err: Error) => void,
 * }} handlers
 * @param {import('./beatEngine').BeatEngineOptions} [optionOverrides]
 * @returns {{ start: () => void, stop: () => void }}
 */
function createBeatEngine (handlers, optionOverrides = {}) {
  const cfg = {
    ...DEFAULT_BEAT_ENGINE_OPTIONS,
    ...loadBeatEngineConfig(),
    ...optionOverrides
  }

  const maxOdfSamples = Math.floor(cfg.odfBufferDurationSec / HOP_DURATION_SEC)

  let odfHistory = []
  let pcmRemainder = Buffer.alloc(0)
  let previousAmpSpectrum = null

  let audioTimeSec = 0
  let currentLiveBPM = cfg.initialBpm
  let beatGridOriginSec = null
  let lastEmittedBeatIndex = -1
  let lastOnsetAudioTimeSec = -Infinity
  let lastBpmUpdateTime = 0
  let beatsSinceLastSync = 0
  let smoothedAudioLevel = 0
  let lastFrameRms = 0
  let isSilent = false
  let belowThresholdSinceMs = null
  let lastSilentSyncTime = 0
  let lastAudioLevelReportTime = 0

  let recording = null
  let inputStream = null

  const AUDIO_LEVEL_SMOOTHING = 0.92
  const silenceTimeoutMs = cfg.silenceTimeoutSec * 1000

  function syncBpm () {
    return isSilent ? cfg.silentBpm : currentLiveBPM
  }

  function beatPeriodSec () {
    return 60 / currentLiveBPM
  }

  function nearestBeatAudioTimeSec (t) {
    const period = beatPeriodSec()
    const n = Math.round((t - beatGridOriginSec) / period)
    return beatGridOriginSec + n * period
  }

  function notifySync (anchorAudioTimeSec, phaseAdjustSec, reason) {
    handlers.onSync({
      t: Date.now(),
      audioT: roundSec(anchorAudioTimeSec),
      bpm: roundBpm(syncBpm()),
      phaseAdjustMs: Math.round(phaseAdjustSec * 1000),
      reason
    })
    beatsSinceLastSync = 0
  }

  function enterSilentMode () {
    isSilent = true
    beatGridOriginSec = null
    lastEmittedBeatIndex = -1
    beatsSinceLastSync = 0
    notifySync(audioTimeSec, 0, 'bar')
    lastSilentSyncTime = Date.now()
  }

  function exitSilentMode () {
    isSilent = false
    belowThresholdSinceMs = null
    beatGridOriginSec = null
    lastEmittedBeatIndex = -1
    beatsSinceLastSync = 0
    lastOnsetAudioTimeSec = -Infinity
  }

  function belowThresholdDurationMs (now) {
    if (belowThresholdSinceMs === null) return 0
    return now - belowThresholdSinceMs
  }

  function reportAudioLevel () {
    const now = Date.now()
    handlers.onAudioLevel?.({
      rms: roundLevel(lastFrameRms),
      smoothed: roundLevel(smoothedAudioLevel),
      threshold: cfg.audioSilenceThreshold,
      silent: isSilent,
      belowThresholdMs: belowThresholdDurationMs(now)
    })
    lastAudioLevelReportTime = now
  }

  function maybeReportAudioLevel () {
    const now = Date.now()
    if (now - lastAudioLevelReportTime < cfg.bpmUpdateIntervalMs) return
    reportAudioLevel()
  }

  function updateSilenceState (frame) {
    const rms = frameRms(frame)
    const now = Date.now()
    lastFrameRms = rms
    smoothedAudioLevel =
      smoothedAudioLevel * AUDIO_LEVEL_SMOOTHING + rms * (1 - AUDIO_LEVEL_SMOOTHING)

    if (rms >= cfg.audioSilenceThreshold) {
      belowThresholdSinceMs = null
      if (isSilent) {
        exitSilentMode()
        reportAudioLevel()
      }
      return
    }

    if (belowThresholdSinceMs === null) {
      belowThresholdSinceMs = now
    }

    if (!isSilent && belowThresholdDurationMs(now) >= silenceTimeoutMs) {
      enterSilentMode()
      reportAudioLevel()
    }
  }

  function maybeNotifySilentSync () {
    if (!isSilent) return
    const now = Date.now()
    if (now - lastSilentSyncTime < cfg.bpmUpdateIntervalMs) return
    notifySync(audioTimeSec, 0, 'bar')
    lastSilentSyncTime = now
  }

  function notifyBeat (beatAudioTimeSec, beatIndex, source) {
    handlers.onBeat?.({
      t: Date.now(),
      audioT: roundSec(beatAudioTimeSec),
      beat: beatIndex,
      bpm: roundBpm(currentLiveBPM),
      source
    })
    beatsSinceLastSync += 1
    if (beatsSinceLastSync >= cfg.syncBarBeats) {
      notifySync(beatAudioTimeSec, 0, 'bar')
    }
  }

  function alignBeatCursorToPresent () {
    if (beatGridOriginSec === null) return
    const period = beatPeriodSec()
    const idx = Math.floor((audioTimeSec - beatGridOriginSec) / period) - 1
    lastEmittedBeatIndex = Math.max(lastEmittedBeatIndex, idx)
  }

  function markBeatIndexEmitted (beatIndex) {
    lastEmittedBeatIndex = Math.max(lastEmittedBeatIndex, beatIndex)
  }

  function detectOnsetAtEnd () {
    const len = odfHistory.length
    if (len < 3) return false

    const prev = odfHistory[len - 3]
    const curr = odfHistory[len - 2]
    const next = odfHistory[len - 1]
    if (!(curr > prev && curr > next)) return false

    const onsetAudioTimeSec = audioTimeSec - HOP_DURATION_SEC
    if (onsetAudioTimeSec - lastOnsetAudioTimeSec < cfg.onsetMinGapSec) return false

    const windowStart = Math.max(0, len - cfg.onsetFluxWindow)
    const window = odfHistory.slice(windowStart, len - 1)
    const threshold = mean(window) + cfg.onsetFluxSigma * stddev(window)
    if (curr < threshold) return false

    lastOnsetAudioTimeSec = onsetAudioTimeSec
    return onsetAudioTimeSec
  }

  function trySyncPhaseToOnset (onsetAudioTimeSec, reason) {
    if (beatGridOriginSec === null) {
      beatGridOriginSec = onsetAudioTimeSec
      markBeatIndexEmitted(0)
      notifySync(onsetAudioTimeSec, 0, reason)
      return true
    }

    const nearest = nearestBeatAudioTimeSec(onsetAudioTimeSec)
    const phaseErrorSec = onsetAudioTimeSec - nearest
    if (Math.abs(phaseErrorSec) > cfg.syncToleranceSec) return false

    beatGridOriginSec += phaseErrorSec
    const period = beatPeriodSec()
    const beatIdx = Math.round((onsetAudioTimeSec - beatGridOriginSec) / period)
    markBeatIndexEmitted(beatIdx)
    notifySync(onsetAudioTimeSec, phaseErrorSec, reason)
    return true
  }

  function schedulePastBeats () {
    if (beatGridOriginSec === null) return

    const period = beatPeriodSec()
    while (true) {
      const nextIndex = lastEmittedBeatIndex + 1
      const nextBeatTime = beatGridOriginSec + nextIndex * period
      if (audioTimeSec < nextBeatTime) break

      notifyBeat(nextBeatTime, nextIndex, 'grid')
      lastEmittedBeatIndex = nextIndex
    }
  }

  function calculateLiveTempo () {
    if (odfHistory.length < maxOdfSamples / 2) return

    const N = odfHistory.length
    const r = new Float32Array(N)

    for (let lag = 0; lag < N; lag++) {
      let sum = 0
      for (let i = 0; i < N - lag; i++) {
        sum += odfHistory[i] * odfHistory[i + lag]
      }
      r[lag] = sum
    }

    const minLag = Math.floor(60 / cfg.bpmMax / HOP_DURATION_SEC)
    const maxLag = Math.floor(60 / cfg.bpmMin / HOP_DURATION_SEC)

    let maxVal = -1
    let bestLag = -1

    for (let lag = minLag; lag < Math.min(maxLag, r.length); lag++) {
      if (r[lag] > maxVal && r[lag] > r[lag - 1] && r[lag] > r[lag + 1]) {
        maxVal = r[lag]
        bestLag = lag
      }
    }

    if (bestLag !== -1) {
      const detectedPeriod = bestLag * HOP_DURATION_SEC
      const rawBpm = 60 / detectedPeriod
      const keepWeight = 1 - cfg.bpmSmoothNewWeight
      currentLiveBPM = currentLiveBPM * keepWeight + rawBpm * cfg.bpmSmoothNewWeight
    }
  }

  function onBpmChanged (prevBpm) {
    if (beatGridOriginSec === null) return
    if (Math.abs(currentLiveBPM - prevBpm) < 0.5) return

    const period = beatPeriodSec()
    const beatsElapsed = Math.max(0, lastEmittedBeatIndex + 1)
    beatGridOriginSec =
      beatGridOriginSec + beatsElapsed * period - beatsElapsed * (60 / prevBpm)
    alignBeatCursorToPresent()
    handlers.onBpm?.({
      t: Date.now(),
      audioT: roundSec(audioTimeSec),
      bpm: roundBpm(currentLiveBPM),
      prevBpm: roundBpm(prevBpm)
    })
  }

  function processAudioFrame (frame) {
    updateSilenceState(frame)
    if (isSilent) {
      audioTimeSec += HOP_DURATION_SEC
      maybeNotifySilentSync()
      maybeReportAudioLevel()
      return
    }

    const features = Meyda.extract(['amplitudeSpectrum'], frame)
    if (!features) return

    const ampSpectrum = features.amplitudeSpectrum
    if (!previousAmpSpectrum) {
      previousAmpSpectrum = ampSpectrum.slice()
      return
    }

    const spectralFlux = halfWaveRectifiedSpectralFlux(
      ampSpectrum,
      previousAmpSpectrum
    )
    previousAmpSpectrum = ampSpectrum.slice()

    audioTimeSec += HOP_DURATION_SEC

    odfHistory.push(spectralFlux)
    if (odfHistory.length > maxOdfSamples) {
      odfHistory.shift()
    }

    const onsetTime = detectOnsetAtEnd()
    if (onsetTime !== false) {
      trySyncPhaseToOnset(onsetTime, 'onset')
    }

    schedulePastBeats()

    const now = Date.now()
    if (now - lastBpmUpdateTime >= cfg.bpmUpdateIntervalMs) {
      const prevBpm = currentLiveBPM
      calculateLiveTempo()
      onBpmChanged(prevBpm)
      lastBpmUpdateTime = now
    }

    maybeReportAudioLevel()
  }

  function start () {
    recording = recorder.record({
      sampleRate: SAMPLE_RATE,
      channels: 1,
      audioType: 'raw'
    })
    inputStream = recording.stream()

    inputStream.on('data', chunk => {
      pcmRemainder = Buffer.concat([pcmRemainder, chunk])

      while (pcmRemainder.length >= BYTES_PER_FRAME) {
        const frameBytes = pcmRemainder.subarray(0, BYTES_PER_FRAME)
        pcmRemainder = pcmRemainder.subarray(BYTES_PER_FRAME)
        processAudioFrame(pcm16BufferToFloat32(frameBytes))
      }
    })

    inputStream.on('error', err => {
      const error = err instanceof Error ? err : new Error(String(err))
      handlers.onError?.(error)
    })
  }

  function stop () {
    recording?.stop()
    recording = null
    inputStream = null
  }

  return { start, stop }
}

module.exports = { createBeatEngine }
