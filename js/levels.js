/* ==========================================================================
   LEVELS DATABASE
   Configures the story, rules, parameters, and victory checkers for each mission.
   ========================================================================== */

window.Levels = [
  {
    id: 1,
    name: "The Solo Vigilante",
    tagline: "Compute & Storage Limits",
    desc: "Our speedster hero Volt is working alone in Metro City. Distress calls are coming in, but Volt's queue is piling up! If his queue overflows, calls will be dropped. Upgrade Volt's speed (CPU) or increase his queue buffer to handle the surge.",
    credits: 600,
    allowedHeroes: ["volt"],
    spawnRate: 1800, // ms between spawns
    spawnIntensity: 1,
    objectives: [
      { id: "resolve_calls", text: "Successfully resolve 25 distress calls", check: (sim) => sim.stats.resolved >= 25 },
      { id: "no_drops", text: "Keep dropped calls under 3", check: (sim) => sim.stats.failed < 3 },
      { id: "upgrade_volt", text: "Upgrade Volt's speed (CPU) at least once", check: (sim) => {
        const volts = sim.nodes.filter(n => n.type === 'volt');
        return volts.some(v => v.level > 1);
      }}
    ],
    setup: (sim) => {
      // Pre-place Volt in the center of the canvas
      const x = sim.width / 2;
      const y = sim.height / 2;
      sim.spawnNode('volt', x, y, { preplaced: true });
      sim.credits = 600;
    },
    tick: (sim) => {
      // Gradually increase request rate to force upgrade
      if (sim.tickCount > 600 && sim.tickCount % 200 === 0) {
        sim.levelConfig.spawnRate = Math.max(800, sim.levelConfig.spawnRate - 200);
      }
    }
  },
  {
    id: 2,
    name: "The Hero League",
    tagline: "Horizontal Scaling & Load Balancing",
    desc: "Volt is overloaded. Scaling vertically has reached its limit! You must deploy a second Speedster (Zoom) and place a Chief Dispatcher (Load Balancer) to route distress calls. But watch out: villains might try to freeze one of your heroes!",
    credits: 800,
    allowedHeroes: ["volt", "dispatcher"],
    spawnRate: 1000,
    spawnIntensity: 2,
    objectives: [
      { id: "deploy_dispatcher", text: "Deploy a Chief Dispatcher (Load Balancer)", check: (sim) => sim.nodes.some(n => n.type === 'dispatcher') },
      { id: "deploy_two_speedsters", text: "Have at least 2 active Speedsters (Volt / Zoom)", check: (sim) => sim.nodes.filter(n => n.type === 'volt').length >= 2 },
      { id: "resolve_calls", text: "Successfully resolve 40 distress calls", check: (sim) => sim.stats.resolved >= 40 },
      { id: "no_drops", text: "Zero dropped calls during the final wave", check: (sim) => sim.stats.failed === 0 || sim.stats.resolved < 10 },
      { id: "enable_health_check", text: "Turn on 'Telepathic Ping' (Health Checks) in Dispatcher settings", check: (sim) => {
        const dispatcher = sim.nodes.find(n => n.type === 'dispatcher');
        return dispatcher && dispatcher.healthCheckEnabled;
      }}
    ],
    setup: (sim) => {
      sim.credits = 800;
      // Pre-place Volt
      sim.spawnNode('volt', sim.width / 3, sim.height / 2, { preplaced: true });
    },
    tick: (sim) => {
      // Freeze Volt at tick 500 to demonstrate need for health checks
      if (sim.tickCount === 450) {
        const volt = sim.nodes.find(n => n.type === 'volt' && !n.isFrozen);
        if (volt) {
          volt.isFrozen = true;
          sim.log("🚨 VILLAIN ATTACK: Volt has been frozen in ice! He cannot process calls!", "danger");
        }
      }
      // Unfreeze Volt after some time
      if (sim.tickCount === 900) {
        const volt = sim.nodes.find(n => n.type === 'volt' && n.isFrozen);
        if (volt) {
          volt.isFrozen = false;
          sim.log("✨ HERO ESCAPE: Volt has thawed and is back online!", "success");
        }
      }
    }
  },
  {
    id: 3,
    name: "The Asteroid Storm",
    tagline: "Unreliable Network links & Retries",
    desc: "A nearby district has been cut off by an electromagnetic asteroid belt. Distress calls sent via Portal Links are dropping. You must establish a portal link and configure Volt's transmission settings: enable 'Roger That' (ACKs), 'Auto-Retry', and the 'De-duplication Logbook' to avoid duplicate missions.",
    credits: 1000,
    allowedHeroes: ["volt", "dispatcher"],
    spawnRate: 1200,
    spawnIntensity: 1,
    objectives: [
      { id: "link_portal", text: "Link the Dispatcher to Volt using a Portal", check: (sim) => sim.portals.length >= 1 },
      { id: "enable_acks", text: "Enable 'Roger That' (ACKs) and 'Auto-Retry' on Portal or Dispatcher", check: (sim) => sim.settings.ackEnabled && sim.settings.retryEnabled },
      { id: "enable_dedup", text: "Enable 'De-duplication Logbook' (Idempotency) on Volt", check: (sim) => {
        const volt = sim.nodes.find(n => n.type === 'volt');
        return volt && volt.dedupEnabled;
      }},
      { id: "resolve_calls", text: "Resolve 30 calls across the portal link", check: (sim) => sim.stats.resolved >= 30 },
      { id: "prevent_duplicates", text: "Let the De-duplication Logbook safely discard at least 1 duplicate mission (proving it works)", check: (sim) => {
        const volt = sim.nodes.find(n => n.type === 'volt');
        return volt && volt.dedupEnabled && sim.stats.duplicates >= 1;
      }}
    ],
    setup: (sim) => {
      sim.credits = 1000;
      // Spawn Dispatcher in Center and Volt in a distant district
      sim.spawnNode('dispatcher', sim.width / 3, sim.height / 2, { preplaced: true });
      sim.spawnNode('volt', (sim.width * 3) / 4, sim.height / 2, { preplaced: true });
      
      // Configure simulation-wide settings
      sim.settings.networkLossRate = 0.35; // 35% packet loss through the storm!
      sim.log("⚠️ ASTEROID ALERT: Warp portals in this zone have 35% package loss rate!", "warning");
    },
    tick: (sim) => {}
  },
  {
    id: 4,
    name: "The Shared File Room",
    tagline: "Database Replication & Sync Lag",
    desc: "Every rescue needs to be written to a database ledger by Mind-Palace. To handle massive civilian database checks, we need a Replica database. But updates take time to travel between databases. Players must deploy a primary Mind-Palace, a secondary replica, and manage replication speed to prevent citizens from getting stale data.",
    credits: 1200,
    allowedHeroes: ["volt", "mind-palace"],
    spawnRate: 1100,
    spawnIntensity: 2,
    objectives: [
      { id: "deploy_db", text: "Deploy Primary Database (Mind-Palace)", check: (sim) => sim.nodes.some(n => n.type === 'mind-palace' && n.dbRole === 'primary') },
      { id: "deploy_replica", text: "Deploy Replica Database (Mind-Palace Replica)", check: (sim) => sim.nodes.some(n => n.type === 'mind-palace' && n.dbRole === 'replica') },
      { id: "link_replication", text: "Establish a Replication Portal from Primary to Replica", check: (sim) => {
        const primary = sim.nodes.find(n => n.type === 'mind-palace' && n.dbRole === 'primary');
        const replica = sim.nodes.find(n => n.type === 'mind-palace' && n.dbRole === 'replica');
        if (!primary || !replica) return false;
        return sim.portals.some(p => (p.from === primary && p.to === replica) || (p.from === replica && p.to === primary));
      }},
      { id: "limit_stale_reads", text: "Keep 'Stale Address Reads' below 5%", check: (sim) => {
        if (sim.stats.dbReads === 0) return true;
        const staleRate = (sim.stats.staleDbReads / sim.stats.dbReads);
        return staleRate < 0.05 && sim.stats.dbReads > 10;
      }},
      { id: "resolve_calls", text: "Verify addresses and resolve 30 calls", check: (sim) => sim.stats.resolved >= 30 }
    ],
    setup: (sim) => {
      sim.credits = 1200;
      // Pre-place Volt
      sim.spawnNode('volt', sim.width / 2, sim.height / 3, { preplaced: true });
      sim.log("ℹ️ SYSTEM BRIEFING: Speedsters write records to Primary database, but read civilian files from the closest Replica to save network time.", "info");
    },
    tick: (sim) => {}
  },
  {
    id: 5,
    name: "The Dimensional Rift",
    tagline: "Network Partition & CAP Theorem",
    desc: "A massive spatial rift splits the city! The East and West sectors are completely isolated (Network Partition). You must manage your databases under the CAP Theorem: choose either AP Mode (allow both sides to make updates, but risk split-brain inconsistency) or CP Mode (lock down nodes in the minority partition to guarantee data safety).",
    credits: 1500,
    allowedHeroes: ["volt", "mind-palace", "dispatcher"],
    spawnRate: 1200,
    spawnIntensity: 2,
    objectives: [
      { id: "rift_survived", text: "Survive the 40-second Rift Partition", check: (sim) => sim.tickCount >= 1000 },
      { id: "choose_mode", text: "Select CAP strategy: choose AP (Availability) or CP (Consistency)", check: (sim) => sim.settings.capStrategy === 'AP' || sim.settings.capStrategy === 'CP' },
      { id: "resolve_calls", text: "Resolve at least 25 calls during the partition", check: (sim) => sim.stats.resolved >= 25 },
      { id: "verify_cap_consequences", text: "Maintain DB state without double-spend crashes (CP) OR resolve conflicts after heal (AP)", check: (sim) => {
        if (sim.settings.capStrategy === 'CP') {
          return sim.stats.dbConflicts === 0;
        } else if (sim.settings.capStrategy === 'AP') {
          return sim.stats.dbConflictsResolved >= sim.stats.dbConflicts && sim.stats.dbConflicts > 0;
        }
        return false;
      }}
    ],
    setup: (sim) => {
      sim.credits = 1500;
      // Place two databases and two speedsters on left/right sides
      const db1 = sim.spawnNode('mind-palace', sim.width / 4, sim.height / 3, { preplaced: true });
      db1.dbRole = 'primary';
      
      const db2 = sim.spawnNode('mind-palace', (sim.width * 3) / 4, sim.height / 3, { preplaced: true });
      db2.dbRole = 'replica';
      
      sim.spawnNode('volt', sim.width / 4, (sim.height * 2) / 3, { preplaced: true });
      sim.spawnNode('volt', (sim.width * 3) / 4, (sim.height * 2) / 3, { preplaced: true });
      
      // Establish initial connection portal
      sim.spawnPortal(db1, db2);
      
      sim.log("⚡ RIFT ADVISORY: Spatial partition will activate at tick 300! Setup your strategy beforehand (Click on a Database node to select AP or CP strategy).", "warning");
    },
    tick: (sim) => {
      // Slice network partition at tick 300
      if (sim.tickCount === 300) {
        sim.settings.networkPartitionActive = true;
        sim.log("🚨 DIMENSIONAL RIFT: The city is cut in half! Left side nodes cannot communicate with Right side nodes!", "danger");
      }
      
      // Heal at tick 850
      if (sim.tickCount === 850) {
        sim.settings.networkPartitionActive = false;
        sim.log("✨ RIFT HEALED: Communication tunnels restored! Databases are synchronizing registries...", "success");
        sim.resolveDatabaseConflicts();
      }
    }
  },
  {
    id: 6,
    name: "The Self-Repairing Fleet",
    tagline: "Containers & Automated Orchestration",
    desc: "Meteor storms are hammering the city, randomly destroying hero stations! Doing manual re-deploys is impossible. You must deploy a **Clone Coordinator (Kubernetes Orchestrator)**, package Volt into a **Holographic Clone (Container)**, set the desired state to 4, and let the system auto-heal itself when nodes crash.",
    credits: 1600,
    allowedHeroes: ["volt", "dispatcher", "coordinator"],
    spawnRate: 900,
    spawnIntensity: 2,
    objectives: [
      { id: "deploy_coordinator", text: "Deploy a Clone Coordinator", check: (sim) => sim.nodes.some(n => n.type === 'coordinator') },
      { id: "set_clones", text: "Set Coordinator's desired Speedster Clones to 4", check: (sim) => {
        const coord = sim.nodes.find(n => n.type === 'coordinator');
        return coord && coord.desiredReplicaCount >= 4;
      }},
      { id: "auto_healed", text: "Survive the meteor shower (Let the coordinator replace destroyed nodes)", check: (sim) => sim.tickCount >= 1000 },
      { id: "resolve_calls", text: "Successfully resolve 40 calls during the bombardment", check: (sim) => sim.stats.resolved >= 40 }
    ],
    setup: (sim) => {
      sim.credits = 1600;
      // Pre-place a Dispatcher + one Volt so the level doesn't panic out
      // before the player has time to deploy the Coordinator and configure clones.
      sim.spawnNode('dispatcher', sim.width / 2, sim.height / 2, { preplaced: true });
      sim.spawnNode('volt', sim.width / 3, sim.height / 2, { preplaced: true });
      sim.log("☄️ METEOR DETECTED: Large rocks are falling! Deploy a Clone Coordinator, set its clone count to 4, and let it auto-heal. One Volt is already on duty — deploy reinforcements quickly!", "warning");
    },
    tick: (sim) => {
      // Trigger random meteor strikes (every ~3 seconds so the coordinator
      // has time to re-spawn clones between hits).
      if (sim.tickCount >= 400 && sim.tickCount % 180 === 0) {
        // Strike a random speedster node
        const speedsters = sim.nodes.filter(n => (n.type === 'volt' || n.isClone) && n.status === 'active');
        if (speedsters.length > 0) {
          const victim = speedsters[Math.floor(Math.random() * speedsters.length)];
          victim.takeDamage(100); // Instantly destroy
          sim.triggerMeteorAnimation(victim.x, victim.y);
          sim.log(`☄️ METEOR IMPACT: A speedster at (${Math.round(victim.x)}, ${Math.round(victim.y)}) was smashed by a meteor!`, "danger");
        }
      }
    }
  }
];
