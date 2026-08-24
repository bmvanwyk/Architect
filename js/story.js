/* ==========================================================================
   STORY — narrative content for mission briefings & the city's lore.
   Kept separate from level logic so writers can iterate without touching sim.
   ========================================================================== */
window.Story = {
  // Narrative hook shown at the top of a mission briefing.
  narrative(levelId) {
    const map = {
      1: `<strong>Metro City</strong> never sleeps — and tonight, its distress grid is screaming. A <em>Thundering Herd</em> of simultaneous SOS signals is about to stampede the lone responder on duty. You are the newly-promoted <strong>Chief Architect</strong>. Build a system that absorbs the surge instead of breaking under it.`,
      2: `The grid held, but barely. Now the city wants <strong>redundancy</strong>: route calls through a Dispatcher so no single hero becomes a bottleneck. The <em>Latency Wraith</em> is circling.`,
      3: `A second district came online and the load doubled. <strong>Replication</strong> is no longer optional — when one hero freezes, another must answer. Watch for the <em>Partition Rift</em>.`,
      4: `The archives are corrupting under load. You need a <strong>cache tier</strong> and a database that reconciles after splits. Stale reads are the enemy now.`,
      5: `Coordination at scale: the <em>Poison Pill</em> attacks your writes. Stand up consensus so the cluster agrees on truth even when half of it goes dark.`,
      6: `The <em>Cascade</em> — every failure you ignored, arriving at once. This is the final exam. Build the resilient city you were promised.`
    };
    return map[levelId] || '';
  },

  // Adversary bestiary — used by tutorial / future codex.
  failureEntities: {
    'Latency Wraith': 'Tail latency. Countered by caching, bulkheads, timeouts.',
    'Partition Rift': 'Network split / CAP split-brain. Countered by quorum + reconciliation.',
    'Thundering Herd': 'Cache stampede / retry storm. Countered by jitter + coalescing.',
    'Poison Pill': 'Bad message / bad deploy. Countered by circuit breakers + dead-letter.',
    'Cascade': 'One slow dependency saturates callers. Countered by bulkheads + backpressure.'
  }
};
