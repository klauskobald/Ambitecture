# Contributing to Ambitecture

Thanks for your interest in contributing. Ambitecture is currently focused on production readiness for a live show on **May 20, 2026**, so changes that destabilize core flows or expand scope late in that window will be deferred.

## Before You Start

1. Read [`README.md`](README.md) for the project overview and quick start.
2. Read [`SYSTEM-ARCHITECTURE.md`](SYSTEM-ARCHITECTURE.md) — it is the canonical reference for module layout, the WebSocket protocol, graph state, animations, bindings, and the intent registry. **Any architectural change must update this document in the same commit.**
3. Read [`CLAUDE.md`](CLAUDE.md) for project-wide conventions and coding style. Human contributors should follow the same rules.

## Development Setup

The repository is a collection of self-contained modules. There is no monorepo tooling and no root-level build.

```text
modules/
  hub/                     Central authority (HTTP + WebSocket)
  renderers/dmx-ts/        DMX renderer (TypeScript)
  renderers/simulator-2d/  Browser-based 2D simulator
  controllers/surface-v2/  Primary touch operator UI (static HTML/JS)
  controllers/surface-v1/  Deprecated — do not edit (agents/humans: use v2)
  controllers/starter/     Minimal headless controller reference
  deliver/                 Optional static HTTP host for browser modules
var/
  fixtures/                Fixture profile YAML
  projects/                Project / zone YAML
```

Each module installs and runs independently:

```bash
cd modules/hub
npm install
cp .env.DEMO .env
npm run dev
```

See [`README.md`](README.md) and [`CLAUDE.md`](CLAUDE.md) for the full per-module command list.

## Reporting Issues

Please open a GitHub issue with:

- What you were trying to do.
- What happened (with logs from hub / renderer / controller where relevant).
- Module versions or commit hash.
- Project / fixture YAML if the issue is config-driven.

For runtime issues, the `Logger` output from `modules/hub` is usually the most useful artifact.

## Pull Requests

### Scope

- Keep PRs focused on a single concern. Refactors and feature work should not be bundled.
- Don't add features, abstractions, or backwards-compatibility shims beyond what the task requires.
- If a change spans hub + renderer + controller, that is fine — but call it out in the PR description.

### Before opening a PR

- Run `npm run typecheck` in every module you touched.
- Run the hub integration tests when changing hub behavior:
  ```bash
  cd modules/hub
  ts-node tests/runtest.ts
  ```
- Verify the change end-to-end against a live hub when it touches the WebSocket protocol, graph state, animations, or bindings. There are no mocks — tests are live integration scripts.
- For UI changes in `surface-v2` or `simulator-2d`, exercise the feature in a real browser session against a running hub. Do not change deprecated `surface-v1`.

### What to include in the PR description

- A short summary of the change and why.
- Any architectural impact (link to the section of `SYSTEM-ARCHITECTURE.md` you updated).
- Test plan: which scripts you ran, which flows you exercised manually.

## Coding Conventions

These are enforced by review. Full detail in [`CLAUDE.md`](CLAUDE.md).

### Module boundaries

- **Modules are self-contained.** No `../../` cross-module imports. Duplication is acceptable while the architecture is still stabilizing.
- **Hub is the source of truth.** Renderers and controllers may cache hub data in memory but must not invent authoritative state.
- **Renderers must stay in sync.** Any logic change to one renderer (e.g. `dmx-ts`) must be applied to every other renderer (e.g. `simulator-2d`). Divergence causes hard-to-debug behavioral drift.
- **Configuration goes through `Config.ts`** in the hub. No direct `fs` / `yaml` reads in feature code.

### TypeScript

- Strict mode, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` are on. Don't relax them.
- **No shared `types.d.ts`.** Types are declared inside the module file where they are used.
- `ts-node` is the runtime for development — no compiled output needed.

### Style

- Entry points are thin orchestrators. Each WebSocket message type gets its own handler class/file, dispatched via a handler map.
- For concepts with multiple concrete types (fixtures, animators, devices, event kinds), use the three-layer pattern from `CLAUDE.md`: utility helper + base class + derived class. Each animator class owns its own edit interface — do not invent a shared abstraction across animators.
- Use `switch` / `case` for multi-branch dispatch on a discriminator. Avoid `if / else if / else` chains.
- Keep functions small and single-purpose. Break complex boolean expressions into named constants before using them.
- For dot-path graph patches use the module-local `dotPath` helper. Do not hand-roll `split('.')` traversal.

### Comments

- Default to writing no comments. Add one only when the **why** is non-obvious — a hidden constraint, a subtle invariant, or a workaround for a specific bug.
- Don't explain **what** the code does — well-named identifiers do that.
- Don't reference the current task, fix, or callers in comments. That belongs in the PR description.
- Don't leave `// removed` placeholders or back-compat shims for code you actually deleted.

### CSS

- Mobile-first. Base styles target small screens; breakpoints add desktop layout.
- No frameworks or bundlers in the hub web GUI or controller surfaces (`surface-v2`). Plain HTML + CSS + JS.

## Architecture Changes

If your change touches any of the following, update [`SYSTEM-ARCHITECTURE.md`](SYSTEM-ARCHITECTURE.md) in the same commit:

- WebSocket message types or envelope shape
- `graph:command` / `graph:delta` / `runtime:command` / `runtime:update` semantics
- Animation, binding, intent-registry, or function-curve subsystems
- Hub status, lock-intent, or `systemCapabilities` flows
- `surface-v2` controller architecture (`surface-v1` is deprecated — do not edit)
- The color pipeline (CIE 1931 `xyY`)
- Project / fixture / scene data model

Stale architecture docs are worse than no docs.

## Cross-Module Sync Checklist

Before merging, check that:

- [ ] Every renderer (`dmx-ts`, `simulator-2d`) has the same change applied.
- [ ] If `system.yml` capability shapes changed (input kinds, animation classes, function curves, intent properties), both the hub and `surface-v2` reflect it.
- [ ] `SYSTEM-ARCHITECTURE.md` is updated if architecture changed.
- [ ] `CLAUDE.md` is updated if project-wide conventions changed.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
