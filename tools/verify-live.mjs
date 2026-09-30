/* Checks the LIVE site, not a local copy. A version number going up proves a
   deploy happened, not that anything works — this drives the real paths.

     node tools/verify-live.mjs [url]

   Exits non-zero on any failure. Touches nothing and stores nothing that
   outlives the browser it opens. */
import { chromium, webkit } from 'playwright';

const BASE = process.argv[2] || 'https://rikkikkir.github.io/luke-dose-compass/';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==';

const fails = [];
const ok = [];
const check = (name, cond, detail = '') =>
  (cond ? ok : fails).push(`${name}${detail ? ' — ' + detail : ''}`);

for (const [engine, launcher] of [['webkit', webkit], ['chromium', chromium]]) {
  const browser = await launcher.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const errors = [];
  ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
  const page = await ctx.newPage();

  // 1. The crisis card must render with no JavaScript at all.
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const bare = await noJs.newPage();
  await bare.goto(BASE, { waitUntil: 'domcontentloaded' });
  const bareText = await bare.locator('body').innerText();
  check(`${engine}: crisis card with JavaScript off`, bareText.includes('548-4226'));
  check(`${engine}: emergency number dials`, (await bare.locator('a[href="tel:+14065484226"]').count()) > 0);
  await noJs.close();

  // 2. The app boots.
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  check(`${engine}: version is 2026-09-29.9`,
    (await page.locator('#version').innerText()).includes('2026-09-29.9'));
  check(`${engine}: no sideways scroll at 390px`,
    !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)));

  // 3. Recordings and photos survive storage. This is the fix that shipped.
  const round = await page.evaluate(async (base) => {
    const { putAudio, getAudio } = await import(new URL('audio.js', base).href);
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    await putAudio('live-probe', new Blob([bytes], { type: 'audio/webm' }));
    const back = await getAudio('live-probe');
    return { isBlob: back instanceof Blob, type: back && back.type,
             same: back ? [...new Uint8Array(await back.arrayBuffer())].join(',') : null };
  }, BASE);
  check(`${engine}: a recording survives storage`,
    round.isBlob && round.type === 'audio/webm' && round.same === '0,1,2,253,254,255',
    JSON.stringify(round));

  // 4. A photo, through the button she actually taps.
  await page.goto(BASE + '#capture', { waitUntil: 'load' });
  await page.locator('#photo-open').waitFor({ state: 'visible', timeout: 15000 });
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#photo-open').click();
  await (await chooser).setFiles({ name: 'luke.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
  await page.waitForTimeout(1500);
  check(`${engine}: a photo saves`, (await page.locator('#toast').innerText()).includes('Photo saved'));
  check(`${engine}: the photo appears in the log`, (await page.locator('[data-photo]').count()) === 1);
  await page.locator('[data-photo]').first().click();
  await page.waitForTimeout(800);
  check(`${engine}: the photo reopens`, await page.locator('.photo-view').isVisible());

  // 5. The quality-of-life check-in, and the sentence that must never be small.
  await page.locator('#qol-open').click();
  await page.waitForTimeout(400);
  const note = page.locator('.qol-note');
  check(`${engine}: quality-of-life check-in opens`, (await note.count()) > 0);
  if (await note.count()) {
    check(`${engine}: "never tell you it is time" is present`,
      (await note.innerText()).toLowerCase().includes('never tell you it is time'));
    check(`${engine}: that sentence is not uppercase micro-text`,
      await note.evaluate((el) => {
        const s = getComputedStyle(el);
        return s.textTransform !== 'uppercase' && parseFloat(s.fontSize) >= 12;
      }));
  }

  // 6. No file picker leaking onto the page.
  check(`${engine}: no stray "Choose File" control`,
    await page.evaluate(() => [...document.querySelectorAll('input[type=file]')]
      .every((i) => getComputedStyle(i).display === 'none')));

  check(`${engine}: no page errors`, errors.length === 0, errors.join(' | '));
  await browser.close();
}

// 7. Offline, in Chromium only: WebKit's setOffline does not work in Playwright.
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(2500);                 // let the shell precache
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  const offline = await page.locator('body').innerText();
  check('chromium: the app opens with no signal', offline.includes('Luke'));
  // S8 says one tap from any screen, not that the number sits on the home
  // screen. So tap through, the way she would, still offline.
  check('chromium: the crisis card is one tap away with no signal',
    (await page.locator('a[href="#crisis"]').count()) > 0);
  await page.locator('a[href="#crisis"]').first().click();
  await page.waitForTimeout(900);
  const crisis = await page.locator('body').innerText();
  check('chromium: the crisis number is there with no signal', crisis.includes('548-4226'));
  check('chromium: it still dials with no signal',
    (await page.locator('a[href="tel:+14065484226"]').count()) > 0);
  await ctx.setOffline(false);
  await browser.close();
}

console.log(`\nChecked ${BASE}\n`);
ok.forEach((o) => console.log('  PASS  ' + o));
if (fails.length) {
  console.log('');
  fails.forEach((f) => console.log('  FAIL  ' + f));
  console.log(`\n${fails.length} failed, ${ok.length} passed.`);
  process.exit(1);
}
console.log(`\nAll ${ok.length} passed against the live site.`);
