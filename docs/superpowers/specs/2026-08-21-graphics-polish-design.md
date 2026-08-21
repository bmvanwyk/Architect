# Graphics Polish Design — "Clean Sci-Fi UI"

**Date:** 2026-08-21
**Goal:** Significantly improve the game's graphics with a *visual juice / polish* pass — same structure and meaning, dramatically richer look — without breaking any existing behavior.
**Style direction:** Clean Sci-Fi UI (glassmorphism, soft restrained glow, crisp lines, minimal noise).
**Icon treatment:** Inline SVG sprite emblems (data-URI) replacing emoji.

## Constraints (agreed)

- Keep the repo **zero-dependency / zero-build** rule. No npm packages, no bundler.
- Adding asset files and a vendored lib is permitted *if needed*, but this design uses **pure Canvas 2D + embedded data-URI SVG** — no vendored lib required.
- All canvas drawing stays owned by `renderer.js`. `fx.js` provides helpers called by the renderer; it never mutates simulation state.
- FX reads only existing `sim` data fields; it introduces **no new simulation state**.
- Degrades gracefully: if `fx.js` fails to load, the game must still run with current visuals (guard every `FX.*` call with `if (window.FX)`).

## Architecture

- New file `js/fx.js` defines `window.FX` — reusable presentation helpers plus a small particle pool.
- Loaded via a `<script>` tag in `index.html` **before** `renderer.js`, so `FX` exists by the time `draw()` runs.
- `renderer.js` keeps owning the canvas draw calls but delegates effect work to `FX.*`.
- FX holds only presentation state: cached sprites, an offscreen background canvas, and particle arrays. None of this affects game logic or headless simulation tests.

## `fx.js` Components

1. **`FX.starfield(ctx, w, h)`** — cached offscreen parallax dot-field + faint drifting grid, regenerated on resize. Replaces the bare crosshair grid background.
2. **`FX.glassNode(ctx, node)`** — radial-gradient "glass" fill, inner highlight, soft outer glow ring, status-colored border, and CPU-load arc.
3. **`FX.sprite(type)`** — cached `Image` built from an embedded **data-URI SVG** hero emblem (tower / volt / dispatcher / mind-palace / coordinator, plus a frozen variant). Falls back to a simple colored ring if the image is not yet ready, so nothing ever disappears.
4. **`FX.energyLink(ctx, from, to, t, color)`** — animated flowing dashes along portal links; uses the existing red dashed style when the link is partitioned.
5. **`FX.particles`** — pooled comet trails behind packets and spark bursts on meteor hits. Exposes `spawn(x, y, color, kind)`, `update()`, `draw(ctx)`.
6. **Utilities** — `lerp`, `easeOut`, and a glow-gradient cache keyed by color/radius to avoid per-frame gradient allocation.

## `renderer.js` Changes (contained)

- `draw()`: call `FX.starfield` as the first step; keep the existing district labels.
- `drawPortals()`: delegate to `FX.energyLink`; preserve the red-dashed partition behavior.
- `drawNodes()`: use `FX.glassNode` + `FX.sprite` in place of the emoji `fillText(icon)`. Keep the FROZEN box, queue dots, name/level label, and dbRole text (restyled within the glass frame).
- `drawPackets()`: draw a glowing comet head with a short gradient tail via the particle trail, instead of a plain circle.
- `drawMeteors()`: add spark particles on explosion; keep the existing ring.
- `resize()`: also call `FX.onResize(w, h)` to rebuild the cached background.

## No-Break Guarantees

- Reads only existing sim fields: `x, y, type, status, cpuLoad, queue, dbRole, isFrozen, level, name, progress, packets[].state/type, portals, emergencies`.
- Zero changes to `simulation.js` or `levels.js`.
- Data-URI SVGs require no network fetch → works under `file://` and in headless contexts.
- Every `FX.*` access is guarded so a missing `fx.js` degrades to current visuals.

## Testing & Verification

1. `node --check js/fx.js && node --check js/renderer.js` after every edit.
2. AGENTS.md headless integration test (loads only `levels.js` + `simulation.js`) must still pass unchanged — proves FX touches no game logic.
3. FX smoke test: a small `node -e` with a minimal `window`/`document` shim that asserts `FX` exposes `starfield, glassNode, sprite, energyLink, particles` (catches missing exports without a browser).
4. Manual browser pass on Levels 1–3: no console errors, 60fps holds, visuals correct, and graceful fallback confirmed by temporarily removing `fx.js`.

## Docs Updates

- `AGENTS.md` file-responsibilities table: add
  `fx.js | Presentation-only effects (background, glow, sprites, particles); called by renderer; never mutates sim`.
- `README.md` / `docs/architecture.md`: one-line note that rendering polish lives in `fx.js` + `renderer.js`.
- No changes to `levels.js` / `simulation.js` documentation.

## Out of Scope (YAGNI)

- No new gameplay, levels, or simulation changes.
- No vendored third-party library (pure Canvas 2D is sufficient).
- No CSS/DOM overhaul of the surrounding UI panels (only canvas visuals).
