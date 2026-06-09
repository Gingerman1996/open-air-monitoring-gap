/**
 * Drive the app in Chrome (Playwright) for the build→verify→fix loop.
 *
 *   node scripts/chrome-debug.mjs [url] [--wait ms] [--shot name] [--click-country Name]
 *
 * Loads the page, captures console errors / uncaught exceptions / failed requests,
 * optionally clicks a country to exercise the info panel, writes a screenshot to
 * debug-artifacts/, prints a PASS/FAIL summary, and exits non-zero on any error.
 * Uses the system Google Chrome (channel: 'chrome') — no Chromium download needed.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000';
const opt = (flag, def) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const waitMs = Number(opt('--wait', '4000'));
const shot = opt('--shot', 'dashboard');
const clickCountry = opt('--click-country', '');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'debug-artifacts');
mkdirSync(outDir, { recursive: true });

const consoleErrors = [];
const pageErrors = [];
const failedReqs = [];

const browser = await chromium
  .launch({ channel: 'chrome', headless: true })
  .catch(() => chromium.launch({ headless: true }));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('requestfailed', (r) => {
  const u = r.url();
  if (u.includes('favicon')) return;
  failedReqs.push(`${u} — ${r.failure()?.errorText ?? 'failed'}`);
});

let navOk = true;
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(waitMs);
} catch (e) {
  navOk = false;
  pageErrors.push(`navigation: ${e.message}`);
}

// optional: click a country polygon to open the info panel
let panelText = '';
if (clickCountry) {
  try {
    const path = page.locator('#map path').first();
    await path.waitFor({ timeout: 5000 });
    // click roughly the centre of the largest visible path as a generic "hit a country"
    await page.locator('#map path').nth(20).click({ timeout: 5000, force: true });
    await page.waitForTimeout(800);
    panelText = (await page.locator('.panel.info.show .ibody').innerText().catch(() => '')) || '';
  } catch (e) {
    pageErrors.push(`click-country: ${e.message}`);
  }
}

const shotPath = resolve(outDir, `${shot}.png`);
await page.screenshot({ path: shotPath });

// quick DOM probes
const probe = await page.evaluate(() => ({
  tiles: document.querySelectorAll('.leaflet-tile').length,
  countryPaths: document.querySelectorAll('#map path').length,
  pins: document.querySelectorAll('.pm-pin, .pm-cluster').length,
  pill: document.querySelector('.countpill')?.textContent?.trim() ?? '',
  title: document.title,
}));

await browser.close();

const errors = [...consoleErrors, ...pageErrors, ...failedReqs];
const pass = navOk && errors.length === 0 && probe.countryPaths > 0;

console.log('\n=== chrome-debug ===');
console.log('url           :', url);
console.log('title         :', probe.title);
console.log('leaflet tiles :', probe.tiles);
console.log('country paths :', probe.countryPaths);
console.log('monitor pins  :', probe.pins);
console.log('count pill    :', probe.pill);
if (clickCountry) console.log('panel text    :', panelText.replace(/\s+/g, ' ').slice(0, 160));
console.log('screenshot    :', shotPath);
console.log('console errors:', consoleErrors.length);
console.log('page errors   :', pageErrors.length);
console.log('failed reqs   :', failedReqs.length);
if (errors.length) {
  console.log('\n--- errors ---');
  for (const e of errors) console.log(' •', e);
}
console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'}\n`);
process.exit(pass ? 0 : 1);
