# Controller web test

Static shell that embeds **simulator-2d** in an iframe (hub-driven renderer), connects to the hub as a **controller**, receives **project `config`** (per-zone `boundingBox` and fixtures from [`var/projects`](../../../var/projects)), and draws touch/pointer traces on a **transparent overlay canvas**. Pointer positions use the **same on-screen rect** as `#sim-canvas` and **linear** mapping into meters along the zone bbox XZ span (see `#spatial-readout`). The iframe has `pointer-events: none` so local input does not reach the simulator.

## Config (`config.json`)

Tunable layout and overlay drawing values live next to `index.html` in **`config.json`** (no hardcoded layout numbers in `src/main.js` / `src/styles.css`). Required keys:

| Key | Meaning |
|-----|--------|
| `AMBITECTURE_HUB_URL` | Hub HTTP URL (used to open the WebSocket). |
| `GEO_LOCATION` | Two numbers as in renderer config (`"lon lat"`) for the register envelope. |
| `CONTROLLER_GUID` | `guid` sent with `role: controller`. |
| `SIMULATOR_RENDERER_GUID` | Which project zone’s `boundingBox` to use for touch→meters (must match the embedded simulator’s renderer GUID). |
| `SIMULATOR_IFRAME_URL` | Path or URL for the simulator document (e.g. `/simulator-2d/` on the same deliver host). |
| `LAYOUT.pagePaddingPx` | Root `body` padding in px. |
| `LAYOUT.mainGapPx` | Gap between simulator stack and control strip. |
| `LAYOUT.simStackMinHeightVh` | Minimum height of the simulator stack in `vh`. |
| `LAYOUT.controlStripMinHeightPx` | Reserved strip height for future sliders. |
| `LAYOUT.iframeZIndex` | Stacking order for the iframe. |
| `LAYOUT.overlayZIndex` | Stacking order for the overlay canvas (should be above iframe). |
| `LAYOUT.overlayFingerRadiusPx` | Radius of touch indicator circles. |
| `LAYOUT.overlayFingerFillRgba` | Fill color (CSS rgba string). |
| `LAYOUT.overlayFingerStrokeRgba` | Stroke color. |
| `LAYOUT.overlayLineWidthPx` | Stroke width for indicators. |
| `LAYOUT.overlayTrailFadeMs` | How long finger marks stay visible. |

If any required key is missing or wrong type, the page shows an error in the header and logs to the console.

## Run (with deliver)

From repo root, start **[`modules/deliver`](../deliver)** so both mounts exist (`deliver.yml` should list `controller-test` and `simulator-2d`). Then open:

`http://127.0.0.1:8080/controller-test/`

(Adjust host/port to match `deliver.yml` `listen`.)

## Smoke test

With deliver already listening:

```bash
cd modules/controllers/web-test
node tests/deliver-smoke.mjs
```

Override base URL:

```bash
DELIVER_BASE=http://127.0.0.1:9090 node tests/deliver-smoke.mjs
```
