# AGENTS.md — Working on Super-Architects

## Project type

This is a zero-dependency, zero-build, single-page browser game. There is **no package.json**, no bundler, no framework. All JS files communicate through the `window` namespace and are loaded via plain `<script>` tags in `index.html`.

## How to verify your changes

There is no test framework. Instead, verify every change with a Node.js integration script that loads the game code into a `vm` sandbox and runs the simulation headlessly:

```js
// Example: verify fix for Level 3
const fs = require('fs');
const vm = require('vm');
const sandbox = { window: {}, console, Math, Date, Set, Map, JSON };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('./js/levels.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync('./js/simulation.js', 'utf8'), sandbox);

const Sim = sandbox.window.Simulation;
const sim = new Sim(800, 600);
sim.log = () => {}; // silence log spam
const lvl = sandbox.window.Levels.find(l => l.id === 3);
lvl.setup(sim);
// ... apply player actions (deploy, configure settings, etc.)
sim.isPlaying = true;
sim.levelConfig = lvl;
for (let i = 0; i < 12000; i++) {
  if (!sim.isPlaying) break;
  sim.tick();
}
const met = lvl.objectives.filter(o => o.check(sim));
console.log('objectives met:', met.map(o => o.id));
```

Use `timeout 30 node -e "..."` for quick checks; `timeout 120` for full-level tests.

**Always syntax-check after edits:** `node --check <file>`.

## File responsibilities

| File | Owns | Do NOT put here |
|------|------|-----------------|
| `simulation.js` | All game state, tick logic, Node/Packet/Portal classes | DOM manipulation, event handlers, rendering |
| `renderer.js` | Canvas 2D draw calls only | Game state mutation, event handling |
| `ui.js` | DOM binding, inspector, telemetry, tutorial, save/load, deployment | Simulation logic, canvas drawing |
| `app.js` | Bootstrap, game loop, component wiring | No business logic |
| `levels.js` | Level configs (plain objects) | No logic — only `setup`, `tick`, and objective `check` closures |
| `audio.js` | All Web Audio API code | Never call without user-gesture guard |

## Key design rules

### Simulation (`simulation.js`)

1. **`sim.tick()` is the only entry point for advancing state.** Never mutate `sim.nodes`, `sim.packets`, `sim.emergencies`, etc. from outside the tick cycle.

2. **Packet transit is synchronous within a tick.** A packet's `progress` advances by `speed (0.025)` per tick. Delivery fires at `progress >= 1.0` within the same tick.

3. **Packet loss only applies to forwarded packets** — `pkt.from !== null`. The initial `emergency → dispatcher` dispatch has no retry path, so it must be immune to loss.

4. **Dedup must echo an ACK.** When a Volt's `seenPacketIds` catches a duplicate, it immediately sends an ACK back to the sender (usually a Dispatcher). Without this, the sender exhausts its 3 retries even though the call was already resolved.

5. **Dispatchers must always exclude destroyed nodes.** Active-status filtering (`n.status === 'active'`) is always on. `healthCheckEnabled` additionally filters frozen nodes.

6. **Panic coefficient is 0.04.** Don't re-tune it without testing every level — panic controls game-over timing and interacts with spawn rates across all 6 missions.

7. **DB reads and writes use different keys.** The write key (`emergency_shelter`) is a single hot record mutated every rescue — this creates the CAP split-brain in Level 5. The read key (`civilian_address`) is stable, seeded at boot, so replication lag only causes stale reads during the first sync window. If reads target the write key, the replica is stale after every write and Level 4's <5% objective is impossible.

### Levels (`levels.js`)

8. **All pre-placed nodes MUST use `{ preplaced: true }`.** Otherwise `spawnNode` silently deducts credits, breaking the player's budget.

9. **Every level must be verified winnable** with a reasonable player strategy. Run the full-level test above before landing a level change.

10. **Objective `check` closures run every tick.** Avoid O(n²) scans inside checks where possible; use the stats accumulators.

### UI (`ui.js`)

11. **Deploy cards are gated by `levelConfig.allowedHeroes` and credits.** The `card.title` tooltip always explains WHY a card is locked. Never disable a card without providing the reason.

12. **Canvas cursor must reflect the active tool.** `setTool('select'/'wire')` resets the cursor to default. `selectHeroForDeployment(type)` sets it to `crosshair`.

### Audio (`audio.js`)

13. **Never call `new AudioContext()` without a user gesture.** The engine lazy-initialises on first `start()` call, which is always triggered by a click/tap event.

## Common pitfalls

- **`sim.log()` floods the incident log.** Only 35 entries are kept. Throttle verbose per-tick logs (e.g. DB writes every 5th event).
- **`requestAnimationFrame` timestamps are in milliseconds from page load, not frame deltas.** The game loop in `app.js` caps at 60fps via `elapsed >= 16.6` check.
- **Canvas dimensions must be set from `parentElement.getBoundingClientRect()`, not from CSS.** `renderer.resize()` does this; call it after any layout change (panel resize, level load, window resize).
- **Mind-Palace `dbRole` defaults to `id % 2 === 1 ? 'primary' : 'replica'`** based on `this.id` (sequential from `nextNodeId`). If the player deploys mind-palaces out of the expected order, roles may be wrong. Levels 4-5 explicitly set `dbRole` after `spawnNode`.
- **The dispatcher drain is 1 packet per tick.** If the queue grows faster than processing, calls are silently dropped (buffer overflow). This is intentional — it models real-world queue saturation.

## Naming conventions

- Stick to the existing global pattern: `window.ClassName = class ClassName` for the 3 exported classes (Simulation, Renderer, UI, AudioManager).
- Internal classes (Node, Packet, Portal) are script-local and don't need the `window.` prefix.
- Event handler methods on UI use `on` prefix: `handleCanvasClick`, `updateTickUI`.

## Recent Fixes

### 2026-07-25 — Aegis QA pass
- **Bug fix**: `processPortals()` now guards against null packets (was crashing on Level 6 when coordinator spawned clones)
- **Verified**: All 6 levels pass headless auto-play test
- **Key API notes for testing**:
  - Budget is `sim.credits` (not `sim.budget`)
  - Coordinator uses `desiredReplicaCount` (not `desiredClones`)
  - Global settings: `sim.settings.ackEnabled`, `sim.settings.retryEnabled`
  - Node settings: `node.healthCheckEnabled`, `node.dedupEnabled`, `node.dbRole`
  - Portal creation: `sim.spawnPortal(nodeA, nodeB)`
  - Stats: `sim.stats.resolved`, `sim.stats.failed`
