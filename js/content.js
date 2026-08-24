/* ==========================================================================
   CONTENT — scenario DSL loader/validator.
   Turns a plain-data scenario object into a running simulation timeline.
   Pure transformation; mutates only the sim it is given at load time.
   ========================================================================== */
(function () {
  const TICKS_PER_SEC = 60;

  function toTicks(sec) { return Math.round((sec || 0) * TICKS_PER_SEC); }

  window.Content = {
    // scenario = {
    //   budget, allowedHeroes, slo,
    //   preplaced: [{type, x, y, config}],
    //   incidents: [{t (sec), count, label}],
    //   failures:  [{t (sec), kind, target, rate?, factor?, duration?, label?}],
    //   objectives: [{id, text, check(sim)}]
    // }
    applyScenario(sim, scenario) {
      if (!scenario) return;

      if (scenario.budget != null) sim.credits = scenario.budget;
      if (scenario.allowedHeroes) sim.levelConfig.allowedHeroes = scenario.allowedHeroes;
      if (scenario.slo) sim.levelConfig.slo = scenario.slo;
      if (scenario.objectives) sim.levelConfig.objectives = scenario.objectives;

      if (scenario.preplaced) {
        for (const p of scenario.preplaced) {
          sim.spawnNode(p.type, p.x, p.y, Object.assign({ preplaced: true }, p.config || {}));
        }
      }

      const events = [];
      if (scenario.incidents) {
        for (const it of scenario.incidents) {
          events.push({ t: toTicks(it.t), kind: 'spawn', count: it.count || 5, label: it.label });
        }
      }
      if (scenario.failures) {
        for (const f of scenario.failures) {
          const endKind = f.endKind || (f.kind + 'End');
          events.push({
            t: toTicks(f.t), kind: f.kind, target: f.target,
            rate: f.rate, factor: f.factor, label: f.label
          });
          if (f.duration) {
            events.push({ t: toTicks(f.t + f.duration), kind: endKind, target: f.target, label: f.label });
          }
        }
      }
      events.sort((a, b) => a.t - b.t);
      sim._scenarioEvents = events;
      if (events.length) sim.log(`📋 SCENARIO: ${events.length} timeline events scheduled.`, 'info');
    },

    validate(scenario) {
      const errors = [];
      if (!scenario) return { ok: false, errors: ['scenario is null'] };
      if (scenario.allowedHeroes && !Array.isArray(scenario.allowedHeroes))
        errors.push('allowedHeroes must be an array');
      if (scenario.incidents && !Array.isArray(scenario.incidents))
        errors.push('incidents must be an array');
      if (scenario.failures && !Array.isArray(scenario.failures))
        errors.push('failures must be an array');
      return { ok: errors.length === 0, errors };
    }
  };
})();
