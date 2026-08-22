/* ==========================================================================
   FX — PRESENTATION-ONLY EFFECTS
   Pure Canvas 2D + embedded data-URI SVG. Never mutates simulation state.
   Called by renderer.js. All effects degrade gracefully if window.FX is absent.
   ========================================================================== */

window.FX = (function () {
  "use strict";

  // ---- Presentation-only state -------------------------------------------
  let bgCanvas = null;
  let bgW = 0;
  let bgH = 0;
  const sprites = {};        // key -> { img, ready }
  const glowCache = {};      // key -> CanvasGradient
  const particles = [];      // active effect particles

  // ---- Utilities ----------------------------------------------------------
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function now() {
    return (typeof performance !== "undefined" && performance.now)
      ? performance.now()
      : Date.now();
  }

  // Cached radial glow gradient keyed by color + radius.
  function glow(ctx, x, y, r, color) {
    const key = color + "_" + r;
    let g = glowCache[key];
    if (!g) {
      g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      glowCache[key] = g;
    }
    return g;
  }

  // ---- Hero emblem sprites (data-URI SVG, no network fetch) --------------
  function svgFor(type) {
    const head = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'>";
    const foot = "</svg>";
    switch (type) {
      case "volt":
        return head +
          "<path d='M27 8 L16 26 L24 26 L21 40 L33 20 L25 20 Z' " +
          "fill='#ffe14d' stroke='#fff7c2' stroke-width='1.5' stroke-linejoin='round'/>" +
          foot;
      case "dispatcher":
        return head +
          "<g fill='none' stroke='#7fe3ff' stroke-width='2.5' stroke-linecap='round'>" +
          "<path d='M14 34 A18 18 0 0 1 34 14'/>" +
          "<line x1='14' y1='34' x2='30' y2='34'/>" +
          "<circle cx='20' cy='28' r='2.5' fill='#7fe3ff'/>" +
          "<line x1='34' y1='14' x2='40' y2='8'/>" +
          "</g>" + foot;
      case "mind-palace":
        return head +
          "<g fill='none' stroke='#bb86fc' stroke-width='2.5' stroke-linejoin='round'>" +
          "<path d='M24 14 C16 14 14 22 18 26 C14 30 18 38 24 36 " +
          "C30 38 34 30 30 26 C34 22 32 14 24 14 Z'/>" +
          "<line x1='24' y1='16' x2='24' y2='36'/>" +
          "</g>" + foot;
      case "coordinator":
        return head +
          "<g fill='none' stroke='#5fffc4' stroke-width='2.5'>" +
          "<circle cx='24' cy='24' r='14'/>" +
          "<path d='M24 10 V38 M10 24 H38'/>" +
          "<circle cx='24' cy='24' r='4' fill='#5fffc4'/>" +
          "</g>" + foot;
      case "tower":
      default:
        return head +
          "<g fill='none' stroke='#7fe3ff' stroke-width='2.5' stroke-linecap='round'>" +
          "<path d='M24 40 V20'/>" +
          "<circle cx='24' cy='14' r='4'/>" +
          "<path d='M24 20 L14 30 M24 20 L34 30'/>" +
          "<path d='M14 30 h20'/>" +
          "<circle cx='14' cy='30' r='2' fill='#7fe3ff'/>" +
          "<circle cx='34' cy='30' r='2' fill='#7fe3ff'/>" +
          "</g>" + foot;
    }
  }

  function spriteKey(node) {
    if (node.type === "volt" || node.isClone) return "volt";
    if (node.type === "dispatcher") return "dispatcher";
    if (node.type === "mind-palace") return "mind-palace";
    if (node.type === "coordinator") return "coordinator";
    return "tower";
  }

  function getSprite(type) {
    if (!sprites[type]) {
      const s = { img: new Image(), ready: false };
      s.img.onload = () => { s.ready = true; };
      s.img.src = "data:image/svg+xml;utf8," + encodeURIComponent(svgFor(type));
      sprites[type] = s;
    }
    return sprites[type];
  }

  // Draw hero emblem centered at (x,y). Falls back to a colored ring if the
  // sprite image is not yet decoded, so nothing ever disappears.
  function drawSprite(ctx, node, x, y, size) {
    size = size || 30;
    const key = spriteKey(node);
    const s = getSprite(key);
    if (s.ready && s.img.naturalWidth) {
      ctx.drawImage(s.img, x - size / 2, y - size / 2, size, size);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, size / 2 - 2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(127,227,255,0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ---- Background: cached starfield + faint grid --------------------------
  function buildBackground(w, h) {
    const c = (typeof document !== "undefined")
      ? document.createElement("canvas")
      : null;
    if (!c) return null;
    c.width = w;
    c.height = h;
    const b = c.getContext("2d");

    // Base vertical gradient
    const base = b.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, "#0a1326");
    base.addColorStop(1, "#05080f");
    b.fillStyle = base;
    b.fillRect(0, 0, w, h);

    // Faint nebula blooms
    const bloom = (cx, cy, r, col) => {
      const g = b.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, col);
      g.addColorStop(1, "rgba(0,0,0,0)");
      b.fillStyle = g;
      b.fillRect(0, 0, w, h);
    };
    bloom(w * 0.25, h * 0.30, Math.max(w, h) * 0.35, "rgba(20,60,110,0.25)");
    bloom(w * 0.78, h * 0.72, Math.max(w, h) * 0.30, "rgba(70,20,90,0.18)");

    // ---- Metro City underlay (dim city blocks + lit windows + avenues) -----
    // Drawn beneath stars/grid; kept ≤14% alpha so nodes & packets stay dominant.
    // Blocks cluster around district centers so it reads as a city, not noise.
    let cseed = 4242;
    const rndCity = () => {
      cseed = (cseed * 1103515245 + 12345) & 0x7fffffff;
      return cseed / 0x7fffffff;
    };
    const districts = [];
    const dCount = Math.max(4, Math.floor((w * h) / 90000));
    for (let i = 0; i < dCount; i++) {
      districts.push({ x: rndCity() * w, y: rndCity() * h });
    }
    for (const d of districts) {
      const blocksHere = 3 + Math.floor(rndCity() * 4);
      for (let i = 0; i < blocksHere; i++) {
        const bw = 30 + rndCity() * 70;
        const bh = 24 + rndCity() * 50;
        const bx = d.x + (rndCity() - 0.5) * 220 - bw / 2;
        const by = d.y + (rndCity() - 0.5) * 180 - bh / 2;
        b.fillStyle = "rgba(0,60,90," + (0.05 + rndCity() * 0.08).toFixed(2) + ")";
        b.fillRect(bx, by, bw, bh);
        // Window dots
        const cols = Math.floor(bw / 9);
        const rows = Math.floor(bh / 9);
        b.fillStyle = "rgba(255,214,0,0.09)";
        for (let wx = 0; wx < cols; wx++) {
          for (let wy = 0; wy < rows; wy++) {
            if (rndCity() > 0.68) {
              b.fillRect(bx + 4 + wx * 9, by + 4 + wy * 9, 2, 2);
            }
          }
        }
      }
    }
    // Avenues: a few brighter lines crossing between districts
    const avenueCount = 3 + Math.floor(w / 400);
    b.lineWidth = 2;
    for (let i = 0; i < avenueCount; i++) {
      const horiz = rndCity() > 0.5;
      const pos = rndCity() * (horiz ? h : w);
      b.strokeStyle = "rgba(0,242,254,0.07)";
      b.beginPath();
      if (horiz) { b.moveTo(0, pos); b.lineTo(w, pos); }
      else { b.moveTo(pos, 0); b.lineTo(pos, h); }
      b.stroke();
    }

    // Deterministic star field (seeded so it stays stable across rebuilds)
    let seed = 1337;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const count = Math.floor((w * h) / 5500);
    for (let i = 0; i < count; i++) {
      const sx = rnd() * w;
      const sy = rnd() * h;
      const sr = rnd() * 1.1 + 0.2;
      const a = rnd() * 0.5 + 0.15;
      b.beginPath();
      b.arc(sx, sy, sr, 0, Math.PI * 2);
      b.fillStyle = "rgba(200,225,255," + a.toFixed(2) + ")";
      b.fill();
    }

    // Faint grid
    b.strokeStyle = "rgba(255,255,255,0.025)";
    b.lineWidth = 1;
    const step = 48;
    b.beginPath();
    for (let gx = 0; gx <= w; gx += step) { b.moveTo(gx, 0); b.lineTo(gx, h); }
    for (let gy = 0; gy <= h; gy += step) { b.moveTo(0, gy); b.lineTo(w, gy); }
    b.stroke();

    return c;
  }

  function starfield(ctx, w, h) {
    if (!bgCanvas || bgW !== w || bgH !== h) {
      bgCanvas = buildBackground(w, h);
      bgW = w;
      bgH = h;
    }
    if (bgCanvas) {
      ctx.drawImage(bgCanvas, 0, 0);
    } else {
      // Non-browser fallback: flat fill
      ctx.fillStyle = "#05080f";
      ctx.fillRect(0, 0, w, h);
    }
  }

  function onResize(w, h) {
    // Force background rebuild on next starfield() call.
    bgW = 0;
    bgH = 0;
    bgCanvas = null;
  }

  // ---- Glass node body ----------------------------------------------------
  function glassNode(ctx, node) {
    const x = node.x, y = node.y;
    const r = 20;
    const frozen = !!node.isFrozen;
    const border = frozen ? "#4facfe" : "rgba(180,220,255,0.35)";

    // Outer soft glow
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const og = glow(ctx, x, y, 34, frozen ? "rgba(79,172,254,0.18)" : "rgba(80,180,255,0.14)");
    ctx.fillStyle = og;
    ctx.beginPath();
    ctx.arc(x, y, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Glass fill (radial gradient)
    const g = ctx.createRadialGradient(x - 6, y - 8, 2, x, y, r);
    g.addColorStop(0, "rgba(40,70,120,0.95)");
    g.addColorStop(1, "rgba(10,18,38,0.95)");
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // Inner top highlight
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.75);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Border
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ---- Energy-flow portal link -------------------------------------------
  function energyLink(ctx, from, to, partitioned, color) {
    if (partitioned) {
      ctx.save();
      ctx.strokeStyle = "#ff1744";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    color = color || "rgba(0,242,254,0.85)";
    // Base translucent line
    ctx.save();
    ctx.strokeStyle = "rgba(0,242,254,0.12)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // Animated flowing dashes
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 10]);
    ctx.lineDashOffset = -(now() * 0.04) % 16;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  // ---- Particle system (packet trails + meteor sparks) --------------------
  const Particles = {
    spawn(x, y, color, kind) {
      if (kind === "trail") {
        particles.push({ x, y, vx: 0, vy: 0, color, kind, life: 9, max: 9, size: 3 });
      } else if (kind === "spark") {
        const a = Math.random() * Math.PI * 2;
        const sp = Math.random() * 2.2 + 0.6;
        particles.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          color, kind, life: 22, max: 22, size: 2
        });
      }
    },
    update() {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
      }
    },
    draw(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const p of particles) {
        const a = p.life / p.max;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, Math.PI * 2);
        ctx.fillStyle = p.color.replace("ALPHA", a.toFixed(2));
        ctx.globalAlpha = a;
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    },
    clear() { particles.length = 0; }
  };

  // Color strings that support an ALPHA placeholder for particles.
  function packetColor(pkt) {
    switch (pkt.type) {
      case "ack":   return "rgba(0,230,118,ALPHA)";
      case "sync":  return "rgba(0,242,254,ALPHA)";
      case "write": return "rgba(255,152,0,ALPHA)";
      case "read":  return "rgba(187,134,252,ALPHA)";
      default:      return "rgba(255,214,0,ALPHA)";
    }
  }

  // ---- Deployment grid --------------------------------------------------
  function grid(ctx, w, h, hover) {
    const CELL = 84;
    ctx.save();
    ctx.strokeStyle = "rgba(120,180,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = CELL; x < w; x += CELL) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = CELL; y < h; y += CELL) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    if (hover) {
      ctx.fillStyle = "rgba(0,242,254,0.10)";
      ctx.strokeStyle = "rgba(0,242,254,0.5)";
      ctx.lineWidth = 1.5;
      ctx.fillRect(hover.x - hover.cw / 2, hover.y - hover.ch / 2, hover.cw, hover.ch);
      ctx.strokeRect(hover.x - hover.cw / 2, hover.y - hover.ch / 2, hover.cw, hover.ch);
    }
    ctx.restore();
  }

  // ---- Diagram node shapes (cloud-architecture conventions) -------------
  function shapePath(ctx, node) {
    const x = node.x, y = node.y, R = 22;
    ctx.beginPath();
    if (node.type === 'dispatcher') {
      // Hexagon (Load Balancer)
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + i * Math.PI / 3;
        const px = x + Math.cos(a) * R, py = y + Math.sin(a) * R;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else if (node.type === 'mind-palace') {
      // Cylinder (Database)
      const ry = 7;
      ctx.moveTo(x - R, y - 10);
      ctx.lineTo(x - R, y + 10);
      ctx.ellipse(x, y + 10, R, ry, 0, Math.PI, 0, true);
      ctx.lineTo(x + R, y - 10);
      ctx.ellipse(x, y - 10, R, ry, 0, 0, Math.PI * 2);
    } else if (node.type === 'coordinator') {
      // Rounded square (Orchestrator)
      const s = R - 2, r = 6;
      ctx.moveTo(x - s + r, y - s);
      ctx.arcTo(x + s, y - s, x + s, y + s, r);
      ctx.arcTo(x + s, y + s, x - s, y + s, r);
      ctx.arcTo(x - s, y + s, x - s, y - s, r);
      ctx.arcTo(x - s, y - s, x + s, y - s, r);
      ctx.closePath();
    } else if (node.type === 'cache') {
      // Stacked layers (Cache / queue)
      for (let i = -1; i <= 1; i++) {
        const yy = y + i * 8;
        ctx.moveTo(x - R + 4, yy - 2);
        ctx.lineTo(x + R - 4, yy - 2);
        ctx.lineTo(x + R - 8, yy + 2);
        ctx.lineTo(x - R + 8, yy + 2);
        ctx.closePath();
      }
    } else {
      // Volt / default: rounded rect (Compute)
      const s = R - 2, r = 5;
      ctx.moveTo(x - s + r, y - s);
      ctx.arcTo(x + s, y - s, x + s, y + s, r);
      ctx.arcTo(x + s, y + s, x - s, y + s, r);
      ctx.arcTo(x - s, y + s, x - s, y - s, r);
      ctx.arcTo(x - s, y - s, x + s, y - s, r);
      ctx.closePath();
    }
  }

  function diagramNode(ctx, node) {
    const x = node.x, y = node.y;
    const frozen = !!node.isFrozen;
    const border = frozen ? "#4facfe" : "rgba(150,200,255,0.55)";

    // Outer soft glow
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const og = glow(ctx, x, y, 34, frozen ? "rgba(79,172,254,0.18)" : "rgba(80,180,255,0.14)");
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.arc(x, y, 34, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Glass fill + shape stroke
    const g = ctx.createRadialGradient(x - 6, y - 8, 2, x, y, 24);
    g.addColorStop(0, "rgba(40,70,120,0.95)");
    g.addColorStop(1, "rgba(10,18,38,0.95)");
    shapePath(ctx, node);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner glyph accent
    ctx.save();
    ctx.strokeStyle = "rgba(180,220,255,0.5)";
    ctx.lineWidth = 1.5;
    if (node.type === 'dispatcher') {
      ctx.beginPath();
      ctx.moveTo(x - 6, y); ctx.lineTo(x + 4, y);
      ctx.moveTo(x + 4, y); ctx.lineTo(x, y - 4);
      ctx.moveTo(x + 4, y); ctx.lineTo(x, y + 4);
      ctx.stroke();
    } else if (node.type === 'mind-palace') {
      ctx.beginPath(); ctx.ellipse(x, y, 6, 4, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (node.type === 'coordinator') {
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.strokeRect(x - 5, y - 5, 10, 10);
    }
    ctx.restore();
  }

  // ---- Orthogonal connector (diagram edge) ------------------------------
  function orthogonalLink(ctx, from, to, opts) {
    opts = opts || {};
    const OFF = 24;
    const dx = to.x - from.x, dy = to.y - from.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy);

    let fp, tp, mid;
    if (horizontal) {
      const sx = dx >= 0 ? 1 : -1;
      fp = { x: from.x + sx * OFF, y: from.y };
      tp = { x: to.x - sx * OFF, y: to.y };
      const midX = (fp.x + tp.x) / 2;
      mid = [{ x: midX, y: fp.y }, { x: midX, y: tp.y }];
    } else {
      const sy = dy >= 0 ? 1 : -1;
      fp = { x: from.x, y: from.y + sy * OFF };
      tp = { x: to.x, y: to.y - sy * OFF };
      const midY = (fp.y + tp.y) / 2;
      mid = [{ x: fp.x, y: midY }, { x: tp.x, y: midY }];
    }

    const partitioned = !!opts.partitioned;
    const color = opts.color || (partitioned ? "#ff1744" : "rgba(0,242,254,0.7)");
    ctx.save();
    if (opts.highlight) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 3;
    } else {
      ctx.lineWidth = partitioned ? 2 : 1.6;
    }
    ctx.strokeStyle = color;
    if (partitioned) ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(fp.x, fp.y);
    for (const m of mid) ctx.lineTo(m.x, m.y);
    ctx.lineTo(tp.x, tp.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead at target
    if (!partitioned) {
      const prev = mid[mid.length - 1];
      const ang = Math.atan2(tp.y - prev.y, tp.x - prev.x);
      ctx.beginPath();
      ctx.moveTo(tp.x, tp.y);
      ctx.lineTo(tp.x - 7 * Math.cos(ang - 0.4), tp.y - 7 * Math.sin(ang - 0.4));
      ctx.lineTo(tp.x - 7 * Math.cos(ang + 0.4), tp.y - 7 * Math.sin(ang + 0.4));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Link-type label
    if (opts.label) {
      const lx = (mid[0].x + mid[1].x) / 2;
      const ly = (mid[0].y + mid[1].y) / 2;
      ctx.font = "700 8px Outfit";
      const tw = ctx.measureText(opts.label).width + 6;
      ctx.fillStyle = "rgba(5,10,20,0.85)";
      ctx.fillRect(lx - tw / 2, ly - 7, tw, 13);
      ctx.fillStyle = opts.labelColor || color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(opts.label, lx, ly);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
    ctx.restore();
  }

  return {
    lerp, easeOut,
    starfield, onResize, grid,
    glassNode, drawSprite, spriteKey,
    energyLink, diagramNode, orthogonalLink, shapePath,
    particles: Particles,
    packetColor
  };
})();
