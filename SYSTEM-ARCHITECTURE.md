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
- **`src/handlers/RegisterHandler.ts`** — Accepts `register`, stores module identity/metadata, pushes `config` and `systemCapabilities` to renderers/controllers, and pushes `graph:init` to controllers. Controllers may include an optional **`discovery`** object on the register payload; see **`DiscoveryService`** below.
- **`src/DiscoveryService.ts`** — In-memory map of **plugin UI advertisements** keyed by controller `guid`. Upserted when a controller registers with `discovery: { interfaces: { [interfaceId]: { ui?: { kind, url }, ws?: { kind, url } } } } }`, removed when that socket disconnects. Broadcasts **`discovery:delta`** (`op: upsert` with `entry`, or `op: remove` with `controllerGuid`) to all subscribers.
- **`src/handlers/DiscoveryHandler.ts`** — Handles **`discovery:subscribe`** (controllers only). Replies with **`discovery:snapshot`** `{ entries: DiscoveryEntry[] }` containing the full current map.
- **`src/GraphProtocol.ts`** — Defines the open graph command/delta/init protocol used by controllers and the hub.
- **`src/BindingProtocol.ts`** — Defines the `binding:subscribe` / `binding:set` / `binding:value` message shapes used to wire controller UI to live hub-owned values (animation timescale, edit-mode keyframe step, etc.).
- **`src/dotPath.ts`** — Hub-local dot-key helper for graph patches such as `params.color`. Provides `readAtDotPath` / `setAtDotPath` / `removeAtDotPath` / `applyDotPathPatch` / `diffRecordsToPatch` / `cloneRecord`. Use these for reading, setting, removing, diffing, and applying dot-path patches instead of reimplementing `split('.')` traversal. Supports nested objects only (arrays addressed by stable `guid`, not by index).
- **`src/FnCurve.ts`** — Named easing function evaluator. `FnCurve.evaluate(name, t ∈ [0,1])` supports `linear`, `quadratic`, `cubic`, `sqrt`, `smoothstep`, `hard`. Used by hub `paramLerpSchedule` to plan eased intermediate keyframe samples and mirrored verbatim in `dmx-ts/src/FnCurve.ts` and `simulator-2d/src/FnCurve.js` so renderers attenuate the same way.
- **`src/ProjectGraphStore.ts`** — Hub-side graph state mutation boundary. Owns graph revisions, durable/runtime mutation policy, controller deltas, renderer event/config invalidation results, and opaque future entity persistence. Active-scene addressing uses **`activeSceneGuid`** (no longer `activeSceneName`); scene identity flows by stable GUID across the wire.
- **`src/RuntimeIntentStore.ts`** — Hub-authoritative merge cache for runtime (perform) intent overlays. Keeps the three layers — definition, scene overlay, runtime perform patches — separate. `processRuntimeUpdates()` merges patches and emits normalized renderer events; `getEffectiveIntent(guid)` returns the currently merged intent; `listRuntimeOverlayGuidsInActiveScene()` lets controllers offer "clear overlay" UI; `evictMergeGuids()` and `clear()` invalidate selectively (scene change, project reload).
- **`src/intents/`** — Class-specific intent normalization registry. `transformIntentToNormalized(intent)` dispatches by `class` and falls through to `PassthroughIntent` for unknown classes. `LightIntent` normalizes `params.color` into CIE 1931 `xyY` regardless of the input format used by the controller (HSL, hex, RGB). Add a new module + `registry.ts` entry to introduce a new intent class.
- **`src/handlers/GraphCommandHandler.ts`** — Accepts controller `graph:command`, validates role/payload, applies it through `ProjectGraphStore`, and publishes mutation results.
- **`src/handlers/EventsHandler.ts`** — Legacy/direct `events` forwarder kept for compatibility paths.
- **`src/handlers/IntentsHandler.ts`** — Legacy controller `intents` path kept for compatibility. New controller code should send `graph:command` instead.
- **`src/EventQueue.ts`** — Buckets/schedules generated renderer `events` by execution timestamp and dispatches to connected renderers.
- **`src/ProjectManager.ts`** — Loads project + referenced fixtures, assigns missing GUIDs to mutable graph entities (including scenes), serializes renderer/controller snapshots, saves durable YAML, and exposes project helper methods used by `ProjectGraphStore`.
- **`src/RuntimeUpdateDispatcher.ts`** — Extracted dispatch layer for `runtime:command` and action-triggered intent execution: forwards `runtime:update` to all other connected controllers, converts intent runtime updates to renderer events via `RuntimeIntentStore`, and schedules them on `EventQueue`. Used by `RuntimeCommandHandler`, `ActionHandler`, and `AnimationManager`.
- **`src/ActionInputManager.ts`** — Builds `GraphCommand[]` from `ActionInputCommand` payloads (`ensureInputAssignment`, `removeInputAssignment`, `renameInput`). Validates input/display types against `systemCapabilities`, composes typed params via `composeInputParams.ts`, and wires actions ↔ inputs by target (`{ type, guid }`). Also provides `buildSceneCleanupCommands(sceneGuid)` for orphan removal when a scene is deleted.
- **`src/inputAssignment/composeInputParams.ts`** — Pure stateless helpers for reading `systemCapabilities.inputTypes`/`displayTypes`, resolving defaults, validating type class strings, and composing typed `params` from `inputConfig` fields. Extend `applyParamKind()` here when adding new param kinds (currently only `jsonString`).
- **`src/handlers/ActionHandler.ts`** — Handles `action:input` (delegates to `ActionInputManager` → `ProjectGraphStore`) and `action:trigger`. Trigger execute items resolve to: scene activation, intent runtime updates via `RuntimeUpdateDispatcher`, or animation control via `AnimationManager` (`start` / `stop` / `pause` / `settimescale`). Only registered controllers may send these messages.
- **`src/animation/AnimationManager.ts`** — Hub-side animation orchestrator. Holds one runner per animation `guid`, drives lifecycle (`trigger` / `stop` / `pause` / `setTimescale`), enters/exits live keyframe edit mode, broadcasts `hub:status` updates and per-target `lock:intent` notifications, and registers timescale + edit-state binding masters with `BindingManager`. Scene-membership changes gracefully restart runners so closures over stale graph state are dropped.
- **`src/animation/keyframeAnimator.ts`** — Keyframe animation runner. Plays time-ordered keyframe steps against a `targetIntent`, dispatches mutations through `RuntimeUpdateDispatcher` (same path as a knob drag), and supports a live edit mode where the operator can step through keyframes and capture deltas vs. the live intent state via `Add` (uses `diffRecordsToPatch`). The only animation class with built-in edit support today; new classes plug in via `intents/registry.ts`-style registration.
- **`src/animation/paramLerpSchedule.ts`** — Plans quantized intermediate patches between two keyframe anchors using `content.lerp` (quantization step, min interval, total time, named curve). Pure planning code; the runner schedules the resulting patches.
- **`src/handlers/AnimationEditHandler.ts`** — Routes controller `animation:edit` (`{ animationGuid, on }`) into `AnimationManager.enterEditMode/exitEditMode`. Edit lifecycle is hub-owned, not viewer-owned, so multiple controllers stay in sync.
- **`src/BindingManager.ts`** — Generic bidirectional binding layer. Hub modules call `registerMaster(key, getDataFn, setDataFn)`; controllers `binding:subscribe` to a key and `binding:set` to push values. The hub never caches master values — every read hits the live getter. Pending subscribers are queued until their master registers. Used today for animation timescale and keyframe edit state, and for any future hub-owned UI value.
- **`src/handlers/BindingHandler.ts`** — Routes `binding:subscribe` and `binding:set` controller messages into `BindingManager`.
- **`src/statsTool.ts`** — EMA-based per-key sample/rate counter with display-interval logging. Used to profile animation tick rates, runtime dispatch rates, and per-renderer event delivery.
- **`src/hubStatusTypes.ts`** — Type definitions for `hub:status` payloads (currently `HubStatusAnimationPayload`: `kind` / `animationGuid` / `status: 'started' | 'paused' | 'stopped'` / `message` / `data`). Open by `kind` so future status sources can extend without breaking controllers.
- **`src/hubWebSocketStats.ts`** — Per-socket WebSocket counters surfaced through `statsTool`.
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

**`controllers/surface-v1/`** — Primary operator controller. Architecture built around a **pane-based SPA** with lazy-loading panes, a touch overlay canvas, and a resizable multi-pane bottom region:

- **Pane router** (`src/app/router.js`): Three panes — **Perform**, **Edit**, **Setup** — each lazily imported, mounted once, and cycled via `activate()`/`deactivate()` lifecycle. No full page reloads or teardown on switch.
- **Pane host resize** (`src/app/paneHostResize.js`): Drag-to-resize the lower pane region; persists last height per pane. Enables the Perform pane to host a resizable Animate panel under the perform HUD.
- **Touch overlay** (`src/viewport/overlayCanvas.js`): Transparent canvas stacked on top of the simulator iframe. Handles pointer events for intent/fixture dragging, draws a finger-trail, intent radius circles, out-of-zone markers, and selection bubbles. Supports modality via **interaction policies** and an optional **SelectionManager**.
- **Interaction policies** (`src/viewport/interactionPolicies.js`): `performPolicy` (allowance-gated drag, also gated by `intentLockRegistry` so locked intents are not draggable), `editPolicy` (all intents and fixtures draggable), `noopPolicy` (no interaction). Policy switches per pane via `overlay.setPolicy()`.
- **SelectionManager** (`src/viewport/selectionManager.js`): Generic bubble-overlay system — renders bubbles at world positions for any set of objects, detects taps within a hit radius, and calls an `onTap` callback. The manager holds no selection state — that belongs to the caller (e.g., allowances graph in `stores.js`). Can be enabled/disabled on the overlay canvas.
- **Project graph** (`src/core/projectGraph.js`): Controller-side graph replica with a path-scoped subscription model. Initializes from hub `graph:init`, stores entities by stable `guid`, applies `graph:delta`, derives scene/fixture/spatial views, and notifies UI subscribers. Subscribers register against named slices (`intents`, `actions`, `inputs`, `scenes`, etc.) and are batched per delta so multi-field changes (e.g., scene + linked input) fire once.
- **Dot-key helper** (`src/core/dotPath.js`): Controller-local helper for reading and immutably editing nested graph properties addressed by dot keys such as `params.color`.
- **State helpers** (`src/core/stores.js`): Pure helper functions for graph objects such as `intentGuid`, `intentLayer`, `intentName`, `intentRadius`, and `fixtureId`.
- **Color** (`src/core/color.js`): Display-oriented color conversion. Detects format (HSL, xyY, hex, RGB array, RGB components) and converts to CSS `rgb()` strings or HSL for palette initialization. Internal math matches hub `color.ts` and simulator-2d `color.js`.
- **Outbound queue** (`src/core/outboundQueue.js`): Rate-limited WebSocket send queue for minimal `graph:command` updates. Intent changes are sent as GUID-addressed patches/removals; fixture moves are sent by fixture GUID; scene saves are converted to graph upserts/removes. Also exposes `sendBindingSubscribe` / `sendBindingSet` / `sendAnimationEdit`.
- **WebSocket** (`src/core/socket.js`): Auto-reconnecting WebSocket with `onOpen`/`onMessage`/`onClose` callbacks. Reconnects immediately on close/error (with a small backoff to avoid hammering a hub that just bounced).
- **Config** (`src/core/config.js`): Loads `config.json` at startup, validates required keys (including `CONTROLLER_GUID`, `SIMULATOR_RENDERER_GUID`, `GEO_LOCATION`, `LAYOUT`, `STYLE`), and applies layout/style CSS custom properties from those blocks.
- **Spatial math** (`src/viewport/spatialMath.js`): World ↔ canvas coordinate transforms, zone containment checks, client-to-world conversion via the simulator canvas rect.
- **CSS split** by concern: `theme.css`, `layout.css`, `controls.css` (matching the frontend styling policy), plus `modal.css` and `editPanel.css`. Layout/theme values driven from `config.json` `LAYOUT` and `STYLE` blocks via CSS custom properties.
- **HTML** (`index.html`): Semantic structure — app root, header with nav toggle/spatial readout/active scene readout, nav bar with pane links, sim area (iframe + overlay canvas), and pane host container with resize handle.
- **Modal** (`src/core/Modal.js`): Single-overlay dark-themed modal system. One modal at a time — calling any method auto-dismisses the current one. API: `alert()`, `warn()`, `confirm()`, `prompt()`, `pickChoice()`, `openModalCard(factory)`. All return `Promise`. **Use `Modal.*` for all confirm/prompt/dialog flows — never `window.alert/confirm/prompt`.**
- **systemCapabilities** (`src/core/systemCapabilities.js`): Receives and caches `systemCapabilities` pushed by the hub on register. Exposes `getInputTypes()`, `getDisplayTypes()`, `getAnimationTypes()`, `resolveDefaultPerformTypes()`, `resolveDescriptorsForClass(intentClass)` (with `optionsRef` resolution). Never hardcode input/display/animation types or intent property descriptors — always read from this module.
- **KeyboardManager** (`src/core/KeyboardManager.js`): Global key → action binding. Maps `keydown` / `keyup` to perform momentary on/off or one-shot button trigger, coordinates with `performMomentaryRegistry`, suppresses repeats, and skips when a focused input is editing text. Bindings are derived from inputs whose `params.key` is set; rebuilt on graph changes.
- **performKeyboardVisual** (`src/core/performKeyboardVisual.js`): Visual feedback (pulse / hold highlight) for keyboard-triggered perform inputs.
- **bindingRegistry** (`src/core/bindingRegistry.js`): Controller-side cache of `binding:value` messages keyed by binding key. UI subscribes via `subscribe(key, cb)`; underlying `binding:subscribe` is sent on first subscriber. Used by the animate edit pane (timescale, keyframe step) and any other hub-owned value the UI needs to observe live.
- **animationPlayRegistry** (`src/core/animationPlayRegistry.js`): Subscribes to `hub:status` animation events; tracks which animation GUIDs are currently `started` / `paused`. Animate panel reads this for play/stop button state and for surfacing "now playing" indicators.
- **intentLockRegistry** (`src/core/intentLockRegistry.js`): Tracks `lock:intent` notifications from the hub (intents currently driven by an animation). Edit/perform UIs query this to disable knobs and overlay drag while the lock is active.
- **intentPerformDefaults** (`src/core/intentPerformDefaults.js`): Per-intent perform reset policies — controls which dot-keys snap back to defaults when a perform-mode override is cleared.
- **performMomentaryRegistry** (`src/core/performMomentaryRegistry.js`): Tracks momentary inputs currently held (touch + keyboard) so that `argsOff` is dispatched exactly once on release regardless of input source.
- **performButtonInputs** (`src/core/performButtonInputs.js`): `collectPerformButtonInputs()` — the canonical filter for which inputs appear as Perform pane buttons (`display.type === 'button'` + valid linked action). Always call this function instead of filtering inputs inline.
- **ArraySorter** (`src/core/arraySorter.js`): Generic drag-to-reorder UI for any object array with a numeric sort-key property. `getItemsSorted()` stable-sorts by key then `guid`. `displaySortDialog(host, callbackDisplay, callbackLifecycle, onReorder)` renders pointer-capture draggable rows with ghost and drop markers, writes sort keys in place. Default key: `DEFAULT_PERFORM_INPUT_SORT_KEY` (`'_sortIdx'`). Use for any list that operators need to reorder.
- **InputAssignManager** (`src/edit/InputAssignManager.js`): Reusable per-target class for assigning/editing/removing a controller input. Constructor: `new InputAssignManager({ context: { type, guid }, labelDefault? })`. Provides `getInvokeButton()` (standalone toggle button), `getInlinePane()` (row with toggle + rename button, used in property panel), and `showControl()` (full modal with type/displayType/name/params/key from `systemCapabilities`). Sends via `sendActionInputCommand()`. Supports any `targetType` — scene, intent, animation, and future entity types.
- **paramKindHandlers** (`src/edit/inputAssign/paramKindHandlers.js`): Form-to-value parse/stringify for each input param `kind` (currently `jsonString`). Add new switch cases here when `system.yml` defines new param kinds.
- **PropertyPanel** (`src/edit/PropertyPanel.js`): Generic property editor card. Renders descriptor-driven controls (scalars, dropdowns, color, fnCurve, infoText) for one or many selected entities, integrates with `InputAssignManager`'s inline pane, and routes value changes through the project graph (`durable` for committed edits, `runtime` for live drag).
- **selectPopup** (`src/edit/components/selectPopup.js`): Inline dropdown popup used by `PropertyPanel` and animator viewers (e.g., picking a `functionCurves` value).
- **ScalarRadialKnobSvg** (`src/edit/components/ScalarRadialKnobSvg.js`): SVG-based radial knob for continuous scalar values. Replaces the older Canvas-based `perform/ScalarRadialKnob.js`. Used by both `PerformQuickPanelHud` and the Animate edit pane (animation timescale, keyframe field controls). Supports a long-press zoomed precision mode.
- **performResetKeyMetas** (`src/edit/performResetKeyMetas.js`): Per-descriptor metadata for the Edit pane's "reset perform overrides" toggles.
- **PerformQuickPanelHud** (`src/perform/performQuickPanelHud.js`): Per-intent floating HUD panel in the Perform pane. Reconciles panels against the live intent list via `projectGraph.subscribe()`. Creates `ScalarRadialKnobSvg` instances for each descriptor with `quickPanel: true` in `systemCapabilities.intentProperties[class]`. Positioned by a `requestAnimationFrame` loop using world-to-canvas conversion. Activated/deactivated with the Perform pane via `start()`/`stop()`. Hides knobs for intents present in `intentLockRegistry`.

**Perform pane subnav (`src/panes/`):**

- **performPane.js** — top-level Perform orchestrator. Mounts the perform HUD, scene buttons, perform buttons, and the **performSubnavShell** for the lower section.
- **performSubnavShell.js** — nested navigation between **Control**, **Animate**, and optional **plugin** subpanes inside Perform (see **Plugin UI panels** below).
- **performControlPanel.js** — Control subpane: scene activation buttons, perform buttons, system status.
- **performAnimatePanel.js** — Animate subpane: list of project animations with play / stop / pause / open-edit controls. Subscribes to `animationPlayRegistry`.
- **performAnimateEditPane.js** — Per-animation edit overlay. Uses an `AnimatorViewer` for the animation's class and the `bindingRegistry` to mirror timescale and keyframe step state from the hub.
- **performIntentFilter.js** (`src/core/performIntentFilter.js`) — Shared perform-mode **intent filter** (GUID or `null`). **performSubnavShell** drives the funnel chip from this module (chip visible on **Animate** and **plugin** subpanes; hidden on **Control** while the filter may still be remembered). Single-tap an intent on the perform overlay toggles the filter when **Animate** or an active **plugin** subpane is selected. **performSubnavShell** adds **`filter=<intentGuid>`** to the plugin iframe URL when set and drops it when the filter is cleared.

**Plugin UI panels (headless controllers → surface-v1 Perform):**

- **Project YAML** — On the **surface** controller row, optional **`plugins`** array. Each item: **`guid`**, **`provider`: `{ guid, interface, name }`** (`name` is the Perform subnav / iframe title), **`context`: `{ pane: perform, type: panel }`**. URLs are **not** duplicated in YAML; the browser resolves them from the hub discovery feed.
- **Hub protocol** — After **`register`**, a client sends **`discovery:subscribe`** → **`discovery:snapshot`**. Further changes arrive as **`discovery:delta`**. The hub does not proxy plugin iframe/WebSocket traffic.
- **`src/plugins/discoveryRegistry.js`** — Client-side map updated from snapshot/delta.
- **`src/plugins/pluginRegistry.js`** — **`getResolvedPerformPlugins()`** merges `projectGraph.getControllerPlugins()` with discovery for iframe URLs and online/offline.
- **`src/plugins/themeToIframe.js`** — After iframe `load`, parent posts `{ type: 'theme', vars }` (`--color-*`, `--space-*`, `--radius-*` from `getComputedStyle`) so child UIs can match `theme.css`.
- **Iframe `filter` query** — Optional **`filter=<intentGuid>`** on the plugin page URL (appended by **performSubnavShell** from **`performIntentFilter`**). Plugin UIs may use it to narrow lists client-side; the hub graph is unchanged.

**`controllers/midi-v1/`** — Headless MIDI controller: **`graph:init` / `graph:delta`** drive **`GraphReplica`** assignments → receivers; **`graph:command`** `patch` on its own controller guid persists assignment edits from the plugin UI. Runs a small **HTTP + WebSocket** server (`PluginServer`, static `ui/assign.html`) for the assign editor; **`register`** includes **`discovery`** built from **`PLUGIN_PUBLIC_HOST`** + **`PLUGIN_LISTEN_PORT`**. The iframe connects to **`/ws`** on that server for live state (trusted LAN). The assign UI reads **`filter`** from the page URL and shows only assignments that include an **`intent`** target with that GUID (client-side; full list still arrives over the socket).

**Animator viewers (`src/panes/animators/`):**

- **AnimatorViewer.js** — base class for animation-class viewers. Subclasses implement `getClassName()`, `getName()`, `getFieldDescriptor()`, `renderField(host, descriptor)`, `renderEditSection(host)`. Pattern matches the fixture-class abstraction rule.
- **animatorViewerRegistry.js** — `registerAnimatorViewer(class, ctor)` and `createViewer(class, ...)`. Add new animation classes by registering here; never branch on class string in viewer host code.
- **keyframeAnimator.js** (controller-side) — `KeyframeAnimatorViewer` implementation. Renders fields (length, repeat, lerp.*) from `systemCapabilities.animations[].display`, plus the live keyframe step editor (prev / next / add / remove / merge) wired to hub `animation:edit` mode through the `bindingRegistry`.

**`controllers/starter/`** — Minimal TypeScript reference controller demonstrating the full connection lifecycle. Key classes:

- **`HubSocket`** — WebSocket client with auto-reconnect, register-on-open, and typed `sendRuntimeCommand()` / `sendActionTrigger(guid, args?)` helpers.
- **`ProjectGraph`** — Lightweight controller-side graph replica: applies `graph:init` / `graph:delta`, exposes `getIntent()`, `getAction()`, `isIntentInActiveScene()`, `getMovementBoundsForIntent()`.
- **`StarterController`** — Orchestrator with `start()` / `stop()` and overridable lifecycle hooks (`onGraphInit`, `onGraphDelta`, etc.). Demonstrates both a `runtime:command` position loop and an `action:trigger` alternating loop. Extend this class to build custom headless controllers.

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

- `graph:init` — hub -> controller, sent on controller register/reconnect/resync. This is the full controller snapshot and includes project name, revision, **`activeSceneGuid`** (no longer `activeSceneName`), zones, scenes, controller-visible intents, renderer routing, and a generic entity map.
- `graph:command` — controller -> hub for authoritative graph/control mutations. It carries an operation, open `entityType` string, stable `guid`, optional `patch`, optional `remove`, optional full `value`, and a persistence policy.
- `graph:delta` — hub -> controllers, sent after accepted mutations. It carries one or more deltas with hub-assigned `revision`.
- `runtime:command` — controller -> hub for transient live updates. It carries an open `entityType`, stable `guid`, and optional `patch` / `remove` / `value` data. It must not save YAML, must not emit `graph:delta`, and must not call the authoritative project graph mutation path.
- `runtime:update` — hub -> controllers for relayed live updates. Controllers apply these as transient state, separately from `graph:delta`.
- `binding:subscribe` / `binding:set` — controller -> hub for per-key bindings to live hub-owned values (animation timescale, keyframe edit state).
- `binding:value` — hub -> controllers, value pushes for subscribed binding keys.
- `animation:edit` — controller -> hub, `{ animationGuid, on }` to enter/exit live keyframe edit mode for an animation.
- `hub:status` — hub -> controllers, broadcast status updates (currently animation `started` / `paused` / `stopped` events). Open by `kind` for future status sources.
- `lock:intent` — hub -> controllers, indicates an intent is currently driven by an animation and should be uneditable (knobs/drag disabled) until released.
- `config` — hub -> renderer, still used for assigned zones/fixtures.
- `events` — hub -> renderer, still used for incremental intent execution.

Use `graph:command` for scene activation, controller state, durable edits, saves, and final committed graph changes. Use `runtime:command` for live data streams such as intent dragging, controller-generated loops, MIDI/sensor values, temporary overrides, and future realtime entity updates. Runtime traffic is latest-wins/coalesced by entity and must not block or rerender graph/control UI such as scene buttons. Use `binding:*` for controller UI that needs to mirror or push hub-owned live values (animation timescale, edit state); never replicate hub state by polling.

Hub-owned runtime intent merge state lives in **`RuntimeIntentStore`** (`hub/src/RuntimeIntentStore.ts`). Controllers send compact `runtime:command` patches; the hub merges them on top of the active scene overlay and bare definition, normalizes the result through the **intent registry** (`hub/src/intents/`), and emits renderer events. Controllers do not perform this merge — they apply inbound `runtime:update` for sync only.

Example `graph:command` (scene activation by GUID):

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
        "activeSceneGuid": "scene-7f1c2a"
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
- **Renderer-bound normalization happens on the hub**, not on the renderer: `LightIntent.transformToNormalized` (in `hub/src/intents/`) converts `params.color` to `xyY` regardless of the input format before the event payload is built. Renderers therefore always receive `params.color` as `{ x, y, Y }`.

The format detection logic is `{ h, s, l }` → HSL, `{ x, y, Y }` → CIE xyY, `{ rgb: "#..." }` → hex, `{ rgb: [r,g,b] }` → RGB array, `{ r, g, b }` → RGB components.

### Interaction policies

The `surface-v1` controller uses an **interaction policy** pattern to control what the touch overlay canvas allows per pane:

- `performPolicy` — dragging is gated by the allowances graph (`allowances[guid].performEnabled`)
- `editPolicy` — all intents and fixtures are draggable
- `noopPolicy` — no interaction

Policies are set on the overlay canvas via `overlay.setPolicy(policy)` when switching panes. The policy defines four methods: `canDragIntent(intent)`, `canDragFixture(fixture)`, `onIntentMove(guid, wx, wz)`, `onFixtureMove(id, wx, wz)`. This keeps pane-specific interaction rules in a single testable object rather than scattered through the overlay code.

### SelectionManager

A generic interactive bubble overlay (`surface-v1/src/viewport/selectionManager.js`) that renders bubbles at world-space positions for any set of objects. It has no selection state of its own — the caller (e.g., the allowances graph in `stores.js`) owns the state. The `OverlayCanvas` can enable/disable a SelectionManager; when active, it intercepts all pointer events and routes taps to the manager's `onTap` callback. Used by the Edit pane to toggle fixture/intent allowances via tap on world-positioned bubbles.

### Actions and Inputs

Controller perform buttons are implemented through a three-entity graph structure: **Action** → **Input** → **UI control**.

**Action** (`entityType: "action"`) — a named, executable graph entity stored at the top level of the project graph. Fields: `guid`, `name`, `execute[]`. Each execute item is `{ type, guid }` — current supported types: `scene` and `intent`.

**Input** (`entityType: "input"`) — a controller-owned UI binding stored **inside the controller entity** (`parent: { entityType: "controller", guid }`). Key fields:
- `type` — input class from `systemCapabilities.inputTypes` (e.g. `button`, `momentarySwitch`)
- `display.type` — display class from `systemCapabilities.displayTypes` (e.g. `button`)
- `action` — linked action GUID
- `target` — `{ type, guid }` of the entity this input targets
- `context` — scene GUID (legacy path for scene inputs; prefer `target` for new entity types)
- `params` — typed per-input parameters (e.g. `args`, `argsOn`, `argsOff` as `jsonString` objects)
- `_sortIdx` — numeric sort index for Perform pane button ordering

**`action:input`** (controller → hub): sends `ActionInputCommand` payloads to create, update, or remove inputs and their linked actions atomically. Three commands:
- `ensureInputAssignment` — creates or updates the action + input for `{ targetType, targetGuid, input: { name, type, displayType, ...params } }`
- `removeInputAssignment` — removes matching inputs and their actions (unless referenced elsewhere)
- `renameInput` — patches the input `name` field by `inputGuid`

Hub validates types against `systemCapabilities`, composes params via `composeInputParams.ts`, applies as `graph:command` pairs, and broadcasts `graph:delta`.

**`action:trigger`** (controller → hub): `{ actionGuid, args? }`. Hub resolves the action's `execute` items:
- `type: "scene"` → activates scene via `ProjectGraphStore` (emits `graph:delta`)
- `type: "intent"` → dispatches a `RuntimeUpdate` via `RuntimeUpdateDispatcher` (transient, no graph write, no `graph:delta`). The action's `execute` item may carry `params`, `patch`, `remove`, or `value`; `args` from the trigger call are merged on top.

**Usage rules:**
- Use `sendActionInputCommand(command)` from `outboundQueue.js` — never raw `sendGraphCommands` — to create/remove/rename inputs.
- Use `sendActionTrigger(guid, args?)` from `outboundQueue.js` — never a graph command — to fire actions.
- Collect Perform pane buttons via `collectPerformButtonInputs()` only; do not filter inputs inline in pane code.
- When deleting a scene on the hub, call `ActionInputManager.buildSceneCleanupCommands(sceneGuid)` and apply the returned commands to remove orphaned inputs and actions.

### Animations

The hub runs animations as authoritative time-driven mutators of intents. The full lifecycle is hub-owned; controllers drive only triggers, edits, and UI display.

**Hub side (`hub/src/animation/`):**

- **`AnimationManager`** — one runner per animation `guid`. Methods: `trigger(guid, { location, timescale })`, `stop(guid)`, `pause(guid)`, `setTimescale(guid, value)`, `enterEditMode(guid)`, `exitEditMode(guid)`. On any state change it broadcasts `hub:status` (`started` / `paused` / `stopped`) and emits `lock:intent` for the animation's `targetIntent` so controllers disable that intent in UI.
- **`keyframeAnimator`** — the only runner class today. Plays time-ordered keyframe steps against `targetIntent` and dispatches mutations through `RuntimeUpdateDispatcher` (same path as a knob drag — no graph writes). When `content.lerp` is set, intermediate patches are planned by `paramLerpSchedule.planIntermediateLerpPatches()` using the named function curve and the quantization/minMs/time settings.
- **`paramLerpSchedule`** — pure planning of eased intermediate patches between two keyframe anchors.
- **`AnimationEditHandler`** — routes controller `animation:edit` (`{ animationGuid, on }`) into `AnimationManager`. Live edit mode is hub-owned so multiple controllers stay in sync via `binding:value`.
- Scene membership changes gracefully restart runners so closures over stale graph state are dropped.
- Companion action GUID = animation GUID; `action:trigger` with that GUID maps through `ActionHandler` to `AnimationManager` (`start` default, or `stop` / `pause` / `settimescale` per execute item).

**Controller side (`surface-v1/src/panes/animators/`):**

- **`AnimatorViewer`** — abstract base; subclasses implement `getClassName/getName/getFieldDescriptor/renderField/renderEditSection`. `animatorViewerRegistry` maps class → constructor.
- **`KeyframeAnimatorViewer`** — renders the field set defined in `systemCapabilities.animations[].display`, plus the live keyframe step editor (prev/next/add/remove/merge) wired through `bindingRegistry`.
- **Animate panel** (`performAnimatePanel.js`) — animation list with play/stop/pause/open-edit; subscribes to `animationPlayRegistry`.
- **Animate edit pane** (`performAnimateEditPane.js`) — opens the viewer for an animation, subscribes to its timescale and edit-state binding keys.

**Rules:**

- Animation runtime mutations must go through `RuntimeUpdateDispatcher` (transient, no YAML write). Do not write durable graph state from a running animation.
- Add a new animation class by registering on both sides: a runner in `hub/src/animation/` (and an entry routed by `AnimationManager`), a `*Viewer` in `surface-v1/src/panes/animators/` registered via `animatorViewerRegistry`, and a matching entry in `system.yml → systemCapabilities.animations[]`.
- The Edit pane and Perform HUD must respect `intentLockRegistry` — never let the operator drag/knob an intent currently driven by an animation.

### Bindings

`BindingManager` is the generic bidirectional binding layer between hub state and controller UI. It is intentionally free of any animation- or feature-specific logic.

- **Hub side (`hub/src/BindingManager.ts`):** modules call `registerMaster(key, getDataFn, setDataFn)`. Subscribe requests for unknown keys are queued and flushed on later registration. Reads always go through the live getter — the hub never caches master values.
- **Controller side (`surface-v1/src/core/bindingRegistry.js`):** `subscribe(key, callback)` returns the latest cached value and registers for future `binding:value` pushes; `set(key, value)` sends `binding:set`. The first subscriber to a key triggers `binding:subscribe`; later subscribers piggyback on the existing subscription.
- **Today's keys:** animation timescale (`${animationGuid}-timescale`), keyframe edit state (per animation GUID).
- **Use bindings, not polling**, when controller UI needs to reflect or push hub-owned live values (animations, future global mutators, future scene crossfaders, etc.).

### Function curves

Named easing functions used by the animation lerp planner and by renderer spatial attenuation. The implementation is mirrored verbatim across modules so an animation eased on the hub looks identical when rendered locally.

- **Hub:** `hub/src/FnCurve.ts → FnCurve.evaluate(name, t ∈ [0,1])`.
- **Renderers:** `dmx-ts/src/FnCurve.ts` and `simulator-2d/src/FnCurve.js` — same signature, same math.
- **Available curves:** `linear`, `quadratic`, `cubic`, `sqrt`, `smoothstep`, `hard`. Listed in `systemCapabilities.functionCurves` and referenced from descriptors via `optionsRef: functionCurves`.
- **Rule:** if you add a curve, add it on every side (hub + every renderer + system.yml) in the same change. Divergence shows up as visibly wrong attenuation/animation.

### Hub status and stats

- **`hub:status`** (`hub/src/hubStatusTypes.ts`) — broadcast hub-originated status notifications. Currently `HubStatusAnimationPayload` (`kind: 'animation'`, `animationGuid`, `status: 'started' | 'paused' | 'stopped'`, optional `message` and `data`). Open by `kind` so future status sources can extend without breaking older controllers.
- **`lock:intent`** — paired with animation lifecycle to mark intents currently uneditable.
- **`statsTool`** (`hub/src/statsTool.ts`) — EMA-based per-key sample/rate counter with display interval. Used to profile animation tick rates, runtime dispatch rates, and per-renderer event delivery.
- **`hubWebSocketStats`** (`hub/src/hubWebSocketStats.ts`) — per-socket counters surfaced through `statsTool`.

### Intent normalization registry

`hub/src/intents/` holds class-specific transforms applied **before** intent state is published to renderers:

- `transformIntentToNormalized(intent)` dispatches by `class`. Unknown classes fall through to `PassthroughIntent`.
- `LightIntent.transformToNormalized` normalizes `params.color` into CIE 1931 `xyY` regardless of the input format the controller used (HSL, hex, RGB).
- `MasterIntent.transformToNormalized` is currently a pass-through (placeholder for class-specific master logic).
- Add a new class by adding a module + entry in `intents/registry.ts`. Renderer event payloads then carry already-normalized data.

### systemCapabilities

The hub reads `systemCapabilities` from `system.yml` and broadcasts it to all connecting controllers as a `systemCapabilities` message immediately after registration. Both controller and hub sides normalize these the same way.

Structure:
- `inputTypes[]` — `{ class, name, hint, params: { paramKey: kind } }`. Param `kind` is currently `jsonString` only. To add a new kind: add a case in `applyParamKind()` (`hub/src/inputAssignment/composeInputParams.ts`) **and** in `parseParamFromForm()` (`surface-v1/src/edit/inputAssign/paramKindHandlers.js`).
- `displayTypes[]` — `{ class, name }`. Currently only `button`.
- `animations[]` — `{ class, name, display: { dotKey: { type } } }`. Drives the field set the controller `AnimatorViewer` renders for an animation class. Today only `keyframeAnimator` is registered, with `content.length`, `content.repeat`, and `content.lerp.{quantization, minMs, time, curve}` exposed. Add a new animation class by adding a hub runner (under `hub/src/animation/`), a controller viewer (under `surface-v1/src/panes/animators/`) registered through `animatorViewerRegistry`, and a matching `animations[]` entry.
- `functionCurves[]` — string array of named easing functions (`linear`, `quadratic`, `cubic`, `sqrt`, `smoothstep`, `hard`). Resolved by hub `FnCurve.evaluate` and the matching renderer mirrors. Referenced via `optionsRef: functionCurves` in intentProperties descriptors and as `content.lerp.curve` for animations.
- `intentProperties` — per-class descriptor arrays. Each descriptor has `dotKey`, `name`, `type`, and optional flags:
  - `quickPanel: true` — shown as a knob in the Perform HUD (`PerformQuickPanelHud`)
  - `allowOverlay: true` — editable via overlay controls in the Edit pane
  - `isMandatory: true` — always shown in the property panel regardless of value state
  - `optionsRef` — string referencing a top-level array key in `systemCapabilities` (e.g. `functionCurves`)
  - `delta` — describes how values change when used with incremental controls (e.g. ADD/MULTIPLY with range)

**Rule:** Never hardcode input types, display types, animation classes, function curves, or intent property names in controller code. Always read from `systemCapabilities.js` via the exported helper functions.

### Modal system

`surface-v1/src/core/Modal.js` is the **only** approved dialog mechanism in `surface-v1`. It provides dark-themed, promise-based modals over a single full-screen overlay. Only one modal is active at a time; starting a new one auto-dismisses the current one.

API:
- `alert(text)` / `warn(text)` — informational, single OK button.
- `confirm(text, { yes, no })` → `Promise<boolean>`.
- `prompt(text, fields, { submit, cancel })` → `Promise<Record<string, string> | null>`. Field values are always `.trim()`'d. Fields: `{ label, key, type?, placeholder?, value? }`.
- `pickChoice(message, options, { cancel? })` → `Promise<string | null>`. Options are a vertical stacked list; each has `{ value, label, disabled?, title? }`.
- `openModalCard(factory)` → `Promise<T | null>`. Caller builds a full `.modal` card element and calls `dismiss(value)` when done. Overlay-click dismisses with `null`.

**Rule:** Do not call `window.alert/confirm/prompt`. Do not build ad-hoc overlay elements for dialogs. Always use `Modal.*` or `openModalCard`.

### ArraySorter — generic drag-to-reorder

`surface-v1/src/core/arraySorter.js` provides reusable pointer-capture drag-and-drop list reordering for any array of objects with a numeric sort-key property.

Usage pattern:

```js
const sorter = new ArraySorter(rawList, '_sortIdx')  // rawList references are mutated in place

// Render sort UI into a host element:
sorter.displaySortDialog(
  hostEl,
  item  => buildRowElement(item),          // returns HTMLElement per row
  (item, phase) => { ... },               // 'willBeDragged' | 'hasBeenDragged' lifecycle
  ordered => pushSortUpdate(ordered),     // called on mount and on every reorder; sort keys already written
)

// Read sorted items (e.g. for Perform pane rendering):
const items = sorter.getItemsSorted()
```

CSS classes written by `ArraySorter`: `.array-sort-row`, `.array-sort-row--dragging`, `.array-sort-row--drop-before`, `.array-sort-row--drop-after`, `.array-sort-ghost`. Style these in the relevant CSS file.

**Rules:**
- Do not hand-roll index-based drag-to-reorder logic. Use `ArraySorter`.
- The default sort key for perform inputs is `DEFAULT_PERFORM_INPUT_SORT_KEY` (`'_sortIdx'`). Use the same exported constant wherever sort indices are read or compared.
- `displaySortDialog` calls `onReorder` immediately on mount (to seed contiguous indices) and on every drag completion.

### Perform HUD

The Perform pane renders a floating HUD panel above each intent's position on the canvas. It is driven by `PerformQuickPanelHud` (`surface-v1/src/perform/performQuickPanelHud.js`) and `ScalarRadialKnobSvg` (`surface-v1/src/edit/components/ScalarRadialKnobSvg.js`).

- HUD panels are reconciled against the live intent list on each `projectGraph` change (subscribe callback).
- Knob descriptors come from `resolveDescriptorsForClass(intent.class)` filtered to `quickPanel: true` — never hardcoded.
- Panel position is calculated every `requestAnimationFrame` via world-to-canvas conversion using `worldToCanvas()` from `spatialMath.js`.
- `ScalarRadialKnobSvg` (SVG-based, replaces the older Canvas-based `perform/ScalarRadialKnob.js`) supports a zoomed precision mode (long-press): a larger overlay appears for fine-grained control, then collapses on release. The same component is reused by the Animate edit pane (timescale + keyframe field knobs).
- Knob value changes are sent as `queueIntentUpdate()` (runtime, not graph commands).
- Knobs for intents present in `intentLockRegistry` are hidden/disabled — those intents are currently driven by an animation.

**Rule:** Add new Perform HUD controls by setting `quickPanel: true` on a descriptor in `system.yml → systemCapabilities.intentProperties`. Do not add special-case knob construction in `PerformQuickPanelHud` source.

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

**`action:input`** — controller -> hub:

Manages controller input assignments and their linked actions. Payload is an `ActionInputCommand`:

```json
{ "command": "ensureInputAssignment", "targetType": "intent", "targetGuid": "intent-42",
  "input": { "name": "Flash Red", "type": "button", "displayType": "button", "args": { "params.alpha": 1 } } }
```

Also supports `removeInputAssignment` and `renameInput`. Hub validates types against `systemCapabilities`, composes params, and returns `graph:delta` on success.

**`action:trigger`** — controller -> hub:

Fires a named action by GUID. Optional `args` are merged into intent execute patches.

```json
{ "actionGuid": "action-abc123", "args": { "params.alpha": 0.5 } }
```

Hub resolves execute items: scene → activates scene; intent → dispatches as `RuntimeUpdate` (transient, no YAML write).

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
- Spatial attenuation uses fixture range and a named function curve (`linear`, `quadratic`, `cubic`, `sqrt`, `smoothstep`, `hard`), defaulting to `quadratic`. `hard` is full strength inside the radius and zero outside (no falloff).
- On spatial intents with `position`, renderer intent state is zone-stamped and filtered against configured zones; if an existing intent moves outside all zones, that intent `guid` is removed from active state.

### Event dispatch model

- Hub accepts controller `graph:command` messages, applies interpreted mutations through `ProjectGraphStore`, normalizes `params.color` into CIE 1931 `xyY`, and emits scheduled renderer `events` through `EventQueue` when the effective active scene requires it.
- Current queue dispatch broadcasts generated `events` to connected renderers.
- Hub broadcasts `graph:delta` to other connected controllers for state sync.
- Hub forwards controller intent `guid` into renderer `events`; renderers ignore events without `guid`.
- `class` (inside an event object) is stored as layer intent type and consumed by renderer capability resolvers.
- Renderer dynamically imports fixture class modules and runs `applyIntentSnapshot(...)` for configured fixtures.
- `scheduled` is an absolute execution timestamp used by the renderer queue/scheduler (past timestamps execute immediately).

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

Mandatory animation / binding / intent-registry rules:

- Animation runtime mutations must dispatch through `RuntimeUpdateDispatcher` (transient). Do not write durable graph state from a running animation.
- Animation lifecycle (start / stop / pause / setTimescale / edit on/off) is hub-owned in `AnimationManager`. Controllers must not maintain their own playback state — read from `animationPlayRegistry` (sourced from `hub:status`) and write through `action:trigger` or `animation:edit`.
- Adding a new animation class must touch all three sides in one change: hub runner under `hub/src/animation/` (and routed through `AnimationManager`), controller viewer under `surface-v1/src/panes/animators/` registered with `animatorViewerRegistry`, and a matching entry in `system.yml → systemCapabilities.animations[]`.
- Edit and Perform UIs must respect `intentLockRegistry`. Do not let the operator drag/knob an intent currently driven by an animation.
- Use `BindingManager` (via `bindingRegistry` on the controller) for any controller UI that must mirror or push hub-owned live values. Do not poll `runtime:update` or invent ad-hoc subscription messages.
- Active scene addressing is by **`activeSceneGuid`**, not name. Do not reintroduce `activeSceneName` on the wire or in graph patches.
- Intent normalization (color space, future class-specific transforms) belongs in `hub/src/intents/`. Do not duplicate normalization in renderers — events arrive already normalized.
- Function curves must stay byte-identical across `hub/src/FnCurve.ts`, `dmx-ts/src/FnCurve.ts`, and `simulator-2d/src/FnCurve.js`. Adding a curve requires updating all three plus `system.yml → systemCapabilities.functionCurves`.

Mandatory actions/inputs rules:

- Do not use `sendGraphCommands` directly to create or remove inputs or actions. Use `sendActionInputCommand(command)` from `outboundQueue.js`. This ensures types are validated against `systemCapabilities` and action/input graph entries are kept in sync.
- Do not trigger actions via a graph command patch. Use `sendActionTrigger(guid, args?)` from `outboundQueue.js`. The hub's `ActionHandler` resolves execute items and routes to the correct runtime path.
- Do not collect Perform pane buttons by filtering inputs inline. Call `collectPerformButtonInputs()` from `performButtonInputs.js` — it is the canonical filter.
- Do not reorder list items with hand-rolled index logic. Use `ArraySorter` from `arraySorter.js`. The default sort key is `DEFAULT_PERFORM_INPUT_SORT_KEY`.
- Do not show dialogs with `window.alert/confirm/prompt`. Use `Modal.*` or `openModalCard` from `surface-v1/src/core/Modal.js`.
- Do not hardcode input types, display types, or intent property names in controller code. Read them from `systemCapabilities.js` via the exported helpers.
- Do not add new Perform HUD knobs by modifying `PerformQuickPanelHud` source. Set `quickPanel: true` on the descriptor in `system.yml → systemCapabilities.intentProperties`.
- Do not add new input param kinds only on one side. When adding a new `kind` to `system.yml`, implement the coercion in `hub/src/inputAssignment/composeInputParams.ts → applyParamKind()` **and** the form parse/stringify in `surface-v1/src/edit/inputAssign/paramKindHandlers.js → parseParamFromForm()`.
- Do not build new headless controllers from scratch. Start from `controllers/starter/` — it has the correct registration flow, graph replica, `action:trigger` send path, and `runtime:command` position path.
- Do not bind keys to actions by attaching ad-hoc `keydown` listeners. Add `params.key` to the input via `InputAssignManager` and let `KeyboardManager` route the event through `performMomentaryRegistry` / `action:trigger`.
- Do not subscribe to the project graph by reading the whole snapshot on every change. Use `projectGraph.subscribe(paths, callback)` — register against the slices you care about (`intents`, `inputs`, `actions`, `scenes`, etc.) so multi-field deltas batch.

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
