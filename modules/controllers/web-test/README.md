# Controller web test

Static shell that embeds **simulator-2d** in an iframe (hub-driven renderer) and draws touch/pointer traces on a **transparent overlay canvas** in the parent page. The iframe has `pointer-events: none` so local input does not reach the simulator; overlay input is visual only in this version.

## Config (`config.json`)

All tunable layout and overlay drawing values live next to `index.html` in **`config.json`** (no hardcoded layout numbers in `src/main.js` / `src/styles.css`). Required keys:

| Key | Meaning |
|-----|--------|
| `AMBITECTURE_HUB_URL` | Hub HTTP URL (reserved for a future parent WebSocket client). |
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
