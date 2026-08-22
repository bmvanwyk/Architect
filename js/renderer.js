/* ==========================================================================
   CANVAS RENDERING ENGINE
   Handles vector drawing, particle animations, HUD layouts, and status highlights.
   ========================================================================== */

window.Renderer = class Renderer {
  constructor(canvas, simulation) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sim = simulation;
    
    // Grid animation offsets
    this.dashOffset = 0;
    
    // Set standard canvas sizes
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.sim.width = rect.width;
    this.sim.height = rect.height;
    if (window.FX) {
      window.FX.onResize(this.canvas.width, this.canvas.height);
    }
  }

  draw() {
    const ctx = this.ctx;
    const vw = this.canvas.width;
    const vh = this.canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, vw, vh);

    // 0. Starfield stays in SCREEN space (parallax backdrop)
    if (window.FX) window.FX.starfield(ctx, vw, vh);
    ctx.restore();

    // World-space layer (pans + zooms with the camera)
    ctx.save();
    if (this.camera) this.camera.applyTransform(ctx, vw, vh);

    this.dashOffset -= 0.25;

    // 0a. Geo world-map underlay (world space, Phase G)
    if (window.FX && window.WorldMap) window.WorldMap.drawWorldMap(ctx, this.sim.width, this.sim.height);

    // Build route-highlight set from in-transit packets (for connector glow)
    this._highlight = new Set();
    for (const p of this.sim.packets) {
      if (p.state === 'in-transit' && p.from && p.to) {
        this._highlight.add(p.from.id + '>' + p.to.id);
        this._highlight.add(p.to.id + '>' + p.from.id);
      }
    }

    // 0b. Deployment grid (world space)
    if (window.FX) {
      window.FX.grid(ctx, this.sim.width, this.sim.height, this.sim.hoverCell || null);
    }

    // 1. Draw Grid Districts
    this.drawDistricts();

    // 2. Draw Portal Connections (Networks)
    this.drawPortals();

    // 3. Draw Dimensional Rift (CAP partition)
    if (this.sim.settings.networkPartitionActive) {
      this.drawRift();
    }

    // 4. Draw Distress Calls (Emergencies)
    this.drawEmergencies();

    // 5. Draw Deployed Heroes (Nodes)
    this.drawNodes();

    // 6. Draw Packets in Transit
    this.drawPackets();

    // 7. Draw Meteor Explosions
    this.drawMeteors();

    // 7b. Rescue payoff floaters (+$40 rising from rescue sites)
    this.drawResolveFx();

    // 8. Update + draw particle effects (packet trails, sparks)
    if (window.FX) {
      window.FX.particles.update();
      window.FX.particles.draw(ctx);
    }
    ctx.restore();
  }

  drawResolveFx() {
    const ctx = this.ctx;
    const list = this.sim.resolveFx;
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      // One-time celebratory spark burst at spawn
      if (f.life === f.max && window.FX) {
        for (let s = 0; s < 6; s++) window.FX.particles.spawn(f.x, f.y, '#ffd600', 'spark');
      }
      const t = f.life / f.max;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, t * 1.6));
      ctx.fillStyle = '#ffd600';
      ctx.font = '700 13px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#ffd600';
      ctx.shadowBlur = 8;
      ctx.fillText(f.text, f.x, f.y - (1 - t) * 26 - 18);
      ctx.restore();
      f.y -= 0.45;
      f.life--;
      if (f.life <= 0) list.splice(i, 1);
    }
  }

  drawDistricts() {
    const ctx = this.ctx;
    const w = this.sim.width;
    const h = this.sim.height;
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    
    // Draw crosshair dividers
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    
    // Label Districts
    ctx.font = '700 9px Outfit';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.letterSpacing = '1px';
    ctx.fillText("DISTRICT NORTH-WEST", 20, 25);
    ctx.fillText("DISTRICT NORTH-EAST", w - 150, 25);
    ctx.fillText("DISTRICT SOUTH-WEST", 20, h - 20);
    ctx.fillText("DISTRICT SOUTH-EAST", w - 150, h - 20);
  }

  drawPortals() {
    const ctx = this.ctx;
    ctx.lineWidth = 2;
    
    for (let portal of this.sim.portals) {
       const isPartitioned = this.sim.settings.networkPartitionActive &&
        ((portal.from.x < this.sim.width / 2) !== (portal.to.x < this.sim.width / 2));
      
      // Infer a diagram link-type label from the endpoints' roles
      let label = null, labelColor = "rgba(0,242,254,0.9)";
      if (!isPartitioned) {
        const types = [portal.from.type, portal.to.type];
        if (types.includes('mind-palace')) { label = "db"; labelColor = "#bb86fc"; }
        else if (types.includes('dispatcher') && types.includes('volt')) { label = "lb"; labelColor = "#00e676"; }
        else if (types.includes('dispatcher')) { label = "route"; }
        else { label = "link"; }
      }
      
      const key = portal.from.id + '>' + portal.to.id;
      const highlight = this._highlight && this._highlight.has(key);
      
      if (window.FX) {
        window.FX.orthogonalLink(ctx, portal.from, portal.to, {
          partitioned: isPartitioned,
          highlight: highlight,
          label: label,
          labelColor: labelColor
        });
      } else {
        // Draw Laser Link
        ctx.beginPath();
        ctx.moveTo(portal.from.x, portal.from.y);
        ctx.lineTo(portal.to.x, portal.to.y);
        
        if (isPartitioned) {
          // Red dashed line for severed link
          ctx.strokeStyle = '#ff1744';
          ctx.setLineDash([4, 6]);
        } else {
          // Glowing cyan line
          ctx.strokeStyle = 'rgba(0, 242, 254, 0.3)';
          ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      
      // Draw end connector rings
      ctx.beginPath();
      ctx.arc(portal.from.x, portal.from.y, 22, 0, Math.PI * 2);
      ctx.strokeStyle = isPartitioned ? 'rgba(255, 23, 68, 0.2)' : 'rgba(0, 242, 254, 0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  drawRift() {
    const ctx = this.ctx;
    const w = this.sim.width;
    const h = this.sim.height;
    
    // Jagged partition line down center
    ctx.strokeStyle = 'rgba(255, 23, 68, 0.7)';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ff1744';
    ctx.shadowBlur = 12;
    
    ctx.beginPath();
    let currY = 0;
    ctx.moveTo(w / 2, currY);
    while (currY < h) {
      currY += 20;
      const deviation = (Math.random() - 0.5) * 15;
      ctx.lineTo(w / 2 + deviation, currY);
    }
    ctx.stroke();
    ctx.shadowBlur = 0; // reset
    
    // Rift labels
    ctx.fillStyle = 'rgba(255, 23, 68, 0.9)';
    ctx.font = '700 11px Outfit';
    ctx.textAlign = 'center';
    ctx.fillText("⚠️ DIMENSIONAL RIFT ACTIVE ⚠️", w / 2, 40);
    ctx.fillText("EAST/WEST COMMUNICATIONS BLOCKERED", w / 2, 56);
    ctx.textAlign = 'left'; // reset
  }

  drawEmergencies() {
    const ctx = this.ctx;
    
    for (let em of this.sim.emergencies) {
      // 1. Draw outer panic pulse ring
      const pulseRatio = (this.sim.tickCount % 60) / 60;
      ctx.beginPath();
      ctx.arc(em.x, em.y, 8 + pulseRatio * 16, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 82, 82, ${1 - pulseRatio})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      
      // 2. Draw remaining lifetime circular dial
      const lifeRatio = 1 - (em.ticksActive / em.maxLife);
      ctx.beginPath();
      ctx.arc(em.x, em.y, 11, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * lifeRatio));
      ctx.strokeStyle = lifeRatio > 0.45 ? '#ffd600' : '#ff1744';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // 3. Draw core beacon
      ctx.beginPath();
      ctx.arc(em.x, em.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ff1744';
      ctx.shadowColor = '#ff1744';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0; // reset
      
      // Label beacon
      ctx.fillStyle = '#f8f9fa';
      ctx.font = '700 8px Outfit';
      ctx.fillText(`SOS #${em.id}`, em.x - 14, em.y - 18);
    }
  }

  drawNodes() {
    const ctx = this.ctx;
    
    for (let node of this.sim.nodes) {
      if (node.status !== 'active') continue;
      
      // Draw Base Ring (diagram node body via FX, or flat fallback)
      if (window.FX) {
        window.FX.diagramNode(ctx, node);
      } else {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 20, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.strokeStyle = node.isFrozen ? '#4facfe' : 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
      }
      
      // Draw dynamic CPU Load Ring on external border
      if (node.cpuLoad > 0) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 23, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * (node.cpuLoad / 100)));
        ctx.strokeStyle = node.cpuLoad > 80 ? '#ff1744' : (node.cpuLoad > 50 ? '#ffd600' : '#00e676');
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      
      // Icons and labels based on Type (emoji fallback only if FX absent)
      if (!window.FX) {
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        let icon = "🗼";
        if (node.type === 'volt' || node.isClone) icon = "⚡";
        if (node.type === 'dispatcher') icon = "📡";
        if (node.type === 'mind-palace') icon = "🧠";
        if (node.type === 'coordinator') icon = "🐳";
        
        ctx.fillText(icon, node.x, node.y);
        ctx.textAlign = 'left'; // reset text align
        ctx.textBaseline = 'alphabetic'; // reset baseline
      }
      
      // Frozen Block Indicator
      if (node.isFrozen) {
        ctx.fillStyle = 'rgba(79, 172, 254, 0.3)';
        ctx.strokeStyle = '#00f2fe';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(node.x - 22, node.y - 22, 44, 44);
        ctx.fill();
        ctx.stroke();
        
        ctx.fillStyle = '#4facfe';
        ctx.font = '700 8px Outfit';
        ctx.fillText("FROZEN", node.x - 17, node.y + 32);
      }
      
      // Queue indicator: segmented arc ring hugging the node body
      // (capped at 12 visual segments; each segment = ceil(maxQueue/12) slots)
      const segs = Math.min(12, node.maxQueue);
      const per = Math.ceil(node.maxQueue / segs);
      const fillRatio = node.queue.length / node.maxQueue;
      for (let i = 0; i < segs; i++) {
        const a0 = -Math.PI / 2 + (i / segs) * Math.PI * 2 + 0.07;
        const a1 = -Math.PI / 2 + ((i + 1) / segs) * Math.PI * 2 - 0.07;
        const filled = node.queue.length > i * per;
        ctx.beginPath();
        ctx.arc(node.x, node.y, 27, a0, a1);
        ctx.strokeStyle = filled
          ? (fillRatio > 0.8 ? '#ff1744' : fillRatio > 0.5 ? '#ffd600' : '#00e676')
          : 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      
      // Text details
      ctx.fillStyle = '#f8f9fa';
      ctx.font = '700 10px Outfit';
      const label = `${node.name} L${node.level}`;
      const labelWidth = ctx.measureText(label).width;
      ctx.fillText(label, node.x - labelWidth / 2, node.y + 36);
      
      // Database specific replica lag / database roles text
      if (node.type === 'mind-palace') {
        ctx.fillStyle = node.dbRole === 'primary' ? '#ffd600' : '#4facfe';
        ctx.font = '700 8px Outfit';
        const roleText = node.dbRole.toUpperCase();
        const roleWidth = ctx.measureText(roleText).width;
        ctx.fillText(roleText, node.x - roleWidth / 2, node.y + 47);
      }
    }
  }

  drawPackets() {
    const ctx = this.ctx;
    
    for (let pkt of this.sim.packets) {
      if (pkt.state !== 'in-transit') continue;
      
      // Calculate coordinates from progress (interpolated linear path)
      const startX = pkt.from ? pkt.from.x : pkt.payload.x;
      const startY = pkt.from ? pkt.from.y : pkt.payload.y;
      const targetX = pkt.to.x;
      const targetY = pkt.to.y;
      
      const currentX = startX + (targetX - startX) * pkt.progress;
      const currentY = startY + (targetY - startY) * pkt.progress;
      
      // Color-coding based on packet type
      let color = '#ffd600'; // Yellow for standard requests
      let radius = 4;
      
      if (pkt.type === 'ack') {
        color = '#00e676'; // Acid Green for ACKs
        radius = 3;
      } else if (pkt.type === 'sync') {
        color = '#00f2fe'; // Blue for DB replication sync
        radius = 5.5;
      } else if (pkt.type === 'write') {
        color = '#ff9800'; // Orange for DB writes
        radius = 4.5;
      } else if (pkt.type === 'read') {
        color = '#bb86fc'; // Purple for DB reads
        radius = 4.5;
      }
      
      // Packet trail (FX only)
      if (window.FX) {
        window.FX.particles.spawn(currentX, currentY, window.FX.packetColor(pkt), 'trail');
      }
      
      ctx.beginPath();
      ctx.arc(currentX, currentY, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      
      // Packet glow
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0; // reset
    }
  }

  drawMeteors() {
    const ctx = this.ctx;
    for (let m of this.sim.meteors) {
      m.radius += 2.5;
      m.opacity -= 0.035;
      
      if (m.opacity > 0) {
        // Spark burst (FX only)
        if (window.FX && Math.random() < 0.6) {
          for (let s = 0; s < 3; s++) {
            window.FX.particles.spawn(m.x, m.y, 'rgba(255,140,90,ALPHA)', 'spark');
          }
        }
        
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 23, 68, ${m.opacity})`;
        ctx.lineWidth = 4;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.radius / 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 110, 64, ${m.opacity * 0.4})`;
        ctx.fill();
      }
    }
    
    // Flush dead animations
    this.sim.meteors = this.sim.meteors.filter(m => m.opacity > 0);
  }
}
