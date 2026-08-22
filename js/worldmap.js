/* ==========================================================================
   WORLDMAP — stylized geo layer for the playfield (Phase G).
   Zero dependencies: continent outlines are baked-in normalized polygons
   (0..1 of map width/height), projected onto the simulation field.
   Drawn in WORLD space so it pans/zooms with the camera.
   Presentation only: never mutates simulation state.
   ========================================================================== */

window.WorldMap = (function () {
  // Rough, stylized landmasses — recognizable silhouettes over realism.
  const CONTINENTS = [
    [ // North America
      [0.030,0.105],[0.130,0.058],[0.220,0.088],[0.262,0.168],[0.232,0.250],
      [0.192,0.330],[0.152,0.402],[0.104,0.360],[0.068,0.280],[0.038,0.180]
    ],
    [ // Central America bridge
      [0.196,0.382],[0.246,0.418],[0.216,0.452],[0.198,0.420]
    ],
    [ // South America
      [0.242,0.440],[0.312,0.462],[0.340,0.552],[0.302,0.662],[0.262,0.722],
      [0.236,0.620],[0.226,0.522]
    ],
    [ // Europe
      [0.436,0.122],[0.506,0.082],[0.552,0.118],[0.562,0.182],[0.512,0.222],
      [0.472,0.212],[0.442,0.162]
    ],
    [ // Africa
      [0.450,0.262],[0.532,0.240],[0.602,0.300],[0.616,0.400],[0.572,0.520],
      [0.522,0.582],[0.486,0.502],[0.456,0.382]
    ],
    [ // Asia
      [0.570,0.052],[0.720,0.040],[0.860,0.082],[0.930,0.160],[0.900,0.260],
      [0.822,0.322],[0.742,0.362],[0.682,0.302],[0.612,0.262],[0.566,0.162]
    ],
    [ // Australia
      [0.802,0.600],[0.886,0.576],[0.926,0.632],[0.896,0.700],[0.826,0.692]
    ]
  ];

  // Active deployment regions (normalized bounds). Later phases unlock more.
  const REGIONS = [
    { id: 'us-east-1', x0: 0.150, y0: 0.135, x1: 0.235, y1: 0.310 }
  ];

  function drawWorldMap(ctx, w, h) {
    ctx.save();

    // Landmasses: muted teal fill + faint neon coastline
    for (const poly of CONTINENTS) {
      ctx.beginPath();
      poly.forEach(([nx, ny], i) => {
        const px = nx * w, py = ny * h;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(13, 34, 54, 0.55)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.11)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Region zones
    for (const r of REGIONS) {
      const x = r.x0 * w, y = r.y0 * h;
      const rw = (r.x1 - r.x0) * w, rh = (r.y1 - r.y0) * h;
      ctx.fillStyle = 'rgba(0, 242, 254, 0.045)';
      ctx.fillRect(x, y, rw, rh);
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.28)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, rw, rh);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0, 242, 254, 0.55)';
      ctx.font = '700 11px Outfit, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(r.id, x + 6, y - 6);
    }

    ctx.restore();
  }

  return { drawWorldMap, CONTINENTS, REGIONS };
})();
