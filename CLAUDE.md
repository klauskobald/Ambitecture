# CLAUDE.md

Guidance for Claude Code (claude.ai/code) and any other coding agent working in this repository.

---

## READ FIRST: SYSTEM-ARCHITECTURE.md

**Before editing or designing anything, read [`SYSTEM-ARCHITECTURE.md`](SYSTEM-ARCHITECTURE.md) in this repository.** It is the canonical reference for:

- Module layout and what each module owns
- WebSocket protocol, message envelope, and every message type
- Graph state protocol (`graph:command` / `graph:delta` / `runtime:command` / `runtime:update`)
- Animation, binding, intent-registry, and function-curve subsystems
- Hub status / lock-intent / systemCapabilities flows
- `surface-v1` controller architecture (perform subnav, animator viewers, registries)
- Color pipeline (CIE 1931 `xyY`)
- Project / fixture / scene data model
- Mandatory rules for graph state, actions/inputs, dot keys, animations, bindings

This file (CLAUDE.md) covers **only** project-wide conventions, dev commands, and coding style. Anything architectural lives in SYSTEM-ARCHITECTURE.md. If the two ever conflict, SYSTEM-ARCHITECTURE.md wins — update it in the same change as the code.

---

## Project: Ambitecture

A distributed framework for live orchestration of physical environments — lights, DMX hardware, and spatial objects. The system decouples creative **intent** (spatial color/light positions in CIE 1931 `xyY`) from hardware **execution** (DMX, LED, etc.).

**Hard deadline:** May 20, 2026 (live show).

---

## Module Layout

```
modules/
  hub/                 — Central authority: HTTP API, WebSocket server, web GUI
  renderers/           — Hardware output drivers (e.g. DMX, simulator-2d)
  controllers/         — Operator UIs / trigger surfaces (surface-v1, starter)
  deliver/             — Optional static HTTP host for browser-only assets
var/
  fixtures/            — Fixture profile YAML definitions
  projects/            — Project / zone / fixture assignment YAML
```

Each module is self-contained with its own `package.json` (where applicable). There is no monorepo tooling or root-level build.

For what each module does and how they communicate, see SYSTEM-ARCHITECTURE.md.

---

## Dev Commands

### `modules/hub`

```bash
cd modules/hub
npm install
npm run dev          # ts-node --respawn (auto-reload on change)
npm run start        # ts-node (one-shot)
npm run build        # tsc (compile to dist/)
npm run typecheck    # tsc --noEmit
```

Pick a config profile via `.env`:

```bash
cp .env.DEMO .env    # points CONFIG_PATH at config.DEMO/
npm run dev
```

### `modules/renderers/dmx-ts`

```bash
npm run start        # one-shot ts-node run
npm run dev          # watch mode
npm run typecheck    # tsc --noEmit
```

### `modules/controllers/starter`

```bash
npm run start        # one-shot ts-node run
npm run dev          # node --watch
npm run typecheck    # tsc --noEmit
```

### `modules/deliver`

```bash
npm start            # node src/index.js
npm run dev          # node --watch src/index.js
```

### Hub integration tests

```bash
cd modules/hub
ts-node tests/runtest.ts                              # all tests
ts-node tests/runtest.ts 001-blinker.ts               # one test, defaults
ts-node tests/runtest.ts 001-blinker.ts --timeout 5   # one test with timeout
```

Tests are live integration scripts that talk to a running hub via HTTP and/or WebSocket. **No mocks.** The runner reads `tests/test.yml` for shared options (hub URL, per-test config) and passes two objects to every test:

- `data` — CLI-provided: `{ args: string[], timeout: number }`
- `options` — from `test.yml`: `{ url: string, testconfig: Record<string, unknown> }`

Test file contract:

```ts
export const defaultArgs = ['value1', 'value2'];

export async function main(
  data: { args: string[], timeout: number },
  options: { url: string, testconfig: Record<string, unknown> }
) {
  // connect to options.url, send messages, assert responses
  // throw to fail; return to pass
}
```

No hardcoded addresses or local config reads inside test files.

---

## TypeScript / Runtime Setup

- Strict mode + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
- CommonJS output targeting ES2020.
- `ts-node` is the runtime — no compiled output needed for development.
- **Types must be declared in the module where they belong. No shared `types.d.ts` files.**

---

## Conventions

- **No generic `types.d.ts`.** Types are declared inside the module file where they are used.
- **No framework or bundler** for the hub web GUI or `surface-v1`. Plain HTML + CSS + JS, served directly.
- **Mobile-first CSS.** Base styles target small screens; breakpoints add desktop layout.
- Config in YAML (not hardcoded). Listen port/host always come from `server.yml`.
- `Logger` (`src/Logger.ts`) is the shared logging utility for hub-side code.
- **Modules are self-contained.** No `../../` cross-module imports. Duplication is acceptable for now — shared utilities will be extracted into a proper shared package later.
- **Renderers must stay in sync.** Whenever you update a renderer (e.g. `dmx-ts`), apply the same logic change to all other renderers (e.g. `simulator-2d`). Renderers share the same event model, LayerIntentEngine, fixture classes, and `FnCurve` math — divergence causes hard-to-debug behavioral differences at runtime.
- **Hub is the source of truth.** Renderers and controllers may cache hub data in memory but must not invent authoritative state. Use `runtime:command` for transient streams, `graph:command` for durable changes.

---

## Coding Style

### Structure and dispatch

- Entry points (`index.ts`, `main.js`) are thin orchestrators — they wire things up and delegate; no business logic lives there.
- Each WebSocket message type is handled by a dedicated class/file. The entry point routes by `type` using a handler map, never inline logic.
- Event classes (`class: "light"`, etc.) are **imported dynamically** so new event types can be added without touching the dispatcher.

```ts
const handler = await import(`./events/${event.class}Event`);
handler.default.handle(event);
```

### Interfaces and types

- Define proper interfaces or class hierarchies wherever the shape of data is non-trivial. Don't use anonymous object types for anything that crosses a function boundary.

### Helper files

- Formatting, color math (CIE conversions, gamut mapping), geo/spatial math, function curves (`FnCurve`), and DMX utilities each live in their own reusable file or class. No ad-hoc helpers scattered in business logic files.
- For dot-path graph patches use the module-local `dotPath` helper (`hub/src/dotPath.ts`, `surface-v1/src/core/dotPath.js`). Do not hand-roll `split('.')` traversal in feature code.

### Fixture / device / animator abstraction pattern

Whenever a concept has multiple concrete types (fixture classes, event kinds, device protocols, animator classes), apply this three-layer structure:

1. **Utility helper** — stateless plain object of reusable primitives (e.g. `CanvasDraw`). No state, no constructor. Imported and called directly by subclasses.
2. **Base class** — owns the lifecycle interface the orchestrator depends on and the shared helpers all subclasses need. Abstract methods use throw stubs with `_`-prefixed params:
   ```js
   draw(_ctx, _cx, _cy, _ppm) { throw new Error(`${this.constructor.name} must implement draw()`); }
   ```
   Takes a **config bag** (`drawConfig`, `deviceConfig`, etc.) and stores only the slice it needs.
3. **Derived class** — `class Foo extends Base`. Implements only what is specific to this type. Accesses type-specific config via `this._drawConfig.<key>`. Calls utility helpers directly.

**Orchestrator rule:** the caller (renderer, dispatcher, animator host, etc.) depends only on the base class interface. Zero type-specific branches or property reads.

**Config bag rule:** pass the full typed config object at construction; each subclass picks what it needs. Adding a new fixture/animator type requires no changes to the orchestrator or config structure.

### Function design

- Keep functions small and single-purpose. Prefer more functions with long, descriptive names over fewer large ones.
- Use `switch`/`case` for any multi-branch dispatch on a discriminator value. Avoid `if / else if / else` chains.
- Break complex boolean expressions into named constants before using them:

```ts
const isWithinRange = position.x > bounds.x0 && position.x < bounds.x1;
const isActiveLayer = event.params.layer >= currentLayer;
if (isWithinRange && isActiveLayer) { ... }
```

### Comments and dead code

- Default to writing no comments. Add one only when the **why** is non-obvious (a hidden constraint, a subtle invariant, a workaround for a specific bug).
- Don't explain **what** the code does — well-named identifiers do that.
- Don't reference the current task, fix, or callers in code (`// added for the X flow`, `// used by Y`) — that belongs in the PR description.
- Don't leave `// removed` placeholders or back-compat shims for code you actually deleted.
- Do not remove existing comments while editing files unless the surrounding code they describe is also being removed.

---

## Reminders for Agents

- **Read SYSTEM-ARCHITECTURE.md before designing anything.** Then check the actual code in case the doc lags.
- **Editing `modules/controllers/surface-v2/`:** read [modules/controllers/surface-v2/CLAUDE.md](modules/controllers/surface-v2/CLAUDE.md) first. The layout shell under `src/layout/` is framework code — extend via pane registration and leaf-chrome adapters; do not add domain-specific logic there.
- **Update SYSTEM-ARCHITECTURE.md in the same change** when you touch architecture, protocols, or shared subsystems. Stale architecture docs are worse than no docs.
- When changing renderer behavior, change every renderer (`dmx-ts`, `simulator-2d`) — never just one.
- When changing a `system.yml` capability shape (input kinds, animation classes, function curves, intent properties), check both the hub and `surface-v1` sides — they must stay in sync.
- For new headless controllers, start from `modules/controllers/starter/` — it has the correct registration flow, GUID-keyed graph replica, lifecycle hooks for every inbound hub message, and typed send helpers. On `register`, set `subscribe: { runtime: false }` when the module only pushes pulse/actions and does not need perform `runtime:update`; set `runtime: true` when it mirrors perform live state (e.g. `surface-v1`, sample runtime loop).
