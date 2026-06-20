# CLAUDE.md — surface-v2

**Agents: read this file before editing anything under `modules/controllers/surface-v2/`.**  
Also obey repo-root [CLAUDE.md](../../../CLAUDE.md) and [SYSTEM-ARCHITECTURE.md](../../../SYSTEM-ARCHITECTURE.md) for hub protocol and graph rules. **`surface-v1` is deprecated and frozen — never edit it** (only if the user explicitly requests a v1 change in the same message).

---

## What this module is

Browser controller UI for Ambitecture: configurable split layouts, tabbed panes, simulator stage + perform/edit overlays, hub WebSocket. Plain HTML/CSS/JS (no bundler). Config from `config.json` (`LAYOUT_MANAGER`, hub URL, layout CSS vars).

`surface-v2` is a **slow port** from `surface-v1`. Prefer extending v2 patterns over copying v1 monoliths into the layout shell.

---

## Framework vs product code

### Layout shell (framework — extend, do not specialize)

These implement a **generic** layout engine. They must stay free of Ambitecture domain logic (no hub types, intents, perform/edit policies, hardcoded pane ids like `stage` / `stage-edit`).

| Path | Role |
|------|------|
| `src/layout/LayoutManager.js` | Build hbox/vbox/leaf tree, layout toolbar, tab activate/deactivate, lazy pane mounts |
| `src/layout/paneRendererRegistry.js` | `registerPaneRenderer` / `createPaneRenderer` |
| `src/layout/loadLayoutCatalog.js` | Parse/validate `LAYOUT_MANAGER` tree (`parseLayoutCatalog` is generic) |
| `src/layout/splitResize.js` | Draggable split grips |
| `src/layout/layoutSplitState.js` | Persist split ratios + active layout id (localStorage) |
| `src/styles/layout.css` | Layout shell class contract |

**Allowed changes here:** more generic capability (e.g. injectable storage key, pluggable catalog loader, optional `onLayoutRebuild` callback on `init`). **Not allowed:** `if (paneId === 'stage-edit')`, imports from `src/stage/`, `src/edit/`, `hubConnection`, etc.

### Extension points (put product logic here)

| Mechanism | Where to register | Use for |
|-----------|-------------------|---------|
| Pane renderer | `src/app/main.js` → `registerPaneRenderer(id, factory)` | `mount` / `activate` / `deactivate` on a body mount |
| Layout catalog | `config.json` → `LAYOUT_MANAGER` | Tree of `hbox` / `vbox` / `leaf`; optional `tags` on nodes |
| Layout rebuild hook | `LayoutManager.init({ onLayoutRebuild })` from `main.js` | Rebind product overlays after preset change (no pane ids in layout code) |
| Pane implementations | `src/layout/renderers/*.js` | Per-tab UI |

### Shared simulator (`stageCommon.js`)

**One** iframe + `ControllerSurface` instance for the whole app:

- `initStageCommon(url, layout)` in `main.js` after config load
- `attachStageTo(container)` / `detachStage()` — reparent shared DOM into the active pane slot; detach parks off-DOM (avoids iframe reload) and disposes the stack after 5s idle if nothing re-attaches
- `StagePane` and `StageEditPane` each have a `.layout-stage-slot`; **activate** attaches, **deactivate** detaches (including when switching to non-stage tabs)

Do not build a second simulator in pane renderers. Edit toolbar and policies stay in `StageEditPane`; perform HUD stays in `StagePane`.

### Layout tags (framework mechanism, product styling)

Catalog `tags: ["stage-edit", ...]` → `data-layout-tag` + `layout-tag-host--{tag}` on the built node. Product code may query hosts (e.g. `IntentParamsHost` → `[data-layout-tag~="stage-edit"]`). **Do not** hardcode tag names inside `LayoutManager.js`; only in product modules/CSS.

### Stage / hub subsystems (product — do not fold into layout shell)

| Area | Path | Notes |
|------|------|--------|
| Hub wiring | `src/app/hubConnection.js`, `src/core/socket.js`, `outboundQueue.js` | Hub is source of truth |
| Stage surface | `src/stage/stageCommon.js`, `controllerSurface.js`, `stageOverlayHost.js` | Shared sim + overlay |
| Overlay policy | `src/stage/stageOverlayCoordinator.js` | Single writer for perform vs edit |
| Edit / perform UI | `src/edit/`, `src/perform/`, `src/viewport/` | Ported from v1; grows here |
| Config | `src/app/config.js`, `config.json` | Loads catalog + hub URL |

When adding a feature, **default to a new renderer or a `src/stage/` helper**, not a change to `LayoutManager.js`.

---

## Directory map (quick)

```
src/app/          entry (main.js), config, hub, status UI
src/layout/       layout framework + renderers/
src/stage/        stageCommon, controllerSurface, overlay host, intent params
src/edit/         property panels, selection, action edit (v1 port)
src/perform/      perform HUD
src/viewport/     interaction policies, selection managers
src/core/         graph, color, modal, capabilities (v1 port)
src/styles/       theme + feature CSS
```

---

## Agent checklist

Before submitting changes:

1. **Touched `src/layout/` outside `renderers/`?** Change must be generic; no pane ids, no domain imports.
2. **New tab or layout region?** Add renderer + catalog entry; register in `main.js`.
3. **Need the simulator?** Use `stageCommon` attach/detach from the pane renderer — do not duplicate iframe/overlay construction.
4. **Hub / graph behavior?** Follow SYSTEM-ARCHITECTURE.md; use `graph:command` / `runtime:command` appropriately.
5. **Updated architecture or protocol?** Update SYSTEM-ARCHITECTURE.md in the same PR (repo rule).

---

## Conventions (surface-v2)

- **Entry point** `src/app/main.js` stays thin: `initStageCommon`, register panes, `LayoutManager.init`, `connectStageHub`.
- **PaneRenderer** lifecycle: `mount(container)` once; `activate` / `deactivate` on tab switch.
- **CSS:** mobile-first; layout shell classes prefixed `layout-`; product features use their own sheets (`stageEdit.css`, `performHud.css`, …).
- **No cross-module imports** outside `surface-v2` (repo rule). Copy small v1 helpers if needed until a shared package exists.
- **Comments:** same as repo CLAUDE.md — only for non-obvious *why*.

---

## Future notes (extend this section)

_Add short dated bullets when new framework boundaries or extension points appear._

- **2026-05:** Shared sim via `stageCommon.js`; `stage` / `stage-edit` are normal tab renderers (attach on activate, detach on deactivate). Removed leaf-chrome pairing for stage-edit.
- **2026-05:** Pulse bucket ↔ animation assignment (`PulseAssignManager`): assign list matches input assign (toggle + ✎ Edit + delete). **Edit** opens one modal for bucket **name** and animation **`execute.params`** (manual runmode), saved with `renameBucket` / `updateAction` as needed.
- **2026-06:** Help system (`src/core/help/`): reusable, **domain-free** in-app help — floating/host-attachable panel + persistent ❓ toggle. `HelpManager.show(key, { host?, onClose? })`; topics authored in `help.json` (`{ heading, text, mandatory? }`). Coupled to the app only via `registerHost(name, getter)` and `setConduit({ callFunction })`, both wired in `main.js`. Inline markup in `renderHelpText.js`: `[text](topicKey)` internal links, `http(s)://` external links, `${plugin:fn(args)}` placeholders. Extend via the protocol registry (`protocols/`) and display-plugin registry (`display/`, e.g. `listView`) — never add domain imports or special-cases inside `help/`. See SYSTEM-ARCHITECTURE.md → Help system.
- **2026-06:** Hub query endpoint `system:probe` (`src/core/HubProbe.js` + hub `probe/`): correlated request/response for read-only hub state. `hubProbe.probe(query, args)` → `Promise`; results routed in `hubConnection.js` (`system:probe:result`). The help **conduit** is now the `HelpConduit` class (`src/app/HelpConduit.js`, app-layer glue) — one `callFunction` case per help function, most returning a probe Promise (e.g. `getRendererList` → `connectedRenderers`). `renderHelpText.js` handles a Promise display result generically (loading placeholder → swap). Add new live-data help functions by adding a `HelpConduit` case + a hub query; do **not** add domain imports to `help/`.
- **2026-06:** Fixture instance editor (`src/edit/fixture/`): double-tap a fixture in Stage edit → `FixtureParamsHost` (twin of `IntentParamsHost`, same `stage-edit` overlay, mutually exclusive). Reuses `PropertyPanel`/`PropertyControl` via an injected **write target** (`{ read, update, remove, save }`) — intents keep the default path. Editable shape = built-in root descriptors + the profile YAML `instance` array (retained from `graph:init`). New extension point: a fixture class overrides display/validation by subclassing `FixtureEditDefault` and registering in `fixtureEditors/registry.js` (lazy import, falls back to default). Writes go out as durable `graph:command` fixture patches via `queueFixturePropertyUpdate`.
