const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const SCREENSHOT_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(__dirname, '..', url);
  const ext = path.extname(filePath);
  const mime = { '.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png' }[ext]||'text/plain';
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200,{'Content-Type':mime});
    res.end(content);
  } catch {
    if (!res.headersSent) { res.writeHead(404); res.end('Not found'); }
  }
});

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  server.listen(PORT);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();

  // === 1. Full UI overview with Level 1 loaded, nodes deployed, paused ===
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#sim-canvas', { timeout: 10000 });
  try { await page.waitForSelector('#btn-tut-skip',{timeout:2000}); await page.click('#btn-tut-skip'); } catch {}
  await wait(500);
  await page.select('#level-select', '1');
  await wait(500);
  // Place extra Volt so canvas has something to show
  await page.evaluate(() => app.sim.spawnNode('volt', 600, 300, {}));
  // Start then pause so nodes are visible but no panic
  await page.click('#btn-start');
  await wait(2000);
  await page.click('#btn-pause');
  await wait(300);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'ui-overview.png') });
  console.log('Saved ui-overview.png');

  // === 2. Inspector panel — select a node ===
  await page.evaluate(() => {
    const sim = app.sim;
    // Select the Volt at center
    const v = sim.nodes.find(n => n.type === 'volt');
    if (v) { app.ui.selectedNode = v; app.ui.updateInspector(); }
  });
  await wait(500);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'ui-inspector.png') });
  console.log('Saved ui-inspector.png');

  // === 3. Deploy tab active card selection ===
  await page.evaluate(() => {
    document.querySelector('.tab-btn[data-tab="tab-deploy"]').click();
  });
  await wait(300);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'ui-deploy.png') });
  console.log('Saved ui-deploy.png');

  await browser.close();
  server.close();
  console.log('Done!');
}
main().catch(err => { console.error(err); process.exit(1); });
