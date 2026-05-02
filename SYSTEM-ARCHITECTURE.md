# System layout (`modules/`)

The `modules/` tree holds **runnable components** grouped by role: one central **hub**, many **renderers** (hardware or protocol outputs), **controllers** (operator UIs), and optionally **`deliver`** (static HTTP only for browser assets). Each folder is meant to be developed and run somewhat independently. For the product vision (Hub as conductor, spatial intent, CIE color), see the main [README.md](README.md).

---

## `modules/hub`

**Role:** Central process: configuration authority and real-time channel for controllers and renderers.

The hub is the **single source of truth** for system-wide configuration and graph state. `Config.ts` supports file-watch subscribers, but project graph reload/sync is currently driven by hub startup, graph commands, and explicit runtime mutation paths.

**Stack:** Node.js, TypeScript, `ts-node` (see `package.json`). Declared entry point is `src/index.ts`.

**What is in the tree today**

- **`src/Config.ts`** — Loads YAML from a config directory (`CONFIG_PATH` env, default `config/` under the process cwd), or a named `.yml` / `.yaml` path. Supports optional configs, dot-notation `get()`, `CONFIG:otherConfig:key` string indirection, and `fs.watch` reload with subscriber callbacks.
- **`src/Logger.ts`** — Shared logging.
- **`src/Server.ts`** — HTTP server + WebSocket server (`perMessageDeflate` enabled, heartbeat ping/pong supervision).
- **`src/MessageRouter.ts`** — Message dispatch by `message.type`.
- **`src/handlers/RegisterHandler.ts`** — Accepts `register`, stores module identity/metadata, pushes `config` to renderers, and pushes `graph:init` to controllers.
- **`src/GraphProtocol.ts`** — Defines the open graph command/delta/init protocol used by controllers and the hub.
- **`src/dotPath.ts`** — Hub-local dot-key helper for graph patches such as `params.color`. Use this for reading, setting, removing, cloning, and applying dot-path patches instead of reimplementing `split('.')` traversal.
- **`src/ProjectGraphStore.ts`** — Hub-side graph state mutation boundary. Owns graph revisions, durable/runtime mutation policy, controller deltas, renderer event/config invalidation results, and opaque future entity persistence.
- **`src/handlers/GraphCommandHandler.ts`** — Accepts controller `graph:command`, validates role/payload, applies it through `ProjectGraphStore`, and publishes mutation results.
- **`src/handlers/EventsHandler.ts`** — Legacy/direct `events` forwarder kept for compatibility paths.
- **`src/handlers/IntentsHandler.ts`** — Legacy controller `intents` path kept for compatibility. New controller code should send `graph:command` instead.
- **`src/EventQueue.ts`** — Buckets/schedules generated renderer `events` by execution timestamp and dispatches to connected renderers.
- **`src/ProjectManager.ts`** — Loads project + referenced fixtures, assigns missing GUIDs to mutable graph entities, serializes renderer/controller snapshots, saves durable YAML, and exposes project helper methods used by `ProjectGraphStore`.
- **Profile example:** `config.DEMO/server.yml` defines `LISTEN_PORT` and `LISTEN_HOST` (demo uses `3000` and `0.0.0.0`). Use `.env` / `.env.DEMO` to point `CONFIG_PATH` at a profile such as `config.DEMO`.

**Current runtime note:** The hub currently runs on Node's `http` server directly (not Express). WebSocket is attached to that server without a path restriction (not limited to `/ws` yet).

### Hub-hosted setup GUI

The hub `public/` directory contains the static SPA frontend shell served by the hub HTTP server.

All setup should be possible through the hub's own web GUI, served from `hub/public`.

- Target routing (once HTTP layer is wired on the same server host/port):
  - `GET /api/*`: REST endpoints for CRUD-style operations and snapshots.
  - `GET /ws`: WebSocket endpoint for realtime updates, module sessions, and command forwarding.
  - Any non-API/non-WS route should serve frontend assets from `public` via a generic catch-all route (SPA-friendly).

The GUI should use a mobile-first layout with:

- a generic navigation shell
- pane-based sections (system, projects, fixtures, zones, modules, etc.)
- fast pane switching without full page reloads

The pane-based architecture pattern is already implemented in the `surface-v1` controller as a reference: lazy-loading pane modules, single mount with activate/deactivate lifecycle, no teardown on switch.

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
- Renderer config is pushed from the hub (not locally self-authored at runtime). Renderers still receive compact assigned zone/fixture snapshots, not graph deltas.
- Event queues/state are kept in renderer memory for now (no persistent event store yet).
- Renderers receive incremental intent execution as `events` lists. They do not receive `graph:init`, `graph:command`, or `graph:delta`.

---

## `modules/controllers`

**Role:** Front ends and tools that send control intent/state to the hub.

**`controllers/surface-v1/`** — Primary operator controller. Architecture built around a **pane-based SPA** with lazy-loading panes and a touch overlay canvas:

- **Pane router** (`src/app/router.js`): Three panes — **Perform**, **Edit**, **Setup** — each lazily imported, mounted once, and cycled via `activate()`/`deactivate()` lifecycle. No full page reloads or teardown on switch.
- **Touch overlay** (`src/viewport/overlayCanvas.js`): Transparent canvas stacked on top of the simulator iframe. Handles pointer events for intent/fixture dragging, draws a finger-trail, intent radius circles, out-of-zone markers, and selection bubbles. Supports modality via **interaction policies** and an optional **SelectionManager**.
- **Interaction policies** (`src/viewport/interactionPolicies.js`): `performPolicy` (allowance-gated drag), `editPolicy` (all intents and fixtures draggable), `noopPolicy` (no interaction). Policy switches per pane via `overlay.setPolicy()`.
- **SelectionManager** (`src/viewport/selectionManager.js`): Generic bubble-overlay system — renders bubbles at world positions for any set of objects, detects taps within a hit radius, and calls an `onTap` callback. The manager holds no selection state — that belongs to the caller (e.g., allowances graph in `stores.js`). Can be enabled/disabled on the overlay canvas.
- **Project graph** (`src/core/projectGraph.js`): Controller-side graph replica. Initializes from hub `graph:init`, stores entities by stable `guid`, applies `graph:delta`, derives scene/fixture/spatial views, and notifies UI subscribers.
- **Dot-key helper** (`src/core/dotPath.js`): Controller-local helper for reading and immutably editing nested graph properties addressed by dot keys such as `params.color`.
- **State helpers** (`src/core/stores.js`): Pure helper functions for graph objects such as `intentGuid`, `intentLayer`, `intentName`, `intentRadius`, and `fixtureId`.
- **Color** (`src/core/color.js`): Display-oriented color conversion. Detects format (HSL, xyY, hex, RGB array, RGB components) and converts to CSS `rgb()` strings or HSL for palette initialization. Internal math matches hub `color.ts` and simulator-2d `color.js`.
- **Outbound queue** (`src/core/outboundQueue.js`): Rate-limited WebSocket send queue for minimal `graph:command` updates. Intent changes are sent as GUID-addressed patches/removals; fixture moves are sent by fixture GUID; scene saves are converted to graph upserts/removes.
- **WebSocket** (`src/core/socket.js`): Auto-reconnecting WebSocket with `onOpen`/`onMessage`/`onClose` callbacks. Reconnects immediately on close/error.
- **Config** (`src/core/config.js`): Loads `config.json` at startup, validates required keys (including `CONTROLLER_GUID`, `SIMULATOR_RENDERER_GUID`, `GEO_LOCATION`, `LAYOUT`), and applies layout CSS custom properties.
- **Spatial math** (`src/viewport/spatialMath.js`): World ↔ canvas coordinate transforms, zone containment checks, client-to-world conversion via the simulator canvas rect.
- **CSS split** by concern: `theme.css`, `layout.css`, `controls.css` (matching the frontend styling policy). Layout values driven from `config.json` `LAYOUT` block via CSS custom properties.
- **HTML** (`index.html`): Semantic structure — app root, header with nav toggle/spatial readout, nav bar with pane links, sim area (iframe + overlay canvas), and pane host container.

**`controllers/web-test/`** — Legacy static controller shell (being replaced by surface-v1).

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

Stylesheets must be split by concern, as implemented in `surface-v1/src/styles/`:

- `theme.css` — CSS variables for colors, typography, radii, shadows (dark theme baseline)
- `layout.css` — positioning, flow, spacing, grid/flex helpers, pane sizing, responsive breakpoints
- `controls.css` — form/input controls: buttons, inputs, selects, sliders, focus states

Layout values that are tunable per deployment (padding, gaps, z-indices, overlay sizes) are injected from `config.json` as CSS custom properties on `:root`.

Initial baseline is a single dark theme. Theme values should be defined via variables so additional themes can be added later without changing component HTML.

### Global location model per module

Every renderer and controller module carries location metadata so the hub can make spatially scoped decisions. Current examples in repo configs include:

- `GEO_LOCATION` (planet-level reference point)
- `BOUNDING_BOX` (local 3D extent: `x0 y0 z0 x1 y1 z1`) for register metadata where needed; project zones carry **`boundingBox`** for scene layout; event `position` is local inside that zone box.

This metadata can be stored in module-local config (`.env`, JSON) and then treated as connection-time capabilities.

### Connection handshake and capability registration

When a module connects, it should announce its location/capability data to the hub.

- **Renderer -> Hub:** announces geo + optional `boundingBox` metadata + `guid`; spatial truth for the scene comes from hub **`config`** (project zones, each with `boundingBox`).
- **Controller -> Hub:** announces geo + `guid` + `scope` (rooms/areas); receives hub **`graph:init`** with full controller graph data including zones, scenes, controller-visible intents, renderer routing, and active scene state.

The hub keeps this as authoritative runtime metadata and can update it if the module reconnects or republishes.

### Intent-to-event routing for renderers

Controllers submit authoritative graph/control changes to the hub with `graph:command`, and transient live updates with `runtime:command`. For interpreted `intent` runtime updates, the hub does not mutate the project graph; it derives scheduled renderer-facing `events` when the intent belongs to the active scene. Renderers then apply received events through a capability-based layer engine. In the current implementation, renderers keep intent state keyed by stable intent `guid` and fixtures sample capabilities from snapshots (`light.color.xyY`, `light.strobe`, `master.brightness`, `master.blackout`) instead of handling each event directly.

Hub pre-filtering by bounding box/location is intended optimization, not current default behavior. Current queue dispatch of generated `events` is broadcast to all connected renderers.

### Room and scope filtering for controllers

Controllers should eventually receive room/scope-filtered graph init/delta data based on announced metadata. This filtering is not implemented yet.

### Graph state protocol

Current controller/hub state sync uses a GUID-addressed graph/control protocol:

- `graph:init` — hub -> controller, sent on controller register/reconnect/resync. This is the full controller snapshot and includes project name, revision, active scene, zones, scenes, controller-visible intents, renderer routing, and a generic entity map.
- `graph:command` — controller -> hub for authoritative graph/control mutations. It carries an operation, open `entityType` string, stable `guid`, optional `patch`, optional `remove`, optional full `value`, and a persistence policy.
- `graph:delta` — hub -> controllers, sent after accepted mutations. It carries one or more deltas with hub-assigned `revision`.
- `runtime:command` — controller -> hub for transient live updates. It carries an open `entityType`, stable `guid`, and optional `patch` / `remove` / `value` data. It must not save YAML, must not emit `graph:delta`, and must not call the authoritative project graph mutation path.
- `runtime:update` — hub -> controllers for relayed live updates. Controllers apply these as transient state, separately from `graph:delta`.
- `config` — hub -> renderer, still used for assigned zones/fixtures.
- `events` — hub -> renderer, still used for incremental intent execution.

Use `graph:command` for scene activation, controller state, durable edits, saves, and final committed graph changes. Use `runtime:command` for live data streams such as intent dragging, controller-generated loops, MIDI/sensor values, temporary overrides, and future realtime entity updates. Runtime traffic is latest-wins/coalesced by entity and must not block or rerender graph/control UI such as scene buttons.

Example `graph:command`:

```json
{
  "message": {
    "type": "graph:command",
    "location": [8.5417, 47.3769],
    "payload": {
      "op": "patch",
      "entityType": "project",
      "guid": "active",
      "patch": {
        "activeSceneName": "Scene 1"
      },
      "persistence": "runtimeAndDurable"
    }
  }
}
```

Example `runtime:command`:

```json
{
  "message": {
    "type": "runtime:command",
    "location": [8.5417, 47.3769],
    "payload": {
      "entityType": "intent",
      "guid": "color-1",
      "patch": {
        "position": [4.1, 0, 3.2],
        "params.color": { "h": 220, "s": 1, "l": 0.4 }
      }
    }
  }
}
```

Persistence policy:

- `runtime` — applies to authoritative graph state in memory and emits renderer/controller updates, but does not save YAML. Do not use this for high-frequency live streams; use `runtime:command` instead.
- `durable` — applies to durable project state and saves YAML.
- `runtimeAndDurable` — applies live and saves YAML. Edit-mode drop/commit paths normally use this.

Entity type policy:

- `entityType` is intentionally open-ended (`string`), not a closed union.
- Core interpreted types include `intent`, `fixture`, `scene`, `zone`, `controller`, and `project`. The hub understands these and may derive renderer events/config or active-scene behavior from them.
- Unknown or future types are allowed. If no hub handler exists for a type, the hub may store/sync it as opaque graph state but must not generate renderer events or renderer config from it.
- System-relevant future types such as `sequence`, `trigger`, and `action` must become explicit hub-interpreted handlers when execution exists. A `sequence` is not just an opaque blob once the hub runs it.
- Module-specific custom types should be namespaced, for example `controller.midi-v1.mapping` or `controller.surface-v1.widget`.
- Every synced or durable graph entity must have a stable `guid`. Migration/loading code must assign and save GUIDs for legacy YAML objects that only have names.

Important scene rule:

- Renderer events for intent updates are only emitted when the intent belongs to the active scene. Saving all durable intents after an edit must not cause disabled/out-of-scene intents to appear on renderers.

### Color pipeline

Color flows through the system in multiple formats, with CIE 1931 `xyY` as the internal truth on the hub:

- **Hub** (`src/color.ts`): `Color.createFromObject()` accepts CIE xyY, hex strings, RGB components (0-255), and **HSL** (`{ h, s, l }`). All formats are converted to internal xyY on construction. HSL was added to support color picker output from controller UIs.
- **Controller** (`surface-v1/src/core/color.js`): Display-oriented mirror — detects the same format set and converts to CSS `rgb()` strings for rendering, and to HSL for palette initialization.
- **Simulator-2D**: Maintains its own `color.js` with the same conversion math for in-browser preview.

The format detection logic is `{ h, s, l }` → HSL, `{ x, y, Y }` → CIE xyY, `{ rgb: "#..." }` → hex, `{ rgb: [r,g,b] }` → RGB array, `{ r, g, b }` → RGB components.

### Interaction policies

The `surface-v1` controller uses an **interaction policy** pattern to control what the touch overlay canvas allows per pane:

- `performPolicy` — dragging is gated by the allowances graph (`allowances[guid].performEnabled`)
- `editPolicy` — all intents and fixtures are draggable
- `noopPolicy` — no interaction

Policies are set on the overlay canvas via `overlay.setPolicy(policy)` when switching panes. The policy defines four methods: `canDragIntent(intent)`, `canDragFixture(fixture)`, `onIntentMove(guid, wx, wz)`, `onFixtureMove(id, wx, wz)`. This keeps pane-specific interaction rules in a single testable object rather than scattered through the overlay code.

### SelectionManager

A generic interactive bubble overlay (`surface-v1/src/viewport/selectionManager.js`) that renders bubbles at world-space positions for any set of objects. It has no selection state of its own — the caller (e.g., the allowances graph in `stores.js`) owns the state. The `OverlayCanvas` can enable/disable a SelectionManager; when active, it intercepts all pointer events and routes taps to the manager's `onTap` callback. Used by the Edit pane to toggle fixture/intent allowances via tap on world-positioned bubbles.

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

**`graph:init`** — hub -> controller:

Full controller snapshot sent on register/reconnect/resync only. Controllers should not expect full project snapshots after every edit.

**`graph:command`** — controller -> hub:

Minimal mutation message. Use this for new controller features instead of `intents`, `fixtures`, `saveProject`, or broad top-level project patches.

**`graph:delta`** — hub -> controller:

Minimal accepted mutation result. Controllers apply this by `entityType` and `guid`.

**`intents`** — legacy controller -> hub:

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
        "layer": 100,
        "name": "my intent",
        "radius": 3.5,
        "params": {
          "color": { "x": 0.32, "y": 0.34, "Y": 0.8 },
          "blend": "ADD",
          "alpha": 1
        }
      }
    ]
  }
}
```

`scheduled` in legacy controller `intents` is relative milliseconds from "now" and is resolved by the hub into absolute event timestamps. New graph commands may patch any mutable intent field, not only `position`.

`layer`, `name`, and `radius` are top-level intent fields (not nested inside `params`). `layer` controls compositing priority, `name` is a human-readable label, and `radius` defines a spatial radius in world units for the intent.

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
        "layer": 100,
        "name": "my intent",
        "radius": 3.5,
        "params": {
          "color": { "x": 0.32, "y": 0.34, "Y": 0.8 },
          "blend": "ADD",
          "alpha": 1
        }
      }
    ]
  }
}
```

**`config`** — hub -> renderer:

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

- Renderer intent storage is keyed by intent `guid` (not by `layer`), so multiple intents can coexist on the same layer.
- `layer` is a top-level intent field that controls compositing priority.
- `name` is a top-level human-readable label shown in controller UI.
- `radius` is a top-level spatial radius in world units, rendered as a circle on the controller overlay canvas.
- `light.color.xyY` is composited in ascending layer order using each intent's `blend` (`ADD`, `ALPHA`, `MULTIPLY`) and `alpha`.
- Scalar and boolean capabilities (`light.strobe`, `master.brightness`, `master.blackout`) resolve by highest layer carrying a typed value.
- Spatial attenuation uses fixture range and a named function curve (`linear`, `quadratic`, `cubic`, `sqrt`, `smoothstep`), defaulting to `quadratic`.
- On spatial intents with `position`, renderer intent state is zone-stamped and filtered against configured zones; if an existing intent moves outside all zones, that intent `guid` is removed from active state.

### Event dispatch model

- Hub accepts controller `graph:command` messages, applies interpreted mutations through `ProjectGraphStore`, normalizes `params.color` into CIE 1931 `xyY`, and emits scheduled renderer `events` through `EventQueue` when the effective active scene requires it.
- Current queue dispatch broadcasts generated `events` to connected renderers.
- Hub broadcasts `graph:delta` to other connected controllers for state sync.
- Hub forwards controller intent `guid` into renderer `events`; renderers ignore events without `guid`.
- `class` (inside an event object) is stored as layer intent type and consumed by renderer capability resolvers.
- Renderer dynamically imports fixture class modules and runs `applyIntentSnapshot(...)` for configured fixtures.
- `scheduled` is an absolute execution timestamp used by the renderer queue/scheduler (past timestamps execute immediately).

### Refresh message

`refresh` is a legacy hub -> controller signal. New graph-aware controllers should rely on `graph:init` after reconnect and `graph:delta` during normal operation.

---

## Obligatory Guidance For Coding Agents

Future coding agents must read and obey [CLAUDE.md](CLAUDE.md) first. It is the hard-rule file for this repository: module layout, dev commands, WebSocket contract, color model, renderer synchronization rules, coding style, test conventions, and the rule that renderers must not diverge.

Use this `SYSTEM-ARCHITECTURE.md` file as the hard architecture reference. If code and this document disagree, inspect the current code and update this document in the same change.

Mandatory graph-state rules:

- Do not invent new top-level WebSocket mutation messages for controller state. Use `graph:command` unless a truly separate subsystem is being designed.
- Do not send full controller project snapshots after normal edits. Use `graph:delta`; reserve `graph:init` for register/reconnect/resync.
- Do not make `entityType` a closed TypeScript union. It must remain an open string so future modules can define new types.
- Do not treat unknown entity types as renderer-affecting. Unknown types may be stored/synced as opaque graph state, but only registered hub-interpreted handlers may produce renderer `events` or renderer `config`.
- Do not update only one renderer when changing shared renderer event/config behavior. Apply equivalent changes to `dmx-ts` and `simulator-2d`.
- Do not persist perform-mode live changes unless the command says `durable` or `runtimeAndDurable`.
- Do not emit renderer events for disabled/out-of-active-scene intents when committing all durable intents from edit mode.
- Do not rely on fixture names alone for synced mutable fixture identity. Use stable fixture GUIDs.
- Do not remove existing comments while editing files.

Mandatory dot-key rules:

- Dot keys are the graph patch language for nested properties, for example `position`, `layer`, `params.color`, and `params.aux.amber`.
- Use the module-local dot-path helper for all dot-key reads/writes/removals: `modules/hub/src/dotPath.ts` in the hub and `modules/controllers/surface-v1/src/core/dotPath.js` in the controller surface.
- Do not hand-roll `dotKey.split('.')` traversal in feature code. Keeping this logic centralized prevents subtle drift in graph commands, runtime commands, controller UI state, and future scene overlays.
- Dot-path helpers intentionally traverse plain objects only. Arrays are not addressable by dot key; mutate list members by stable `guid` first, then apply dot keys inside the matched object.
- Removing a dot-key value removes only the leaf and preserves parent objects, matching current graph patch/remove behavior.

---

## WebSocket reliability

All long-lived module connections (renderers and controllers) must be treated as mission-critical and self-healing.

### Heartbeat contract

- WS-level ping/pong frames every 10 s (handled by the `ws` library — no application message needed).
- Hub tracks last pong timestamp per connection; missing pong beyond timeout = socket terminated.

### Reconnect behavior

- DMX and simulator renderers reconnect immediately on close/error and re-register.
- `controllers/surface-v1` automatically reconnects on close/error via its `Socket.connect()` (reconnects immediately with zero delay, re-registers on open).
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
