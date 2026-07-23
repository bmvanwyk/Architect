# Super-Architects: Improvement Plan

## Scope

Three-phase improvement to the Super-Architects distributed systems learning game. This spec covers all three phases at a high level; Phase 1 (Code Architecture) is detailed for immediate implementation.

## Phase 1: Code Architecture

### Goals

- Replace global `window.*` namespace with ES modules
- Split monolithic files into focused units
- Add Retina/HiDPI canvas support
- Add browser-based unit tests for simulation core

### File Structure

```
index.html                  — single <script type="module" src="js/app.js">
js/
  app.js                    — bootsrap: import Simulation, Renderer, UI, AudioManager
  simulation/
    index.js                — Simulation class: orchestrates tick(), routes packets, tracks stats/objectives
    node.js                 — Node class: hero towers (volt, dispatcher, mind-palace, coordinator, clones)
    packet.js               — Packet class: distress calls, ACKs, retries, replication payloads
    portal.js               — Portal class: network links between nodes (loss rate, partition state)
    save-manager.js         — serialize/deserialize with schema validation, QuotaExceededError handling
  levels.js                 — unchanged: level config array
  renderer.js               — canvas drawing (add devicePixelRatio scaling)
  audio.js                  — unchanged: procedural Web Audio synth
  ui/
    index.js                — UI class: event binding, tick UI refresh, orchestrates sub-modules
    inspector.js            — component inspector panel (upgrades, settings toggles)
    telemetry.js            — live statistics dashboard + node telemetry cards
    tutorial.js             — tutorial overlay (slides, navigation, skip)
    panel-resizer.js        — drag-to-resize for left/right panels
tests/
  test-runner.html          — minimal test harness (no framework, pure JS)
  simulation-tests.js       — tests for packet routing, replication, CAP, save/load
```

### Module Conversion Rules

1. Every class gets `export default class ...` instead of `window.ClassName = class ...`
2. `index.html` loads only `js/app.js` via `<script type="module" src="js/app.js">`
3. `app.js` imports all dependencies, bootsraps on `DOMContentLoaded`
4. Cross-file references (e.g. `window.Levels` in simulation) become explicit imports
5. No circular dependencies allowed

### Extraction Boundaries

**simulation/index.js:**
- Retains: `tick()`, packet routing orchestration, emergency spawn logic, stats accumulation, objective checking, callback dispatch
- Imports: `Node`, `Packet`, `Portal`, `SaveManager`
- Methods that create/mutate nodes/packets/portals delegate to the entity classes

**simulation/node.js:**
- `Node` class from current simulation.js (type, position, level, queue, CPU load, health, role, settings)
- Methods: `takeDamage(amount)`, `upgrade(stat)`, `serialize()`, `static deserialize(data)`

**simulation/packet.js:**
- `Packet` class (id, type, from, to, state, payload, metadata)
- State machine: `spawned → enqueued → dispatched → sent → ack-waiting → completed | failed | retried`
- Methods: `retry()`, `ack()`, `fail()`, `serialize()`, `static deserialize(data)`

**simulation/portal.js:**
- `Portal` class (id, from, to, lossRate, healthCheckEnabled)
- Methods: `transmit(packet) → boolean` (applies loss rate), `serialize()`, `static deserialize(data)`

**simulation/save-manager.js:**
- `SaveManager` class
- `save(simulation) → void`: serializes nodes, portals, settings, stats, level; writes to localStorage key `super_architects_save_state`
- `load() → SimulationState | null`: reads localStorage, validates schema (version field, required keys), parses and returns state object, or null on corruption/missing
- Validates: `version` field exists, `nodes` is array, `credits` is number, `tickCount` is number, `settings` has required keys
- On `QuotaExceededError`: logs warning and surfaces message via callback
- `clear()`: removes saved state

**ui/index.js:**
- Retains: DOM cache, event binding, level selector, deploy card/tool listeners, `updateTickUI()`, overlay show/hide
- Calls out to sub-modules for inspector/telemetry/tutorial/resizer

**ui/inspector.js:**
- `renderInspector(node, sim)` builds the selected-node details + upgrade buttons
- `clearInspector()` resets to empty state
- No DOM queries for the inspector container — receives container element from UI

**ui/telemetry.js:**
- `updateTelemetry(sim)` refreshes the 4 metric cards and the node telemetry list
- `clearTelemetry()` resets to empty state

**ui/tutorial.js:**
- `Tutorial` class with slide array, `start()`, `next()`, `back()`, `skip()`
- Renders into a provided container/overlay element

**ui/panel-resizer.js:**
- `PanelResizer(resizerElement, targetPanel, options)` handles mousedown/mousemove/mouseup
- No `mousemove` on `document` leaks — listener is attached on mousedown, removed on mouseup

### Retina Canvas

In `renderer.js`, modify `resize()`:

```
const dpr = window.devicePixelRatio || 1;
canvas.width = rect.width * dpr;
canvas.height = rect.height * dpr;
canvas.style.width = rect.width + 'px';
canvas.style.height = rect.height + 'px';
ctx.scale(dpr, dpr);
```

### Tests

**Test harness** (`tests/test-runner.html`):
- Imports simulation modules from `../js/simulation/index.js`
- Provides a minimal `assert(condition, message)` function
- Runs test suites and renders pass/fail counts to the page
- No test framework dependency

**Test suites** (`tests/simulation-tests.js`):

Packet routing:
- Portal with 0% loss: packet always arrives
- Portal with 100% loss: packet always dropped
- ACK enabled: packet transitions through ack-waiting state
- Retry enabled + loss: packet retries and eventually completes
- Dedup enabled: duplicate packet IDs are discarded

Replication:
- Primary writes data, replica reads it after sync
- Replication lag: stale read returns old data

CAP:
- AP mode during partition: both sides accept writes, conflicts resolved on heal
- CP mode during partition: minority side rejects writes

Save/load:
- Round-trip: serialize then deserialize produces identical state
- Corrupted JSON: returns null
- Missing version field: returns null

## Phase 2: Gameplay UX

### Undo / Delete

- Right-click on a placed node or portal → confirm → removes it, refunds partial credits
- `simulation.removeNode(id)` and `simulation.removePortal(id)` methods
- UI binds `contextmenu` event on canvas, delegates to inspector's selected node or hit-test

### Speed Controls

- Add 1x/2x/4x buttons next to Play/Pause in the game controls
- `Simulation.tick()` interval multiplier: at 2x, every `requestAnimationFrame` runs 2 ticks; at 4x, 4 ticks
- Audio BPM scales proportionally with speed multiplier (caps at 240 BPM)

### AudioContext Autoplay Fix

- `AudioManager.start()` calls `ctx.resume()` before creating any nodes
- Catch `ctx.resume()` rejection (still blocked) and retry on next user interaction

## Phase 3: Polish

### Self-Hosted Fonts

- Download the 2 Google Fonts (Outfit, Plus Jakarta Sans) as woff2
- Host in `fonts/` directory
- Replace `<link rel="preconnect" href="https://fonts.googleapis.com">` with `@font-face` declarations in CSS
- Remove all Google Font CDN references from `index.html`

### Mobile-Responsive Layout

- Below 900px viewport width: side panels collapse to bottom drawers (triggered by tab-style toggles)
- Canvas fills remaining viewport height
- Header stats stack vertically
- Draggable resizers hidden below breakpoint

### Save/Load Validation

- `SaveManager.load()` validates schema version, field types, and required keys
- Corrupted state shows a user-facing error message instead of silently crashing
- Export/import via JSON file download/upload as a backup mechanism

## Out of Scope (for this round)

- TypeScript conversion (would conflict with the zero-dependency ethos unless compiled, which adds a build step)
- Service worker / full offline PWA
- Multiplayer or real-time collaboration
- New levels beyond the existing 6
