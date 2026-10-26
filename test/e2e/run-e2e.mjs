// End-to-end check of the built app in Chromium with a fake Web Serial port.
// Usage: npm run build && npm run test:e2e
// Screenshots are written to test/e2e/output/. This proves the browser path
// (UI, Web Serial handling, engine) against a scripted port; it is not a test
// of the physical hardware.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Playwright is resolved like a CommonJS module so a globally installed copy works too.
const { chromium } = createRequire(import.meta.url)('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, 'output');
mkdirSync(out, { recursive: true });
const PORT = 4179;
const url = `http://localhost:${PORT}/`;

// Run Vite's CLI directly (not through npx) so killing it stops the server.
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
let server;
const stop = () => server?.kill('SIGTERM');
process.on('exit', stop);

async function waitForServer() {
  try {
    await fetch(url);
    throw new Error(`port ${PORT} is already in use; stop the other server first`);
  } catch (e) {
    if (String(e.message).includes('already in use')) throw e;
  }
  server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start');
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await waitForServer();
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript({ content: readFileSync(join(here, 'fakeArduino.js'), 'utf8') });
  const page = await context.newPage();
  // Software WebGL (SwiftShader) makes screenshots of the 3D view slow.
  page.setDefaultTimeout(90_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  // One-click firmware install through the bootloader (fake STK500 responder).
  await page.goto(`${url}#/setup`);
  await page.waitForSelector('.view-setup');
  await page.click('.view-setup .step:first-child .btn-primary');
  await page.waitForFunction(() => document.querySelector('.install-status')?.textContent?.includes('installed and verified'), null, { timeout: 20000 });
  const boot = await page.evaluate(() => window.__arduino.bootloader());
  check('installs firmware through the bootloader', boot.flashedV2 && boot.written > 4000, `${boot.written} bytes written, ${boot.resets} DTR/RTS changes`);
  await page.screenshot({ path: join(out, '00-setup-installed.png'), fullPage: true });

  await page.goto(`${url}#/overview`);
  await page.waitForSelector('.hero');
  check('starts disconnected with onboarding', await page.isVisible('.onboarding'));
  check('USB pill shows Disconnected', (await page.textContent('.pills')).includes('Disconnected'));
  await page.screenshot({ path: join(out, '01-overview-disconnected.png'), fullPage: true });

  await page.click('.topbar .btn-primary');
  await page.waitForFunction(() => document.querySelector('.pills')?.textContent?.includes('Connected'));
  check('connects through Web Serial', true);
  check('waits for data before showing occupancy', (await page.textContent('.hero-number')).trim() === '—');
  await page.waitForFunction(() => document.querySelector('.hero-number')?.textContent?.trim() === '2', null, { timeout: 8000 });
  check('shows the reported count', true, 'occupancy 2');
  check('detects firmware v2', (await page.textContent('.health')).includes('v2'));
  await sleep(1500);
  await page.screenshot({ path: join(out, '02-overview-live.png'), fullPage: true });

  await page.evaluate(() => window.__arduino.entry());
  await page.waitForFunction(() => document.querySelector('.hero-number')?.textContent?.trim() === '3', null, { timeout: 8000 });
  check('entry raises occupancy from the hardware value', true);
  await sleep(2500);
  await page.screenshot({ path: join(out, '03-overview-after-entry.png'), fullPage: true });

  await page.goto(`${url}#/timeline`);
  await page.waitForSelector('.events');
  const timeline = await page.textContent('.view-timeline');
  check('timeline records a confirmed entry', timeline.includes('Vehicle entered') && timeline.includes('Confirmed'));
  await page.screenshot({ path: join(out, '04-timeline.png'), fullPage: true });

  // Repeated identical frames must not add events.
  const countEvents = () => page.evaluate(() => document.querySelectorAll('.view-timeline .event').length);
  const before = await countEvents();
  await sleep(3000);
  check('repeated readings create no events', (await countEvents()) === before, `${before} events before and after 3 s`);

  await page.goto(`${url}#/facility`);
  await page.waitForSelector('.stage-full');
  await page.evaluate(() => window.__arduino.entry());
  await sleep(4200);
  await page.screenshot({ path: join(out, '05-facility-journey.png') });
  const hasCanvas = await page.isVisible('.stage-full canvas');
  check('3D facility renders a WebGL canvas', hasCanvas);
  await sleep(4000);
  await page.screenshot({ path: join(out, '06-facility.png') });

  // Exit with the decrement path not wired: the counter must not move and a discrepancy appears.
  await page.evaluate(() => window.__arduino.setDecrementWired(false));
  await page.evaluate(() => window.__arduino.exit());
  await page.waitForSelector('.alert.tone-bad', { timeout: 9000 });
  const alertText = await page.textContent('.alerts');
  check('flags an exit the counter did not record', alertText.includes('Exit reported') && alertText.includes('stayed at 4'), alertText.slice(0, 120));
  await page.goto(`${url}#/overview`);
  await page.waitForSelector('.hero');
  check('occupancy stays at the hardware value (4)', (await page.textContent('.hero-number')).trim() === '4');
  await page.screenshot({ path: join(out, '07-discrepancy.png'), fullPage: true });
  await page.click('.alerts .btn');

  await page.goto(`${url}#/lab`);
  await page.waitForSelector('.schematic');
  await sleep(500);
  await page.screenshot({ path: join(out, '08-lab.png'), fullPage: true });

  await page.goto(`${url}#/diagnostics`);
  await page.evaluate(() => {
    window.__arduino.garbage('ENTRY DETECTED! Opening Gate...');
    window.__arduino.garbage('{"q2":0,"q1":1,"q0":1,"count":4}');
    window.__arduino.garbage('{"q2":');
  });
  await sleep(300);
  check('console shows rejected lines', (await page.textContent('.console')).includes('ENTRY DETECTED'));
  await page.screenshot({ path: join(out, '09-diagnostics.png'), fullPage: true });

  await page.evaluate(() => window.__arduino.setFloating(true));
  await sleep(600);
  await page.goto(`${url}#/overview`);
  await page.waitForSelector('.hero');
  await sleep(300);
  const heroText = await page.textContent('.hero');
  check('count 7 is shown as out of range, not occupancy', heroText.includes('Counter reads 7') && (await page.textContent('.hero-number')).trim() === '—');
  check('entry gate predicted to refuse at 7', (await page.textContent('.gates')).includes('Will be refused'));
  await page.screenshot({ path: join(out, '10-out-of-range.png'), fullPage: true });
  await page.evaluate(() => window.__arduino.setFloating(false));
  await sleep(600);

  await page.goto(`${url}#/insights`);
  await page.waitForSelector('.view-insights');
  await sleep(300);
  await page.screenshot({ path: join(out, '11-insights.png'), fullPage: true });

  await page.evaluate(() => window.__arduino.unplug());
  await page.waitForFunction(() => document.querySelector('.pills')?.textContent?.includes('Disconnected'));
  await page.goto(`${url}#/overview`);
  await page.waitForSelector('.hero');
  check('unplugging shows disconnected and last known value', (await page.textContent('.hero .freshness')).includes('Last known'));
  await page.screenshot({ path: join(out, '12-unplugged.png'), fullPage: true });

  // Simulation is separate and labelled.
  const liveNumber = (await page.textContent('.hero-number')).trim();
  await page.click('.source button:nth-child(2)');
  await page.waitForSelector('.sim-tag');
  check('simulation does not start by itself', (await page.textContent('.hero')).includes('not started'));
  await page.click('.sim-controls .btn-sim');
  await page.waitForFunction(() => document.querySelector('.hero-number')?.textContent?.trim() === '2', null, { timeout: 8000 });
  await page.click('.sim-controls button:has-text("Vehicle at entry")');
  await sleep(4500);
  await page.screenshot({ path: join(out, '13-simulation.png'), fullPage: true });
  await page.click('.source button:nth-child(1)');
  await sleep(300);
  check('live view unchanged by simulation', (await page.textContent('.hero-number')).trim() === liveNumber, `live shows ${liveNumber}`);
  const stored = await page.evaluate(() => localStorage.getItem('ldm-parking.live-history.v1') ?? '');
  check('simulation events never persisted', !stored.includes('"source":"simulation"'));

  // Mobile layout.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mobile.addInitScript({ content: readFileSync(join(here, 'fakeArduino.js'), 'utf8') });
  const m = await mobile.newPage();
  await m.goto(url);
  await m.waitForSelector('.hero');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal scroll at 390 px', overflow <= 0, `overflow ${overflow}px`);
  await m.screenshot({ path: join(out, '14-mobile-overview.png'), fullPage: true });
  await m.goto(`${url}#/lab`);
  await m.waitForSelector('.schematic');
  const overflowLab = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('lab page fits at 390 px', overflowLab <= 0, `overflow ${overflowLab}px`);
  await m.screenshot({ path: join(out, '15-mobile-lab.png'), fullPage: true });

  const relevant = errors.filter((e) => !/GPU stall|WebGL|swiftshader|Automatic fallback/i.test(e));
  check('no page errors', relevant.length === 0, relevant.slice(0, 3).join(' | '));

  await browser.close();
  stop();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  stop();
  process.exit(1);
});
