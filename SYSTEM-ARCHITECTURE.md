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

---

## `modules/renderers`

**Role:** Programs that turn hub timing and intent into concrete outputs (DMX universes, devices, etc.). Add one subdirectory per renderer implementation.

**`renderers/dmx-ts/`** — TypeScript renderer package (scaffold: `package.json`, `tsconfig.json`). Intended to schedule timed events and drive a DMX bus once `src/` is filled in.

Renderers receive configuration changes via WebSocket whenever the hub decides to publish them. A renderer module must wait for a valid config before starting normal operation; in the common path, this config arrives immediately after connection.

---

## `modules/controllers`

**Role:** Front ends and tools that send control or scene data to the hub.

**`controllers/web-test/`** — Minimal static web client (`src/index.html`, `main.js`, `styles.css`). `src/config.json` holds `AMBITECTURE_HUB_URL` so the page knows which hub instance to talk to.

Controllers also receive configuration changes via WebSocket whenever the hub decides to publish them. A controller module should wait for a valid config before starting operation; this usually happens immediately after connecting.

---

## General features

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

## Data schema

Events are packets sent from the hub to renderers inside a message envelope.

```json
{
  "message": {
    "location": [8.5417, 47.3769],
    "events": [
      {
        "type": "light",
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

- `type` maps to an event handler class (for example, `LightEvent` for `type: "light"`).
- The class defines and validates the expected `params` shape for that event kind.
- The renderer dispatches each event to its class and executes behavior using the parsed `params`.
- `scheduled` is the execution timestamp used by the renderer queue/scheduler.
