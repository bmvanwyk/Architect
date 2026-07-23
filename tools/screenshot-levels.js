const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const SCREENSHOT_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Per-level setup: what to deploy before taking the screenshot.
// These create visually interesting canvases with nodes, portals, and packets.
const LEVEL_SCRIPTS = {
  1: `app.sim.spawnNode('volt', 500, 300, {});`,
  2: `
    app.sim.spawnNode('volt', 500, 150, {});
    app.sim.spawnNode('volt', 250, 400, {});
    const d = app.sim.spawnNode('dispatcher', 400, 300, {});
    d.healthCheckEnabled = true;
  `,
  3: `
    const d3 = app.sim.nodes.find(n => n.type === 'dispatcher');
    const v3 = app.sim.nodes.find(n => n.type === 'volt');
    app.sim.spawnPortal(d3, v3);
    app.sim.settings.ackEnabled = true;
    app.sim.settings.retryEnabled = true;
    v3.dedupEnabled = true;
    app.sim.spawnNode('volt', 600, 400, {});
  `,
  4: `
    const p4 = app.sim.spawnNode('mind-palace', 250, 250, {});
    const r4 = app.sim.spawnNode('mind-palace', 550, 500, {});
    app.sim.spawnPortal(p4, r4);
    app.sim.spawnNode('volt', 550, 200, {});
  `,
  5: `
    app.sim.spawnNode('volt', 150, 500, {});
    app.sim.spawnNode('volt', 650, 500, {});
    app.sim.settings.capStrategy = 'AP';
  `,
  6: `
    const c6 = app.sim.spawnNode('coordinator', 400, 200, {});
    c6.desiredReplicaCount = 4;
    app.sim.spawnNode('volt', 150, 150, {});
    app.sim.spawnNode('volt', 600, 150, {});
    app.sim.spawnNode('volt', 150, 450, {});
    app.sim.spawnNode('volt', 600, 450, {});
  `,
};

const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(__dirname, '..', url);
  const ext = path.extname(filePath);
  const mime = {
    '.html': 'text/html', '.js': 'application/javascript',
    '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  }[ext] || 'text/plain';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  server.listen(PORT, () => console.log(`Server on :${PORT}`));

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    defaultViewport: { width: 1440, height: 900 },
  });

  for (let id = 1; id <= 6; id++) {
    console.log(`\n=== Level ${id} ===`);
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sim-canvas', { timeout: 10000 });

    // Dismiss tutorial overlay
    try { await page.waitForSelector('#btn-tut-skip', { timeout: 2000 }); await page.click('#btn-tut-skip'); } catch {}
    await wait(500);

    // Select this level
    await page.select('#level-select', String(id));
    await wait(800);

    // Deploy nodes specific to this level
    const setupCode = LEVEL_SCRIPTS[id] || '';
    if (setupCode) await page.evaluate(setupCode);
    await wait(300);

    // Start simulation so canvas draws nodes, portals, and packets
    await page.click('#btn-start');
    console.log('  Running...');
    await wait(3000);

    const filePath = path.join(SCREENSHOT_DIR, `level-${id}.png`);
    await page.screenshot({ path: filePath });
    console.log(`  Saved ${filePath}`);

    await page.close();
  }

  await browser.close();
  server.close();
  console.log('\nDone!');
}

main().catch(err => { console.error(err); process.exit(1); });
