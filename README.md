# Ambitecture

**Author:** Klaus P Kobald GmbH  
**Website:** [https://kobald.com](https://kobald.com)

Distributed framework for live orchestration of physical environments (lights, DMX hardware, and spatial objects), with creative intent decoupled from hardware execution.

Ambitecture is open source and currently focused on production readiness for a live show deadline on **May 20, 2026**.

## Repository Layout

```text
modules/
  hub/                 Central authority (WebSocket/HTTP, config/project distribution)
  renderers/dmx-ts/    DMX renderer implementation (TypeScript)
  controllers/         Controller modules (scaffold for now)
var/
  projects/            Project and zone definitions (YAML)
  fixtures/            Fixture profiles (YAML)
```

Each module is self-contained with its own `package.json` and scripts.

## Current Runtime Model

- Hub and renderer are both TypeScript-first runtimes using `ts-node`.
- The hub accepts WebSocket clients and routes messages by `message.type`.
- Current hub runtime is WebSocket-first; REST endpoints and static `public` serving are target surface and not yet wired.
- Renderers self-register, receive project-derived fixture config, and process event streams.
- Event color payloads are normalized to CIE 1931 `xyY` in the hub before forwarding.
- Renderer side uses a scheduled event queue and dynamic fixture class loading.

## WebSocket Message Envelope

All module messages use one envelope:

```json
{
  "message": {
    "type": "events",
    "location": [8.5417, 47.3769],
    "payload": {}
  }
}
```

Common message types in the current code:

- `register`: module announces role and identity
- `config`: hub -> renderer project/fixture assignment
- `events`: controller/hub -> renderer timed event batches

## Color Pipeline (Current)

- Internal exchange color format is CIE 1931 `xyY`.
- Hub accepts multiple input formats and converts to `xyY`:
  - `{ x, y, Y }`
  - `{ rgb: "#112233" }`
  - `{ rgb: [r, g, b] }`
  - `{ r, g, b }`
- Renderer converts `xyY` to RGB for DMX channel output.

## Quick Start

### 1) Start Hub

```bash
cd modules/hub
npm install
cp .env.DEMO .env
npm run dev
```

`.env.DEMO` sets:

```env
CONFIG_PATH=./config.DEMO
```

The default demo server config is in `modules/hub/config.DEMO/server.yml` and points at:

- `var/projects`
- `var/fixtures`
- default project `test`

### 2) Start DMX Renderer

```bash
cd modules/renderers/dmx-ts
npm install
npm run dev
```

Renderer settings come from environment variables (examples):

- `AMBITECTURE_HUB_URL` (default `http://localhost:3000`, converted to `ws://...`)
- `GUID`
- `GEO_LOCATION`
- `POSITION_ORIGIN`
- `BOUNDING_BOX`
- `DMX_DRIVER`
- `DMX_DEVICE`
- `DMX_UNIVERSE`
- `DMX_FRAME_RATE`

## Module Commands

### `modules/hub`

```bash
npm run start      # one-shot ts-node run
npm run dev        # watch mode
npm run build      # tsc compile
npm run typecheck  # tsc --noEmit
```

### `modules/renderers/dmx-ts`

```bash
npm run start      # one-shot ts-node run
npm run dev        # watch mode
npm run typecheck  # tsc --noEmit
```

## Project + Fixture Config Flow

- Project YAML (`var/projects/*.yml`) defines zones, target renderer GUID, and fixture instances.
- Fixture profile YAML (`var/fixtures/*.yml`) defines fixture class and DMX channel-function mappings.
- On renderer registration, hub builds renderer-specific config and sends `message.type = "config"`.
- Hub watches project and referenced fixture files and pushes updated config after reload.

Demo files:

- `var/projects/test.yml`
- `var/fixtures/rgb_simple.yml`

## Integration Test Runner (Hub)

Integration tests in `modules/hub/tests` are runnable via:

```bash
cd modules/hub
ts-node tests/runtest.ts
```

Run one test:

```bash
ts-node tests/runtest.ts 001-blinker.ts --timeout 10
```

Config source:

- `modules/hub/config.DEMO/test.yml`

`001-blinker.ts` acts as a controller client, registers via WebSocket, and sends timed event batches.

## Resilience Notes

- Hub WebSocket server heartbeat:
  - ping every 10s
  - terminate if pong timeout exceeds 15s
- Hub enables `perMessageDeflate` (threshold 1024 bytes).
- Renderer reconnects to hub immediately after close/error.
- DMX universe driver includes recovery logic and automatic reconnect retries on device/driver failures.

## Contributing

Contributions are welcome. Keep module boundaries clear and prefer module-local types/utilities over shared global type files while the architecture is still stabilizing.
