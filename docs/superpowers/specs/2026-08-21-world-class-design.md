# SUPER-ARCHITECTS — World-Class Design Spec

*Date: 2026-08-21 · Status: DRAFT for approval · Branch: `world-class` (from `topology-graph`)*

## 0. North Star
A world-class, browser-based **strategy/simulation** game that teaches distributed-systems thinking *through play*. You are the **Chief Architect** of Metro City; distress calls are requests, and failure modes become personified threats. The loop is **Observe → Design → Deploy → Survive → Diagnose → Optimize**, backed by a *faithful* distributed-systems simulation.

Hard constraints (user-approved):
- **Zero-build, zero-dependency, vanilla JS.** Native `<script>` tags + `window` namespace, exactly like today. Max portability, instant load.
- Maximize **all four axes at once**: systems depth, game feel/polish, content breadth, narrative/theme.

## 1. Core Fantasy & Theme
- **Setting:** Metro City runs entirely on a distributed system. A city **Trust/Uptime** meter (0–100%) is the score; at 0 the city blackouts (loss).
- **The player:** the Chief Architect — a heroic systems thinker. You win by *designing well*, not by reflexes.
- **Adversaries = Failure Entities** (each maps to a real failure mode + countermeasure):
  - **Latency Wraith** → tail latency; countered by caching, bulkheads, timeouts.
  - **Partition Rift** → network split / CAP split-brain; countered by quorum, reconciliation.
  - **Thundering Herd** → cache stampede / retry storm; countered by jitter, coalescing.
  - **Poison Pill** → bad message / bad deploy; countered by circuit breakers, dead-letter.
  - **Cascade** (boss) → one slow dependency saturates callers; countered by bulkheads + backpressure.

## 2. Core Loop
1. **Briefing** — narrative hook + objective + constraints (budget, allowed heroes, SLOs).
2. **Build** — place nodes on the grid, wire ports, configure per-node knobs (replicas, cache TTL, queue depth, LB algorithm, retry budget, breaker threshold, shard key).
3. **Incident** — waves of requests + injected failures run on the real-time sim.
4. **Observe** — live telemetry: latency p50/p95/p99, throughput, queue depth, error rate, replica lag, **SLI / SLO / error-budget burn**.
5. **Adapt** — pause, re-wire, scale out, add breakers/bulkheads, tune.
6. **Resolve** — meet SLOs → win (city Trust up, unlocks); blackout → retry/redesign.

## 3. Simulation Systems (the depth differentiator)
Faithful request lifecycle, all visible/actionable:
- **Gateway → Load Balancer** (round-robin / least-conn / consistent-hash) → **Stateless Compute** (autoscale by queue depth) → **Cache tier** (hit/miss, TTL, stampede/coalescing) → **Database** (primary/replica, replication lag, sharding key) → **Queue / async workers** (backpressure, dead-letter) → **Coordinator** (Raft-lite leader election / distributed lock).
- **Failure injection:** node crash/freeze, network partition, latency spike, poison message, thundering herd, resource exhaustion (conn-pool/CPU), cascade.
- **Resilience players deploy/configure:** circuit breakers, bulkheads, rate limiters, retries with budget + jitter, idempotency, caching, replication, sharding, autoscaling, graceful degradation, health checks.
- **SRE layer:** SLIs, SLO targets, error-budget burn-down — teaches the real mental model.

> Existing `simulation.js` mechanics (speed 0.025/tick, loss only on forwarded packets, dedup ACK, panic 0.04, dbRole split-brain) become the *foundation*. Backward compatible: today's 6 levels still run.

## 4. Content Framework (data-driven)
A **scenario DSL** (plain JS objects) drives every mission so content scales without code:
```
{ id, title, district, narrative, grid:{w,h}, budget, allowedHeroes:[],
  preplaced:[{type,x,y,config}],
  incidents:[{t, kind, magnitude, target?}],
  failures:[{t, kind, target?, duration?}],
  slo:{ latencyP99:ms, errorRate:frac, throughput:rps },
  objectives:[{id, text, check(sim)}] }
```
- **Campaign:** ~12–18 missions across districts, each teaching 1–2 concepts, culminating in boss syndromes.
- **Sandbox / Chaos Lab:** pick a district, free build, sliders to inject failures.
- **Scenario puzzles:** given a broken system, fix with minimal components/cost.
- **Endless:** escalating random incidents; scored by uptime-duration.

## 5. Production / Game Feel
- **Visuals:** our deployment-diagram aesthetic as the *system view*; plus a stylized city/map whose lights flicker as services degrade. Camera pan/zoom. Node state colors, request particle trails, animated Failure Entities.
- **Audio:** adaptive music intensity by load; SFX for deploy, breach, heal (built on `audio.js` synth).
- **Telemetry HUD:** in-game dashboards (small multiples). Contextual, interactive tutorials. Scripted first-mission onboarding.
- **Juice:** screen shake on breach, glow on heal, satisfying deploy, clear mental-model feedback.

## 6. Architecture (zero-build, modular)
Keep `window` namespace; split into focused modules (extend AGENTS.md table):
- `js/simulation.js` — engine core (unchanged public API).
- `js/systems/` — `routing.js`, `queueing.js`, `caching.js`, `consensus.js`, `failure.js`, `metrics.js` (each a `window.Sys_*` pure-ish module the engine calls).
- `js/topology.js` — graph engine (exists).
- `js/content.js` — scenario DSL loader/validator. `js/levels.js` — data only.
- `js/renderer.js`, `js/fx.js`, `js/camera.js`, `js/hud.js` (telemetry), `js/audio.js`.
- `js/ui.js` (deploy/inspect), `js/story.js` (briefing/narrative), `js/tutorial.js`, `js/save.js`.
- `js/app.js` — bootstrap + game loop + mode state machine.
- Loaded via `<script>` in dependency order. No bundler.

## 7. Phased Roadmap
- **Phase 0 — Foundation:** modularize sim into `systems/*`; add `camera.js` (pan/zoom); adopt scenario DSL; keep current 6 levels running via adapter.
- **Phase 1 — Flagship slice:** rebuild Mission 1 (Blackout) as proof: narrative briefing + tutorial, deeper sim (queues/backpressure/caching/circuit-breaker), telemetry HUD, adaptive audio, juice. Confirms the loop *feels* world-class.
- **Phase 2 — Systems breadth:** consensus, sharding, rate limiting, autoscaling; full failure-injection framework; more components (gateway, cache, queue, rate-limiter, bulkhead).
- **Phase 3 — Content:** campaign of 10–15 missions, Sandbox chaos lab, scenario puzzles.
- **Phase 4 — Meta & polish:** progression/unlocks, Endless mode, boss narrative arc, perf, accessibility, final art/audio pass.

## 8. Open Questions / Risks
- Scope of *this* session: I recommend building **Phase 0 + Phase 1** now (a reviewable, playable flagship) rather than attempting everything.
- File size of `simulation.js` may need splitting before deeper systems land (Phase 0 addresses this).
- Need a way to run headless validation per new system (extend the AGENTS.md vm-sandbox harness).
