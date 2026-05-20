/**
 * Same-layer ALPHA peers add, then composite over lower layers.
 * Run: `node tests/unit/layerIntentColorCompositing.mjs` from modules/renderers/simulator-2d
 */
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '../..')
const src = (p) => readFileSync(join(root, p), 'utf8')

const ctx = { console, Math, performance: { now: () => 0 } }
createContext(ctx)

function load (path, exportName) {
  runInContext(`${src(path)}\nglobalThis.${exportName} = ${exportName};`, ctx)
}

load('src/color.js', 'Color')
load('src/Vector3.js', 'Vector3')
load('src/FnCurve.js', 'FnCurve')
load('src/layerIntent/LayerIntentEngine.js', 'LayerIntentEngine')

function assert (cond, msg) {
  if (!cond) throw new Error(msg)
}

const RED = { x: 0.64, y: 0.33, Y: 1 }
const GREEN = { x: 0.3, y: 0.6, Y: 1 }
const BLUE = { x: 0.15, y: 0.06, Y: 1 }

const engine = new ctx.LayerIntentEngine()
const zone = { name: 'z', bbox: [0, 0, 0, 10, 10, 10], extend: 0, fixtures: [] }
const ev = (guid, layer, color) => ({
  guid,
  class: 'light',
  layer,
  params: { color, blend: 'ALPHA', alpha: 1 }
})

engine.applyEvent(ev('blue', 100, BLUE), [zone])
engine.applyEvent(ev('red', 150, RED), [zone])
engine.applyEvent(ev('green', 150, GREEN), [zone])

const context = {
  fixture: { name: 'f', location: [5, 5, 5], range: 10, params: {} },
  fixtureWorldPos: [5, 5, 5],
  zoneName: 'z'
}

const mixed = engine.sample(context, 'light.color.xyY', false)
assert(mixed !== undefined, 'expected mixed color')

const { r, g, b } = mixed.toRGB()
assert(
  r > 0.85 && g > 0.85 && b < 0.15,
  `expected yellow RGB, got r=${r} g=${g} b=${b}`
)

console.log('layerIntentColorCompositing: ok')
