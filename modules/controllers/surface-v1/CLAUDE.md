# DEPRECATED — do not edit

**`modules/controllers/surface-v1/` is frozen.** Coding agents must not modify, refactor, format, or “fix” anything under this path.

## Agent rules

1. **Do not open or edit** files under `surface-v1/` for any task (features, bugs, sync with hub, `system.yml`, styling, docs-in-code, etc.).
2. **Do not copy new code from v1 into other modules** except as read-only reference when porting to **`surface-v2`**.
3. **Implement all controller UI work in** [`../surface-v2/`](../surface-v2/) — read [`../surface-v2/CLAUDE.md`](../surface-v2/CLAUDE.md) first.
4. The **only** exception: the user explicitly names `surface-v1` and asks for a change in that module in the same message.

## Where to work instead

| Was (v1) | Use (v2) |
|----------|----------|
| `controllers/surface-v1/` | `controllers/surface-v2/` |
| `src/core/dotPath.js` | `surface-v2/src/core/dotPath.js` |
| `src/panes/animators/` | `surface-v2/src/perform/animators/` |
| `src/edit/inputAssign/paramKindHandlers.js` | `surface-v2/src/edit/inputAssign/paramKindHandlers.js` |
| `src/core/Modal.js` | `surface-v2/src/core/Modal.js` |

Repo-wide agent guidance: [../../../CLAUDE.md](../../../CLAUDE.md).
