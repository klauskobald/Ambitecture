# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project: Ambitecture

A distributed framework for live orchestration of physical environments — lights, DMX hardware, and spatial objects. The system decouples creative **intent** (spatial color/light positions in CIE 1931 $xyY$) from hardware **execution** (DMX, LED, etc.).

**Hard deadline:** May 20, 2026 (live show).

---

## Module Layout

```
modules/
  hub/               — Central authority: HTTP API, WebSocket server, web GUI
  renderers/         — Hardware output drivers (e.g. DMX)
  controllers/       — Operator UIs / trigger surfaces
var/
  fixtures/          — Fixture profile YAML definitions
  projects/          — Project/zone/fixture assignment YAML
```

Each module is self-contained with its own `package.json`. There is no monorepo tooling or root-level build.

---

## Hub (`modules/hub`)

### Dev commands

```bash
cd modules/hub
npm install
npm run dev          # ts-node --respawn (auto-reload on change)
npm run start        # ts-node (one-shot)
npm run build        # tsc (compile to dist/)
npm run typecheck    # tsc --noEmit
```

### Running with a config profile

```bash
cd modules/hub
cp .env.DEMO .env    # points CONFIG_PATH at config.DEMO/
npm run dev
```

### Config system

`Config` (`src/Config.ts`) loads YAML from the directory in `CONFIG_PATH` env (default `config/`). Usage:

```ts
const cfg = new Config('server');          // loads CONFIG_PATH/server.yml
cfg.get<number>('LISTEN_PORT');            // dot-notation
cfg.getOrDefault('LISTEN_HOST', '127.0.0.1');
cfg.subscribeToChanges(cb);               // hot-reload via fs.watch
```

String values can reference other configs: `CONFIG:env:MY_KEY` — resolved at load time.

`FsStorage` (`src/FsStorage.ts`) provides a simple key/file store rooted at `system.yml > dataDir`. It auto-creates directories. `setItem` supports optional debounce.

### TypeScript setup

- Strict mode + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
- CommonJS output targeting ES2020.
- `ts-node` is the runtime — no compiled output needed for development.
- **Types must be declared in the module where they belong. No shared `types.d.ts` files.**

---

## Web GUI (`hub/public`)

The hub will serve its own setup GUI from `hub/public` as a static SPA.

- **Vanilla JS only — no frameworks, no bundler, no build step.**
- **Mobile-first layout, fully responsive.**
- Routes: `GET /api/*` (REST), `GET /ws` (WebSocket), all other routes → `hub/public/index.html`.
- CSS must be split by concern: `layout.css`, `controls.css`, `theme.css` (CSS variables for a dark base theme).
- HTML: semantic structure only; no inline styles; use global class names.
- Pane-based navigation — switch sections without full page reloads.

### Renderer setup panes (remote-provided HTML)

When a renderer connects it announces setup pane identifiers. The hub fetches HTML snippets via WebSocket and injects them into the GUI. User actions in the injected pane are forwarded back through the hub to the renderer.

---

## WebSocket Protocol

All module connections are long-lived and self-healing.

### Compression

The hub enables `perMessageDeflate` with a threshold of 1024 bytes — messages smaller than that (heartbeats, acks) are sent uncompressed automatically. Compression is negotiated at the WS handshake level, so constrained clients (ESP32, etc.) that don't offer the extension simply get uncompressed frames. No application-level logic needed.

```ts
new WebSocketServer({
  perMessageDeflate: { threshold: 1024 }
});
```

### Heartbeat contract
- `ping`/`pong` every 10 s.
- Missing heartbeat beyond timeout = dead connection.

### Reconnect behavior
- Reconnect immediately on close/error/heartbeat failure.
- Infinite retry (optional backoff); never "give up."
- After reconnect, module re-registers identity + capabilities and waits for fresh config.

### Message envelope

Every WebSocket message uses this unified shape:

```json
{
  "message": {
    "type": "<message-type>",
    "location": [8.5417, 47.3769],
    "payload": {}
  }
}
```

`type` is the sole routing key — no switch/case needed, just a handler map keyed by `type`. `location` is optional for non-spatial messages (e.g. `ping`/`pong`).

### Message types

**`register`** — module → hub on connect:

```json
{
  "message": {
    "type": "register",
    "location": [8.5417, 47.3769],
    "payload": {
      "role": "renderer",
      "guid": "renderer-1234567890",
      "positionOrigin": [0, 0, 0],
      "boundingBox": [0, 0, 0, 10, 5, 3]
    }
  }
}
```

Controllers use `role: "controller"` and include `scope` (rooms/areas) instead of `boundingBox`.

**`events`** — hub → renderer:

```json
{
  "message": {
    "type": "events",
    "location": [8.5417, 47.3769],
    "payload": [
      {
        "class": "light",
        "scheduled": 1767225600000,
        "position": [1.2, 0.0, -3.5],
        "params": {
          "color": { "x": 0.32, "y": 0.34, "Y": 0.8 },
          "layer": 100,
          "blend": "ADD",
          "alpha": 1
        }
      }
    ]
  }
}
```

**`config`** — hub → renderer/controller:

```json
{
  "message": {
    "type": "config",
    "location": [8.5417, 47.3769],
    "payload": { "...": "config data" }
  }
}
```

**`ping`** / **`pong`** — heartbeat (no `location` or `payload` needed):

```json
{ "message": { "type": "ping" } }
{ "message": { "type": "pong" } }
```

### Field semantics
- `location`: coarse `[lon, lat]` — sender's geo context.
- `position` (inside an event): local XYZ relative to `location` anchor.
- `class` (inside an event): event kind — routes to the correct event handler on the renderer.
- `layer`: compositing priority; higher wins.
- `blend`: `ADD` | `ALPHA` | `MULTIPLY` — how overlapping layers combine.
- `scheduled`: renderer-side execution timestamp (ms); renderers buffer timed sequences locally.

---

## Color: CIE 1931 $xyY$

All color in the system is expressed as `{ x, y, Y }` (CIE 1931):
- `x`, `y` — chromaticity (device-independent hue/saturation).
- `Y` — luminance (perceived brightness).

Renderers convert $xyY$ → device RGB using their gamut map. If a requested $xy$ is outside a fixture's gamut, the renderer snaps to the nearest point on the spectral locus.

Blending: additive mixing sums `Y` values and takes weighted average of `xy`.

---

## Projects and Fixtures

- **Fixtures** (`var/fixtures/*.yml`): define DMX channel → function mappings and class (e.g. `dmx_light_static`).
- **Projects** (`var/projects/*.yml`): define zones, each bound to a `rendererGUID`, with fixture instances carrying `location`, `target`/`rotation`, and `range`.
- `server.yml` keys `projectsPath`, `fixturesPath`, `defaultProject` tell the hub where to load data from.
- At runtime the hub loads `defaultProject` and pushes zone + fixture data to matching renderers on connect.

---

## Service Self-Healing

All server-side processes must be supervised:
- Restart immediately on crash.
- No max-retry limit — never enter a permanent failure state.
- On restart: reload config, restore WebSocket subscriptions, resume operation automatically.

---

## Conventions

- **No generic `types.d.ts`.** Types are declared inside the module file where they are used.
- **No framework or bundler** for the web GUI. Plain HTML + CSS + JS, served directly.
- **Mobile-first CSS.** Base styles target small screens; breakpoints add desktop layout.
- Config in YAML (not hardcoded). Listen port/host always come from `server.yml`.
- `Logger` (`src/Logger.ts`) is the shared logging utility for hub-side code.
- **Modules are self-contained.** No `../../` cross-module imports. Duplication is acceptable for now — shared utilities will be extracted into a proper shared package later.

---

## Coding Style

### Structure and dispatch

- Entry points (`index.ts`, `main.js`) are thin orchestrators — they wire things up and delegate; no business logic lives there.
- Each WebSocket message type is handled by a dedicated class/file. The entry point routes by `type` using a handler map, never inline logic.
- Event classes (`class: "light"`, etc.) are **imported dynamically** so new event types can be added without touching the dispatcher.

```ts
// dynamic event dispatch example
const handler = await import(`./events/${event.class}Event`);
handler.default.handle(event);
```

### Interfaces and types

- Define proper interfaces or class hierarchies wherever the shape of data is non-trivial. Don't use anonymous object types for anything that crosses a function boundary.

### Helper files

- Formatting, color math (CIE conversions, gamut mapping), geo/spatial math, and DMX utilities each live in their own reusable file or class. No ad-hoc helpers scattered in business logic files.

### Function design

- Keep functions small and single-purpose. Prefer more functions with long, descriptive names over fewer large ones.
- Use `switch`/`case` for any multi-branch dispatch on a discriminator value. Avoid `if / else if / else` chains.
- Break complex boolean expressions into named constants before using them:

```ts
const isWithinRange = position.x > bounds.x0 && position.x < bounds.x1;
const isActiveLayer  = event.params.layer >= currentLayer;
if (isWithinRange && isActiveLayer) { ... }
```
