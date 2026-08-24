# Super-Architects — Architecture

> A living document for **humans and AI agents**. It explains how the game is put together, how the mechanics actually work, and how to modify it safely. Pair it with `AGENTS.md` (working rules) and `docs/superpowers/plans/` (change history).
>
> **The one-sentence model:** a zero-build, zero-dependency browser game where plain `<script>` tags wire independent modules together through the `window` namespace, a single `Simulation.tick()` advances all game state, and everything else (renderer, UI, audio) only *reads* that state or *requests* changes to it.

---

## 1. Module map

No bundler, no framework, no package.json. `index.html` loads every module; each attaches one class/namespace to `window`. Dependencies flow strictly downward: **App → UI/Simulation → support modules**. The renderer never mutates state; the simulation never touches the DOM.

```mermaid
flowchart TD
    subgraph Bootstrap
        INDEX["index.html<br/>(DOM skeleton + script tags)"]
        APP["js/app.js — App<br/>bootstrap, RAF game loop,<br/>loadLevel, start/pause"]
    end

    subgraph State["Game state (the only source of truth)"]
        SIM["js/simulation.js — Simulation<br/>tick(), Node, Packet, Portal,<br/>emergencies, panic, credits, stats"]
        LVL["js/levels.js — Levels<br/>plain-data configs:<br/>setup / tick / objectives / learn / slo / scenario"]
        TOP["js/topology.js — Topology<br/>read-only graph: path, nodesByRole,<br/>entryNodeFor, bestTarget"]
        CONTENT["js/content.js — Content<br/>scenario DSL → sim timeline"]
    end

    subgraph Presentation["Presentation (read-only)"]
        REN["js/renderer.js — Renderer<br/>canvas 2D, world-space draw"]
        FX["js/fx.js — FX<br/>starfield, particles, node shapes,<br/>connectors, energy links"]
        CAM["js/camera.js — Camera<br/>pan/zoom/shake, world ↔ screen"]
        MAP["js/worldmap.js — WorldMap<br/>continents, regions (minLevel)"]
        HUD["js/hud.js — HUD<br/>latency p95, error rate, trust, SLO pills"]
    end

    subgraph Interaction
        UI["js/ui.js — UI<br/>DOM binding, inspector, deploy,<br/>keyboard, camera input, hints"]
        AUDIO["js/audio.js — AudioManager<br/>procedural synthwave + SFX"]
        STORY["js/story.js — Story<br/>narrative hooks, bestiary"]
    end

    INDEX --> APP
    APP --> SIM
    APP --> UI
    APP --> REN
    APP --> CAM
    APP --> AUDIO
    UI --> SIM
    UI --> CAM
    UI --> AUDIO
    UI --> HUD
    REN --> FX
    REN --> CAM
    REN --> SIM
    REN --> MAP
    SIM --> TOP
    SIM --> CONTENT
    SIM --> LVL
    UI --> STORY
```

**File responsibility contract** (enforced by `AGENTS.md` — do not cross these lines):

| File | Owns | Must never do |
|---|---|---|
| `simulation.js` | All mutable game state; `tick()` is the only way state advances | Touch DOM, canvas, or audio |
| `renderer.js` | Canvas draw calls, delegating polish to `FX` | Mutate simulation state |
| `fx.js` / `worldmap.js` | Pure presentation | Any game logic or state mutation |
| `camera.js` | View transform + `shake()` | Mutate sim state |
| `topology.js` | Read-only graph queries | Mutate sim |
| `ui.js` | DOM, input, inspector, telemetry display | Game logic / simulation rules |
| `levels.js` | Plain-data configs + `setup`/`tick`/`check` closures | New engine mechanics (those go in `content.js`/`simulation.js`) |
| `content.js` | Scenario DSL → `sim._scenarioEvents` timeline | Rendering |
| `audio.js` | Web Audio; lazy-init on first user gesture | Run before a user gesture |

---

## 2. The frame loop

Everything happens on one `requestAnimationFrame` loop. The simulation is capped to ~60 ticks/sec; drawing happens every frame for fluid visuals.

```mermaid
sequenceDiagram
    participant RAF as requestAnimationFrame
    participant APP as App.loop()
    participant SIM as Simulation
    participant REN as Renderer
    participant UI as UI

    RAF->>APP: loop(timestamp)
    APP->>APP: elapsed = timestamp - lastTime
    alt elapsed >= 16.6ms (≈60 fps cap)
        APP->>SIM: tick()
    end
    APP->>REN: draw()
    REN->>CAM: applyTransform(ctx)   // world space
    REN->>REN: map → grid → portals →<br/>emergencies → nodes → packets →<br/>floaters → particles
    APP->>UI: updateTickUI()          // DOM: credits, panic, trust,<br/>objectives, inspector refresh
    APP->>RAF: next frame
```

Key consequence for modifiers: **if you want something to change over time, it must happen inside `tick()`** (or in a `level.tick` closure). Anything drawn but not ticked is a frozen prop.

---

## 3. Inside `Simulation.tick()`

The tick is a fixed pipeline. Order matters (e.g. emergencies expire *before* portals move packets, so a dead call's packets are cleaned up the same tick).

```mermaid
flowchart TD
    T[tickCount++] --> SPAWN["spawnEmergency()<br/>rate-based; assigns kind +<br/>latency SLO + reward"]
    SPAWN --> ROUTE["routeEmergency()<br/>via Topology.entryNodeFor<br/>(dispatcher, else nearest volt)"]
    ROUTE --> EMRG["processEmergencies()<br/>expire → stats.failed++,<br/>panic +1, purge its packets"]
    EMRG --> DISP["processDispatcherNode()<br/>drain 1/tick; route by policy:<br/>round-robin / least-connections /<br/>nearest (latency)"]
    DISP --> VOLT["processVoltNode()<br/>dequeue → db read → task progress<br/>+= processingRate → on finish:<br/>credits += reward, floater + burst,<br/>db write, ACK to sender"]
    VOLT --> PORT["processPortals()<br/>progress += speed (15/dist),<br/>loss check @50%, retries (≤3),<br/>partition drops, delivery,<br/>reap ACK-resolved packets"]
    PORT --> PANIC["calculatePanic()<br/>congestion: +0.04×(active−3)<br/>calm decay: −0.06<br/>≥100 → game over"]
    PANIC --> OBJ["evaluateObjectives()<br/>all true → win screen"]
    OBJ --> METRICS["updateDerivedMetrics()<br/>latency p50/p95/p99, queueDepth,<br/>errorRate, cityTrust = 100−panic"]
    METRICS --> LEVTICK["level.tick(sim)<br/>freezes, meteors, rift schedule"]
    LEVTICK --> SCEN["runScenarioTick()<br/>fires content.js timeline events"]
```

---

## 4. Packet lifecycle (the heart of the game)

Packets model requests, ACKs, DB reads/writes and replication syncs. Their state machine is where most mechanics live.

```mermaid
stateDiagram-v2
    [*] --> in_transit: spawn (emergency dispatch,<br/>dispatcher forward, db read/write, ack)
    in_transit --> in_transit: progress += speed<br/>speed = clamp(15/dist, .008, .06)<br/>(distance = latency)
    in_transit --> LOST: 50% loss check fails<br/>(only packets with a sender)
    LOST --> in_transit: retry (same id, ≤3 attempts)
    LOST --> dead: retry budget exhausted<br/>stats.failed++
    in_transit --> PARTITIONED: crosses rift (L5)<br/>frozen 200 ticks then dropped
    in_transit --> DELIVERED: progress ≥ 1.0<br/>deliverPacket()
    DELIVERED --> QUEUED: pushed to node.queue<br/>(frozen node buffers + sends<br/>receipt-ACK, HTTP-202 style)
    QUEUED --> RESOLVED: volt finishes task<br/>credits += reward, floater,<br/>db write, ACK back
    DELIVERED --> DUP_DISCARDED: idempotency match<br/>(seenPacketIds) → ACK anyway<br/>so sender stops retrying
    DELIVERED --> OVERFLOW: queue full<br/>stats.failed++
    DELIVERED --> dead: ACK received →<br/>original marked 'done' →<br/>reaped by portal loop
    RESOLVED --> [*]
    dead --> [*]
```

**Design invariants worth memorizing** (each exists because breaking it broke a level):

- Only *forwarded* packets (those with a `from`) suffer loss — the initial emergency dispatch has no retry path and must be immune.
- A duplicate delivery **must echo an ACK**, or the sender burns all retries against a call that already succeeded.
- Frozen nodes **buffer** incoming requests and ACK receipt; they don't connection-refuse. (Refusing caused a deterministic L2 failure.)
- The portal loop iterates backwards and only accounts for *its own* splice — `deliverPacket` must never remove a second packet from the array (mark it `'done'`; the loop reaps it). This desync once crashed L6.

---

## 5. Mechanics reference

### 5.1 Latency-sensitive origins (Phase G)

Every emergency rolls a place-kind; the kind sets its **timer** (latency SLO) and **reward**. Tight SLO = high pay. This is the economic pressure behind geo-placement and the *Nearest Region* routing policy.

```mermaid
flowchart LR
    R["roll 0..1"] --> H["🏠 home 50%<br/>800 ticks · $40"]
    R --> S["🏪 shop 25%<br/>520 ticks · $70"]
    R --> C["🏥 clinic 15%<br/>380 ticks · $100"]
    R --> ST["🏟️ stadium 10%<br/>1200 ticks · $25"]
```

Packet travel time is **physical**: absolute velocity ≈ 15 px/tick, so a 600 px hop takes ~40 ticks (badge reads `80ms` at 2 ms/tick) while a cross-map crawl takes 3–4× longer. Link badges in `renderer.drawPortals` show this number on every portal.

### 5.2 Panic & trust

```mermaid
flowchart TD
    A["live emergencies > 3"] -->|"+0.04 × (n−3) / tick"| P["panic 0..100"]
    B["emergency expires"] -->|"+1"| P
    C["all quiet"] -->|"−0.06 / tick"| P
    P -->|"> 100"| OVER["game over"]
    P -->|"vignette opacity<br/>(panic−30)/70 × 0.8"| RED["red field glow"]
    P -->|"cityTrust = 100 − panic"| HDR["header: Trust %, Dropped count"]
```

> ⚠️ **Balance-critical:** the 0.04 congestion coefficient gates game-over timing across all 6 missions. Re-tune only with a full `playtest.js` run (see §7).

### 5.3 Databases, replication & CAP (L4–L5)

- `mind-palace` nodes carry `dbRole: 'primary' | 'replica'`. Volts **write** the hot key `emergency_shelter` to the primary after each rescue, and **read** the stable key `civilian_address` from the nearest replica.
- Replication sync packets travel primary → replica; anything read before the first sync is a **stale read** (tracked in `stats.staleDbReads` — L4's <5% objective).
- L5 activates `settings.networkPartitionActive`: cross-rift packets freeze and drop. The player picks **AP** (both sides write; conflicts counted & resolved on heal) or **CP** (minority locks down; zero conflicts required). `settings.capStrategy` drives the checks.

### 5.4 Orchestration (L6)

`coordinator` nodes hold `desiredReplicaCount`; when meteors destroy volts, the coordinator spawns `isClone` nodes to heal back to desired state. Clones route and process like normal volts.

### 5.5 Geography & regions (Phase G)

`js/worldmap.js` holds normalized continent polygons and region zones:

```mermaid
flowchart LR
    subgraph WorldMap data
        R1["us-east-1<br/>minLevel 1"]
        R2["eu-west-1<br/>minLevel 4 (locked<br/>→ ghosted + 🔒)"]
    end
    R1 --> D["drawWorldMap(ctx, w, h, sim.currentLevelId)<br/>called inside the camera transform<br/>so it pans/zooms with the world"]
    R2 --> D
```

Dispatcher routing policy `nearest` picks the active speedster closest to the emergency origin — the GeoDNS / latency-based-load-balancing lesson.

### 5.6 Economy

Credits: start per level (600–1600), +reward per rescue, upgrade costs `{1:150, 2:300, 3:500}` (volt: +0.015 processing, +3 queue), decommission refunds 50% of `node.cost` (preplaced nodes are free and permanent).

---

## 6. Rendering pipeline

World-space drawing is wrapped in the camera transform; the starfield deliberately stays in screen space for parallax depth.

```mermaid
flowchart TD
    A["renderer.draw()"] --> B["FX.starfield (screen space)"]
    B --> C["camera.applyTransform(ctx)<br/>translate(vw/2+shake) · scale · translate(−cam)"]
    C --> D["WorldMap.drawWorldMap<br/>continents + region zones"]
    D --> E["FX.grid + hover cell"]
    E --> F["drawDistricts · drawPortals<br/>(orthogonal links, ms badges)"]
    F --> G["drawEmergencies<br/>(pulse ring, SLO dial, kind glyph)"]
    G --> H["drawNodes<br/>(FX.diagramNode, CPU arc, queue ring,<br/>hover ring, selection halo, upgrade pulse)"]
    H --> I["drawPackets (comet + trail)"]
    I --> J["drawResolveFx (+$ floaters)"]
    J --> K["FX.particles (trails, sparks)"]
```

**Click-to-world** (`ui.toWorld`) maps client px → canvas backing px via `canvas.width / rect.width` *before* `camera.screenToWorld` — this scaling is what makes selection work when CSS size ≠ backing size. Node hit radius is 28 px.

---

## 7. How to modify things (recipes)

### Add a level

Append a plain object to `window.Levels` in `js/levels.js`. No registration anywhere else.

```js
{
  id: 7, name: "...", tagline: "...", desc: "...",
  credits: 1500, allowedHeroes: ["volt", "dispatcher"],
  spawnRate: 1000, spawnIntensity: 2,
  learn: "One-sentence concept the player just mastered.",   // win-screen recap
  objectives: [ { id: "unique_id", text: "...", check: (sim) => sim.stats.resolved >= 30 } ],
  setup: (sim) => { const s = sim.snapToGrid(sim.width/2, sim.height/2);
                    sim.spawnNode('volt', s.x, s.y, { preplaced: true }); },
  tick: (sim) => {}
}
```

Rules: pre-placed nodes **must** pass `{ preplaced: true }` (otherwise credits are silently deducted), snap positions with `snapToGrid`, and keep objective `check` closures cheap (they run every tick — read `sim.stats`, don't scan the graph).

### Add a scripted incident

Do **not** hard-code events into `level.tick`. Add a `scenario` array to the level (plain data) and let `content.applyScenario` schedule it:

```js
scenario: [
  { atTick: 600, kind: 'freeze', target: 'volt', label: '❄️ Deep Freeze' },
  { atTick: 1200, kind: 'latency', factor: 0.3, label: '👻 Latency Wraith' }
]
```

New failure kinds are implemented once in `simulation.fireScenarioEvent` and become available to every level.

### Add a node type

1. `simulation.js`: extend the `Node` class defaults + any processing branch.
2. `fx.js`: give it a `shapePath` branch so `diagramNode` can draw it.
3. `ui.js`: deploy cost in `handleCanvasClick`, inspector controls in `updateInspector`, card gating via `levelConfig.allowedHeroes`.
4. `levels.js`: add it to `allowedHeroes` where relevant.

### Add a routing policy

One branch in `processDispatcherNode` (see `nearest` for the pattern) + one `<option>` in the `sel-routing` dropdown in `ui.updateInspector`.

### Tune balance

Central knobs: the kind/SLO table in `spawnEmergency`, panic constants in `calculatePanic`, upgrade costs in `Node.upgrade`, reward in the volt resolve path. **After any balance change, run the full winnability harness** — several "harmless" tweaks in this repo's history broke L2 or L6 deterministically.

### Verify like the CI would

There is no test framework; verification is two harnesses:

```bash
# 1. Syntax + winnability (headless vm, all 6 levels)
node --check js/<file>.js
node /tmp/opencode/playtest.js          # expect: ALL WINNABLE

# 2. Real-browser smoke (Puppeteer is in node_modules)
NODE_PATH=$PWD/node_modules node -e "/* load page, startSimulation, assert DOM/state */"
```

The vm harness pattern (see `AGENTS.md`) loads `levels.js` + `simulation.js` + `topology.js` into a `vm` sandbox and ticks 20 000 times per level with a scripted strategy. The browser harness loads `http://localhost:8000`, skips the tutorial, and drives real clicks — it has caught three bugs the vm could never see (CSS-scaling click offsets, event-dispatch issues, overlay blocking).

---

## 8. Glossary (game term → systems concept)

| Game term | Teaches |
|---|---|
| Volt / clones | Stateless compute workers, horizontal scaling, containers |
| Chief Dispatcher | Load balancer (round-robin / least-connections / latency-based) |
| Telepathic Ping | Health checks |
| Roger That / Auto-Retry | ACKs and retry with backoff budget |
| Idempotency Logbook | Idempotency keys / dedup on redelivery |
| Mind-Palace primary/replica | Write primary, read replicas, replication lag, stale reads |
| The Severed Cable | Network partition → CAP theorem (AP vs CP) |
| Clone Coordinator | Kubernetes desired-state reconciliation |
| Nearest Region routing | GeoDNS / latency-based routing |
| Panic / City Trust | SLO violations eroding user trust |

---

*Maintainers: when you change the architecture, change this file in the same commit. Diagrams are Mermaid — they render on GitHub and most viewers; keep them accurate over pretty.*
