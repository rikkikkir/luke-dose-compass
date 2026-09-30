/* Screenshots of every screen, at her phone's size, in both themes and both
   engines. CLAUDE.md: look before claiming done. Written as a script rather
   than a test so it never runs as part of the suite.

     node tools/screens.mjs            # the screens that usually change
     node tools/screens.mjs all        # every screen

   Output lands in screenshots/, which git ignores. */
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';

const PORT = 8123;
const CORE = ['capture', 'now', 'circles'];
const ALL = ['home', 'now', 'capture', 'circles', 'body', 'vet', 'helper', 'understand', 'crisis'];
const screens = process.argv[2] === 'all' ? ALL : CORE;

// Some screens are only worth seeing with something in the log.
const SEED = [
  { id: 's-wake', seq: 1, type: 'wake', hoursAgo: 6 },
  { id: 's-dose', seq: 2, type: 'dose', drugKey: 'furosemide', tablets: 1, hoursAgo: 5 },
  { id: 's-meal', seq: 3, type: 'meal', value: 'all', hoursAgo: 5 },
  { id: 's-note', seq: 4, type: 'note', text: 'Slower getting up tonight.', hoursAgo: 2 },
];

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
await rm('screenshots', { recursive: true, force: true });
await mkdir('screenshots', { recursive: true });

const problems = [];
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    for (const theme of ['light', 'dark']) {
      const browser = await engine.launch();
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        colorScheme: theme,
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${name}/${theme}: page error — ${e.message}`));
      await page.goto(`http://127.0.0.1:${PORT}/index.html`);
      await page.evaluate((seed) => {
        const now = Date.now();
        // Storage is one JSON array. NDJSON is the export format, not this.
        const rows = seed.map((s) => {
          const { hoursAgo, ...rest } = s;
          const at = now - hoursAgo * 3600000;
          const off = -new Date(at).getTimezoneOffset();
          return { ...rest, atUTC: at, atOffset: off, loggedUTC: at, loggedOffset: off, source: 'Rikki' };
        });
        localStorage.setItem('luke.events.v1', JSON.stringify(rows));
      }, SEED);

      for (const s of screens) {
        await page.goto(`http://127.0.0.1:${PORT}/index.html#${s}`);
        await page.waitForTimeout(500);
        const file = `screenshots/${s}-${theme}-${name}.png`;
        await page.screenshot({ path: file, fullPage: true });
        // Anything running off the side is clipped text she cannot read.
        const overflow = await page.evaluate(() => {
          const w = document.documentElement.clientWidth;
          return [...document.querySelectorAll('body *')]
            .filter((el) => el.getBoundingClientRect().right > w + 1)
            .slice(0, 5)
            .map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''));
        });
        if (overflow.length) problems.push(`${file}: runs past the right edge — ${overflow.join(', ')}`);
        if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) {
          problems.push(`${file}: the page scrolls sideways`);
        }
      }
      await browser.close();
    }
  }
} finally {
  server.kill();
}

console.log(`${screens.length * 4} screenshots in screenshots/`);
if (problems.length) { console.log('\nPROBLEMS:'); problems.forEach((p) => console.log('  ' + p)); process.exit(1); }
console.log('No clipped text, no sideways scroll, no page errors.');
