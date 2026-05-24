require('dotenv').config()
const { createBeatEngine } = require('./beatEngine')
const { loadBeatEngineConfig } = require('./beatEngineConfig')

console.error('Listening to microphone... Play some music!')
console.error('Beat/sync events → stdout (JSON lines).')

function emitEvent (event) {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

const engine = createBeatEngine(
  {
    onSync (event) {
      emitEvent({ type: 'sync', ...event })
    },
    onBeat (event) {
      emitEvent({ type: 'beat', ...event })
    },
    onBpm (event) {
      emitEvent({ type: 'bpm', ...event })
    },
    onAudioLevel (level) {
      console.error(
        `rms=${level.rms} smoothed=${level.smoothed} threshold=${level.threshold} silent=${level.silent} belowMs=${level.belowThresholdMs}`
      )
    },
    onError (err) {
      console.error('Microphone stream error:', err)
      process.exit(1)
    }
  },
  loadBeatEngineConfig()
)

engine.start()

process.on('SIGINT', () => {
  engine.stop()
  process.exit(0)
})
