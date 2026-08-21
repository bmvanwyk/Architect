/* ==========================================================================
   TOPOLOGY — GRAPH ENGINE (presentation/logic helper, zero-dep)
   A read-only view of sim.portals / sim.nodes. Never mutates game state.
   Used by simulation.js for routing decisions and by levels for blueprint
   validation. Degrades gracefully: simulation.js guards every call.
   ========================================================================== */

window.Topology = (function () {
  "use strict";

  // Adjacency over non-partitioned portals.
  function neighbors(sim, node) {
    const out = [];
    for (const p of sim.portals) {
      if (p.isPartitioned) continue;
      if (p.from === node) out.push(p.to);
      else if (p.to === node) out.push(p.from);
    }
    return out;
  }

  // BFS shortest path (by hop count) between two nodes.
  // Returns an ordered array of nodes [from, ..., to] or null if unreachable.
  function path(sim, from, to) {
    if (from === to) return [from];
    const prev = new Map();
    const seen = new Set([from.id]);
    const q = [from];
    while (q.length) {
      const cur = q.shift();
      for (const nb of neighbors(sim, cur)) {
        if (!seen.has(nb.id)) {
          seen.add(nb.id);
          prev.set(nb.id, cur);
          if (nb === to) {
            const route = [to];
            let c = to;
            while (prev.get(c.id)) { c = prev.get(c.id); route.unshift(c); }
            return route;
          }
          q.push(nb);
        }
      }
    }
    return null;
  }

  // All active nodes of a role (clones count as volts). Optional filter.
  function nodesByRole(sim, type, filterFn) {
    let list = sim.nodes.filter(n =>
      (n.type === type || (type === 'volt' && n.isClone)) && n.status === 'active'
    );
    if (filterFn) list = list.filter(filterFn);
    return list;
  }

  // Flood fill of all reachable active nodes from start (optionally matching predicate).
  function reachable(sim, start, predicate) {
    const out = [start];
    const q = [start];
    const seen = new Set([start.id]);
    while (q.length) {
      const cur = q.shift();
      for (const nb of neighbors(sim, cur)) {
        if (nb.status === 'active' && (!predicate || predicate(nb)) && !seen.has(nb.id)) {
          seen.add(nb.id);
          out.push(nb);
          q.push(nb);
        }
      }
    }
    return out;
  }

  // First hop for an incoming request: prefer a Dispatcher if present,
  // else the nearest active Volt. Preserves current routeEmergency semantics.
  function entryNodeFor(sim, request) {
    const dispatcher = sim.nodes.find(n => n.type === 'dispatcher' && n.status === 'active');
    if (dispatcher) return dispatcher;

    const volts = nodesByRole(sim, 'volt');
    if (volts.length === 0) return null;

    const ex = request.x, ey = request.y;
    let closest = volts[0];
    let min = Math.hypot(volts[0].x - ex, volts[0].y - ey);
    for (const v of volts) {
      const d = Math.hypot(v.x - ex, v.y - ey);
      if (d < min) { min = d; closest = v; }
    }
    return closest;
  }

  // Best target among a role by routing policy (mirrors processDispatcherNode).
  function bestTarget(sim, role, policy) {
    let list = nodesByRole(sim, role, n => !n.isFrozen);
    if (list.length === 0) return null;
    if (policy === 'round-robin') {
      const idx = (sim._topoRR || 0) % list.length;
      sim._topoRR = idx + 1;
      return list[idx];
    }
    let best = list[0], min = list[0].queue.length;
    for (const s of list) {
      if (s.queue.length < min) { min = s.queue.length; best = s; }
    }
    return best;
  }

  // Evaluate constraint-based blueprint. Each constraint is
  // { text, check(sim) } or a bare fn(sim) -> true|false.
  function satisfies(constraints, sim) {
    if (!constraints || constraints.length === 0) return { ok: true, missing: [] };
    const missing = [];
    for (const c of constraints) {
      const fn = (c && c.check) ? c.check : c;
      const ok = fn(sim) === true;
      if (!ok) missing.push((c && c.text) ? c.text : 'unmet constraint');
    }
    return { ok: missing.length === 0, missing };
  }

  // Helper: is there a (non-partitioned) portal linking two nodes?
  function linked(sim, a, b) {
    return sim.portals.some(p =>
      !p.isPartitioned && ((p.from === a && p.to === b) || (p.from === b && p.to === a))
    );
  }

  return {
    neighbors, path, nodesByRole, reachable,
    entryNodeFor, bestTarget, satisfies, linked
  };
})();
