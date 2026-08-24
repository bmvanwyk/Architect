/* ==========================================================================
   HUD — telemetry dashboard rendering (latency percentiles, error rate,
   queue depth, city Trust, SLO status). Reads sim.stats; updates DOM.
   Pure view layer; no game-state mutation.
   ========================================================================== */
window.HUD = {
  _el(id) { return document.getElementById(id); },

  render(sim) {
    const s = sim.stats;
    const set = (id, val) => { const e = this._el(id); if (e) e.innerText = val; };
    const cls = (id, c) => { const e = this._el(id); if (e) e.className = 'metric-val ' + c; };

    set('metric-p95', `${s.latencyP95}ms`);
    set('metric-error', `${s.errorRate.toFixed(1)}%`);
    set('metric-queue', `${s.queueDepth}`);
    set('metric-trust', `${s.cityTrust}%`);

    // Color the error rate + trust by severity
    cls('metric-error', s.errorRate > 15 ? 'text-red' : (s.errorRate > 5 ? 'text-gold' : 'text-green'));
    cls('metric-trust', s.cityTrust < 40 ? 'text-red' : (s.cityTrust < 70 ? 'text-gold' : 'text-green'));

    // SLO status block
    const slo = sim.levelConfig && sim.levelConfig.slo;
    const box = this._el('slo-status');
    if (!box) return;
    if (!slo) { box.innerHTML = ''; return; }

    const checks = [
      { label: `Latency P99 ≤ ${slo.latencyP99}ms`, ok: s.latencyP99 > 0 && s.latencyP99 <= slo.latencyP99 },
      { label: `Error rate ≤ ${Math.round(slo.errorRate * 100)}%`, ok: s.errorRate <= slo.errorRate * 100 },
      { label: `Throughput ≥ ${slo.throughput} rps`, ok: s.rps >= slo.throughput }
    ];
    box.innerHTML = '<div class="slo-title">SERVICE LEVEL OBJECTIVES</div>' + checks.map(c =>
      `<div class="slo-pill ${c.ok ? 'slo-ok' : 'slo-bad'}">${c.ok ? '✓' : '✗'} ${c.label}</div>`
    ).join('');
  }
};
