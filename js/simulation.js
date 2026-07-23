/* ==========================================================================
   SIMULATION ENGINE
   The physics and logic engine of the distributed systems game.
   Handles tick intervals, node queues, database sync, CAP strategy, and metrics.
   ========================================================================== */
window.Simulation = class Simulation {
  constructor(canvasWidth, canvasHeight) {
    this.width = canvasWidth;
    this.height = canvasHeight;
    
    // State lists
    this.nodes = [];
    this.portals = [];
    this.packets = [];
    this.emergencies = [];
    
    // Core game parameters
    this.credits = 0;
    this.panic = 0; // 0 to 100%
    this.tickCount = 0;
    this.isPlaying = false;
    
    // Level tracking
    this.levelConfig = null;
    this.currentLevelId = 1;
    this.completedObjectives = new Set();
    
    // Callbacks for UI updates
    this.onTickCallback = null;
    this.onLogCallback = null;
    this.onLevelCompleteCallback = null;
    this.onLevelFailCallback = null;
    
    // Telemetry Statistics
    this.stats = {
      rps: 0.0,
      resolved: 0,
      failed: 0,
      duplicates: 0,
      latencySum: 0,
      latencyCount: 0,
      dbReads: 0,
      dbWrites: 0,
      staleDbReads: 0,
      dbConflicts: 0,
      dbConflictsResolved: 0
    };
    
    // Global parameters
    this.settings = {
      ackEnabled: false,
      retryEnabled: false,
      networkLossRate: 0,
      networkPartitionActive: false,
      capStrategy: 'AP', // 'AP' or 'CP'
      retryTimeout: 120 // ticks before retry (2 seconds)
    };
    
    // Packet ID counter
    this.nextPacketId = 1;
    
    // Node ID counter
    this.nextNodeId = 1;
    
    // Emergency ID counter
    this.nextEmergencyId = 1;
    
    // Live logs storage
    this.logs = [];
    
    // Meteor visual triggers
    this.meteors = [];
  }

  log(message, type = 'system-msg') {
    const time = new Date().toLocaleTimeString();
    const logEntry = { id: Date.now() + Math.random(), time, message, type };
    this.logs.push(logEntry);
    if (this.logs.length > 50) this.logs.shift();
    if (this.onLogCallback) this.onLogCallback(logEntry);
  }

  loadLevel(levelId) {
    this.currentLevelId = levelId;
    this.levelConfig = window.Levels.find(l => l.id === levelId);
    
    // Reset simulation state
    this.nodes = [];
    this.portals = [];
    this.packets = [];
    this.emergencies = [];
    this.tickCount = 0;
    this.panic = 0;
    this.completedObjectives.clear();
    
    // Reset stats
    this.stats = {
      rps: 0.0,
      resolved: 0,
      failed: 0,
      duplicates: 0,
      latencySum: 0,
      latencyCount: 0,
      dbReads: 0,
      dbWrites: 0,
      staleDbReads: 0,
      dbConflicts: 0,
      dbConflictsResolved: 0
    };
    
    // Reset global settings
    this.settings = {
      ackEnabled: false,
      retryEnabled: false,
      networkLossRate: 0,
      networkPartitionActive: false,
      capStrategy: 'AP',
      retryTimeout: 120
    };
    
    // Deduct cost and deploy starting assets
    if (this.levelConfig) {
      this.levelConfig.setup(this);
      this.log(`🚀 LOADED: Level ${this.levelConfig.id} - ${this.levelConfig.name}`, "info");
    }
  }

  start() {
    this.isPlaying = true;
    this.log("▶ Simulation started.", "system-msg");
  }

  pause() {
    this.isPlaying = false;
    this.log("⏸ Simulation paused.", "system-msg");
  }

  tick() {
    if (!this.isPlaying) return;
    
    this.tickCount++;
    
    // 1. Run Level-specific Tick Script (for event triggers like meteors or freezes)
    if (this.levelConfig && this.levelConfig.tick) {
      this.levelConfig.tick(this);
    }
    
    // 2. Spawn Emergencies periodically
    if (this.tickCount % Math.floor(this.levelConfig.spawnRate / 16.6) === 0) {
      const count = this.levelConfig.spawnIntensity;
      for (let i = 0; i < count; i++) {
        this.spawnEmergency();
      }
    }
    
    // 3. Process Emergencies / Distress Calls
    this.processEmergencies();
    
    // 4. Process Portals & Packets (Networking)
    this.processPortals();
    
    // 5. Process Nodes (Compute, Database, Dispatchers, Coordinators)
    this.processNodes();
    
    // 6. Handle Panic Level Increments
    this.calculatePanic();
    
    // 7. Update Live RPS (Rolling average)
    if (this.tickCount % 60 === 0) {
      const activeCalls = this.emergencies.length;
      this.stats.rps = parseFloat(((activeCalls + this.stats.resolved) / (this.tickCount / 60)).toFixed(1));
    }
    
    // 8. Evaluate Objectives
    this.evaluateObjectives();
    
    // 9. Fire general tick callback to update canvas / UI panels
    if (this.onTickCallback) this.onTickCallback();
  }

  spawnEmergency() {
    // Generate a random district coordinate
    const padding = 60;
    const x = padding + Math.random() * (this.width - padding * 2);
    const y = padding + Math.random() * (this.height - padding * 2);
    
    const emergency = {
      id: this.nextEmergencyId++,
      x,
      y,
      ticksActive: 0,
      maxLife: 800, // Ticks before failure
      state: 'pending' // 'pending', 'assigned', 'resolved'
    };
    
    this.emergencies.push(emergency);
    
    // Auto-route it if a Dispatcher exists. Otherwise, send to nearest Volt.
    this.routeEmergency(emergency);
  }

  routeEmergency(emergency) {
    // Look for Dispatcher first
    const dispatcher = this.nodes.find(n => n.type === 'dispatcher' && n.status === 'active');
    
    if (dispatcher) {
      // Send message to Dispatcher
      const packet = new Packet(
        this.nextPacketId++,
        'request',
        null,
        dispatcher,
        emergency
      );
      this.packets.push(packet);
      emergency.state = 'assigned';
    } else {
      // Send directly to the closest Volt node
      const volts = this.nodes.filter(n => (n.type === 'volt' || n.isClone) && n.status === 'active');
      if (volts.length > 0) {
        // Find closest
        let closest = volts[0];
        let minDist = Math.hypot(volts[0].x - emergency.x, volts[0].y - emergency.y);
        for (let v of volts) {
          const dist = Math.hypot(v.x - emergency.x, v.y - emergency.y);
          if (dist < minDist) {
            minDist = dist;
            closest = v;
          }
        }
        
        const packet = new Packet(
          this.nextPacketId++,
          'request',
          null,
          closest,
          emergency
        );
        this.packets.push(packet);
        emergency.state = 'assigned';
      }
    }
  }

  spawnNode(type, x, y, options = {}) {
    const costs = { 'volt': 200, 'mind-palace': 300, 'dispatcher': 150, 'cache': 100, 'coordinator': 250 };
    const cost = costs[type] || 100;
    
    if (!options.preplaced && this.credits < cost) {
      this.log(`❌ DEPLOY FAILED: Insufficient credits to deploy ${type} (Costs $${cost})`, "warning");
      return null;
    }
    
    if (!options.preplaced) {
      this.credits -= cost;
    }
    
    const node = new Node(this.nextNodeId++, type, x, y, options);
    this.nodes.push(node);
    
    this.log(`🛠️ DEPLOYED: ${node.name} at coordinate (${Math.round(x)}, ${Math.round(y)})`, "info");
    return node;
  }

  spawnPortal(nodeA, nodeB) {
    if (nodeA === nodeB) return null;
    // Check if portal already exists
    const exists = this.portals.some(p => (p.from === nodeA && p.to === nodeB) || (p.from === nodeB && p.to === nodeA));
    if (exists) return null;
    
    const portal = new Portal(nodeA, nodeB);
    this.portals.push(portal);
    this.log(`🌀 PORTAL CREATED: Linked ${nodeA.name} to ${nodeB.name}`, "info");
    return portal;
  }

  processEmergencies() {
    for (let i = this.emergencies.length - 1; i >= 0; i--) {
      const em = this.emergencies[i];
      if (em.state === 'resolved') {
        this.emergencies.splice(i, 1);
        continue;
      }
      
      em.ticksActive++;
      
      // If emergency expires, fail it (dropped call / high panic)
      if (em.ticksActive >= em.maxLife) {
        this.stats.failed++;
        this.emergencies.splice(i, 1);
        this.log(`🚨 RESPONSE TIMEOUT: Distress call expired! Panic increasing.`, "danger");
        
        // Clean up any packet targeting this emergency
        this.packets = this.packets.filter(p => p.payload !== em);
      }
    }
  }

  processPortals() {
    // Move and process packets traveling inside portals
    for (let i = this.packets.length - 1; i >= 0; i--) {
      const pkt = this.packets[i];
      
      // Check network partition rifts (Level 5 CAP Theorem)
      if (this.settings.networkPartitionActive) {
        const fromSideLeft = pkt.from ? pkt.from.x < this.width / 2 : pkt.payload.x < this.width / 2;
        const toSideLeft = pkt.to.x < this.width / 2;
        
        if (fromSideLeft !== toSideLeft) {
          // Cross-partition packet is isolated!
          pkt.ticksPartitioned++;
          if (pkt.ticksPartitioned > 200) {
            // Packet times out and is dropped
            this.packets.splice(i, 1);
            this.log(`🔏 NETWORK PARTITION: Packet #${pkt.id} lost in the Rift zone`, "danger");
            continue;
          }
          continue; // Freeze transit movement
        }
      }
      
      if (pkt.state === 'in-transit') {
        pkt.progress += pkt.speed;
        
        // Unstable portal drop check (packet loss simulator).
        // Only apply network loss to forwarded packets that have a known
        // sender — packets dispatched anonymously from an emergency (from:null)
        // represent a local routing attempt before they've even hit a portal,
        // and retry logic only exists for dispatcher-→-volt forwarding.
        if (pkt.from && pkt.progress >= 0.5 && !pkt.hasPassedLossCheck) {
          pkt.hasPassedLossCheck = true;
          if (Math.random() < this.settings.networkLossRate) {
            // Packet is lost!
            this.log(`💥 PACKET LOSS: Distress Signal #${pkt.id} destroyed by Asteroids`, "warning");
            this.packets.splice(i, 1);
            continue;
          }
        }
        
        if (pkt.progress >= 1.0) {
          // Packet arrived at destination!
          this.deliverPacket(pkt, i);
        }
      } else if (pkt.state === 'sent-waiting-ack') {
        pkt.ticksWaitingAck++;
        
        if (this.settings.retryEnabled && pkt.ticksWaitingAck >= this.settings.retryTimeout) {
          // ACK timed out! Send retry packet.
          pkt.ticksWaitingAck = 0;
          pkt.retryCount++;
          
          if (pkt.retryCount > 3) {
            // Give up
            this.log(`❌ PACKET FAILED: Giving up retrying Packet #${pkt.id} after 3 attempts`, "danger");
            this.stats.failed++;
            this.packets.splice(i, 1);
          } else {
            this.log(`🔄 RETRY SENT: Re-transmitting Packet #${pkt.id} (Attempt ${pkt.retryCount})`, "warning");
            
            // Spawn duplicate packet traveling along portal
            const duplicate = new Packet(
              pkt.id, // Keep same ID so receiver can detect duplicate
              pkt.type,
              pkt.from,
              pkt.to,
              pkt.payload
            );
            duplicate.retryCount = pkt.retryCount;
            this.packets.push(duplicate);
          }
        }
      }
    }
  }

  deliverPacket(pkt, indexInArray) {
    const destination = pkt.to;
    
    // Remove packet from transit list
    this.packets.splice(indexInArray, 1);
    
    if (destination.isFrozen || destination.status !== 'active') {
      this.log(`⚠️ DELIVERY ERROR: ${destination.name} is offline. Packet dropped.`, "warning");
      return;
    }
    
    // Check if duplicate detection is active on destination (Idempotency)
    if (destination.dedupEnabled && destination.seenPacketIds.has(pkt.id)) {
      this.log(`🛡️ IDEMPOTENCY MATCH: Volt discarded duplicate Packet #${pkt.id}`, "info");
      this.stats.duplicates++;
      
      // Even for a discarded duplicate, reply with an ACK so the sender
      // (usually a Dispatcher awaiting a routing confirmation) learns the
      // call was already resolved and stops retrying.
      if (this.settings.ackEnabled && pkt.from) {
        const ackPacket = new Packet(
          this.nextPacketId++, 'ack',
          destination, pkt.from,
          pkt.id
        );
        this.packets.push(ackPacket);
      }
      return;
    }
    
    // Add to recipient's queue
    if (destination.queue.length >= destination.maxQueue) {
      // Buffer Overflow!
      this.log(`💥 BUFFER OVERFLOW: ${destination.name} queue is full. Packet dropped!`, "danger");
      this.stats.failed++;
      return;
    }
    
    // If it's an ACK packet, handle it
    if (pkt.type === 'ack') {
      // Find original packet that was waiting for this ACK
      const original = this.packets.find(p => p.id === pkt.payload && p.state === 'sent-waiting-ack');
      if (original) {
        this.packets = this.packets.filter(p => p !== original);
        // Successfully resolved transaction!
      }
      return;
    }
    
    // Record packet ID if de-duplication is active
    if (destination.dedupEnabled) {
      destination.seenPacketIds.add(pkt.id);
      if (destination.seenPacketIds.size > 200) {
        // Keep registry bounded
        const firstValue = destination.seenPacketIds.values().next().value;
        destination.seenPacketIds.delete(firstValue);
      }
    }
    
    // Push packet to queue
    destination.queue.push(pkt);
  }

  processNodes() {
    for (let node of this.nodes) {
      if (node.status !== 'active') continue;
      
      // Node specific loops
      if (node.type === 'volt' || node.isClone) {
        this.processVoltNode(node);
      } else if (node.type === 'dispatcher') {
        this.processDispatcherNode(node);
      } else if (node.type === 'mind-palace') {
        this.processDatabaseNode(node);
      } else if (node.type === 'coordinator') {
        this.processCoordinatorNode(node);
      }
    }
  }

  processVoltNode(volt) {
    if (volt.isFrozen) return;
    
    if (volt.queue.length > 0 && volt.currentTaskProgress === 0) {
      // Begin processing next packet
      volt.currentTask = volt.queue[0];
      volt.currentTaskProgress = 0.01;
      volt.dbReadSent = false;
    }
    
    if (volt.currentTask) {
      // Kick off a database READ for civilian address (Levels 4 & 5)
      if (!volt.dbReadSent) {
        volt.dbReadSent = true;
        this.emitDbReadPacket(volt, volt.currentTask.payload);
      }
      
      volt.currentTaskProgress += volt.processingRate;
      
      // Upgrade CPU loading stats
      volt.cpuLoad = Math.min(100, Math.floor((volt.queue.length / volt.maxQueue) * 100));
      
      if (volt.currentTaskProgress >= 1.0) {
        // Task completed!
        const completedPacket = volt.queue.shift();
        const emergency = completedPacket.payload;
        
        emergency.state = 'resolved';
        this.stats.resolved++;
        this.credits += 40; // Earn credits per resolution!
        
        // Telemetry stats
        this.stats.latencySum += emergency.ticksActive;
        this.stats.latencyCount++;
        
        // Log transaction
        this.log(`✅ RESOLVED: Distress call at (${Math.round(emergency.x)}, ${Math.round(emergency.y)}) resolved by ${volt.name}! Earned $40`, "info");
        
        // Commit rescue record to the primary database (Levels 4 & 5)
        this.emitDbWritePacket(volt, emergency);
        
        // If ACKs enabled, transmit ACK packet back to sender
        if (this.settings.ackEnabled && completedPacket.from) {
          const ackPacket = new Packet(
            this.nextPacketId++,
            'ack',
            volt,
            completedPacket.from,
            completedPacket.id // Payload is the ID of the original packet
          );
          this.packets.push(ackPacket);
        }
        
        // Clear task active state
        volt.currentTask = null;
        volt.currentTaskProgress = 0;
      }
    } else {
      volt.cpuLoad = 0;
    }
  }
  
  // Pick the best database node to handle a query for this speedster.
  // Honors network partitions (Level 5) so nodes never cross the Rift,
  // otherwise Volts would appear to send to servers that are unreachable.
  findTargetDatabase(volt, rolePreference) {
    const all = this.nodes.filter(n => n.type === 'mind-palace' && n.status === 'active' && !n.isFrozen);
    if (all.length === 0) return null;
    
    let candidates = all;
    if (this.settings.networkPartitionActive && this.width > 0) {
      const voltLeftSide = volt.x < this.width / 2;
      const sameSide = all.filter(d => (d.x < this.width / 2) === voltLeftSide);
      if (sameSide.length > 0) candidates = sameSide;
    }
    
    if (rolePreference) {
      const preferred = candidates.filter(d => d.dbRole === rolePreference);
      if (preferred.length > 0) candidates = preferred;
    }
    
    // Closest Euclidean match
    let target = candidates[0];
    let minDist = Math.hypot(volt.x - target.x, volt.y - target.y);
    for (let i = 1; i < candidates.length; i++) {
      const d = Math.hypot(volt.x - candidates[i].x, volt.y - candidates[i].y);
      if (d < minDist) { minDist = d; target = candidates[i]; }
    }
    return target;
  }
  
  // Volts write rescue records to the primary database (Level 4 + 5).
  // Keys are drawn from a tiny shared pool of shelter records so that
  // simultaneous writes during a network partition (Level 5, AP mode) can
  // actually collide and exercise CAP conflict resolution. Without a shared
  // key space, every write would be unique and split-brain would never happen.
  emitDbWritePacket(volt, emergency) {
    // Volts share one hot key ("emergency_shelter") — every successful rescue updates
    // the same registry record. Under a network partition this creates the classic
    // AP-mode split-brain: both sides write competing values to the same key, which
    // is exactly what CAP conflict resolution is designed to reconcile after heal.
    const key = 'emergency_shelter';
    const val = `${volt.name}:rescued#${emergency.id}`;
    const primary = this.findTargetDatabase(volt, 'primary');
    if (!primary) {
      // No reachable primary — fall back to any same-side database so the
      // animation still plays (CP mode will reject the actual write later).
      const fallback = this.findTargetDatabase(volt, null);
      if (!fallback) return;
      this.spawnDbPacket(volt, fallback, 'write', { key, val });
      return;
    }
    this.spawnDbPacket(volt, primary, 'write', { key, val });
  }
  
  // Volts read civilian address files from the closest replica (Level 4 + 5).
  // Reads from replicas enable load distribution; falls back to primary when no replica exists.
  // The key read is the "civilian_address" address-book entry — a stable value set at
  // boot that only reads-stale while the replica is waiting for its first sync from primary.
  // (Reads intentionally target a different key than the hot "emergency_shelter" written
  // by every rescue; otherwise the replica would always lag, making the level's <5% stale
  // objective mathematically impossible under realistic traffic.)
  emitDbReadPacket(volt, emergency) {
    const key = 'civilian_address';
    const replica = this.findTargetDatabase(volt, 'replica');
    const target = replica || this.findTargetDatabase(volt, 'primary');
    if (!target) return;
    this.spawnDbPacket(volt, target, 'read', { key });
  }
  
  spawnDbPacket(from, to, type, payload) {
    const packet = new Packet(this.nextPacketId++, type, from, to, payload);
    this.packets.push(packet);
  }

  processDispatcherNode(dispatcher) {
    if (dispatcher.queue.length === 0) return;
    
    const request = dispatcher.queue.shift();
    
    // Route request to speedsters (Volt nodes)
    let speedsters = this.nodes.filter(n => (n.type === 'volt' || n.isClone) && n.status === 'active');
    
    // Filter by health check if enabled (catches frozen, not destroyed)
    if (dispatcher.healthCheckEnabled) {
      speedsters = speedsters.filter(n => !n.isFrozen);
    }
    
    if (speedsters.length === 0) {
      this.log(`⚠️ DISPATCH WARNING: No active speedsters online. Request dropped.`, "warning");
      this.stats.failed++;
      return;
    }
    
    let target = null;
    
    if (dispatcher.routingPolicy === 'round-robin') {
      target = speedsters[dispatcher.lastRoutedIndex % speedsters.length];
      dispatcher.lastRoutedIndex++;
    } else {
      // Least Connections routing
      target = speedsters[0];
      let minQueue = speedsters[0].queue.length;
      for (let s of speedsters) {
        if (s.queue.length < minQueue) {
          minQueue = s.queue.length;
          target = s;
        }
      }
    }
    
    if (target) {
      // Forward request packet
      const routedPacket = new Packet(
        request.id,
        'request',
        dispatcher,
        target,
        request.payload
      );
      
      if (this.settings.ackEnabled) {
        // Keep original waiting in transit for ACK
        request.state = 'sent-waiting-ack';
        request.ticksWaitingAck = 0;
        request.to = target; // Re-target to the destination
        this.packets.push(request);
      }
      
      // Push routed packet into transit
      this.packets.push(routedPacket);
    }
  }

  processDatabaseNode(db) {
    // Database replication loop (Levels 4 and 5)
    if (db.dbRole === 'primary') {
      // Stream updates to replica database if a link exists
      const portals = this.portals.filter(p => p.from === db || p.to === db);
      const replicas = this.nodes.filter(n => n.type === 'mind-palace' && n.dbRole === 'replica' && n.status === 'active');
      
      for (let replica of replicas) {
        // Find if portal links them
        const portal = portals.find(p => p.from === replica || p.to === replica);
        if (portal && !portal.isPartitioned) {
          // If updates occurred, stream sync packets
          if (this.tickCount % Math.floor(db.syncSpeedTicks) === 0) {
            // Replication update packet
            const syncPacket = new Packet(
              this.nextPacketId++,
              'sync',
              db,
              replica,
              { registry: { ...db.registry } }
            );
            this.packets.push(syncPacket);
          }
        }
      }
    }
    
    // Process read/write queries from speedsters in database queue
    if (db.queue.length > 0) {
      const pkt = db.queue.shift();
      
      if (pkt.type === 'sync') {
        // Update replica registry
        db.registry = { ...db.registry, ...pkt.payload.registry };
        db.lastSyncTick = this.tickCount;
      } else if (pkt.type === 'write') {
        // CAP minority lockout check (CP mode)
        if (this.settings.networkPartitionActive && this.settings.capStrategy === 'CP') {
          // Count reachable databases
          const reachable = this.getReachableDBNodes(db);
          const totalDBs = this.nodes.filter(n => n.type === 'mind-palace').length;
          
          if (reachable.length <= totalDBs / 2) {
            // Lock database - Reject write!
            this.log(`🔒 DATABASE CP Mode: Write rejected at ${db.name} due to minority partition!`, "warning");
            this.stats.failed++;
            return;
          }
        }
        
        // Write transaction
        const { key, val } = pkt.payload;
        
        // Store conflict records in AP mode partition
        if (this.settings.networkPartitionActive && this.settings.capStrategy === 'AP') {
          db.registry[key] = val;
          // Track conflict candidates
          if (!this.unmergedWrites) this.unmergedWrites = [];
          this.unmergedWrites.push({ dbId: db.id, key, val, tick: this.tickCount });
        } else {
          db.registry[key] = val;
        }
        
        this.stats.dbWrites = (this.stats.dbWrites || 0) + 1;
        // Throttle: only one summary log per 5 writes so the incident log isn't flooded.
        if (this.stats.dbWrites % 5 === 1) {
          this.log(`📝 DATABASE WRITE: ${this.stats.dbWrites} records committed to ${db.name} so far`, "info");
        }
      } else if (pkt.type === 'read') {
        // Check for stale data reads (Eventual consistency metrics)
        const { key } = pkt.payload;
        this.stats.dbReads++;
        
        const primary = this.nodes.find(n => n.type === 'mind-palace' && n.dbRole === 'primary');
        const correctVal = primary ? primary.registry[key] : null;
        const readVal = db.registry[key];
        
        if (correctVal !== readVal) {
          this.stats.staleDbReads++;
          // Keep one warning per stale read to surface the consistency problem clearly.
          this.log(`⚠️ STALE READ DETECTED: Volt read address from ${db.name} but got stale value: '${readVal}' instead of '${correctVal}'`, "warning");
        }
      }
    }
  }

  getReachableDBNodes(startNode) {
    const reachable = [startNode];
    const queue = [startNode];
    const visited = new Set([startNode.id]);
    
    while (queue.length > 0) {
      const current = queue.shift();
      const portals = this.portals.filter(p => !p.isPartitioned && (p.from === current || p.to === current));
      
      for (let p of portals) {
        const neighbor = p.from === current ? p.to : p.from;
        if (neighbor.type === 'mind-palace' && !visited.has(neighbor.id) && neighbor.status === 'active') {
          visited.add(neighbor.id);
          reachable.push(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return reachable;
  }

  resolveDatabaseConflicts() {
    if (!this.unmergedWrites || this.unmergedWrites.length === 0) return;
    
    // AP Mode: Merge registers. Detect splits and resolve conflicts.
    const keysMap = {};
    for (let w of this.unmergedWrites) {
      if (!keysMap[w.key]) keysMap[w.key] = [];
      keysMap[w.key].push(w);
    }
    
    for (let key in keysMap) {
      const edits = keysMap[key];
      if (edits.length > 1) {
        // Conflict!
        this.stats.dbConflicts++;
        this.log(`⚠️ DB COLLISION: Key conflict detected on '${key}'! Multiple writes made in partition.`, "warning");
        
        // Resolve conflict: latest timestamp (tick count) wins
        edits.sort((a, b) => b.tick - a.tick);
        const winner = edits[0];
        
        // Set all registries to winner
        const primary = this.nodes.find(n => n.type === 'mind-palace' && n.dbRole === 'primary');
        const replicas = this.nodes.filter(n => n.type === 'mind-palace' && n.dbRole === 'replica');
        
        if (primary) primary.registry[key] = winner.val;
        for (let r of replicas) r.registry[key] = winner.val;
        
        this.stats.dbConflictsResolved++;
        this.log(`⚖️ DB RESOLVED: Eventual sync completed. Conflicted key '${key}' overwritten to latest value: '${winner.val}'`, "success");
      }
    }
    
    this.unmergedWrites = [];
  }

  processCoordinatorNode(coord) {
    // Kubernetes-style orchestration loop
    if (this.tickCount % 60 !== 0) return; // run reconciliation loop every 1 second
    
    // Count active clones
    const activeClones = this.nodes.filter(n => n.isClone && n.status === 'active');
    const difference = coord.desiredReplicaCount - activeClones.length;
    
    if (difference > 0) {
      this.log(`🐳 RECONCILE LOOP: Cluster is missing ${difference} Speedster Clones. Auto-scaling up...`, "info");
      for (let i = 0; i < difference; i++) {
        // Spawn clone near the coordinator's radius
        const offset = 80;
        const angle = Math.random() * Math.PI * 2;
        const x = coord.x + Math.cos(angle) * offset;
        const y = coord.y + Math.sin(angle) * offset;
        
        const clone = new Node(this.nextNodeId++, 'volt', x, y, { isClone: true });
        this.nodes.push(clone);
      }
    } else if (difference < 0) {
      this.log(`🐳 RECONCILE LOOP: Cluster has excess speedster clones. Scale down active...`, "info");
      // Remove excess clones
      const toRemoveCount = Math.abs(difference);
      let removed = 0;
      for (let i = this.nodes.length - 1; i >= 0; i--) {
        if (this.nodes[i].isClone && this.nodes[i].status === 'active') {
          this.nodes[i].status = 'destroyed';
          removed++;
          if (removed >= toRemoveCount) break;
        }
      }
    }
  }

  calculatePanic() {
    const activeCount = this.emergencies.length;
    
    // Increase panic based on unanswered calls in queue.
    // A moderate coefficient (0.04) means each extra pending call adds ~2.4%/sec,
    // and recovery is slightly faster at 0.06/sec when things are under control.
    // This is forgiving enough that a capable network can recover from a brief surge.
    if (activeCount > 3) {
      this.panic = Math.min(100, this.panic + 0.04 * (activeCount - 3));
    } else {
      this.panic = Math.max(0, this.panic - 0.06);
    }
    
    // Round panic indicator
    this.panic = parseFloat(this.panic.toFixed(1));
    
    if (this.panic >= 100) {
      this.isPlaying = false;
      if (this.onLevelFailCallback) this.onLevelFailCallback();
    }
  }

  evaluateObjectives() {
    if (!this.levelConfig) return;
    
    let allMet = true;
    for (let obj of this.levelConfig.objectives) {
      const met = obj.check(this);
      if (met) {
        this.completedObjectives.add(obj.id);
      } else {
        this.completedObjectives.delete(obj.id);
        allMet = false;
      }
    }
    
    // Trigger win if all objectives satisfied
    if (allMet && this.isPlaying) {
      this.isPlaying = false;
      if (this.onLevelCompleteCallback) this.onLevelCompleteCallback();
    }
  }

  serialize() {
    const serializedNodes = this.nodes
      .filter(n => n.status === 'active')
      .map(n => ({
        id: n.id,
        type: n.type,
        x: n.x,
        y: n.y,
        level: n.level,
        isClone: n.isClone,
        preplaced: n.preplaced,
        isFrozen: n.isFrozen,
        dbRole: n.dbRole,
        dedupEnabled: n.dedupEnabled,
        desiredReplicaCount: n.desiredReplicaCount,
        registry: n.registry,
        routingPolicy: n.routingPolicy,
        healthCheckEnabled: n.healthCheckEnabled
      }));

    const serializedPortals = this.portals
      .filter(p => !p.isPartitioned)
      .map(p => ({
        fromId: p.from.id,
        toId: p.to.id
      }));

    const saveData = {
      levelId: this.currentLevelId,
      credits: this.credits,
      panic: this.panic,
      tickCount: this.tickCount,
      stats: { ...this.stats },
      settings: { ...this.settings },
      nodes: serializedNodes,
      portals: serializedPortals
    };

    return JSON.stringify(saveData);
  }

  deserialize(jsonString) {
    try {
      const saveData = JSON.parse(jsonString);
      
      // Stop loop while loading
      this.isPlaying = false;
      
      this.currentLevelId = saveData.levelId;
      this.levelConfig = window.Levels.find(l => l.id === this.currentLevelId);
      this.credits = saveData.credits;
      this.panic = saveData.panic;
      this.tickCount = saveData.tickCount;
      this.stats = { ...saveData.stats };
      this.settings = { ...saveData.settings };
      this.completedObjectives.clear();
      
      // Clear queues and systems
      this.nodes = [];
      this.portals = [];
      this.packets = [];
      this.emergencies = [];
      this.logs = [];

      // Restore nodes
      const nodeMap = new Map();
      let maxNodeId = 0;
      
      for (let nData of saveData.nodes) {
        const node = new Node(nData.id, nData.type, nData.x, nData.y, {
          isClone: nData.isClone,
          preplaced: nData.preplaced
        });
        node.level = nData.level;
        node.isFrozen = nData.isFrozen;
        node.dbRole = nData.dbRole;
        node.dedupEnabled = nData.dedupEnabled;
        node.desiredReplicaCount = nData.desiredReplicaCount;
        node.registry = nData.registry || node.registry;
        node.routingPolicy = nData.routingPolicy || node.routingPolicy;
        node.healthCheckEnabled = nData.healthCheckEnabled || node.healthCheckEnabled;
        
        // Reapply stats upgrades based on level
        if (node.level > 1) {
          if (node.type === 'volt') {
            node.processingRate = 0.02 + 0.015 * (node.level - 1);
            node.maxQueue = 5 + 3 * (node.level - 1);
          } else if (node.type === 'dispatcher') {
            node.maxQueue = 20 + 10 * (node.level - 1);
          } else if (node.type === 'mind-palace') {
            node.syncSpeedTicks = Math.max(20, 120 - 40 * (node.level - 1));
            node.maxQueue = 15 + 5 * (node.level - 1);
          }
        }
        
        this.nodes.push(node);
        nodeMap.set(node.id, node);
        if (node.id > maxNodeId) maxNodeId = node.id;
      }
      this.nextNodeId = maxNodeId + 1;

      // Restore portals
      for (let pData of saveData.portals) {
        const fromNode = nodeMap.get(pData.fromId);
        const toNode = nodeMap.get(pData.toId);
        if (fromNode && toNode) {
          const portal = new Portal(fromNode, toNode);
          this.portals.push(portal);
        }
      }

      this.log(`📂 GRID LOADED: Restored saved configuration from local storage.`, "success");
      return true;
    } catch (err) {
      this.log(`❌ LOAD FAILED: Corrupted or invalid save state data.`, "danger");
      return false;
    }
  }

  triggerMeteorAnimation(x, y) {
    this.meteors.push({
      x,
      y,
      radius: 0,
      maxRadius: 40,
      opacity: 1.0
    });
  }
}

/* ==========================================================================
   NODE CLASS
   Represents a deployed superhero base, load balancer, DB, or orchestrator.
   ========================================================================== */
class Node {
  constructor(id, type, x, y, options = {}) {
    this.id = id;
    this.type = type;
    this.x = x;
    this.y = y;
    this.level = 1;
    this.status = 'active'; // 'active', 'destroyed'
    this.isFrozen = false;
    
    // Common capacities
    this.queue = [];
    this.maxQueue = 5;
    
    // Metadata options
    this.isClone = options.isClone || false;
    this.preplaced = options.preplaced || false;
    
    // Type-specific configs
    this.name = this.generateNodeName();
    this.initNodeStats();
  }

  generateNodeName() {
    const cloneSuffix = this.isClone ? ` Clone-${this.id}` : '';
    if (this.type === 'volt') return `Volt${cloneSuffix}`;
    if (this.type === 'dispatcher') return "Chief Dispatcher";
    if (this.type === 'mind-palace') return this.id % 2 === 1 ? "Mind-Palace Primary" : "Mind-Palace Replica";
    if (this.type === 'cache') return "Sticky Assistant";
    if (this.type === 'coordinator') return "Clone Coordinator";
    return `Tower-${this.id}`;
  }

  initNodeStats() {
    this.cpuLoad = 0;
    this.storageUsed = 0;
    this.creditsCost = 200;
    
    if (this.type === 'volt' || this.isClone) {
      this.processingRate = 0.02; // Ticks process increment (50 ticks / task)
      this.dedupEnabled = false;
      this.seenPacketIds = new Set();
      this.currentTask = null;
      this.currentTaskProgress = 0;
    }
    
    if (this.type === 'dispatcher') {
      this.routingPolicy = 'round-robin'; // 'round-robin' or 'least-connections'
      this.healthCheckEnabled = false;
      this.lastRoutedIndex = 0;
      this.maxQueue = 20; // Dispatcher has a large routing buffer
    }
    
    if (this.type === 'mind-palace') {
      this.dbRole = this.id % 2 === 1 ? 'primary' : 'replica';
      // Two keys: the hot "emergency_shelter" is mutated on every successful
      // rescue and is what causes CAP conflicts in Level 5. The "civilian_address"
      // key is the address-book that speedsters READ on every dispatch — it is
      // seeded at boot time and never rewritten by the application, so replicas
      // only have stale values during the very first sync window.
      this.registry = {
        "emergency_shelter": "Sector 4",
        "civilian_address": "North District 7"
      };
      this.syncSpeedTicks = 120; // 2 seconds sync
      this.lastSyncTick = 0;
      this.maxQueue = 15;
    }
    
    if (this.type === 'coordinator') {
      this.desiredReplicaCount = 0;
    }
  }

  takeDamage(amount) {
    this.status = 'destroyed';
  }

  upgrade(sim) {
    const upgradeCosts = { 1: 150, 2: 300, 3: 500 };
    const cost = upgradeCosts[this.level] || 999;
    
    if (sim.credits < cost) return false;
    
    sim.credits -= cost;
    this.level++;
    
    // Apply stats upgrade
    if (this.type === 'volt') {
      this.processingRate += 0.015; // 75% speed boost!
      this.maxQueue += 3;
    } else if (this.type === 'dispatcher') {
      this.maxQueue += 10;
    } else if (this.type === 'mind-palace') {
      this.syncSpeedTicks = Math.max(20, this.syncSpeedTicks - 40); // speed up sync portal transfers
      this.maxQueue += 5;
    }
    
    return true;
  }
}

/* ==========================================================================
   PORTAL CLASS (NETWORK LINK)
   Transports data packages between nodes in a spatial queue.
   ========================================================================== */
class Portal {
  constructor(nodeA, nodeB) {
    this.from = nodeA;
    this.to = nodeB;
    this.isPartitioned = false;
  }
}

/* ==========================================================================
   PACKET CLASS
   Telemetry message containing address headers and coordinate positions.
   ========================================================================== */
class Packet {
  constructor(id, type, from, to, payload) {
    this.id = id;
    this.type = type; // 'request', 'ack', 'sync', 'write', 'read'
    this.from = from;
    this.to = to;
    this.payload = payload;
    
    this.state = 'in-transit'; // 'in-transit', 'sent-waiting-ack'
    this.progress = 0.0;
    this.speed = 0.025; // 40 ticks trip
    this.hasPassedLossCheck = false;
    
    this.ticksWaitingAck = 0;
    this.ticksPartitioned = 0;
    this.retryCount = 0;
  }
}
