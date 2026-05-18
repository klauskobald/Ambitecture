# CLAUDE.md — surface-v2

**Agents: read this file before editing anything under `modules/controllers/surface-v2/`.**  
Also obey repo-root [CLAUDE.md](../../../CLAUDE.md) and [SYSTEM-ARCHITECTURE.md](../../../SYSTEM-ARCHITECTURE.md) for hub protocol and graph rules. **Do not edit `surface-v1`** unless explicitly asked.

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
| `src/layout/leafChromeRegistry.js` | Optional chrome row between leaf header and body (paired tabs, pinned mounts) |
| `src/layout/loadLayoutCatalog.js` | Parse/validate `LAYOUT_MANAGER` tree (`parseLayoutCatalog` is generic) |
| `src/layout/splitResize.js` | Draggable split grips |
| `src/layout/layoutSplitState.js` | Persist split ratios + active layout id (localStorage) |
| `src/styles/layout.css` | Layout shell class contract |

**Allowed changes here:** more generic capability (e.g. injectable storage key, pluggable catalog loader, extra leaf-chrome hooks). **Not allowed:** `if (paneId === 'stage-edit')`, imports from `src/stage/`, `src/edit/`, `hubConnection`, etc.

### Extension points (put product logic here)

| Mechanism | Where to register | Use for |
|-----------|-------------------|---------|
| Pane renderer | `src/app/main.js` → `registerPaneRenderer(id, factory)` | Normal tab: `mount` / `activate` / `deactivate` on a body mount |
| Leaf chrome adapter | `src/app/main.js` → `registerLeafChrome(adapter)` | Tab with no own mount, extra row, or “pin” another pane’s mount visible |
| Layout catalog | `config.json` → `LAYOUT_MANAGER` | Tree of `hbox` / `vbox` / `leaf`; optional `tags` on nodes |
| Pane implementations | `src/layout/renderers/*.js` | Per-tab UI (e.g. `StagePane`, `StageEditPane`, placeholders) |

**Leaf chrome adapter contract** (`leafChromeRegistry.js`):

- `ownerPaneId` — tab id that owns chrome activate/deactivate
- `createRow(leafEl, paneIds)` — DOM between header and body
- `isChromeVisible(activePaneId)` — show/hide chrome row
- `keepMountVisible(activePaneId, mountPaneId, paneIds)` — keep another pane’s mount in DOM without activating it
- `getRenderer(chromeRowEl)` — renderer for `ownerPaneId`
- `onLayoutRebuild()` — optional; after full layout rebuild (e.g. rebind tagged overlays)

Example: `stageEditLeafChrome` in `src/layout/renderers/StageEditPane.js` (stage + stage-edit pair).

### Layout tags (framework mechanism, product styling)

Catalog `tags: ["stage-edit", ...]` → `data-layout-tag` + `layout-tag-host--{tag}` on the built node. Product code may query hosts (e.g. `IntentParamsHost` → `[data-layout-tag~="stage-edit"]`). **Do not** hardcode tag names inside `LayoutManager.js`; only in product modules/CSS.

### Stage / hub subsystems (product — do not fold into layout shell)

| Area | Path | Notes |
|------|------|--------|
| Hub wiring | `src/app/hubConnection.js`, `src/core/socket.js`, `outboundQueue.js` | Hub is source of truth |
| Stage surface | `src/stage/controllerSurface.js`, `stageOverlayHost.js` | Simulator iframe + overlay canvas |
| Overlay policy | `src/stage/stageOverlayCoordinator.js` | Single writer for perform vs edit |
| Edit / perform UI | `src/edit/`, `src/perform/`, `src/viewport/` | Ported from v1; grows here |
| Config | `src/app/config.js`, `config.json` | Loads catalog + hub URL |

When adding a feature, **default to a new renderer or adapter**, not a change to `LayoutManager.js`.

---

## Directory map (quick)

```
src/app/          entry (main.js), config, hub, status UI
src/layout/       layout framework + renderers/
src/stage/        simulator stack, overlay host, intent params host
src/edit/         property panels, selection, action edit (v1 port)
src/perform/      perform HUD
src/viewport/     interaction policies, selection managers
src/core/         graph, color, modal, capabilities (v1 port)
src/styles/       theme + feature CSS
```

---

## Agent checklist

Before submitting changes:

1. **Touched `src/layout/` outside `renderers/`?** Change must be generic; no pane ids, no domain imports. If you need stage-edit behavior, use `registerLeafChrome` or a renderer.
2. **New tab or layout region?** Add renderer + catalog entry; register in `main.js`.
3. **Paired tabs sharing one mount?** Leaf chrome adapter + `keepMountVisible`; do not duplicate mounts in `LayoutManager`.
4. **Hub / graph behavior?** Follow SYSTEM-ARCHITECTURE.md; use `graph:command` / `runtime:command` appropriately.
5. **Updated architecture or protocol?** Update SYSTEM-ARCHITECTURE.md in the same PR (repo rule).

---

## Conventions (surface-v2)

- **Entry point** `src/app/main.js` stays thin: load config, register panes/chrome, `LayoutManager.init`, `connectStageHub`.
- **PaneRenderer** lifecycle: `mount(container)` once; `activate` / `deactivate` on tab switch.
- **CSS:** mobile-first; layout shell classes prefixed `layout-`; product features use their own sheets (`stageEdit.css`, `performHud.css`, …).
- **No cross-module imports** outside `surface-v2` (repo rule). Copy small v1 helpers if needed until a shared package exists.
- **Comments:** same as repo CLAUDE.md — only for non-obvious *why*.

---

## Future notes (extend this section)

_Add short dated bullets when new framework boundaries or extension points appear._

- **2026-05:** Layout shell decoupled from `stage` / `stage-edit` via `leafChromeRegistry` + `stageEditLeafChrome`.
