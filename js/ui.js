/* ==========================================================================
   USER INTERFACE HANDLER
   Binds HTML events, updates dashboard stats, controls logs, and handles inspector.
   ========================================================================== */

window.UI = class UI {
  constructor(simulation, app) {
    this.sim = simulation;
    this.app = app;
    
    // Selection state
    this.selectedTool = 'select'; // 'select' or 'wire'
    this.selectedHeroToDeploy = null; // 'volt', 'mind-palace', etc.
    this.selectedNode = null;
    this.wireStartNode = null;
    
    // Cache DOM references
    this.dom = {
      levelSelect: document.getElementById('level-select'),
      levelTitle: document.getElementById('level-title'),
      levelDesc: document.getElementById('level-desc'),
      levelObjectives: document.getElementById('level-objectives'),
      levelTopology: document.getElementById('level-topology'),
      topologyBox: document.getElementById('topology-box'),
      credits: document.getElementById('stat-credits'),
      panicText: document.getElementById('stat-panic'),
      panicFill: document.getElementById('panic-fill'),
      btnStart: document.getElementById('btn-start'),
      btnPause: document.getElementById('btn-pause'),
      btnRestart: document.getElementById('btn-restart'),
      btnHelp: document.getElementById('btn-help'),
      btnSave: document.getElementById('btn-save'),
      btnLoad: document.getElementById('btn-load'),
      canvas: document.getElementById('sim-canvas'),
      logContainer: document.getElementById('incident-log'),
      overlay: document.getElementById('game-overlay'),
      overlayTitle: document.getElementById('overlay-title'),
      overlayText: document.getElementById('overlay-text'),
      overlayAction: document.getElementById('overlay-action'),
      inspectorContent: document.getElementById('inspector-content'),
      
      // Tabs
      tabBtns: document.querySelectorAll('.tab-btn'),
      tabContents: document.querySelectorAll('.tab-content'),
      
      // Deploy tools
      deployCards: document.querySelectorAll('.deploy-card'),
      toolSelect: document.getElementById('tool-select'),
      toolWire: document.getElementById('tool-wire'),
      
      // Telemetry
      metricRps: document.getElementById('metric-rps'),
      metricResolved: document.getElementById('metric-resolved'),
      metricFailed: document.getElementById('metric-failed'),
      metricLatency: document.getElementById('metric-latency'),
      nodeTelemetry: document.getElementById('node-telemetry-container'),
      simStatus: document.getElementById('simulation-status'),

      // Tutorial DOM
      tutOverlay: document.getElementById('tutorial-overlay'),
      tutTitle: document.getElementById('tutorial-title'),
      tutText: document.getElementById('tutorial-text'),
      btnTutNext: document.getElementById('btn-tut-next'),
      btnTutBack: document.getElementById('btn-tut-back'),
      btnTutSkip: document.getElementById('btn-tut-skip'),
      tutDots: document.getElementById('tutorial-dots'),

      // Resizers
      resizerLeft: document.getElementById('resizer-left'),
      resizerRight: document.getElementById('resizer-right'),
      mainLayout: document.querySelector('.main-layout'),

      // Audio
      btnAudio: document.getElementById('btn-audio')
    };

    // Panel Resizing State
    this.leftPanelWidth = 310;
    this.rightPanelWidth = 380;

    this.tutorialIndex = 0;
    this.tutorialSlides = [
      {
        title: "Welcome, System Architect! 🎓",
        text: "Welcome to Super-Architects! You are in charge of Metro City's distributed response grid. Civilians will send distress calls (SOS signals). If they expire unanswered, panic rises. Your job is to construct a fast, self-healing, and resilient hero network to save the city! Let's learn the ropes."
      },
      {
        title: "1. Deploying Compute (Volt) ⚡",
        text: "Compute nodes do the actual work. <br><br>1. Select the <strong>🛠️ DEPLOY</strong> tab in the right panel.<br>2. Click on the <strong>Volt (Speedster)</strong> inventory card (costs $200).<br>3. Click anywhere on the map grid to deploy his base tower.<br><br>Volt will start answering local calls. Be careful: if his queue gets full, calls will overflow and be dropped!"
      },
      {
        title: "2. Routing & Linking Portals 📡",
        text: "A single Speedster will quickly burn out. To scale, you can deploy a second Speedster and a <strong>Chief Dispatcher (Load Balancer)</strong>.<br><br>1. Deploy the <strong>Dispatcher</strong> card near the center of the grid.<br>2. Select the <strong>🌀 Link Portal</strong> tool at the top of the map.<br>3. Click on the Dispatcher, then click on Volt's tower to create an energy link.<br><br>Distress calls will now route to the Dispatcher, who forwards them along portals to active Speedsters."
      },
      {
        title: "3. Inspector, Upgrades & Logs ⚙️",
        text: "Select the <strong>🔍 Select</strong> tool (top center), and click on any placed tower.<br><br>This loads the <strong>Inspector Panel</strong> on the right, allowing you to:<br>• Spend credits to **Upgrade** speeds and queues.<br>• Toggle settings like **Telepathic Ping** (health checks to bypass frozen heroes) and **Idempotency Logbooks** (to discard duplicate calls in storm zones).<br><br>Check the telemetry charts and live incident log below! Ready? Press **Start Simulation** to begin!"
      }
    ];

    this.init();
  }

  init() {
    // 1. Populating Level Selector
    this.rebuildLevelSelector();
      
    // 2. Tab Toggles
    this.dom.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.tabBtns.forEach(b => b.classList.remove('active'));
        this.dom.tabContents.forEach(c => c.classList.add('hidden'));
        
        btn.classList.add('active');
        const targetTab = document.getElementById(btn.dataset.tab);
        if (targetTab) targetTab.classList.remove('hidden');
      });
    });

    // 3. Bind Control Buttons
    this.dom.btnStart.addEventListener('click', () => this.app.startSimulation());
    this.dom.btnPause.addEventListener('click', () => this.app.pauseSimulation());
    this.dom.btnRestart.addEventListener('click', () => this.app.restartLevel());
    
    if (this.dom.btnHelp) {
      this.dom.btnHelp.addEventListener('click', () => this.startTutorial());
    }
    if (this.dom.btnSave) {
      this.dom.btnSave.addEventListener('click', () => this.saveState());
    }
    if (this.dom.btnLoad) {
      this.dom.btnLoad.addEventListener('click', () => this.loadState());
    }

    // Audio toggle
    if (this.dom.btnAudio) {
      this.dom.btnAudio.addEventListener('click', () => {
        const muted = this.app.audio.toggleMute();
        this.dom.btnAudio.textContent = muted ? '🔇 AUDIO' : '🔊 AUDIO';
        this.dom.btnAudio.classList.toggle('btn-audio-muted', muted);
      });
    }
    
    this.dom.levelSelect.addEventListener('change', (e) => {
      this.app.loadLevel(parseInt(e.target.value));
    });

    // 4. Bind Placement / Wire Tools
    this.dom.toolSelect.addEventListener('click', () => this.setTool('select'));
    this.dom.toolWire.addEventListener('click', () => this.setTool('wire'));

    // Onboarding Tutorial Wizard buttons
    if (this.dom.btnTutNext) {
      this.dom.btnTutNext.addEventListener('click', () => this.nextTutorialStep());
      this.dom.btnTutBack.addEventListener('click', () => this.prevTutorialStep());
      this.dom.btnTutSkip.addEventListener('click', () => this.closeTutorial());
    }

    this.dom.deployCards.forEach(card => {
      card.addEventListener('click', () => {
        this.selectHeroForDeployment(card.dataset.hero);
      });
    });

    // 5. Canvas Clicks
    this.dom.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));

    // Hover highlight for the deployment grid
    this.dom.canvas.addEventListener('mousemove', (e) => {
      const rect = this.dom.canvas.getBoundingClientRect();
      this.sim.hoverCell = this.sim.snapToGrid(e.clientX - rect.left, e.clientY - rect.top);
    });
    this.dom.canvas.addEventListener('mouseleave', () => { this.sim.hoverCell = null; });

    // 6. Win Screen overlay action
    this.dom.overlayAction.addEventListener('click', () => {
      this.dom.overlay.classList.add('hidden');
      const nextLevel = this.sim.currentLevelId + 1;
      if (nextLevel <= this.app.levels.length) {
        this.dom.levelSelect.value = nextLevel;
        this.app.loadLevel(nextLevel);
      } else {
        // Game completed!
        this.app.loadLevel(1); // loop back
      }
    });

    // Register log callbacks
    this.sim.onLogCallback = (log) => this.appendLog(log);
    
    // Bind Panel Resizers
    this.initPanelResizers();
    
    // Initialize first briefing text
    this.updateBriefing();
  }

  setTool(tool) {
    this.selectedTool = tool;
    this.dom.toolSelect.classList.toggle('active', tool === 'select');
    this.dom.toolWire.classList.toggle('active', tool === 'wire');
    
    // Reset canvas cursor to default unless we are in deploy mode.
    this.dom.canvas.style.cursor = tool === 'deploy' ? 'crosshair' : '';
    
    if (tool !== 'select') {
      this.selectedNode = null;
      this.updateInspector();
    }
    
    // Clear deploy cards if active
    if (tool !== 'deploy') {
      this.selectedHeroToDeploy = null;
      this.dom.deployCards.forEach(c => c.classList.remove('active'));
    }
    
    this.wireStartNode = null;
    this.sim.log(`🔧 TOOL SELECTED: ${tool.toUpperCase() === 'WIRE' ? 'Link Portal mode (Click source, then target node)' : 'Select mode'}`, "system-msg");
  }

  selectHeroForDeployment(heroType) {
    this.selectedTool = 'deploy';
    this.selectedHeroToDeploy = heroType;
    this.wireStartNode = null;
    this.selectedNode = null;
    
    this.dom.toolSelect.classList.remove('active');
    this.dom.toolWire.classList.remove('active');
    
    this.dom.deployCards.forEach(card => {
      card.classList.toggle('active', card.dataset.hero === heroType);
    });
    
    // Show crosshair cursor on canvas so the player knows placement mode is active.
    this.dom.canvas.style.cursor = 'crosshair';
    
    this.updateInspector();
    this.sim.log(`🛠️ PLACEMENT ACTIVE: Click anywhere on the map to deploy ${heroType.toUpperCase()}`, "system-msg");
  }

  handleCanvasClick(e) {
    const rect = this.dom.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const clickedNode = this.sim.nodes.find(n => Math.hypot(n.x - x, n.y - y) < 22 && n.status === 'active');
    
    if (this.selectedTool === 'deploy') {
      if (clickedNode) {
        this.sim.log(`❌ DEPLOY BLOCKED: ${clickedNode.name} is occupying that position. Click further away — there is plenty of empty space elsewhere on the map.`, "warning");
        return;
      }
      
      const costs = { volt: 200, 'mind-palace': 300, dispatcher: 150, cache: 100, coordinator: 250 };
      if (!this.sim.credits || this.sim.credits < (costs[this.selectedHeroToDeploy] || 1)) {
        this.sim.log(`❌ INSUFFICIENT BUDGET: Deploying ${this.selectedHeroToDeploy} costs $${costs[this.selectedHeroToDeploy]}. You have $${this.sim.credits}. Resolve more distress calls to earn credits.`, "warning");
        return;
      }
      
      const snap = this.sim.snapToGrid(x, y);
      if (!this.sim.isCellFree(snap.gx, snap.gy)) {
        this.sim.log(`❌ DEPLOY BLOCKED: That grid cell is occupied. Deploy onto a free cell of the deployment grid.`, "warning");
        return;
      }
      const node = this.sim.spawnNode(this.selectedHeroToDeploy, snap.x, snap.y);
      if (node) {
        // Success: Reset tool
        this.setTool('select');
        this.selectedNode = node;
        this.updateInspector();
        // SFX
        if (this.app.audio) this.app.audio.sfxDeploy();
      }
    } else if (this.selectedTool === 'wire') {
      if (!clickedNode) return;
      
      if (!this.wireStartNode) {
        this.wireStartNode = clickedNode;
        this.sim.log(`🌀 LINK PORTAL: Selected source ${clickedNode.name}. Now click target node.`, "system-msg");
      } else {
        if (this.wireStartNode === clickedNode) {
          this.wireStartNode = null;
          this.sim.log("🌀 LINK PORTAL: Canceled portal loop.", "system-msg");
          return;
        }
        
        const portal = this.sim.spawnPortal(this.wireStartNode, clickedNode);
        this.wireStartNode = null;
        this.setTool('select');
        // SFX
        if (this.app.audio) this.app.audio.sfxDeploy();
      }
    } else if (this.selectedTool === 'select') {
      this.selectedNode = clickedNode || null;
      this.updateInspector();
    }
  }

  updateBriefing() {
    if (!this.sim.levelConfig) return;
    this.dom.levelTitle.innerText = `Mission ${this.sim.levelConfig.id}: ${this.sim.levelConfig.name}`;
    this.dom.levelDesc.innerText = this.sim.levelConfig.desc;
    
    // Draw Objectives
    this.dom.levelObjectives.innerHTML = this.sim.levelConfig.objectives
      .map(obj => `<li id="obj-${obj.id}">${obj.text}</li>`)
      .join('');

    // Draw Architecture (topology blueprint) checklist, if the level defines one
    const topo = this.sim.levelConfig.topology;
    if (topo && topo.constraints && topo.constraints.length) {
      this.dom.topologyBox.style.display = '';
      this.dom.levelTopology.innerHTML = topo.constraints
        .map((c, i) => `<li id="topo-${i}">${c.text}</li>`)
        .join('');
    } else {
      this.dom.topologyBox.style.display = 'none';
      this.dom.levelTopology.innerHTML = '';
    }
  }

  updateTickUI() {
    // 1. Credits & Panic
    this.dom.credits.innerText = `$${this.sim.credits}`;
    this.dom.panicText.innerText = `${this.sim.panic}%`;
    this.dom.panicFill.style.width = `${this.sim.panic}%`;
    
    // Toggle color based on panic level
    if (this.sim.panic > 70) {
      this.dom.panicText.className = "stat-value text-red";
    } else if (this.sim.panic > 40) {
      this.dom.panicText.className = "stat-value text-gold";
    } else {
      this.dom.panicText.className = "stat-value text-green";
    }

    // 2. Play/Pause buttons state
    this.dom.btnStart.disabled = this.sim.isPlaying;
    this.dom.btnPause.disabled = !this.sim.isPlaying;
    
    this.dom.simStatus.className = this.sim.isPlaying ? "status-indicator active" : "status-indicator inactive";
    this.dom.simStatus.innerText = this.sim.isPlaying ? "SIMULATION RUNNING" : "SIMULATION PAUSED";

    // 3. Update Objectives State (Completed vs Pending)
    if (this.sim.levelConfig) {
      for (let obj of this.sim.levelConfig.objectives) {
        const item = document.getElementById(`obj-${obj.id}`);
        if (item) {
          const isDone = this.sim.completedObjectives.has(obj.id);
          item.classList.toggle('completed', isDone);
        }
      }
    }

    // 3b. Update Architecture (topology blueprint) checklist
    const topo = this.sim.levelConfig && this.sim.levelConfig.topology;
    if (topo && topo.constraints) {
      topo.constraints.forEach((c, i) => {
        const item = document.getElementById(`topo-${i}`);
        if (item) item.classList.toggle('completed', c.check(this.sim) === true);
      });
    }

    // 4. Update Telemetry Panel
    this.dom.metricRps.innerText = this.sim.stats.rps.toFixed(1);
    this.dom.metricResolved.innerText = this.sim.stats.resolved;
    this.dom.metricFailed.innerText = this.sim.stats.failed;
    
    const avgLatency = this.sim.stats.latencyCount > 0 
      ? Math.round((this.sim.stats.latencySum / this.sim.stats.latencyCount) * 16.6)
      : 0;
    this.dom.metricLatency.innerText = `${avgLatency}ms`;

    // 5. Upgrade buttons states
    this.updateDeployInventoryLimits();

    // 6. Dynamic Inspector contents
    this.tickInspectorRefresh();

    // 7. Render node status progress list
    this.renderNodeTelemetry();

    // 8. Drive audio engine with current panic + play state
    if (this.app.audio) {
      this.app.audio.onSimulationTick(this.sim.panic, this.sim.isPlaying);
    }
  }

  updateDeployInventoryLimits() {
    this.dom.deployCards.forEach(card => {
      const type = card.dataset.hero;
      const allowed = this.sim.levelConfig.allowedHeroes.includes(type);
      const costs = { 'volt': 200, 'mind-palace': 300, 'dispatcher': 150, 'cache': 100, 'coordinator': 250 };
      const canAfford = this.sim.credits >= costs[type];
      
      card.disabled = !allowed || !canAfford;
      // Give the player a hint about WHY a card is locked.
      if (!allowed) {
        card.title = `This component is not available on the current mission.`;
      } else if (!canAfford) {
        card.title = `Need $${costs[type]} — current budget: $${this.sim.credits}`;
      }
    });
  }

  renderNodeTelemetry() {
    const list = this.dom.nodeTelemetry;
    const speedsters = this.sim.nodes.filter(n => (n.type === 'volt' || n.isClone) && n.status === 'active');
    
    if (speedsters.length === 0) {
      list.innerHTML = `<p class="empty-list-msg">No active heroes deployed yet.</p>`;
      return;
    }
    
    list.innerHTML = speedsters.map(s => {
      const barClass = s.cpuLoad > 80 ? 'danger' : (s.cpuLoad > 50 ? 'warning' : '');
      const load = s.cpuLoad;
      const statusText = s.isFrozen ? 'FROZEN' : (s.cpuLoad > 80 ? 'OVERLOAD' : 'ACTIVE');
      const statusColor = s.isFrozen ? '#4facfe' : (s.cpuLoad > 80 ? '#ff1744' : '#00e676');
      
      return `
        <div class="node-tel-card">
          <div class="node-tel-header">
            <span class="node-tel-name">⚡ ${s.name} (Lvl ${s.level})</span>
            <span class="node-tel-status" style="color: ${statusColor}">${statusText}</span>
          </div>
          <div class="node-tel-header" style="font-size: 8.5px; color: #8892b0; margin-bottom: 2px;">
            <span>Queue: ${s.queue.length}/${s.maxQueue} calls</span>
            <span>CPU: ${load}%</span>
          </div>
          <div class="node-progress-bar">
            <div class="node-progress-fill ${barClass}" style="width: ${load}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  updateInspector() {
    const root = this.dom.inspectorContent;
    
    if (!this.selectedNode) {
      root.innerHTML = `<div class="inspector-empty"><p>Click on any hero or portal in the grid to inspect details and purchase upgrades.</p></div>`;
      return;
    }
    
    const node = this.selectedNode;
    const upgradeCosts = { 1: 150, 2: 300, 3: 500 };
    const cost = upgradeCosts[node.level];
    const costText = cost ? `$${cost}` : 'MAX LEVEL';
    const canAfford = cost && this.sim.credits >= cost;
    
    let specificHTML = '';
    
    // Volt specific Controls
    if (node.type === 'volt') {
      const dedupActive = node.dedupEnabled;
      specificHTML = `
        <div class="inspector-row">
          <span class="inspector-label">Processing Rate:</span>
          <span class="inspector-val">${Math.round(node.processingRate * 1000)} Hz</span>
        </div>
        <div class="inspector-row">
          <span class="inspector-label">Idempotency Logbook:</span>
          <span class="inspector-val">
            <input type="checkbox" id="chk-dedup" ${dedupActive ? 'checked' : ''}> Deduplicate
          </span>
        </div>
      `;
    }
    
    // Dispatcher specific controls
    if (node.type === 'dispatcher') {
      const routing = node.routingPolicy;
      const hcActive = node.healthCheckEnabled;
      specificHTML = `
        <div class="inspector-row">
          <span class="inspector-label">Routing Algorithm:</span>
          <span class="inspector-val">
            <select id="sel-routing">
              <option value="round-robin" ${routing === 'round-robin' ? 'selected' : ''}>Round Robin</option>
              <option value="least-connections" ${routing === 'least-connections' ? 'selected' : ''}>Least Connections</option>
            </select>
          </span>
        </div>
        <div class="inspector-row">
          <span class="inspector-label">Telepathic Ping (Health Check):</span>
          <span class="inspector-val">
            <input type="checkbox" id="chk-hc" ${hcActive ? 'checked' : ''}> Active
          </span>
        </div>
      `;
    }
    
    // Database specific controls
    if (node.type === 'mind-palace') {
      const role = node.dbRole.toUpperCase();
      const cap = this.sim.settings.capStrategy;
      const syncSpeed = node.syncSpeedTicks;
      
      specificHTML = `
        <div class="inspector-row">
          <span class="inspector-label">Database Role:</span>
          <span class="inspector-val text-gold">${role}</span>
        </div>
        <div class="inspector-row">
          <span class="inspector-label">CAP Strategy (Consensus):</span>
          <span class="inspector-val">
            <select id="sel-cap">
              <option value="AP" ${cap === 'AP' ? 'selected' : ''}>AP Mode (Available)</option>
              <option value="CP" ${cap === 'CP' ? 'selected' : ''}>CP Mode (Consistent)</option>
            </select>
          </span>
        </div>
        <div class="inspector-row">
          <span class="inspector-label">Sync Portal Delay:</span>
          <span class="inspector-val">${Math.round(syncSpeed * 16.6)}ms</span>
        </div>
        <div class="inspector-row">
          <span class="inspector-label">Registry Size:</span>
          <span class="inspector-val">${Object.keys(node.registry).length} keys</span>
        </div>
      `;
    }

    // Coordinator (Kubernetes) controls
    if (node.type === 'coordinator') {
      const clones = node.desiredReplicaCount;
      specificHTML = `
        <div class="inspector-row">
          <span class="inspector-label">Desired Clones:</span>
          <span class="inspector-val" style="display:flex; align-items:center; gap:8px;">
            <button id="btn-clone-dec" class="btn btn-secondary" style="padding:4px 8px; width:auto;">-</button>
            <span id="txt-clone-count" style="font-weight:bold; font-size:14px;">${clones}</span>
            <button id="btn-clone-inc" class="btn btn-secondary" style="padding:4px 8px; width:auto;">+</button>
          </span>
        </div>
      `;
    }

    // Render Inspector Box
    root.innerHTML = `
      <div class="inspector-card">
        <div class="inspector-row">
          <h4 style="font-family: var(--font-title); font-size: 13px; color: var(--primary);">${node.name}</h4>
          <span class="logo-badge" style="font-size: 8px;">LEVEL ${node.level}</span>
        </div>
        <div class="inspector-row">
          <span class="inspector-label">Queue Slot Buffer:</span>
          <span class="inspector-val">${node.queue.length} / ${node.maxQueue}</span>
        </div>
        ${specificHTML}
        
        <div class="inspector-upgrade-box">
          <button id="btn-upgrade-node" class="upgrade-btn" ${!cost || !canAfford ? 'disabled' : ''}>
            <span>UPGRADE COMPONENT</span>
            <span style="font-weight:bold;">${costText}</span>
          </button>
        </div>
      </div>
    `;

    // 7. Bind interactive actions on the inner inspector components
    this.bindInspectorListeners();
  }

  bindInspectorListeners() {
    const node = this.selectedNode;
    if (!node) return;
    
    // Upgrade button click
    const btnUpgrade = document.getElementById('btn-upgrade-node');
    if (btnUpgrade) {
      btnUpgrade.addEventListener('click', () => {
        if (node.upgrade(this.sim)) {
          this.sim.log(`🚀 UPGRADED: ${node.name} upgraded to Level ${node.level}!`, "success");
          this.updateInspector();
        }
      });
    }
    
    // Volt specific checkbox
    const chkDedup = document.getElementById('chk-dedup');
    if (chkDedup) {
      chkDedup.addEventListener('change', (e) => {
        node.dedupEnabled = e.target.checked;
        this.sim.log(`⚙️ SETTING CHANGE: ${node.name} Idempotence Logbook ${node.dedupEnabled ? 'ENABLED' : 'DISABLED'}`, "system-msg");
      });
    }
    
    // Dispatcher routing policy
    const selRouting = document.getElementById('sel-routing');
    if (selRouting) {
      selRouting.addEventListener('change', (e) => {
        node.routingPolicy = e.target.value;
        this.sim.log(`⚙️ ROUTING CHANGE: Dispatcher algorithm set to ${node.routingPolicy.toUpperCase().replace('-', ' ')}`, "system-msg");
      });
    }
    
    // Dispatcher health check
    const chkHc = document.getElementById('chk-hc');
    if (chkHc) {
      chkHc.addEventListener('change', (e) => {
        node.healthCheckEnabled = e.target.checked;
        this.sim.log(`⚙️ HEALTH CHECKS: Telepathic Ping monitoring ${node.healthCheckEnabled ? 'ENABLED' : 'DISABLED'}`, "system-msg");
      });
    }

    // Database CAP selector
    const selCap = document.getElementById('sel-cap');
    if (selCap) {
      selCap.addEventListener('change', (e) => {
        this.sim.settings.capStrategy = e.target.value;
        this.sim.log(`⚖️ CAP STATE UPDATED: Clusters consensus mode configured for consistency type: ${this.sim.settings.capStrategy}`, "warning");
      });
    }

    // Coordinator Clone increments
    const btnCloneInc = document.getElementById('btn-clone-inc');
    const btnCloneDec = document.getElementById('btn-clone-dec');
    const txtClone = document.getElementById('txt-clone-count');
    
    if (btnCloneInc && btnCloneDec) {
      btnCloneInc.addEventListener('click', () => {
        node.desiredReplicaCount++;
        txtClone.innerText = node.desiredReplicaCount;
        this.sim.log(`🐳 ORCHESTRATION: Cluster set to autoscale, targeted Volt clones: ${node.desiredReplicaCount}`, "info");
      });
      
      btnCloneDec.addEventListener('click', () => {
        node.desiredReplicaCount = Math.max(0, node.desiredReplicaCount - 1);
        txtClone.innerText = node.desiredReplicaCount;
        this.sim.log(`🐳 ORCHESTRATION: Cluster set to autoscale, targeted Volt clones: ${node.desiredReplicaCount}`, "info");
      });
    }
  }

  tickInspectorRefresh() {
    if (!this.selectedNode) return;
    
    // Periodic reload to refresh queue sizes / CPU loads
    const labelQueue = this.dom.inspectorContent.querySelector('.inspector-card .inspector-row span.inspector-val');
    if (labelQueue) {
      labelQueue.innerText = `${this.selectedNode.queue.length} / ${this.selectedNode.maxQueue}`;
    }
    
    // Refresh Upgrade button disabled/enabled state based on dynamic credits changes
    const btnUpgrade = document.getElementById('btn-upgrade-node');
    if (btnUpgrade && this.selectedNode) {
      const upgradeCosts = { 1: 150, 2: 300, 3: 500 };
      const cost = upgradeCosts[this.selectedNode.level];
      const canAfford = cost && this.sim.credits >= cost;
      btnUpgrade.disabled = !cost || !canAfford;
    }
  }

  appendLog(log) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${log.type}`;
    entry.innerHTML = `<span style="color: #8892b0;">[${log.time}]</span> ${log.message}`;
    
    this.dom.logContainer.appendChild(entry);
    
    // Clamp entries to avoid memory leak
    while (this.dom.logContainer.childElementCount > 35) {
      this.dom.logContainer.removeChild(this.dom.logContainer.firstChild);
    }
    
    // Scroll to bottom
    this.dom.logContainer.scrollTop = this.dom.logContainer.scrollHeight;
  }

  showSuccessScreen() {
    this.unlockNextLevel(this.sim.currentLevelId);
    this.dom.overlayTitle.innerText = "MISSION SUCCESS! 🎉";
    this.dom.overlayText.innerText = `Great job Architect! You successfully built a resilient, self-healing system and solved Level ${this.sim.currentLevelId}. Ready for the next architectural challenge?`;
    this.dom.overlayAction.innerText = "NEXT LEVEL ▶";
    this.dom.overlay.classList.remove('hidden');
    if (this.app.audio) this.app.audio.sfxSuccess();
  }

  showFailScreen() {
    this.dom.overlayTitle.innerText = "SYSTEM FAIL 💥";
    this.dom.overlayText.innerText = `The panic index reached 100%! Overloaded queues, broken network pathways, or unhealthful configurations caused calls to expire. Refine your system layout and try again.`;
    this.dom.overlayAction.innerText = "RESTART MISSION 🔄";
    if (this.app.audio) this.app.audio.sfxGameOver();
    
    // Wire overlayAction to restart instead
    const restartCallback = () => {
      this.dom.overlay.classList.add('hidden');
      this.app.restartLevel();
      this.dom.overlayAction.removeEventListener('click', restartCallback);
    };
    
    this.dom.overlayAction.addEventListener('click', restartCallback);
    this.dom.overlay.classList.remove('hidden');
  }

  // ==========================================================================
  // Onboarding Tutorial Wizard Logic
  // ==========================================================================
  startTutorial() {
    this.tutorialIndex = 0;
    this.showTutorialSlide();
    this.dom.tutOverlay.classList.remove('hidden');
  }

  nextTutorialStep() {
    this.tutorialIndex++;
    if (this.tutorialIndex >= this.tutorialSlides.length) {
      this.closeTutorial();
    } else {
      this.showTutorialSlide();
    }
  }

  prevTutorialStep() {
    this.tutorialIndex = Math.max(0, this.tutorialIndex - 1);
    this.showTutorialSlide();
  }

  closeTutorial() {
    this.dom.tutOverlay.classList.add('hidden');
    this.sim.log("🎓 Tutorial closed. Good luck, Architect!", "system-msg");
  }

  showTutorialSlide() {
    const slide = this.tutorialSlides[this.tutorialIndex];
    this.dom.tutTitle.innerText = slide.title;
    this.dom.tutText.innerHTML = slide.text;
    
    // Back button disabled on first step
    this.dom.btnTutBack.disabled = (this.tutorialIndex === 0);
    
    // Next button label finishes on last step
    this.dom.btnTutNext.innerText = (this.tutorialIndex === this.tutorialSlides.length - 1) ? "FINISH 🏁" : "NEXT ➡";
    
    // Render active dot indicators
    if (this.dom.tutDots) {
      this.dom.tutDots.innerHTML = this.tutorialSlides
        .map((_, i) => `<span class="dot ${i === this.tutorialIndex ? 'active' : ''}"></span>`)
        .join('');
    }
  }

  initPanelResizers() {
    const resizerLeft = this.dom.resizerLeft;
    const resizerRight = this.dom.resizerRight;
    const mainLayout = this.dom.mainLayout;
    
    if (!resizerLeft || !resizerRight || !mainLayout) return;
    
    // Left Resizer Drag Handler
    resizerLeft.addEventListener('mousedown', (e) => {
      e.preventDefault();
      resizerLeft.classList.add('resizing');
      
      const onMouseMove = (moveEvent) => {
        // Clamp width between 240px and 450px
        this.leftPanelWidth = Math.max(240, Math.min(450, moveEvent.clientX));
        mainLayout.style.gridTemplateColumns = `${this.leftPanelWidth}px 4px 1fr 4px ${this.rightPanelWidth}px`;
        
        // Recalculate canvas boundaries dynamically
        this.app.renderer.resize();
      };
      
      const onMouseUp = () => {
        resizerLeft.classList.remove('resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
    
    // Right Resizer Drag Handler
    resizerRight.addEventListener('mousedown', (e) => {
      e.preventDefault();
      resizerRight.classList.add('resizing');
      
      const onMouseMove = (moveEvent) => {
        // Clamp width between 280px and 500px
        this.rightPanelWidth = Math.max(280, Math.min(500, window.innerWidth - moveEvent.clientX));
        mainLayout.style.gridTemplateColumns = `${this.leftPanelWidth}px 4px 1fr 4px ${this.rightPanelWidth}px`;
        
        // Recalculate canvas boundaries dynamically
        this.app.renderer.resize();
      };
      
      const onMouseUp = () => {
        resizerRight.classList.remove('resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // ==========================================================================
  // Persistent Save & Load / Level Locking
  // ==========================================================================
  rebuildLevelSelector() {
    const unlocked = this.getUnlockedLevels();
    this.dom.levelSelect.innerHTML = this.app.levels
      .map(lvl => {
        const isUnlocked = unlocked.includes(lvl.id);
        const disabledAttr = isUnlocked ? '' : 'disabled';
        const lockLabel = isUnlocked ? '' : ' (LOCKED)';
        return `<option value="${lvl.id}" ${disabledAttr}>Mission ${lvl.id}: ${lvl.name}${lockLabel}</option>`;
      })
      .join('');
    
    // Set selection index to current active level in dropdown
    this.dom.levelSelect.value = this.sim.currentLevelId;
  }

  getUnlockedLevels() {
    try {
      const stored = localStorage.getItem('super_architects_unlocked_levels');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [1]; // level 1 unlocked by default
  }

  unlockNextLevel(completedLevelId) {
    const nextLevelId = completedLevelId + 1;
    const unlocked = this.getUnlockedLevels();
    if (!unlocked.includes(nextLevelId) && nextLevelId <= this.app.levels.length) {
      unlocked.push(nextLevelId);
      localStorage.setItem('super_architects_unlocked_levels', JSON.stringify(unlocked));
      this.rebuildLevelSelector();
      this.sim.log(`🏆 MISSION UNLOCKED: Level ${nextLevelId} is now available!`, "success");
    }
  }

  saveState() {
    const serializedData = this.sim.serialize();
    localStorage.setItem('super_architects_save_state', serializedData);
    this.sim.log(`💾 GRID ARCHIVED: Deployed layout and credits successfully saved to local storage!`, "success");
  }

  loadState() {
    const stored = localStorage.getItem('super_architects_save_state');
    if (!stored) {
      this.sim.log(`📂 LOAD WARNING: No saved configuration found in browser database.`, "warning");
      return;
    }
    
    if (this.sim.deserialize(stored)) {
      // Rebuild selector and UI elements
      this.rebuildLevelSelector();
      this.updateBriefing();
      this.updateTickUI();
      this.setTool('select');
    }
  }
}
