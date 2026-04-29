# System layout (`modules/`)

The `modules/` tree holds **runnable components** grouped by role: one central **hub**, many **renderers** (hardware or protocol outputs), **controllers** (operator UIs), and optionally **`deliver`** (static HTTP only for browser assets). Each folder is meant to be developed and run somewhat independently. For the product vision (Hub as conductor, spatial intent, CIE color), see the main [README.md](README.md).

---

## `modules/hub`

**Role:** Central process: configuration authority and real-time channel for controllers and renderers.

The hub is the **single source of truth** for system-wide configuration. It subscribes to configuration file changes (implemented in `src/Config.ts`) and is responsible for pushing effective config updates to all connected modules.

**Stack:** Node.js, TypeScript, `ts-node` (see `package.json`). Declared entry point is `src/index.ts`.

**What is in the tree today**

- **`src/Config.ts`** — Loads YAML from a config directory (`CONFIG_PATH` env, default `config/` under the process cwd), or a named `.yml` / `.yaml` path. Supports optional configs, dot-notation `get()`, `CONFIG:otherConfig:key` string indirection, and `fs.watch` reload with subscriber callbacks.
- **`src/Logger.ts`** — Shared logging.
- **`src/Server.ts`** — HTTP server + WebSocket server (`perMessageDeflate` enabled, heartbeat ping/pong supervision).
- **`src/MessageRouter.ts`** — Message dispatch by `message.type`.
- **`src/handlers/RegisterHandler.ts`** — Accepts `register`, stores module identity/metadata, pushes `config` to renderers and controllers, and emits `refresh` to controllers when renderer topology changes.
- **`src/handlers/EventsHandler.ts`** — Legacy/direct `events` forwarder kept for compatibility paths.
- **`src/handlers/IntentsHandler.ts`** — Accepts controller `intents`, updates controller intent state, normalizes color, schedules renderer-facing `events`, and syncs intent state to peer controllers.
- **`src/EventQueue.ts`** — Buckets/schedules generated renderer `events` by execution timestamp and dispatches to connected renderers.
- **`src/ProjectManager.ts`** — Loads project + referenced fixtures, watches files, builds renderer/controller config payloads, and keeps per-controller runtime intent cache.
- **Profile example:** `config.DEMO/server.yml` defines `LISTEN_PORT` and `LISTEN_HOST` (demo uses `3000` and `0.0.0.0`). Use `.env` / `.env.DEMO` to point `CONFIG_PATH` at a profile such as `config.DEMO`.

**Current runtime note:** The hub currently runs on Node's `http` server directly (not Express). WebSocket is attached to that server without a path restriction (not limited to `/ws` yet).

### Hub-hosted setup GUI

Status: **planned surface, mostly placeholder files today** (`public/index.html`, `public/main.js`, `public/styles.css` currently exist but are empty).

All setup should be possible through the hub's own web GUI, served from `hub/public`.

- Target routing (once HTTP layer is wired on the same server host/port):
  - `GET /api/*`: REST endpoints for CRUD-style operations and snapshots.
  - `GET /ws`: WebSocket endpoint for realtime updates, module sessions, and command forwarding.
  - Any non-API/non-WS route should serve frontend assets from `public` via a generic catch-all route (SPA-friendly).

The GUI should use a mobile-first layout with:

- a generic navigation shell
- pane-based sections (system, projects, fixtures, zones, modules, etc.)
- fast pane switching without full page reloads

### Renderer setup panes (remote-provided UI)

Status: **planned protocol direction**, not implemented in current hub handlers yet.

The GUI includes a pane for connected renderers and their specific setup tools.

When a renderer connects, it announces available setup pane identifiers (for example `usb-hardware`). Because renderers may only be reachable over WebSocket, the hub requests pane HTML snippets through the socket channel.

Flow:

1. Renderer connects and publishes capability metadata (including setup pane IDs).
2. Hub requests snippet content for a pane (for example `usb-hardware`) over the WebSocket channel (target route: `/ws` once path-restricted WS is wired).
3. Renderer returns the HTML snippet payload.
4. Hub injects/displays this snippet inside the renderer setup pane in the web GUI.
5. User actions in that pane are sent to the hub.
6. Hub validates/routes the command and forwards it to the target renderer over WebSocket.

---

## `modules/renderers`

**Role:** Programs that turn hub timing and intent into concrete outputs (DMX universes, devices, etc.). Add one subdirectory per renderer implementation.

**`renderers/dmx-ts/`** — TypeScript DMX renderer implementation (active runtime, not scaffold-only).

Current behavior:

- Connects to hub WebSocket, auto-reconnects immediately on close/error.
- Sends `register` payload as `role: "renderer"` with `guid`, `location`, and `boundingBox` (optional metadata until hub `config` is authoritative for spatial bounds).
- Handles `config` to cache fixtures and initialize DMX output.
- Handles `events` via an in-memory scheduled queue (`scheduled` timestamp aware).
- Dynamically loads fixture class handlers from `src/fixtures` based on fixture profile `class`.
- Writes DMX frames continuously at configured frame rate, with DMX recovery/reconnect logic.

Renderers receive configuration over WebSocket from the hub. In the common path this arrives immediately after renderer registration.

Renderer data authority model:

- The hub is always the source of truth for renderer-relevant data.
- A renderer may cache hub data in memory for operation/performance, but cache is non-authoritative.
- Renderer config is pushed from the hub (not locally self-authored at runtime).
- Event queues/state are kept in renderer memory for now (no persistent event store yet).

---

## `modules/controllers`

**Role:** Front ends and tools that send control intent/state to the hub.

**`controllers/web-test/`** — Static controller shell: [`index.html`](modules/controllers/web-test/index.html) embeds simulator-2d in an iframe, opens a WebSocket to the hub as **`role: controller`**, receives **`config`** (full project zones from [`ProjectManager.buildControllerConfig`](modules/hub/src/ProjectManager.ts)), and maps overlay touches to **meters inside the selected zone’s `boundingBox`** (see [`src/main.js`](modules/controllers/web-test/src/main.js)). Tunable layout lives in [`config.json`](modules/controllers/web-test/config.json) next to `index.html`.

---

## `modules/deliver`

**Role:** Optional **static HTTP host** for browser-only assets (HTML/CSS/JS). It does not participate in WebSocket routing or hub APIs; hub and renderers/controllers still connect to the hub the same way. Use it when you want one listen port and stable URL prefixes for tools that have no bundler or backend of their own.

**Stack:** Node.js, ESM (`"type": "module"`), `js-yaml`. No TypeScript build step.

**Configuration:** `modules/deliver/deliver.yml` (or another file via `DELIVER_CONFIG` or `node src/index.js --config <path>`). Each key under `mounts` is a public path segment; `root` is resolved relative to the YAML file’s directory. Only listed mounts are served.

**Behavior (v1):**

- `GET /` returns a small HTML index linking to known mounts.
- `GET /{mountId}` redirects to `GET /{mountId}/` so relative URLs in pages resolve correctly.
- `GET /{mountId}/…` serves files under that mount’s `root`, with path traversal rejected and `realpath` checks so resolved files cannot escape the mount directory.
- Requests for a directory with an `index.html` serve that file.

Example: a mount `simulator-2d` with `root` pointing at `modules/renderers/simulator-2d` serves the simulator at `http://<listen>/simulator-2d/`.

---

## General features

### Frontend markup and styling policy

All HTML should be intentionally minimal and mostly unstyled at module level.

- HTML should contain only semantic structure plus reusable global class names.
- Inline styles and module-local visual styling should be avoided by default.
- Visual design authority lives in the hub frontend styles under `hub/public`.

Stylesheets should be split by concern, for example:

- `layout` / positioning (flow, spacing, grid/flex helpers, pane sizing)
- form/input controls (buttons, inputs, selects, sliders, focus states)
- theme tokens (CSS variables for colors, typography, radii, shadows)

Initial baseline is a single dark theme. Theme values should be defined via variables so additional themes can be added later without changing component HTML.

### Global location model per module

Every renderer and controller module carries location metadata so the hub can make spatially scoped decisions. Current examples in repo configs include:

- `GEO_LOCATION` (planet-level reference point)
- `BOUNDING_BOX` (local 3D extent: `x0 y0 z0 x1 y1 z1`) for register metadata where needed; project zones carry **`boundingBox`** for scene layout; event `position` is local inside that zone box.

This metadata can be stored in module-local config (`.env`, JSON) and then treated as connection-time capabilities.

### Connection handshake and capability registration

When a module connects, it should announce its location/capability data to the hub.

- **Renderer -> Hub:** announces geo + optional `boundingBox` metadata + `guid`; spatial truth for the scene comes from hub **`config`** (project zones, each with `boundingBox`).
- **Controller -> Hub:** announces geo + `guid` + `scope` (rooms/areas); receives hub **`config`** with full project zone data including `boundingBox` and fixtures (view density such as `PIXEL_PER_METER` stays renderer-local).

The hub keeps this as authoritative runtime metadata and can update it if the module reconnects or republishes.

### Intent-to-event routing for renderers

Controllers submit `intents` to the hub. The hub updates controller intent state and converts those intents into scheduled renderer-facing `events` via the queue. Renderers then apply received events through a capability-based layer engine. In the current implementation, renderers keep intent state keyed by stable intent `guid` and fixtures sample capabilities from snapshots (`light.color.xyY`, `light.strobe`, `master.brightness`, `master.blackout`) instead of handling each event directly.

Hub pre-filtering by bounding box/location is intended optimization, not current default behavior. Current queue dispatch of generated `events` is broadcast to all connected renderers.

### Room and scope filtering for controllers

Controllers should eventually receive room/scope-filtered data based on announced metadata. This filtering is not implemented yet.

---

## Demo data and zone routing

The repository includes demo fixture/project data under `var/` that the hub can use as initial runtime content.

### Demo fixture definition

`var/fixtures/rgb_simple.yml` defines a simple RGB DMX fixture profile:

- Fixture class: `dmx_light_static`
- DMX channel mapping:
  - channel `0` -> `brightness`
  - channel `1` -> `red`
  - channel `2` -> `green`
  - channel `3` -> `blue`

### Demo project definition

`var/projects/test.yml` defines a project with zones and fixtures. In the sample:

- Project: `Test Project`
- Zone: `Zone 1`
- Bound renderer: `rendererGUID: renderer-1234567890`
- Fixture instance: references fixture profile `rgb_simple`
- Fixture spatial data includes `location`, `target` (or `rotation`), and `range`; DMX binding uses `params.dmxBaseChannel`.
- Range falloff curve is configured under `params.rangeFunction` (or alias `params.rangeFn`), not a top-level fixture field.

### Default project loading and sync

`modules/hub/config.DEMO/server.yml` sets:

- `projectsPath: ../../var/projects`
- `fixturesPath: ../../var/fixtures`
- `defaultProject: test`

At runtime, the hub loads `defaultProject` and treats its zone structure as authoritative scene assignment data. When a renderer connects (or when project/fixture data updates), the hub transfers relevant zone info plus referenced fixture profiles to matching renderer(s) by `rendererGUID`.

---

## Data schema

Every WebSocket message uses a unified envelope:

```json
{
  "message": {
    "type": "<message-type>",
    "location": [8.5417, 47.3769],
    "payload": {}
  }
}
```

`type` is the sole routing key — receivers use a handler map keyed by `type`. `location` is optional for non-spatial messages.

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
      "boundingBox": [0, 0, 0, 10, 5, 3]
    }
  }
}
```

Controllers use `role: "controller"` and include `scope` (rooms/areas) instead of `boundingBox`.

**`intents`** — controller → hub:

```json
{
  "message": {
    "type": "intents",
    "location": [8.5417, 47.3769],
    "payload": [
      {
        "guid": "intent-42",
        "class": "light",
        "scheduled": 250,
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

`scheduled` in controller `intents` is relative milliseconds from "now" and is resolved by the hub into absolute event timestamps.

**`events`** — hub → renderer:

```json
{
  "message": {
    "type": "events",
    "location": [8.5417, 47.3769],
    "payload": [
      {
        "guid": "intent-42",
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

**`config`** — hub → renderer and hub → controller:

```json
{
  "message": {
    "type": "config",
    "location": [8.5417, 47.3769],
    "payload": {
      "...": "config data"
    }
  }
}
```

### Envelope and coordinate meaning

- `location`: coarse planet coordinates (`[lon, lat]`) for the packet context. Optional on non-spatial messages.
- `position` (inside an event): local XYZ offset relative to `location` anchor — not absolute planet coordinates.
- `type`: message kind; drives handler routing on both hub and modules.
- `payload`: message body — shape depends on `type`.

### Layering and blend behavior

- Renderer intent storage is keyed by intent `guid` (not by `params.layer`), so multiple intents can coexist on the same layer.
- `params.layer` controls compositing priority.
- `light.color.xyY` is composited in ascending layer order using each intent's `blend` (`ADD`, `ALPHA`, `MULTIPLY`) and `alpha`.
- Scalar and boolean capabilities (`light.strobe`, `master.brightness`, `master.blackout`) resolve by highest layer carrying a typed value.
- Spatial attenuation uses fixture range and a named function curve (`linear`, `quadratic`, `cubic`, `sqrt`, `smoothstep`), defaulting to `quadratic`.
- On spatial intents with `position`, renderer intent state is zone-stamped and filtered against configured zones; if an existing intent moves outside all zones, that intent `guid` is removed from active state.

### Event dispatch model

- Hub accepts controller `intents`, updates per-controller intent state in `ProjectManager`, normalizes `params.color` into CIE 1931 `xyY`, and emits scheduled renderer `events` through `EventQueue`.
- Current queue dispatch broadcasts generated `events` to connected renderers.
- Hub also re-broadcasts merged current `intents` to other connected controllers for state sync.
- Hub forwards controller intent `guid` into renderer `events`; renderers ignore events without `guid`.
- `class` (inside an event object) is stored as layer intent type and consumed by renderer capability resolvers.
- Renderer dynamically imports fixture class modules and runs `applyIntentSnapshot(...)` for configured fixtures.
- `scheduled` is an absolute execution timestamp used by the renderer queue/scheduler (past timestamps execute immediately).

### Refresh message

`refresh` is hub → controller and signals browser controllers to re-send current intent state (used when renderer registration or topology changes).

---

## WebSocket reliability

All long-lived module connections (renderers and controllers) must be treated as mission-critical and self-healing.

### Heartbeat contract

- WS-level ping/pong frames every 10 s (handled by the `ws` library — no application message needed).
- Hub tracks last pong timestamp per connection; missing pong beyond timeout = socket terminated.

### Reconnect behavior

- DMX and simulator renderers reconnect immediately on close/error and re-register.
- Controller reconnect behavior is module-specific; `controllers/web-test` currently does not implement automatic reconnect.
- After reconnect, modules should re-register identity/capabilities and wait for fresh config before resuming normal operation.

---

## Service self-healing policy

All server-side runtime processes must be self-healing.

- On crash, the service must restart immediately via a supervisor/runtime manager.
- No permanent failure mode: services should not stop after N retries.
- On restart, service reinitializes config, restores required subscriptions/sockets, and resumes operation automatically.
- Errors should be logged with enough context to debug, but runtime behavior must prioritize continuity.

---

## Optional realtime monitoring panes

Renderers and controllers may provide realtime monitoring/status data on demand.

### Request/stream model

- Hub can request a module status pane stream (for example: "renderer, send status pane data").
- Module starts a cyclic WebSocket message chain with status updates.
- Hub acts as relay/orchestrator and forwards stream messages to the matching web GUI pane.
- Hub does not need to understand pane payload internals; pane-specific logic stays module-owned.

### Pane aggregation in hub GUI

- Hub can display many module status panes inside one global status view.
- Each module pane is responsible for rendering/interpreting its own data contract.

### Listener acknowledgement and auto-stop

- Status pane listeners should periodically acknowledge they are still listening.
- If a module does not receive listener acknowledgements for a defined timeout window, it may stop sending cyclic status updates to save bandwidth/CPU.
- When a listener re-subscribes, module can resume the status stream.
