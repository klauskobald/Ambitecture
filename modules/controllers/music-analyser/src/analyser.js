const recorder = require('node-record-lpcm16')
const Meyda = require('meyda')

const SAMPLE_RATE = 44100
const BUFFER_SIZE = 512
const BYTES_PER_FRAME = BUFFER_SIZE * 2
const HOP_DURATION_SEC = BUFFER_SIZE / SAMPLE_RATE

Meyda.bufferSize = BUFFER_SIZE
Meyda.sampleRate = SAMPLE_RATE

const ODF_BUFFER_DURATION_SEC = 6
const MAX_ODF_SAMPLES = Math.floor(ODF_BUFFER_DURATION_SEC / HOP_DURATION_SEC)

const SYNC_TOLERANCE_SEC = 0.045
const ONSET_MIN_GAP_SEC = 0.12
const ONSET_FLUX_WINDOW = 48
const ONSET_FLUX_SIGMA = 1.4
const BPM_UPDATE_INTERVAL_MS = 1000
const DASHBOARD_INTERVAL_MS = 1000
const SYNC_BAR_BEATS = 4

let odfHistory = []
let pcmRemainder = Buffer.alloc(0)
let previousAmpSpectrum = null

let audioTimeSec = 0
let currentLiveBPM = 120
let beatGridOriginSec = null
let lastEmittedBeatIndex = -1
let lastOnsetAudioTimeSec = -Infinity
let lastBpmUpdateTime = 0
let lastDashboardTime = 0
// let lastAmpSpectrumForDashboard = null
let beatsSinceLastSync = 0

console.error('🎙️  Listening to microphone... Play some music!')
console.error('Beat/sync events → stdout (JSON lines). Status → stderr.')

const recording = recorder.record({
  sampleRate: SAMPLE_RATE,
  channels: 1,
  audioType: 'raw'
})

const inputStream = recording.stream()

function emitEvent (event) {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

function beatPeriodSec () {
  return 60 / currentLiveBPM
}

function nearestBeatAudioTimeSec (t) {
  const period = beatPeriodSec()
  const n = Math.round((t - beatGridOriginSec) / period)
  return beatGridOriginSec + n * period
}

function emitBeat (beatAudioTimeSec, beatIndex, source) {
  emitEvent({
    type: 'beat',
    t: Date.now(),
    audioT: roundSec(beatAudioTimeSec),
    beat: beatIndex,
    bpm: roundBpm(currentLiveBPM),
    source
  })
  beatsSinceLastSync += 1
  if (beatsSinceLastSync >= SYNC_BAR_BEATS) {
    emitSync(beatAudioTimeSec, 0, 'bar')
    beatsSinceLastSync = 0
  }
}

function emitSync (anchorAudioTimeSec, phaseAdjustSec, reason) {
  emitEvent({
    type: 'sync',
    t: Date.now(),
    audioT: roundSec(anchorAudioTimeSec),
    bpm: roundBpm(currentLiveBPM),
    phaseAdjustMs: Math.round(phaseAdjustSec * 1000),
    reason
  })
  beatsSinceLastSync = 0
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

function roundSec (n) {
  return Math.round(n * 1000) / 1000
}

function roundBpm (n) {
  return Math.round(n * 10) / 10
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

function detectOnsetAtEnd () {
  const len = odfHistory.length
  if (len < 3) return false

  const prev = odfHistory[len - 3]
  const curr = odfHistory[len - 2]
  const next = odfHistory[len - 1]
  if (!(curr > prev && curr > next)) return false

  const onsetAudioTimeSec = audioTimeSec - HOP_DURATION_SEC
  if (onsetAudioTimeSec - lastOnsetAudioTimeSec < ONSET_MIN_GAP_SEC) return false

  const windowStart = Math.max(0, len - ONSET_FLUX_WINDOW)
  const window = odfHistory.slice(windowStart, len - 1)
  const threshold = mean(window) + ONSET_FLUX_SIGMA * stddev(window)
  if (curr < threshold) return false

  lastOnsetAudioTimeSec = onsetAudioTimeSec
  return onsetAudioTimeSec
}

function trySyncPhaseToOnset (onsetAudioTimeSec, reason) {
  if (beatGridOriginSec === null) {
    beatGridOriginSec = onsetAudioTimeSec
    markBeatIndexEmitted(0)
    emitSync(onsetAudioTimeSec, 0, reason)
    return true
  }

  const nearest = nearestBeatAudioTimeSec(onsetAudioTimeSec)
  const phaseErrorSec = onsetAudioTimeSec - nearest
  if (Math.abs(phaseErrorSec) > SYNC_TOLERANCE_SEC) return false

  beatGridOriginSec += phaseErrorSec
  const period = beatPeriodSec()
  const beatIdx = Math.round((onsetAudioTimeSec - beatGridOriginSec) / period)
  markBeatIndexEmitted(beatIdx)
  emitSync(onsetAudioTimeSec, phaseErrorSec, reason)
  return true
}

function schedulePastBeats () {
  if (beatGridOriginSec === null) return

  const period = beatPeriodSec()
  while (true) {
    const nextIndex = lastEmittedBeatIndex + 1
    const nextBeatTime = beatGridOriginSec + nextIndex * period
    if (audioTimeSec < nextBeatTime) break

    emitBeat(nextBeatTime, nextIndex, 'grid')
    lastEmittedBeatIndex = nextIndex
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
  emitEvent({
    type: 'bpm',
    t: Date.now(),
    audioT: roundSec(audioTimeSec),
    bpm: roundBpm(currentLiveBPM),
    prevBpm: roundBpm(prevBpm)
  })
}

function processAudioFrame (frame) {
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
  // lastAmpSpectrumForDashboard = ampSpectrum

  audioTimeSec += HOP_DURATION_SEC

  odfHistory.push(spectralFlux)
  if (odfHistory.length > MAX_ODF_SAMPLES) {
    odfHistory.shift()
  }

  const onsetTime = detectOnsetAtEnd()
  if (onsetTime !== false) {
    trySyncPhaseToOnset(onsetTime, 'onset')
  }

  schedulePastBeats()

  const now = Date.now()
  if (now - lastBpmUpdateTime >= BPM_UPDATE_INTERVAL_MS) {
    const prevBpm = currentLiveBPM
    calculateLiveTempo()
    onBpmChanged(prevBpm)
    lastBpmUpdateTime = now
  }

  if (now - lastDashboardTime >= DASHBOARD_INTERVAL_MS) {
    printDashboard()
    lastDashboardTime = now
  }
}

function printDashboard () {
  const period = beatPeriodSec()
  let nextBeatInMs = null
  if (beatGridOriginSec !== null) {
    const nextBeatTime = beatGridOriginSec + (lastEmittedBeatIndex + 1) * period
    nextBeatInMs = Math.max(0, Math.round((nextBeatTime - audioTimeSec) * 1000))
  }

  console.error('\x1Bc')
  console.error('=========================================')
  console.error('🎵 LIVE RHYTHM')
  console.error('=========================================')
  console.error(`BPM: ${currentLiveBPM.toFixed(1)} | audioT: ${audioTimeSec.toFixed(2)}s`)
  console.error(
    `Grid: ${beatGridOriginSec === null ? 'waiting for onset' : `anchored @ ${beatGridOriginSec.toFixed(2)}s`}`
  )
  console.error(
    `Next beat in: ${nextBeatInMs === null ? '—' : `${nextBeatInMs} ms`} | beats emitted: ${lastEmittedBeatIndex + 1}`
  )
  // if (lastAmpSpectrumForDashboard) {
  //   const visualBins = lastAmpSpectrumForDashboard
  //     .slice(0, 10)
  //     .map(v => v.toFixed(2))
  //   console.error(`FFT bins: [ ${visualBins.join(' | ')} ... ]`)
  // }
}

inputStream.on('data', chunk => {
  pcmRemainder = Buffer.concat([pcmRemainder, chunk])

  while (pcmRemainder.length >= BYTES_PER_FRAME) {
    const frameBytes = pcmRemainder.subarray(0, BYTES_PER_FRAME)
    pcmRemainder = pcmRemainder.subarray(BYTES_PER_FRAME)
    processAudioFrame(pcm16BufferToFloat32(frameBytes))
  }
})

inputStream.on('error', err => {
  console.error('Microphone stream error:', err)
  process.exit(1)
})

process.on('SIGINT', () => {
  recording.stop()
  process.exit(0)
})

function calculateLiveTempo () {
  if (odfHistory.length < MAX_ODF_SAMPLES / 2) return

  const N = odfHistory.length
  const r = new Float32Array(N)

  for (let lag = 0; lag < N; lag++) {
    let sum = 0
    for (let i = 0; i < N - lag; i++) {
      sum += odfHistory[i] * odfHistory[i + lag]
    }
    r[lag] = sum
  }

  const minLag = Math.floor(60 / 180 / HOP_DURATION_SEC)
  const maxLag = Math.floor(60 / 60 / HOP_DURATION_SEC)

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
    currentLiveBPM = currentLiveBPM * 0.8 + rawBpm * 0.2
  }
}
