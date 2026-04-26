# System layout (`modules/`)

The `modules/` tree holds **runnable components** grouped by role: one central **hub**, many **renderers** (hardware or protocol outputs), and **controllers** (operator UIs). Each folder is meant to be developed and run somewhat independently. For the product vision (Hub as conductor, spatial intent, CIE color), see the main [README.md](README.md).

---

## `modules/hub`

**Role:** Central process: configuration authority, and (as the stack grows) the HTTP API and real-time channel for controllers and renderers.

The hub is the **single source of truth** for system-wide configuration. It subscribes to configuration file changes (implemented in `src/Config.ts`) and is responsible for pushing effective config updates to all connected modules.

**Stack:** Node.js, TypeScript, `ts-node` (see `package.json`). Declared entry point is `src/index.ts`.

**What is in the tree today**

- **`src/Config.ts`** — Loads YAML from a config directory (`CONFIG_PATH` env, default `config/` under the process cwd), or a named `.yml` / `.yaml` path. Supports optional configs, dot-notation `get()`, `CONFIG:otherConfig:key` string indirection, and `fs.watch` reload with subscriber callbacks.
- **`src/Logger.ts`** — Shared logging.
- **Profile example:** `config.DEMO/server.yml` defines `LISTEN_PORT` and `LISTEN_HOST` (demo uses `3000` and `0.0.0.0`). Use `.env` / `.env.DEMO` to point `CONFIG_PATH` at a profile such as `config.DEMO`.

**Note:** Express on port 80 and a WebSocket on `/ws` describe the **intended** public surface; wire that up in `src/index.ts` and keep listen port/host in YAML (as in the demo) rather than hard-coding.

### Hub-hosted setup GUI

All setup should be possible through the hub's own web GUI, served from `hub/public`.

- `GET /api/*`: REST endpoints for CRUD-style operations and snapshots.
- `GET /ws`: WebSocket endpoint for realtime updates, module sessions, and command forwarding.
- Any non-API/non-WS route should serve frontend assets from `public` via a generic catch-all route (SPA-friendly).

The GUI should use a mobile-first layout with:

- a generic navigation shell
- pane-based sections (system, projects, fixtures, zones, modules, etc.)
- fast pane switching without full page reloads

### Renderer setup panes (remote-provided UI)

The GUI includes a pane for connected renderers and their specific setup tools.

When a renderer connects, it announces available setup pane identifiers (for example `usb-hardware`). Because renderers may only be reachable over WebSocket, the hub requests pane HTML snippets through the socket channel.

Flow:

1. Renderer connects and publishes capability metadata (including setup pane IDs).
2. Hub requests snippet content for a pane (for example `usb-hardware`) over `/ws`.
3. Renderer returns the HTML snippet payload.
4. Hub injects/displays this snippet inside the renderer setup pane in the web GUI.
5. User actions in that pane are sent to the hub.
6. Hub validates/routes the command and forwards it to the target renderer over WebSocket.

---

## `modules/renderers`

**Role:** Programs that turn hub timing and intent into concrete outputs (DMX universes, devices, etc.). Add one subdirectory per renderer implementation.

**`renderers/dmx-ts/`** — TypeScript renderer package (scaffold: `package.json`, `tsconfig.json`). Intended to schedule timed events and drive a DMX bus once `src/` is filled in.

Renderers receive configuration changes via WebSocket whenever the hub decides to publish them. A renderer module must wait for a valid config before starting normal operation; in the common path, this config arrives immediately after connection.

Renderer data authority model:

- The hub is always the source of truth for renderer-relevant data.
- A renderer may cache hub data for short periods (performance optimization), but cache is non-authoritative.
- Renderer config is pushed from the hub (not locally self-authored at runtime).
- Event queues/state are kept in renderer memory for now (no persistent event store yet).

---

## `modules/controllers`

**Role:** Front ends and tools that send control or scene data to the hub.

**`controllers/web-test/`** — Minimal static web client (`src/index.html`, `main.js`, `styles.css`). `src/config.json` holds `AMBITECTURE_HUB_URL` so the page knows which hub instance to talk to.

Controllers also receive configuration changes via WebSocket whenever the hub decides to publish them. A controller module should wait for a valid config before starting operation; this usually happens immediately after connecting.

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
- `POSITION_ORIGIN` (local XYZ offset from geo anchor)
- `BOUNDING_BOX` (local 3D extent: `x0 y0 z0 x1 y1 z1`)

This metadata can be stored in module-local config (`.env`, JSON) and then treated as connection-time capabilities.

### Connection handshake and capability registration

When a module connects, it should announce its location/capability data to the hub.

- **Renderer -> Hub:** announces geo + origin + bounding box
- **Controller -> Hub:** announces geo + origin + working area (rooms/scope)

The hub keeps this as authoritative runtime metadata and can update it if the module reconnects or republishes.

### Spatial event routing for renderers

Renderers receive spatial objects/events from the hub and then evaluate what intersects with their own bounding box before producing output (for example, deciding which fixtures should emit light).

For optimization, the hub can pre-filter and only publish events a renderer is likely interested in, based on the registered bounding box and location metadata.

### Room and scope filtering for controllers

Controllers should only receive data for rooms/scopes they are allowed to work on. Their announced location/scope data allows the hub to decide what room information and controls to expose to each controller connection.

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
- Fixture spatial data includes `location`, `target` (or `rotation`), and `range`

### Default project loading and sync

`modules/hub/config.DEMO/server.yml` sets:

- `projectsPath: ../../var/projects`
- `fixturesPath: ../../var/fixtures`
- `defaultProject: test`

At runtime, the hub loads `defaultProject` and treats its zone structure as authoritative scene assignment data. When a renderer connects (or when project data updates), the hub transfers the relevant zone info plus referenced fixtures to matching renderer(s), primarily by `rendererGUID` and, where applicable, spatial/filter rules.

---

## Data schema

Events are packets sent from the hub to renderers inside a message envelope.

```json
{
  "message": {
    "location": [8.5417, 47.3769],
    "events": [
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

Another valid message shape is a config packet (for example, hub -> renderer/controller):

```json
{
  "message": {
    "location": [8.5417, 47.3769],
    "config": {
      "type": "renderer",
      "payload": {
        "...": "config data"
      }
    }
  }
}
```

### Envelope and coordinate meaning

- `location`: coarse planet coordinates (`[lon, lat]`) for the packet context.
- `position`: local XYZ offset relative to `location` (not absolute planet coordinates).
- `events`: ordered list of event objects to be interpreted by the renderer.
- `config`: optional config envelope used for pushing effective module configuration.

### Layering and blend behavior

- `params.layer` controls compositing priority.
- Higher layer numbers win and are overlaid on lower layers.
- Final visual output still depends on `params.blend` (for example `ADD`, `ALPHA`, `MULTIPLY`) and `params.alpha`.
- In short: layer decides draw order/precedence, blend mode decides how overlapping layers are mathematically combined.

### Event dispatch model

- `class` maps to an event handler class (for example, `LightEvent` for `type: "light"`).
- The class defines and validates the expected `params` shape for that event kind.
- The renderer dispatches each event to its class and executes behavior using the parsed `params`.
- `scheduled` is the execution timestamp used by the renderer queue/scheduler.

---

## WebSocket reliability

All long-lived module connections (renderers and controllers) must be treated as mission-critical and self-healing.

### Heartbeat contract

- Use explicit `ping`/`pong` keepalive messages every 10 seconds.
- Both sides track last successful heartbeat timestamp.
- Missing heartbeat beyond timeout window is treated as a dead connection.

### Reconnect behavior

- If socket closes, errors, or heartbeat fails, module must reconnect immediately.
- Reconnect is infinite: no terminal timeout, no "give up" state.
- Backoff may be used to protect the network, but retry loop must continue forever.
- After reconnect, module re-registers identity/capabilities and waits for fresh valid config before resuming normal operation.

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
