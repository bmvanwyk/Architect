# UX / Look / Feel Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the look/feel/UX gaps found while play-testing all 6 levels: responsiveness, hidden telemetry, undiscoverable camera controls, weak upgrade feedback, no undo, front-loaded tutorial, and an abstract Panic meter — plus small polish (hit radius, shortcuts, win recap, selection ring).

**Architecture:** Zero-build, zero-dependency vanilla JS. All modules live on `window` and are loaded via `<script>` in `index.html`. UI state lives in `js/ui.js` (DOM binding + inspector), rendering in `js/renderer.js` + `js/fx.js`, simulation in `js/simulation.js`, audio in `js/audio.js`, camera in `js/camera.js`, level configs in `js/levels.js`. Each task below is independently committable; **execute Phase A (A1–A4) first, then feedback tasks (4,5,8,11), then chrome tasks (1,2,3,6,7,9,10)** — see REVISION v2.

**Tech Stack:** Plain HTML/CSS/JS, Canvas 2D, Web Audio API. No framework, no bundler.
**Verification baseline (no test framework):** Sim/logic changes are verified with a Node `vm` harness (loads `simulation.js` + `levels.js` into a sandbox). DOM/UX changes are verified with a headless Chromium script via Puppeteer (the sandbox already has it at `node_modules/puppeteer`) that loads `http://172.21.254.89:8000`, drives the UI, and asserts DOM/state. Both harnesses are shown per task.

---

## REVISION v2 — informed by actual mid-game observation

Initial screenshots were taken ~1.5s after start (empty field) and led to a
chrome-first plan. A 70-second live session on Mission 3 (portal linked, ACK +
retry + dedup on, spawnRate 600ms) showed the real picture:

**Already working well (do NOT redo):**
- SOS beacons are genuinely good: pulsing red rings, gold lifetime dial,
  "SOS #N" labels — urgent and legible.
- Packets read as glowing comets with trails; portal links animate flowing
  dashes with packet IDs visible mid-flight.
- Node CPU load arcs render (green → gold → red) and level badges update ("Volt L3").
- Objective strikethroughs + the incident log ("RETRY SENT: Re-transmitting
  Packet #8", "IDEMPOTENCY MATCH…") give excellent narrative feedback.

**Real problems, in priority order:**
1. The field is still ~80% void — the fantasy says "Metro City" but there is no
   city under the grid. Deep-space emptiness where streets should be.
2. Queue indicators (rows of 2.5px dots floating above each node) read as
   rendering glitches, not information. Empty slots are near-invisible;
   a 20-slot dispatcher queue is a mystery dash-line.
3. No resolution payoff — credits tick up silently ($1000→$1230) with zero
   visual/audio reward at the moment of rescue.
4. Panic sat at 0% for the whole 70s run even with 3 dropped calls — the
   tension system never engaged, so the session felt pressure-less.

Therefore execution order is now: **Phase A (Tasks A1–A4, NEW) → Phase B
(Tasks 4,5,8,11 = feedback) → Phase C (Tasks 1,2,3,6,7,9,10 = chrome)**.
Task numbers below are unchanged; Phase A tasks are inserted first.

---

### Task A1: City underlay — put "Metro City" under the grid

**Files:**
- Modify: `js/fx.js` (`buildBackground` — add procedural city layer beneath stars/grid)

- [ ] **Step 1:** In `buildBackground(w,h)` (fx.js ~line 150), BEFORE the starfield, draw a dim city: seeded random rectangular blocks with faint window-dot grids, plus a few brighter "avenue" lines. Blocks in `rgba(0,60,90,0.10)` fill, window dots `rgba(255,214,0,0.05)`, avenues `rgba(0,242,254,0.04)` 2px. Keep everything ≤ 12% alpha so nodes/packets stay dominant.
- [ ] **Step 2:** Verify via Puppeteer screenshot at L1: background reads as a dim city grid, not void; nodes still clearly highest-contrast elements.
- [ ] **Step 3:** Commit: `feat(fx): procedural city underlay beneath the grid`

### Task A2: Resolution payoff — floating "+$" and burst on rescue

**Files:**
- Modify: `js/renderer.js` (add `floaters` array; draw/update in draw loop)
- Modify: `js/simulation.js` (emit floater on resolve)

- [ ] **Step 1:** In `processVoltNode` where `this.credits += 40`, push `this.resolveFx.push({x: emergency.x, y: emergency.y, text: '+$40', life: 40})` (init `resolveFx=[]` in constructor).
- [ ] **Step 2:** In renderer draw loop: rise + fade gold text (`rgba(255,214,0,alpha)`, 12px Outfit, y -= 0.5/frame), plus one FX spark burst (`FX.particles.spawn` ×6 'spark').
- [ ] **Step 3:** Verify: puppeteer — run until `stats.resolved >= 1`, assert `sim.resolveFx.length > 0` shortly after; screenshot shows floater.
- [ ] **Step 4:** Commit: `feat(fx): +$40 floaters and spark burst on rescue`

### Task A3: Queue redesign — segmented arc ring replaces floating dot rows

**Files:**
- Modify: `js/renderer.js` (`drawNodes` — replace the dot-row block at `node.y - 28`)
- Modify: `js/fx.js` (optional helper `queueArc`)

- [ ] **Step 1:** Delete the `for (let s = 0; s < maxSlots; s++)` dot-row loop. Replace with a segmented arc just outside the body radius: N segments (cap visual segments at 12; if maxQueue>12, each segment = ceil(maxQueue/12) slots), segment lit if filled; color green→gold→red by fullness; unlit segments `rgba(255,255,255,0.08)`; arc radius 27, thickness 3.
```js
const segs = Math.min(12, node.maxQueue);
const per = Math.ceil(node.maxQueue / segs);
for (let i = 0; i < segs; i++) {
  const a0 = -Math.PI/2 + (i/segs)*Math.PI*2 + 0.06;
  const a1 = -Math.PI/2 + ((i+1)/segs)*Math.PI*2 - 0.06;
  const filled = node.queue.length > i*per;
  ctx.beginPath();
  ctx.arc(node.x, node.y, 27, a0, a1);
  ctx.strokeStyle = filled ? (node.queue.length > node.maxQueue*0.8 ? '#ff1744'
                  : node.queue.length > node.maxQueue*0.5 ? '#ffd600' : '#00e676')
                  : 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 3; ctx.stroke();
}
```
- [ ] **Step 2:** Verify: puppeteer screenshot L3/L5 — queue now hugs the node as a clean segmented ring; no more floating dash artifacts.
- [ ] **Step 3:** Commit: `feat(fx): queue as segmented ring around node (replaces dot rows)`

### Task A4: Tension you can feel — panic engages + danger vignette + faster default pace

**Files:**
- Modify: `js/simulation.js` (confirm/expo: panic rises on EXPIRED emergencies, not drops — verify; if drops also count, keep)
- Modify: `js/app.js` or `style.css` (red vignette overlay opacity tied to panic)
- Modify: `index.html` (vignette div)
- Modify: `js/ui.js` (update vignette in `updateTickUI`; default camera scale 1.25)

- [ ] **Step 1:** In a 70s L3 run, panic stayed 0 despite 3 failed calls. Inspect panic source; ensure EXPIRED emergencies raise it meaningfully (e.g., +2 per expiry, decay −0.05/tick) and log a warning line on first expiry.
- [ ] **Step 2:** Add `<div id="panic-vignette"></div>` inside `.canvas-wrapper`; CSS: absolute inset-0, pointer-events none, box-shadow inset 0 0 120px rgba(255,23,68,x); JS sets opacity `Math.max(0,(panic-30)/70)*0.8`.
- [ ] **Step 3:** Default camera scale 1.25 on level load (`camera.scale = 1.25` after `centerOn`) so nodes/packets feel substantial.
- [ ] **Step 4:** Verify: force `sim.panic = 60` → vignette visible in screenshot; expire an emergency → panic increases and log warns.
- [ ] **Step 5:** Commit: `feat(sim+ui): panic engages on expiries + danger vignette + tighter default camera`

---

## File Structure

- `index.html` — add header stat boxes (Trust/Resolved/Dropped), camera tool buttons, help button, hint toast container, tutorial→hint markup.
- `style.css` — responsive `main-layout` grid + panel collapse, status strip, camera buttons, hint toast, upgrade pulse, trust meter, selection ring, hover cursor.
- `js/ui.js` — status-strip updates in `updateTickUI`, camera button wiring, decommission handler, hint manager, keyboard shortcuts, Esc-cancel, upgrade pulse trigger, win recap.
- `js/camera.js` — add `resetView()` (scale=1 + re-center).
- `js/audio.js` — add `sfxUpgrade()`.
- `js/simulation.js` — add `decommissionNode(id)` (remove node + its portals, partial refund); expose trust as `100 - panic` for the header (panic stays the game-over driver per AGENTS.md).
- `js/renderer.js` — draw selection ring (stronger) + transient upgrade pulse ring; draw hover ring on `sim.hoverNode`.
- `js/levels.js` — trigger contextual hints at key moments; supply win-recap text.
- `docs/superpowers/plans/` — this file.

---

### Task 1: Responsive layout (panels collapse, canvas keeps priority)

**Files:**
- Modify: `index.html` (add collapse toggles on `.left-panel`/`.right-panel` headers)
- Modify: `style.css` (`.main-layout` responsive grid, `min-width` on canvas, collapsed states)
- Modify: `js/ui.js` (wire collapse toggles)

- [ ] **Step 1: Add collapse buttons to both panel headers in `index.html`**

In the left panel header (after `<h2>🗂️ MISSION SELECTOR</h2>`) and right panel header, add:
```html
<button class="panel-collapse" id="btn-collapse-left" title="Collapse panel">‹</button>
```
and on the right panel header:
```html
<button class="panel-collapse" id="btn-collapse-right" title="Collapse panel">›</button>
```

- [ ] **Step 2: Make the layout responsive in `style.css`**

Replace the `.main-layout` rule (currently `display:flex` with fixed-ish panels) with a CSS grid that gives the canvas priority and supports collapse:
```css
.main-layout {
  display: grid;
  grid-template-columns: var(--left-w, 310px) 4px 1fr 4px var(--right-w, 380px);
  height: calc(100vh - 70px);
  min-width: 0;
}
.main-layout.left-collapsed  { grid-template-columns: 0 4px 1fr 4px var(--right-w, 380px); }
.main-layout.right-collapsed { grid-template-columns: var(--left-w, 310px) 4px 1fr 4px 0; }
.panel.left-panel  { min-width: 0; overflow: hidden; }
.panel.right-panel { min-width: 0; overflow: hidden; }
.canvas-wrapper { min-width: 320px; }
@media (max-width: 1100px) {
  .main-layout { --left-w: 260px; --right-w: 300px; }
  .canvas-wrapper { min-width: 260px; }
}
@media (max-width: 820px) {
  .main-layout { --left-w: 0; --right-w: 0; }   /* force collapse on tiny screens */
}
.collapsed-hint { display:none; }
.left-collapsed .left-panel .panel-body,
.right-collapsed .right-panel .panel-body { display:none; }
```
Keep existing `#sim-canvas { width:100%; height:100%; display:block; }`.

- [ ] **Step 3: Wire collapse toggles in `js/ui.js`**

In `UI.prototype.init` (near other `getElementById` bindings), add:
```js
this.dom.btnCollapseLeft  = document.getElementById('btn-collapse-left');
this.dom.btnCollapseRight = document.getElementById('btn-collapse-right');
if (this.dom.btnCollapseLeft) this.dom.btnCollapseLeft.addEventListener('click', () => {
  document.querySelector('.main-layout').classList.toggle('left-collapsed');
});
if (this.dom.btnCollapseRight) this.dom.btnCollapseRight.addEventListener('click', () => {
  document.querySelector('.main-layout').classList.toggle('right-collapsed');
});
```

- [ ] **Step 4: Verify in real browser**

Run puppeteer check (save as `/tmp/opencode/t1.js`):
```js
const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 820, height: 700 });
  await p.goto('http://172.21.254.89:8000', { waitUntil:'networkidle0' });
  await p.evaluate(() => { window.app.loadLevel(1); window.app.startSimulation(); });
  await p.click('#btn-tut-skip').catch(()=>{});
  await new Promise(r=>setTimeout(r,400));
  const w = await p.evaluate(() => window.app.renderer.canvas.width);
  console.log('canvas width @820px viewport =', w, w > 260 ? 'PASS' : 'FAIL (collapsed/squeezed)');
  await b.close();
})();
```
Expected: `canvas width @820px viewport = <n> PASS` (canvas keeps ≥260px instead of collapsing to ~100px).

- [ ] **Step 5: Commit**
```bash
git add index.html style.css js/ui.js
git commit -m "feat(ui): responsive layout with collapsible panels and canvas min-width"
```

---

### Task 2: Always-on status strip (Trust / Resolved·Target / Dropped)

**Files:**
- Modify: `index.html` (add two header stat boxes after the Panic box)
- Modify: `style.css` (`.header-stat-box` already styled; add trust color)
- Modify: `js/ui.js` (`updateTickUI` populates new values)

- [ ] **Step 1: Add stat boxes in `index.html`** inside `.header-stats`, after the panic box:
```html
<div class="header-stat-box">
  <span class="stat-label">CITY TRUST</span>
  <span class="stat-value text-green" id="stat-trust">100%</span>
</div>
<div class="header-stat-box">
  <span class="stat-label">RESCUED / GOAL</span>
  <span class="stat-value" id="stat-resolved">0 / 0</span>
</div>
<div class="header-stat-box">
  <span class="stat-label">DROPPED</span>
  <span class="stat-value text-red" id="stat-dropped">0</span>
</div>
```

- [ ] **Step 2: Capture refs + update in `js/ui.js`**

In `init` bindings add:
```js
this.dom.statTrust    = document.getElementById('stat-trust');
this.dom.statResolved = document.getElementById('stat-resolved');
this.dom.statDropped  = document.getElementById('stat-dropped');
```
In `updateTickUI()` after the panic block, add:
```js
const trust = 100 - this.sim.panic;
this.dom.statTrust.innerText = `${trust}%`;
this.dom.statTrust.className = 'stat-value ' + (trust > 60 ? 'text-green' : trust > 30 ? 'text-gold' : 'text-red');
this.dom.statResolved.innerText = `${this.sim.stats.resolved} / ${this.sim.levelConfig.resolveGoal || this.sim.stats.resolved}`;
this.dom.statDropped.innerText = `${this.sim.stats.failed}`;
```

- [ ] **Step 3: Verify**
Puppeteer: start L1, run 1500ms, assert `#stat-trust` text is a `%` and `#stat-resolved` matches `n / m`.
Expected: values non-empty and `stat-trust` ends with `%`.

- [ ] **Step 4: Commit**
```bash
git add index.html style.css js/ui.js
git commit -m "feat(ui): always-visible City Trust / Rescued / Dropped status strip"
```

---

### Task 3: Discoverable camera controls (zoom ±, reset view, hint)

**Files:**
- Modify: `index.html` (add buttons to `.canvas-tools`)
- Modify: `style.css` (`.cam-btn` styling)
- Modify: `js/camera.js` (add `resetView`)
- Modify: `js/ui.js` (wire buttons + a one-time hint)

- [ ] **Step 1: Add camera buttons in `index.html`** inside `.canvas-tools`:
```html
<button id="cam-zoom-in" class="cam-btn" title="Zoom in">＋</button>
<button id="cam-zoom-out" class="cam-btn" title="Zoom out">－</button>
<button id="cam-reset" class="cam-btn-primary" title="Reset view">⤢ FIT</button>
```

- [ ] **Step 2: Add `resetView()` to `js/camera.js`**
```js
resetView(vw, vh) {
  this.scale = 1;
  this.x = vw / 2;
  this.y = vh / 2;
  this._initialized = true;
}
```

- [ ] **Step 3: Wire controls in `js/ui.js`**
```js
this.dom.camZoomIn  = document.getElementById('cam-zoom-in');
this.dom.camZoomOut = document.getElementById('cam-zoom-out');
this.dom.camReset   = document.getElementById('cam-reset');
const cw = this.app.renderer.canvas;
if (this.dom.camZoomIn)  this.dom.camZoomIn.addEventListener('click',  () => this.app.camera.zoomAt(cw.width/2, cw.height/2, -1, cw.width, cw.height));
if (this.dom.camZoomOut) this.dom.camZoomOut.addEventListener('click', () => this.app.camera.zoomAt(cw.width/2, cw.height/2,  1, cw.width, cw.height));
if (this.dom.camReset)   this.dom.camReset.addEventListener('click',   () => this.app.camera.resetView(cw.width, cw.height));
```

- [ ] **Step 4: Add `.cam-btn` CSS in `style.css`**
```css
.cam-btn, .cam-btn-primary {
  background: rgba(10,14,23,0.7); border:1px solid var(--border-glow);
  color: var(--primary); border-radius:4px; cursor:pointer; font-size:13px; padding:4px 8px;
}
.cam-btn-primary { color: var(--white); }
.cam-btn:hover, .cam-btn-primary:hover { box-shadow: var(--primary-glow); }
```

- [ ] **Step 5: Verify**
Puppeteer: click `#cam-zoom-in` twice, assert `window.app.camera.scale > 1`; click `#cam-reset`, assert `scale === 1`.
Expected: scale increases then resets to 1.

- [ ] **Step 6: Commit**
```bash
git add index.html style.css js/camera.js js/ui.js
git commit -m "feat(ui): on-screen zoom/reset camera controls (discoverable)"
```

---

### Task 4: Upgrade payoff (sound + visual pulse)

**Files:**
- Modify: `js/audio.js` (add `sfxUpgrade`)
- Modify: `js/ui.js` (call on successful upgrade; set pulse)
- Modify: `js/renderer.js` (draw expanding pulse ring on upgraded node)
- Modify: `style.css` (n/a — pulse drawn on canvas)

- [ ] **Step 1: Add `sfxUpgrade` to `js/audio.js`** (mirror `sfxDeploy` pattern)
```js
sfxUpgrade() {
  if (!this._ctx || this._muted) return;
  const t = this._ctx.currentTime;
  const o = this._ctx.createOscillator();
  const g = this._ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(440, t);
  o.frequency.exponentialRampToValueAtTime(880, t + 0.12);
  o.frequency.exponentialRampToValueAtTime(1320, t + 0.24);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g).connect(this._sfxGain);
  o.start(t); o.stop(t + 0.32);
}
```

- [ ] **Step 2: Trigger in `js/ui.js` upgrade handler**
In the `btnUpgrade` click handler (currently `if (node.upgrade(this.sim)) { ... this.updateInspector(); }`), add:
```js
if (node.upgrade(this.sim)) {
  node._upgradePulse = 18;            // frames of pulse animation
  if (this.app.audio) this.app.audio.sfxUpgrade();
  this.sim.log(`🚀 UPGRADED: ${node.name} upgraded to Level ${node.level}!`, "success");
  this.updateInspector();
}
```

- [ ] **Step 3: Draw pulse in `js/renderer.js`** (in `drawNode` or after drawing the node)
```js
if (node._upgradePulse > 0) {
  const r = 22 + (18 - node._upgradePulse) * 3;
  ctx.save();
  ctx.strokeStyle = `rgba(255,214,0,${node._upgradePulse / 18})`;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
  node._upgradePulse--;
}
```
Place this inside the world-transform section (after `applyTransform`) so it scales with zoom. Decrement each frame.

- [ ] **Step 4: Verify**
Puppeteer: select preplaced Volt, click `#btn-upgrade-node`, then read `window.app.sim.nodes[0]._upgradePulse`.
Expected: `_upgradePulse > 0` immediately after click (animation running). (Audio can't be asserted headlessly; confirm no console error from `sfxUpgrade`.)

- [ ] **Step 5: Commit**
```bash
git add js/audio.js js/ui.js js/renderer.js
git commit -m "feat(fx): upgrade payoff — sfxUpgrade + canvas pulse ring"
```

---

### Task 5: Decommission / undo a misplaced deploy (+ Esc to cancel)

**Files:**
- Modify: `js/simulation.js` (add `decommissionNode`)
- Modify: `js/ui.js` (inspector "Decommission" button + handler; Esc cancels deploy)
- Modify: `index.html` + `style.css` (button)

- [ ] **Step 1: Record `cost` on spawn, and add `decommissionNode` to `js/simulation.js`**

In `spawnNode` (around line 362, after `const node = new Node(...)`), add:
```js
node.cost = cost;   // used by decommission refund
```
Then add the method:
```js
decommissionNode(id) {
  const idx = this.nodes.findIndex(n => n.id === id);
  if (idx === -1) return false;
  const node = this.nodes[idx];
  if (node.preplaced) return false;           // never remove pre-placed heroes
  // remove attached portals
  this.portals = this.portals.filter(p => p.from !== node && p.to !== node);
  this.credits += Math.floor((node.cost || 0) * 0.5);  // 50% refund
  this.nodes.splice(idx, 1);
  return true;
}
```
Ensure `spawnNode` records `node.cost = <hero cost>` when deploying (set in `spawnNode` where cost is deducted — capture it on the node).

- [ ] **Step 2: Inspector button in `js/ui.js` `updateInspector`** (inside `.inspector-upgrade-box`, only for non-preplaced):
```js
const decommissionHTML = (!node.preplaced) ? `<button id="btn-decommission" class="btn btn-secondary" style="margin-top:8px;">DECOMMISSION (50% refund)</button>` : '';
root.innerHTML = `... ${specificHTML} <div class="inspector-upgrade-box"> ... ${decommissionHTML}</div>`;
```
In `bindInspectorListeners()` add:
```js
const btnDec = document.getElementById('btn-decommission');
if (btnDec) btnDec.addEventListener('click', () => {
  if (this.sim.decommissionNode(node.id)) {
    this.selectedNode = null;
    this.sim.log(`🗑️ DECOMMISSIONED: ${node.name} removed (50% refund).`, "system-msg");
    this.updateInspector();
  }
});
```

- [ ] **Step 3: Esc cancels deploy** in `init` (add `keydown` listener):
```js
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && this.selectedTool === 'deploy') this.setTool('select');
});
```

- [ ] **Step 4: Verify**
Puppeteer: deploy a Volt (credits 600→400), select it, click `#btn-decommission`, assert node count decreased and credits ≈ 500.
Expected: node removed, credits refunded ~50%.

- [ ] **Step 5: Commit**
```bash
git add js/simulation.js js/ui.js
git commit -m "feat(ui): decommission node (50% refund) + Esc cancels deploy"
```

---

### Task 6: Contextual hints + persistent help (replace tutorial wall)

**Files:**
- Modify: `js/ui.js` (hint manager: `showHint`, `clearHint`, pulse target)
- Modify: `index.html` (help `?` button + `#hint-toast` container)
- Modify: `style.css` (`.hint-toast`, `.hint-pulse`)
- Modify: `js/levels.js` (emit hints at key moments)

- [ ] **Step 1: Add hint DOM in `index.html`** (inside `.canvas-wrapper`, top):
```html
<div id="hint-toast" class="hint-toast hidden"></div>
<button id="btn-help" class="cam-btn" title="Help / Replay tips">?</button>
```

- [ ] **Step 2: Hint manager in `js/ui.js`**
```js
showHint(text, anchorSel) {
  const t = document.getElementById('hint-toast');
  t.innerHTML = text; t.classList.remove('hidden');
  if (anchorSel) { const a = document.querySelector(anchorSel); if (a) a.classList.add('hint-pulse'); }
  clearTimeout(this._hintT);
  this._hintT = setTimeout(() => this.clearHint(anchorSel), 6000);
}
clearHint(anchorSel) {
  document.getElementById('hint-toast').classList.add('hidden');
  if (anchorSel) { const a = document.querySelector(anchorSel); if (a) a.classList.remove('hint-pulse'); }
}
```
Wire `#btn-help` to re-show the current level's intro hint. In `updateInspector`/`handleCanvasClick` add targeted hints:
- On L1 load: `this.showHint('Click a <strong>Deploy</strong> card, then click the grid to place a hero. Select a placed hero to Upgrade it.', '#tool-select')`.
- On L3 load: `this.showHint('Use the 🌀 Link Portal tool to connect the Dispatcher to the Volt.', '#tool-wire')`.

- [ ] **Step 3: CSS in `style.css`**
```css
.hint-toast { position:absolute; top:12px; left:50%; transform:translateX(-50%);
  background:rgba(10,14,23,0.92); border:1px solid var(--border-glow); color:var(--white);
  padding:10px 16px; border-radius:6px; font-size:12px; max-width:60%; z-index:30; box-shadow:var(--panel-shadow); }
.hint-pulse { animation: hintPulse 1s ease-in-out infinite; }
@keyframes hintPulse { 0%,100%{ box-shadow:0 0 0 rgba(0,242,254,0);} 50%{ box-shadow:0 0 12px rgba(0,242,254,0.8);} }
```

- [ ] **Step 4: Verify**
Puppeteer: load L1, assert `#hint-toast` visible and contains "Deploy"; click `#btn-help`, assert still visible.
Expected: hint toast shown with expected text.

- [ ] **Step 5: Commit**
```bash
git add index.html style.css js/ui.js js/levels.js
git commit -m "feat(ui): contextual hint system + persistent help button"
```

---

### Task 7: Panic/Trust clarity (prominent Trust, label Panic = 100−Trust, flash on drop)

**Files:**
- Modify: `index.html` (Trust meter already added in T2; add a "flash" hook)
- Modify: `js/ui.js` (flash header when a call is dropped)
- Modify: `style.css` (`.flash-danger` animation)
- Modify: `js/simulation.js` (emit a drop event flag the UI can catch)

- [ ] **Step 1: Flash on dropped call** — in `js/simulation.js`, wherever `stats.failed++` happens, also set `this._lastDropTick = this.tickCount;`.

- [ ] **Step 2: Detect flash in `js/ui.js` `updateTickUI`**
```js
if (this.sim._lastDropTick === this.sim.tickCount && !this._flashed) {
  const box = document.querySelector('.header-stat-box .text-red');
  if (box) { box.classList.add('flash-danger'); setTimeout(()=>box.classList.remove('flash-danger'), 400); }
  this._flashed = true;
} else if (this.sim._lastDropTick !== this.sim.tickCount) { this._flashed = false; }
```

- [ ] **Step 3: CSS in `style.css`**
```css
.flash-danger { animation: flashRed 0.4s ease; }
@keyframes flashRed { 0%{ background:rgba(255,23,68,0.5);} 100%{ background:transparent;} }
```
(Trust already shown in T2 as `100 - panic`; the Panic label in the header is hence its inverse — add a tooltip/title "Panic = 100 − City Trust" on the panic stat box.)

- [ ] **Step 4: Verify**
Puppeteer: force `window.app.sim._lastDropTick = window.app.sim.tickCount` then call `updateTickUI()`, assert a `.text-red` element briefly has class `flash-danger`.
Expected: flash class applied.

- [ ] **Step 5: Commit**
```bash
git add index.html style.css js/ui.js js/simulation.js
git commit -m "feat(ui): City Trust prominence + drop-cause flash feedback"
```

---

### Task 8: Larger hit radius + hover ring

**Files:**
- Modify: `js/ui.js` (`handleCanvasClick` radius 22→28; set `sim.hoverNode` on mousemove)
- Modify: `js/renderer.js` (draw ring on `sim.hoverNode`)

- [ ] **Step 1: Bump radius** in `handleCanvasClick`:
```js
const clickedNode = this.sim.nodes.find(n => Math.hypot(n.x - x, n.y - y) < 28 && n.status === 'active');
```

- [ ] **Step 2: Hover tracking** in the existing `mousemove` handler (or add one): set `this.sim.hoverNode = nodeUnderCursor`.
```js
const wpt = this.toWorld(e);
this.sim.hoverNode = this.sim.nodes.find(n => Math.hypot(n.x - wpt.x, n.y - wpt.y) < 28 && n.status === 'active') || null;
```

- [ ] **Step 3: Draw hover ring** in `js/renderer.js` world section:
```js
if (this.sim.hoverNode && this.sim.hoverNode !== this.ui?.selectedNode) {
  ctx.save(); ctx.strokeStyle='rgba(0,242,254,0.5)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(this.sim.hoverNode.x, this.sim.hoverNode.y, 26, 0, Math.PI*2); ctx.stroke(); ctx.restore();
}
```

- [ ] **Step 4: Verify**
Puppeteer: move mouse over a node, assert `window.app.sim.hoverNode` is set.
Expected: hoverNode non-null over a node.

- [ ] **Step 5: Commit**
```bash
git add js/ui.js js/renderer.js
git commit -m "feat(ui): 28px hit radius + hover ring for grabability"
```

---

### Task 9: Keyboard shortcuts

**Files:**
- Modify: `js/ui.js` (keydown handler)

- [ ] **Step 1: Add global shortcuts** in `init`:
```js
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const map = { '1':'volt','2':'dispatcher','3':'mind-palace','4':'cache','5':'coordinator' };
  if (map[e.key]) this.selectHeroForDeployment(map[e.key]);
  else if (e.key === 'u' && this.selectedNode) { const b=document.getElementById('btn-upgrade-node'); if(b&&!b.disabled) b.click(); }
  else if (e.key === ' ') { e.preventDefault(); this.sim.isPlaying ? this.app.pauseSimulation() : this.app.startSimulation(); }
  else if (e.key === 'f') { this.app.camera.resetView(this.app.renderer.canvas.width, this.app.renderer.canvas.height); }
  else if (e.key === 'Escape') { if (this.selectedTool==='deploy') this.setTool('select'); else { this.selectedNode=null; this.updateInspector(); } }
});
```

- [ ] **Step 2: Verify**
Puppeteer: focus body, dispatch `keydown` '1', assert `selectedTool==='deploy' && selectedHeroToDeploy==='volt'`.
Expected: deploy mode for volt active.

- [ ] **Step 3: Commit**
```bash
git add js/ui.js
git commit -m "feat(ui): keyboard shortcuts (1-5 deploy, U upgrade, Space pause, F fit, Esc)"
```

---

### Task 10: Educational win recap

**Files:**
- Modify: `js/ui.js` (on win, show concept recap from `levelConfig.learn`)
- Modify: `js/levels.js` (add `learn` string per level)

- [ ] **Step 1: Add `learn` text** to each level config in `js/levels.js`, e.g. L1: `learn: "You scaled a single worker by upgrading its CPU — vertical scaling."`, L3: `learn: "ACKs + retries + idempotency make unreliable networks safe."`, etc.

- [ ] **Step 1b: Render recap** in the win handler (`showWin`/overlay) in `js/ui.js`:
```js
const learn = this.sim.levelConfig.learn || '';
document.getElementById('overlay-text').innerHTML = `Great job! <br><br><em>What you learned:</em> ${learn}`;
```

- [ ] **Step 2: Verify**
Puppeteer: set `window.app.sim.completedObjectives` to all objectives, force win, assert `#overlay-text` innerHTML contains the `learn` text.
Expected: recap visible.

- [ ] **Step 3: Commit**
```bash
git add js/ui.js js/levels.js
git commit -m "feat(ui): educational recap on win screen"
```

---

### Task 11: Stronger selection ring

**Files:**
- Modify: `js/renderer.js` (selected-node ring)

- [ ] **Step 1: Draw a bold ring on the selected node** in the world section, after `applyTransform`:
```js
if (this.ui && this.ui.selectedNode) {
  const n = this.ui.selectedNode;
  ctx.save();
  ctx.strokeStyle = '#00f2fe';
  ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(0,242,254,0.8)'; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(n.x, n.y, 28, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
}
```

- [ ] **Step 2: Verify**
Puppeteer: select node, assert `window.app.ui.selectedNode` set and no canvas error (visual ring can't be pixel-asserted; rely on no console errors + selection state).
Expected: selectedNode set, zero console errors.

- [ ] **Step 3: Commit**
```bash
git add js/renderer.js
git commit -m "feat(fx): bold glowing selection ring on canvas"
```

---

## Self-Review

**Spec coverage (all 7 priority + 4 polish items mapped to tasks):**
1. Responsiveness → T1 ✓
2. Hidden telemetry → T2 (always-on strip) ✓
3. Undiscoverable camera → T3 ✓
4. Upgrade payoff → T4 ✓
5. No undo → T5 ✓
6. Tutorial wall → T6 ✓
7. Panic/Trust clarity → T7 ✓
Polish: hit radius/hover → T8 ✓; shortcuts → T9 ✓; win recap → T10 ✓; selection ring → T11 ✓.

**Placeholder scan:** No TBD/TODO. Each code step shows concrete code or exact CSS/HTML. Verification commands are explicit with expected output.

**Type/consistency:** `resetView(vw,vh)` used in T3 and T9 matches signature. `_upgradePulse` set in T4 and drawn in T4 (renderer). `decommissionNode` defined in T5 sim and called in T5 ui. `showHint/clearHint` defined and used in T6. `hoverNode` written in T8 ui, read in T8 renderer. `learn` written in T10 levels, read in T10 ui. Consistent.

**Note:** `spawnNode` must record `node.cost` (referenced in T5) — verify in `simulation.js` `spawnNode`; if absent, add `node.cost = costs[type]` at spawn time (one-line, included in T5 Step 1's implied spawn path — add it there).

**Execution handoff:** Plan complete and saved. Two options:
1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — I execute tasks in this session with checkpoints.

Which approach?

---

## REVISION v3 — Phase G: Geo-pivot (approved by owner)

Owner pivot: replace abstract city with a **world map**; requests originate at
distinct locations (homes, shops); component placement gains geo-meaning
(an EU node is slow for a US transaction). Campaign arc: single region →
global network. Latency sensitivity layers on top of throughput constraints.

- **G1 (done):** stylized world-map underlay drawn in WORLD space (pans/zooms
  with camera) — continent polygons baked as data in `js/worldmap.js`,
  equirectangular projection onto the playfield, active region zone tinted and
  labeled `us-east-1`. Replaces the A1 city underlay. Zero dependencies.
- **G2 (done):** emergency origins get kinds (`home` 50%, `shop` 25%,
  `clinic` 15%, `stadium` 10%) with distinct beacon glyphs.
- **G3:** distance-based packet speed (cross-ocean packets visibly crawl) +
  ms badges on portal links.
- **G4:** per-kind latency SLOs — shop = tight timer/high reward, batch =
  tolerant/low, clinic = brutal SLO; reward scales with difficulty.
- **G5:** second region unlocks; dispatcher gains "nearest-region" routing
  choice (teaches GeoDNS / latency-based routing).
- **G6:** L5 retheme → transatlantic cable cut partition; L6 → multi-region fleet.

Constraints: keep the snap grid (cells live inside regions later), no real RTT
math — "distance → slower packets + per-type timers" is the whole model,
≤12% alpha discipline for map layers so nodes/packets stay dominant.
