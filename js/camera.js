/* ==========================================================================
   CAMERA — viewport (pan + zoom) for the simulation canvas.
   Pure view transform: maps world coordinates (sim space) to screen pixels.
   No game-state mutation.
   ========================================================================== */
window.Camera = class Camera {
  constructor() {
    this.x = 400;          // world coordinate shown at screen center
    this.y = 300;
    this.scale = 1;
    this.minScale = 0.45;
    this.maxScale = 2.6;
    this._shakeTime = 0;
    this._shakeMag = 0;
    this._initialized = false;
  }

  // Keep the view centered on first sizing so world == screen at scale 1.
  centerOn(worldW, worldH) {
    if (!this._initialized) {
      this.x = worldW / 2;
      this.y = worldH / 2;
      this._initialized = true;
    }
  }

  worldToScreen(wx, wy, vw, vh) {
    return {
      x: (wx - this.x) * this.scale + vw / 2,
      y: (wy - this.y) * this.scale + vh / 2
    };
  }

  screenToWorld(sx, sy, vw, vh) {
    return {
      x: (sx - vw / 2) / this.scale + this.x,
      y: (sy - vh / 2) / this.scale + this.y
    };
  }

  zoomAt(sx, sy, delta, vw, vh) {
    const before = this.screenToWorld(sx, sy, vw, vh);
    const factor = delta > 0 ? 1.12 : 0.89;
    this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
    const after = this.screenToWorld(sx, sy, vw, vh);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  pan(dx, dy) {
    this.x -= dx / this.scale;
    this.y -= dy / this.scale;
  }

  // Fit view: scale 1 centered on the field (Phase C camera controls)
  resetView(vw, vh) {
    this.scale = 1;
    this.x = vw / 2;
    this.y = vh / 2;
    this._initialized = true;
  }

  shake(mag = 10, time = 12) {
    this._shakeMag = Math.max(this._shakeMag, mag);
    this._shakeTime = Math.max(this._shakeTime, time);
  }

  // Apply the transform to the 2D context for world-space drawing.
  applyTransform(ctx, vw, vh) {
    let ox = 0, oy = 0;
    if (this._shakeTime > 0) {
      ox = (Math.random() - 0.5) * this._shakeMag;
      oy = (Math.random() - 0.5) * this._shakeMag;
      this._shakeTime--;
      if (this._shakeTime === 0) this._shakeMag = 0;
    }
    ctx.translate(vw / 2 + ox, vh / 2 + oy);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.x, -this.y);
  }

  // Visible world rectangle (for culling / background extents).
  visibleWorld(vw, vh) {
    const tl = this.screenToWorld(0, 0, vw, vh);
    const br = this.screenToWorld(vw, vh, vw, vh);
    return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
  }
};
