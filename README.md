# Ambitecture

**Author:** Klaus P Kobald GmbH  
**Website:** [https://kobald.com](https://kobald.com)

Distributed framework for live orchestration of physical environments (lights, DMX hardware, and spatial objects), with creative intent decoupled from hardware execution.

Ambitecture is open source and currently focused on production readiness for a live show deadline on **May 20, 2026**.

## Repository Layout

```text
modules/
  hub/                 Central authority (WebSocket, config/project distribution)
  deliver/             Allowlisted static HTTP host for browser-only UIs (deliver.yml mounts)
  renderers/dmx-ts/    DMX renderer implementation (TypeScript)
  renderers/simulator-2d/ Browser renderer (2D simulator)
  controllers/web-test/ Browser controller test surface
var/
  projects/            Project and zone definitions (YAML)
  fixtures/            Fixture profiles (YAML)
```

Not every module has a Node package. `hub`, `renderers/dmx-ts`, and `deliver` have `package.json`; browser modules are static HTML/JS.

## What You Can Build

Ambitecture is intentionally modular: you can pair many controller types with many renderer types.

- **Controllers** can be touch UIs, automation surfaces, timelines, or sensor-driven tools.
- **Renderers** can be DMX fixtures, visual simulators, or custom output protocols.
- **Hub** keeps shared project + intent state, distributes runtime config, and emits renderer-facing events from controller intents.
- **Deliver** is an optional static host for browser-based controllers/renderers.

Detailed protocol and runtime internals live in [SYSTEM-ARCHITECTURE.md](SYSTEM-ARCHITECTURE.md).

## Example: Fixture Profile

`var/fixtures/rgb_simple.yml` defines a reusable fixture capability:

- Class: `dmx_light_static`
- DMX channel/function mapping for `brightness`, `red`, `green`, `blue`, and strobe functions
- This profile can be reused by many fixture instances in different zones/projects

## Example: Project Scene

`var/projects/test.yml` shows how a scene is assembled:

- **Zone to renderer mapping** (`zone-to-renderer`) routes one zone to one or more renderer GUIDs
- **Controller presets/intents** define interactive defaults (for example layered light colors)
- **Fixture instances** reference fixture profiles (`fixture: rgb_simple`) and define spatial placement:
  - `location`, `target`/`rotation`, `range`
  - DMX instance binding via `params.dmxBaseChannel`

This is the core pattern: profiles define what a fixture can do, projects define where and when it is used.

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
- `BOUNDING_BOX`
- `DMX_DRIVER`
- `DMX_DEVICE`
- `DMX_UNIVERSE`
- `DMX_FRAME_RATE`

### 3) Optional: static web UIs (`deliver`)

Use when you want browser apps (for example the 2D simulator under `modules/renderers/simulator-2d`) on one origin without each folder running its own server:

```bash
cd modules/deliver
npm install
npm start
```

Then open browser modules from mounted paths (defaults from `modules/deliver/deliver.yml`):

- `http://127.0.0.1:8080/simulator-2d/`
- `http://127.0.0.1:8080/controller-test/`

Mounts and listen address/port are defined in `modules/deliver/deliver.yml`. Override with `DELIVER_CONFIG` or `node src/index.js --config /path/to/deliver.yml`.

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

### `modules/deliver`

```bash
npm start   # node src/index.js
npm run dev # node --watch src/index.js
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

`001-blinker.ts` acts as a controller client, registers via WebSocket, and sends timed intent batches.

## Intent Workflow

- Controllers send `message.type = "intents"` to the hub (not direct renderer `events`).
- Hub updates per-controller intent state and includes that state in controller `config` payloads.
- Hub normalizes intent color into CIE 1931 `xyY`, converts relative `scheduled` offsets into absolute times, and queues renderer-facing `events`.
- Renderers consume queued `events` and apply them through their layer/capability engines.

## Resilience Notes

- Hub uses WebSocket heartbeat supervision and compression.
- DMX and simulator renderers reconnect automatically after close/error.
- DMX universe driver includes recovery logic and reconnect retries on device/driver failures.

## Contributing

Contributions are welcome. Keep module boundaries clear and prefer module-local types/utilities over shared global type files while the architecture is still stabilizing.
