# Super-Architects — Architecture

## Overview

Super-Architects is a single-page browser game with no framework, no build pipeline, and no runtime dependencies beyond the DOM and Canvas APIs. Every script is loaded via plain `<script>` tags and communicates through a shared `window` namespace.

The game simulates a distributed system at 60 ticks per second. Emergencies (distress calls) spawn in the city, packets route between hero nodes, and the player deploys and upgrades infrastructure to resolve calls before city-wide panic reaches 100%.

---

## Component Architecture

```mermaid
graph TD
    A["index.html<br/>Layout shell"] --> B["app.js<br/>Bootstrap + game loop"]
    B --> C["simulation.js<br/>Tick engine, state, Node/Packet/Portal"]
    B --> D["renderer.js<br/>Canvas 2D drawing"]
    B --> E["ui.js<br/>DOM events, inspector, telemetry, tutorial"]
    B --> F["audio.js<br/>Web Audio procedural synth"]
    B --> G["levels.js<br/>6 mission configs"]

    D -.->|reads state for drawing| C
    C -->|onTick / onLog / onLevel callbacks| E
    E -->|spawnNode / spawnPortal / settings| C
    E -->|start / pause / restart| B
    F -.->|panic-driven BPM morphing| C
    G -.->|setup / tick / objective checks| C
    E -.->|gates deploy cards via allowedHeroes| G
```

*Solid arrows* = direct invocation. *Dotted arrows* = data flow or callback paths.

---

## File Map

```
index.html          ── Layout shell, toolbar, panels, canvas element
style.css           ── All visual styling (CSS Grid, glassmorphism, animations)
js/
  app.js            ── Bootstrap, game loop, component wiring
  simulation.js     ── Simulation engine, Node/Packet/Portal classes, tick logic
  renderer.js       ── Canvas 2D drawing: grid, nodes, packets, particle effects
  fx.js             ── Presentation-only effects (starfield bg, deployment grid, diagram nodes, orthogonal connectors, particles)
  topology.js       ── Read-only graph engine: pathing, role queries, blueprint validation (consumed by routing + UI)
  ui.js             ── DOM event binding, inspector, telemetry, tutorial, save/load
  levels.js         ── Level configuration array (6 missions)
  audio.js          ── Procedural Web Audio synth (music + SFX, panic-driven BPM)
docs/
  architecture.md   ── This file
  improvements-design.md ── Three-phase improvement plan (Phase 1 detailed)
```

---

## Startup Sequence

```mermaid
sequenceDiagram
    participant DOM as DOMContentLoaded
    participant App as App()
    participant Sim as Simulation
    participant R as Renderer
    participant UI as UI
    participant Audio as AudioManager

    DOM->>App: new App()
    App->>Sim: new Simulation(800,600)
    App->>R: new Renderer(canvas, sim)
    R->>R: resize() — syncs canvas to parent rect
    App->>UI: new UI(sim, app)
    UI->>UI: init() — caches DOM, binds events, sets up tabs
    App->>Audio: new AudioManager() — lazy init
    App->>Sim: onTickCallback = ui.updateTickUI
    App->>Sim: onLevelComplete = ui.showSuccessScreen
    App->>Sim: onLevelFail = ui.showFailScreen
    App->>App: loadLevel(1)
    App->>Sim: sim.loadLevel(1)
    Sim->>Sim: levels[0].setup(sim) — pre-place Volt
    App->>UI: rebuildLevelSelector / updateBriefing / updateTickUI
    App->>R: resize()
    App->>UI: startTutorial()
    App->>App: loop() — requestAnimationFrame kicks off
```

---

## Simulation Engine (`simulation.js`)

The simulation runs an explicit tick cycle — no delta-time accumulation, no physics stepping. Each call to `sim.tick()` advances the world by exactly one logical frame.

### Tick Cycle

```mermaid
flowchart TD
    T1["1. tickCount++"] --> T2["2. levelConfig.tick(sim)<br/>scripted events: freeze, meteors, rift"]
    T2 --> T3["3. spawnEmergency()<br/>every N ticks per spawnRate"]
    T3 --> T4["4. routeEmergency(em)<br/>→ dispatcher or nearest Volt"]
    T4 --> T5["5. processEmergencies()<br/>expiry check (800 tick maxLife)"]
    T5 --> T6["6. processPortals()<br/>advance packets, apply loss/partition"]
    T6 --> T7["7. deliverPacket()<br/>→ node queue with dedup + overflow guards"]
    T7 --> T8["8. processNodes()"]
    T8 --> T8V["volt: task progress, DB read/write emission"]
    T8 --> T8D["dispatcher: load-balance routing"]
    T8 --> T8M["mind-palace: replication sync, read/write, CAP gating"]
    T8 --> T8C["coordinator: reconciliation (every 1s)"]
    T8V --> T9["9. calculatePanic()"]
    T8D --> T9
    T8M --> T9
    T8C --> T9
    T9 --> T10["10. evaluateObjectives()"]
    T10 --> T11["11. onTickCallback() → ui.updateTickUI()"]
    T11 -->|next frame| T1
```

### Key Classes

#### `Simulation`
The monolithic engine. Owns all state arrays (`nodes`, `packets`, `portals`, `emergencies`), the `stats` accumulator, and the `settings` object that gates ACK/retry/loss/CAP strategies.

#### `Node`
A hero tower. Key fields:
- `type`: `volt`, `mind-palace`, `dispatcher`, `cache`, `coordinator` (or `volt` + `isClone`)
- `status`: `active` | `destroyed`
- `isFrozen`: boolean (Level 2 freeze, bypassed by dispatcher health checks)
- `queue[]`: waiting packets (max `maxQueue`)
- `processingRate` (Volt): 0.02 → 50 ticks per task
- `dbRole` (Mind-Palace): `primary` | `replica`
- `registry{}` (Mind-Palace): key-value store, seeded with `emergency_shelter` and `civilian_address`
- `dedupEnabled` / `seenPacketIds`: idempotency for retry duplicate detection
- `desiredReplicaCount` (Coordinator): target clone count

#### `Packet`
A message in transit. Key fields:
- `type`: `request`, `ack`, `sync`, `write`, `read`
- `state`: `in-transit` | `sent-waiting-ack`
- `progress`: 0→1, advances by `speed` (0.025) per tick → 40 ticks to deliver
- `from`/`to`: `Node` references (or `null` for emergency-dispatch packets)
- `payload`: `Emergency` object (for requests), `{key, val}` (for DB writes), `{key}` (for DB reads), `{registry}` (for sync)

#### `Portal`
A bidirectional link between two nodes. Only rendered; the simulation doesn't enforce portal connectivity for routing — packets fly directly between nodes regardless of portal links.

---

## Packet Lifecycle

```mermaid
sequenceDiagram
    participant EM as Emergency
    participant DP as Dispatcher
    participant VT as Volt
    participant DB as Database

    Note over EM: SOS spawned at random district
    EM->>DP: request packet (immune to loss)
    DP->>DP: dequeue + select target<br/>(round-robin or least-connections)

    loop until ACK arrives or 3 retries exhausted
        DP->>VT: routedPacket (35% loss possible)
        alt packet lost
            Note over DP,VT: 💥 lost in transit
        else packet arrives
            VT->>VT: process task (50 ticks)
            VT-->>DP: ackPacket
            alt ACK lost
                Note over DP,VT: ⏰ dispatcher waits 120 ticks then retries
            else ACK arrives
                Note over DP: ✓ transaction complete
            end
        end
    end

    Note over VT,DB: On task start → DB read
    VT->>DB: read packet (civilian_address key)
    DB-->>VT: registry lookup

    Note over VT,DB: On task complete → DB write
    VT->>DB: write packet (emergency_shelter key)
```

---

## Database Read/Write Flow (Levels 4–5)

```mermaid
sequenceDiagram
    participant V as Volt
    participant P as Primary DB
    participant R as Replica DB
    participant Sync as Replication Sync

    Note over V: task begins
    V->>R: read(civilian_address)
    R->>R: lookup civilian_address<br/>compare vs primary
    alt replica value ≠ primary value
        Note over R: ⚠️ stale read detected
    end

    Note over V: task completes (resolved)
    V->>P: write(emergency_shelter, val)

    alt network partition active (Level 5)
        alt CAP = AP
            Note over P,R: both sides accept writes<br/>→ unmergedWrites tracked
        else CAP = CP + minority partition
            Note over P: 🔒 write rejected
        end
    end

    loop every syncSpeedTicks
        P->>R: sync packet (full registry snapshot)
        R->>R: merge replica.registry
    end

    Note over P,R: On rift heal (Level 5):<br/>resolveDatabaseConflicts()<br/>picks latest timestamp per key
```

### Design decisions
- **Read key `civilian_address` vs write key `emergency_shelter`**: The write key is a single hot record — every rescue mutates it. If the read targeted the same key, the replica would be stale after *every* write, making the <5% stale objective impossible. Using a stable address-book key ensures replicas are only stale during the first sync window.
- **Single shared write key**: In Level 5, both left-side and right-side Volts write to `emergency_shelter`. During a partition, each side's DB records a competing value. On heal, `resolveDatabaseConflicts()` detects the collision and picks the latest timestamp.
- **Partition-aware routing**: `findTargetDatabase()` filters by same-side when `networkPartitionActive` is true. Left-side Volts won't attempt to read from a right-side replica that's unreachable across the rift.

---

## Packet Loss & Retry Semantics (Level 3)

Network loss (35% default) applies in `processPortals()` when a packet reaches 50% progress. It only applies to **forwarded** packets (`pkt.from !== null`) — the initial dispatch from an emergency to a dispatcher is immune (no retry path exists for it).

```mermaid
flowchart LR
    EM["Emergency<br/>dispatch"] -->|"immune to loss"| DP["Dispatcher<br/>queue"]
    DP -->|"35% loss possible"| VT["Volt<br/>process task"]
    VT -->|"ACK (35% loss possible)"| DP

    DP -.->|"⏰ no ACK after 120 ticks"| RETRY["Retry<br/>duplicate packet"]
    RETRY -->|"35% loss"| VT
    VT -->|"🛡️ dedup catches duplicate<br/>immediately sends fresh ACK"| DP
```

Dedup handling: when a retry duplicate arrives at the Volt, `seenPacketIds` catches it, `stats.duplicates++`, and the Volt immediately replies with a **fresh ACK**. This ACK-echo ensures the dispatcher doesn't exhaust all 3 retries just because the first ACK was lost.

---

## Panic System

```mermaid
flowchart TD
    TICK["each tick"] --> COUNT["count = emergencies.length"]
    COUNT --> CHECK{"count > 3 ?"}
    CHECK -->|yes| RISE["panic += 0.04 × (count − 3)<br/>rising when overloaded"]
    CHECK -->|no| FALL["panic −= 0.06<br/>recovering when stable"]
    RISE --> CLAMP["clamp to 0–100"]
    FALL --> CLAMP
    CLAMP --> GAMEOVER{"panic ≥ 100 ?"}
    GAMEOVER -->|yes| FAIL["sim.isPlaying = false<br/>show fail screen"]
    GAMEOVER -->|no| NEXT["next tick"]
```

| Emergencies | Panic rate | Time to 100% from 0 |
|-------------|-----------|---------------------|
| 4 | 0.04/tick = 2.4/sec | ~42 seconds |
| 6 | 0.12/tick = 7.2/sec | ~14 seconds |
| 8 | 0.20/tick = 12.0/sec | ~8 seconds |
| 10 | 0.28/tick = 16.8/sec | ~6 seconds |

The coefficient was tuned from the original `0.12` (which caused 28%/sec at 7 emergencies) down to `0.04` to make levels recoverable after a brief surge.

---

## Canvas Rendering (`renderer.js`)

The renderer is called on every `requestAnimationFrame`, independent of simulation ticks. It draws in order:

```mermaid
flowchart TD
    CLR["ctx.clearRect()"] --> G1["1. Grid districts<br/>crosshair lines + quadrant labels"]
    G1 --> G2["2. Portal links<br/>cyan laser lines, red dashed if partitioned"]
    G2 --> G3["3. Dimensional Rift<br/>jagged red line (Level 5)"]
    G3 --> G4["4. Emergencies<br/>pulsing SOS beacons + lifetime dial"]
    G4 --> G5["5. Nodes<br/>rings, hero icons, CPU arc, frozen/queue indicators"]
    G5 --> G6["6. Packets<br/>colored dots along from→to path"]
    G6 --> G7["7. Meteors<br/>expanding shockwave rings, fading opacity"]
```

**Packet colors:**

| Type | Color | Hex | Radius |
|------|-------|-----|--------|
| `request` | Yellow | `#ffd600` | 4px |
| `ack` | Green | `#00e676` | 3px |
| `sync` | Cyan | `#00f2fe` | 5.5px |
| `write` | Orange | `#ff9800` | 4.5px |
| `read` | Purple | `#bb86fc` | 4.5px |

---

## Audio Engine (`audio.js`)

All sound is synthesized in the browser via the Web Audio API — no external audio files. The engine lazy-initialises an `AudioContext` on the first user click (browser autoplay policy compliance).

```mermaid
flowchart TD
    CTX["AudioContext<br/>(lazy-init on user gesture)"] --> MASTER["MasterGain<br/>(mute toggle)"]
    MASTER --> MUSIC["musicGain<br/>0.65–0.85 by panic"]
    MASTER --> SFX["sfxGain<br/>deploy/resolve/fail/success/game-over"]

    MUSIC --> SEQ["StepSequencer<br/>setInterval 50ms, 16th-note grid"]
    SEQ --> KICK["Kick<br/>sine 150→40Hz pitch drop"]
    SEQ --> SNARE["Snare<br/>noise + bandpass 1800Hz"]
    SEQ --> HAT["Hi-hat<br/>HPF noise, open/closed by panic"]
    SEQ --> BASS["Bass<br/>sawtooth + LP filter<br/>cutoff 400→3000Hz by panic"]
    SEQ --> ARP["Arp lead<br/>square detuned + LP + reverb<br/>C minor pentatonic"]

    MUSIC --> PAD["Pad drone<br/>4 stacked sines (Cm chord)<br/>volume 0.04→0.10 by panic"]
    PAD --> REVERB["Convolver reverb<br/>1.2s decay"]

    PANIC["panic level 0→100"] -.->|"BPM 90→160"| SEQ
    PANIC -.->|"filter/dynamics"| BASS
    PANIC -.->|"step division 4→1"| ARP
    PANIC -.->|"volume"| PAD
    PANIC -.->|"velocity 0.4→1.0"| SNARE
```

### Panic-driven musical morphing (0→100%)

| Parameter | Calm (0%) | Frantic (100%) |
|-----------|-----------|----------------|
| BPM | 90 | 160 |
| Bass LP cutoff | 400 Hz (warm) | 3000 Hz (bright) |
| Arp division | 1 note / 4 steps | 1 note / 1 step |
| Pad volume | 0.04 | 0.10 |
| Snare velocity | 0.4 | 1.0 |

---

## Deploy UX

```mermaid
sequenceDiagram
    participant Player
    participant UI as ui.js
    participant Sim as simulation.js

    Player->>UI: click deploy card (e.g. 🐳 Coordinator)
    UI->>UI: selectHeroForDeployment(type)
    UI->>UI: canvas cursor → crosshair
    UI->>UI: log "PLACEMENT ACTIVE"

    Player->>UI: click canvas at (x,y)

    alt near existing node (<22px)
        UI->>UI: log "DEPLOY BLOCKED: {name} is occupying that position"
    else insufficient credits
        UI->>UI: log "INSUFFICIENT BUDGET: need $X, you have $Y"
    else valid placement
        UI->>Sim: spawnNode(type, x, y)
        Sim->>Sim: deduct credits, create Node, push to nodes[]
        Sim-->>UI: node created
        UI->>UI: setTool('select') — reset cursor
        UI->>UI: updateInspector() — show new node
        UI->>UI: sfxDeploy() — audio cue
    end
```

Card disabled states are computed in `updateDeployInventoryLimits()`:
- **Not allowed** → tooltip: "This component is not available on the current mission."
- **Can't afford** → tooltip: "Need $X — current budget: $Y"

---

## Level Configuration Format

Each level in `levels.js` is a plain object:

```js
{
  id, name, tagline, desc,
  credits: 1200,                          // starting budget
  allowedHeroes: ['volt', 'mind-palace'], // gates deploy card enabled states
  spawnRate: 1100,                        // ms between spawn cycles (÷16.6 = ticks)
  spawnIntensity: 2,                      // emergencies per spawn cycle
  objectives: [{ id, text, check(sim) }]  // evaluated every tick
  setup(sim),                             // pre-place nodes, set sim.settings
  tick(sim)                               // scripted events each tick
}
```

Objectives are evaluated in `evaluateObjectives()` every tick. When all pass, the simulation stops and `onLevelCompleteCallback` fires.

---

## Save / Load

- `sim.serialize()` → JSON string with nodes, portals, level, credits, stats, settings
- `ui.saveState()` → writes to `localStorage` key `super_architects_save_state`
- `ui.loadState()` → reads, calls `sim.deserialize(json)` which rebuilds nodes/portals via `spawnNode`/`spawnPortal`
- Level unlock progress: `localStorage` key `super_architects_unlocked_levels` (array of unlocked level IDs)

---

## Testing Strategy

The codebase has no test framework. Integration verification is done via Node.js scripts that:
1. Load `simulation.js` and `levels.js` into a `vm` sandbox (no browser required)
2. Instantiate a `Simulation`, set up a level, and run `sim.tick()` in a loop
3. Assert on objective completion and stat values

Example:
```js
const vm = require('vm');
const ctx = vm.createContext({ window: {}, console, Math, ... });
vm.runInContext(fs.readFileSync('./js/simulation.js'), ctx);
const sim = new ctx.window.Simulation(800, 600);
// ... setup, run ticks, verify objectives
```
