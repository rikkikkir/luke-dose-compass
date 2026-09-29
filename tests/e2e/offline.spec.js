import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* Playwright's WebKit build throws "WebKit encountered an internal error" on any
   navigation once context.setOffline(true) is set, so that API cannot test the
   engine that matters. Killing a real server is both a workaround and a truer
   test: it is what airplane mode looks like to the browser. */

function freePort() {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function serve() {
  const port = await freePort();
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: ROOT, stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1000));
  return { port, stop: () => { try { proc.kill('SIGKILL'); } catch {} } };
}

test('the crisis card survives the network going away entirely', async ({ page }) => {
  const server = await serve();
  try {
    await page.goto(`http://127.0.0.1:${server.port}/index.html`);

    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15000 });
    await page.waitForTimeout(1200);   // let the precache finish writing

    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = await caches.open(names[0]);
      return (await cache.keys()).map((r) => new URL(r.url).pathname);
    });
    expect(cached).toContain('/index.html');
    expect(cached).toContain('/app.css');
    expect(cached).toContain('/contacts.json');

    // --- the real cut ---
    server.stop();
    await new Promise((r) => setTimeout(r, 600));

    await page.goto(`http://127.0.0.1:${server.port}/index.html#crisis`);

    const bridger = page.locator('a.tel[href="tel:+14065484226"]');
    await expect(bridger).toBeVisible();
    await expect(bridger).toHaveText('(406) 548-4226');
    await expect(page.locator('#crisis').getByText('retching without bringing anything up')).toBeVisible();
    await expect(page.locator('#crisis').getByText('Draft, not yet vet-reviewed')).toBeVisible();
    await expect(page.locator('#crisis')).toBeVisible();
  } finally {
    server.stop();
  }
});

test('the card renders with JavaScript disabled', async ({ browser }) => {
  // A broken app.js must degrade to a working static card, never a blank screen.
  const server = await serve();
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.port}/index.html`);
    await expect(page.locator('a.tel[href="tel:+14065484226"]')).toHaveText('(406) 548-4226');
    await expect(page.getByText('Urgent signs, even in comfort care')).toBeAttached();
  } finally {
    await context.close();
    server.stop();
  }
});

test('the home screen offers one tap to the crisis card', async ({ page }) => {
  await page.goto('/index.html');
  const card = page.locator('a.bigbtn[href="#crisis"]');
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('#crisis')).toBeVisible();
  await expect(page.locator('#home')).toBeHidden();
});

test('a dose is logged, shows up on Now, and survives a reload', async ({ page }) => {
  await page.goto('/index.html#log');
  await page.locator('[data-give="furosemide"]').click();

  // The toast confirms only after the write was read back (never optimistic).
  await expect(page.locator('#toast')).toContainText('Furosemide logged');
  await expect(page.locator('.entry')).toContainText('Furosemide given');

  await page.goto('/index.html#now');
  await expect(page.locator('#now')).toContainText('Last given');
  await expect(page.locator('#now')).toContainText('Likely');   // the sourced window

  await page.reload();
  await page.goto('/index.html#now');
  await expect(page.locator('#now')).toContainText('Last given');
});

test('a dose past the label is reported and still logged', async ({ page }) => {
  await page.goto('/index.html#log');
  // Tramadol's label says 2 a day. A third passes it.
  for (let i = 0; i < 3; i++) await page.locator('[data-give="tramadol"]').click();
  await expect(page.locator('#toast')).toContainText('the label says 2');
  // Reported, not refused.
  await expect(page.locator('.entry')).toHaveCount(3);
});

test('undo removes a dose from the count but keeps the record', async ({ page }) => {
  await page.goto('/index.html#log');
  await page.locator('[data-give="tramadol"]').click();
  await expect(page.locator('.entry')).toHaveCount(1);

  await page.locator('.entry .x').first().click();
  await expect(page.locator('#toast')).toContainText('kept in the record');
  await expect(page.locator('.entry')).toHaveCount(0);
});

test('a wake round logs in one tap and one confirm', async ({ page }) => {
  await page.goto('/index.html#log');
  await page.locator('[data-round="wake"]').click();          // tap
  await page.locator('#sheet-ok').click();                    // confirm
  // Seven drugs sit in his wake round.
  await expect(page.locator('.entry')).toHaveCount(7);
  await expect(page.locator('.entry', { hasText: 'Furosemide given' })).toHaveCount(1);
});

test('renaming a drug sticks and reaches the Now screen', async ({ page }) => {
  await page.goto('/index.html#drugs');
  await page.fill('[data-drug="tramadol"][data-field="name"]', 'Tramadol HCl');
  await page.click('#drugs-save');
  await expect(page.locator('#toast')).toContainText('Saved');

  await page.reload();
  await page.goto('/index.html#drugs');
  await expect(page.locator('[data-drug="tramadol"][data-field="name"]')).toHaveValue('Tramadol HCl');

  await page.goto('/index.html#log');
  await page.locator('[data-give="tramadol"]').click();
  await page.goto('/index.html#now');
  await expect(page.locator('#now')).toContainText('Tramadol HCl');
  await expect(page.locator('#now')).toContainText('50 mg');
});

test('an empty box means unknown, not zero', async ({ page }) => {
  // The whole point of "reality, not fiction": clearing a number must leave the
  // app saying it does not know, never treating the gap as a limit of zero.
  await page.goto('/index.html#drugs');
  await page.fill('[data-drug="furosemide"][data-field="maxPer24hMg"]', '240');
  await page.click('#drugs-save');
  await expect(page.locator('#toast')).toContainText('Saved');

  await page.goto('/index.html#log');
  await page.locator('[data-give="furosemide"]').click();   // 3 x 40 = 120 mg
  await page.locator('[data-give="furosemide"]').click();   // 240 mg
  await page.locator('[data-give="furosemide"]').click();   // 360 mg, over
  await expect(page.locator('#toast')).toContainText('the label says 240');

  // Now clear it. No ceiling known means nothing to be over.
  await page.goto('/index.html#drugs');
  await page.fill('[data-drug="furosemide"][data-field="maxPer24hMg"]', '');
  await page.click('#drugs-save');
  await page.goto('/index.html#log');
  await page.locator('[data-give="furosemide"]').click();
  await expect(page.locator('#toast')).not.toContainText('the label says');
});

test('the seven-day text names what is still unknown', async ({ page }) => {
  await page.goto('/index.html#log');
  await page.locator('[data-give="furosemide"]').click();
  const text = await page.evaluate(async () => {
    const st = await import('./store.js');
    const seed = await (await fetch('./regimen.json')).json();
    return st.asText(st.readEvents(), st.mergeRegimen(seed, st.readLocalRegimen()), { days: 7 });
  });
  expect(text).toContain('no minimum gap has been set by a vet');
  expect(text).toContain('source: Rikki');
  expect(text).toContain('Furosemide');
  expect(text).toContain('does not block doses');
});

test('the sync setup is actually reachable', async ({ page }) => {
  // This test exists because sync once shipped with the card defined and never
  // rendered. A feature nobody can switch on is a feature that does not exist.
  await page.goto('/index.html#log');
  await expect(page.locator('#synckey')).toBeVisible();
  await expect(page.locator('#sync-save')).toBeVisible();
  await expect(page.locator('#copy7')).toBeVisible();
});

test('a key that cannot be verified is not kept', async ({ page }) => {
  await page.goto('/index.html#log');
  await page.fill('#synckey', 'github_pat_obviously_not_a_real_key');
  await page.click('#sync-save');
  await expect(page.locator('#toast')).not.toHaveText('', { timeout: 15000 });
  // Still offering setup, because a key that failed its check is discarded.
  await page.reload();
  await page.goto('/index.html#log');
  await expect(page.locator('#synckey')).toBeVisible();
});

test('his body shows what is acting where, with certainty on the face of it', async ({ page }) => {
  await page.goto('/index.html#log');
  await page.locator('[data-give="furosemide"]').click();
  await page.locator('[data-give="tramadol"]').click();

  await page.goto('/index.html#body');
  await expect(page.locator('#body .interp')).toContainText('Interpretation, not measurement');

  // Furosemide acts on water, tramadol on joints and alertness.
  const water = page.locator('.sys', { hasText: 'Kidneys and water' });
  await expect(water).toContainText('Furosemide');
  await expect(water).toContainText('From published pharmacology');

  const joints = page.locator('.sys', { hasText: 'Hips and hind legs' });
  await expect(joints).toContainText('Tramadol');

  // And it admits what it is not.
  await expect(page.locator('#body')).toContainText('not a complete interaction check');
});

test('a system with nothing acting on it says so', async ({ page }) => {
  await page.goto('/index.html#body');
  await expect(page.locator('.sys-quiet').first()).toContainText('Nothing logged that acts here');
});

test('the body view never claims to measure or to advise', async ({ page }) => {
  await page.goto('/index.html#body');
  await expect(page.locator('#body .interp')).toBeVisible();   // regimen has loaded
  const text = await page.locator('#body').innerText();
  expect(text).toContain('Interpretation, not measurement');
  expect(text).toContain('never diagnoses and never recommends a dose');
});

test('the capture screen offers voice and buttons, and the buttons always work', async ({ page }) => {
  await page.goto('/index.html#capture');
  const cap = page.locator('#capture-body');
  // Either a microphone or an honest statement that this browser cannot record.
  await expect(cap.locator('.mic, .unknown').first()).toBeVisible();
  await expect(cap.locator('.quick-adds [data-obs]')).toHaveCount(6);

  await page.locator('[data-obs="meal"][data-val="half"]').click();
  await expect(cap).toContainText('Ate: half');
  await page.locator('[data-obs="out"][data-val="stool"]').click();
  await expect(cap).toContainText('Stool');
});

test('food and water reach the log and survive a reload', async ({ page }) => {
  await page.goto('/index.html#capture');
  await page.locator('[data-obs="water"][data-val="some"]').click();
  await expect(page.locator('#capture-body')).toContainText('Drank');
  await page.reload();
  await page.goto('/index.html#capture');
  await expect(page.locator('#capture-body')).toContainText('Drank');
});

test('a log file can be brought in, and importing it twice adds nothing', async ({ page }) => {
  const line = (id, type, at) => JSON.stringify({ id, seq: 1, type, atUTC: at, atOffset: -360, loggedUTC: at, loggedOffset: -360, source: 'oura' });
  const now = Date.now();
  const file = {
    name: 'luke.oura.export.ndjson',
    mimeType: 'application/x-ndjson',
    buffer: Buffer.from([line('oura-wake-x', 'wake', now - 5 * 3600000), line('oura-sleep-x', 'sleep', now - 14 * 3600000)].join('\n')),
  };

  await page.goto('/index.html#capture');
  await page.locator('#import-details summary').click();
  await page.locator('#import-file').setInputFiles(file);
  await expect(page.locator('#toast')).toContainText('Added 2');

  // Stable ids mean a second import is a no-op, not a duplicate.
  await page.locator('#import-file').setInputFiles(file);
  await expect(page.locator('#toast')).toContainText('Added 0');
  await expect(page.locator('#toast')).toContainText('Already had 2');
});

test('an imported wake makes the Now screen count from it', async ({ page }) => {
  const now = Date.now();
  await page.goto('/index.html#capture');
  await page.locator('#import-details summary').click();
  await page.locator('#import-file').setInputFiles({
    name: 'w.ndjson', mimeType: 'application/x-ndjson',
    buffer: Buffer.from(JSON.stringify({ id: 'oura-wake-y', seq: 1, type: 'wake', atUTC: now - 5 * 3600000, atOffset: -360, loggedUTC: now - 5 * 3600000, loggedOffset: -360, source: 'oura' })),
  });
  await expect(page.locator('#toast')).toContainText('Added 1');
  await page.goto('/index.html#now');
  await expect(page.locator('#now')).toContainText('Awake 5h');
});

test('the circles draw time in 25.4-hour chunks, and refuse a shape too early', async ({ page }) => {
  await page.goto('/index.html#circles');
  await expect(page.locator('#circles .interp')).toContainText('25.4-hour circles');
  await expect(page.locator('#circles-body svg')).toBeVisible();
  await expect(page.locator('.circle-row')).toHaveCount(8);
  // With an empty log it must not imply a trend.
  await expect(page.locator('#circles-body')).toContainText('draws no shape');
});

test('a dose lands in the right circle', async ({ page }) => {
  await page.goto('/index.html#log');
  await page.locator('[data-mark="wake"]').click();
  await page.locator('[data-give="furosemide"]').click();
  await page.goto('/index.html#circles');
  const current = page.locator('.circle-row.current');
  await expect(current).toContainText('1 dose');
  await expect(current.locator('.tick.dose')).toHaveCount(1);
});

test('an empty circle says nothing was logged, not zero of everything', async ({ page }) => {
  await page.goto('/index.html#circles');
  await expect(page.locator('.circle-row').first()).toContainText('nothing logged');
});

test('the vet document explains what the app refuses to claim', async ({ page }) => {
  await page.goto('/index.html#vet');
  const doc = page.locator('#vet .vetdoc');
  await expect(doc).toBeVisible();
  await expect(doc).toContainText('not a medical device');
  await expect(doc).toContainText('What the app refuses to estimate');
  await expect(doc).toContainText('No minimum gap is enforced');
  // It must say plainly that it does not predict her cycle.
  await expect(doc).toContainText('deliberately does not do');
  // And it must carry sources, because a vet will check them.
  await expect(doc).toContainText('Merck Veterinary Manual');
  // Rendered as a document, not as raw markup.
  await expect(doc.locator('h3').first()).toBeVisible();
  expect(await doc.innerText()).not.toContain('**');
});

test('the vet document carries what actually happened', async ({ page }) => {
  await page.goto('/index.html#log');
  await page.locator('[data-give="tramadol"]').click();
  await page.goto('/index.html#capture');
  await page.locator('[data-obs="meal"][data-val="half"]').click();
  await page.goto('/index.html#vet');
  await expect(page.locator('#vet .vetdoc')).toContainText('Tramadol');
  await expect(page.locator('#vet .vetdoc')).toContainText('ate: half');
});

test('what is still working in him shows after a dose, and never as a schedule', async ({ page }) => {
  await page.goto('/index.html#log');
  await page.locator('[data-give="furosemide"]').click();
  await page.goto('/index.html#body');
  const block = page.locator('.sys', { hasText: 'What is still working in him' });
  await expect(block).toContainText('Furosemide');
  await expect(block).toContainText('not a schedule');
  await expect(block).toContainText('Nothing here says when to give the next one');
});

test('where he was and how he seemed reach the log', async ({ page }) => {
  await page.goto('/index.html#capture');
  await page.locator('#env-details summary').click();
  await page.locator('[data-obs="mood"][data-val="sore"]').click();
  await expect(page.locator('#capture-body')).toContainText('Seemed: sore');
  await page.locator('[data-obs="where"][data-val="the car"]').click();
  await expect(page.locator('#capture-body')).toContainText('Where: the car');
});

test('his weight can be refreshed, and a blank is refused', async ({ page }) => {
  await page.goto('/index.html#capture');
  await page.locator('#weight-details summary').click();
  await page.locator('#weight-save').click();
  await expect(page.locator('#toast')).toContainText('Type a weight');
  await page.fill('#weight-kg', '34.8');
  await page.locator('#weight-save').click();
  await expect(page.locator('#toast')).toContainText('34.8 kg');
  await expect(page.locator('#capture-body')).toContainText('Weighed 34.8 kg');
});

test('imported labs appear with their ranges, dates, and staleness', async ({ page }) => {
  const line = (key, name, value, unit, lo, hi, daysAgo) => JSON.stringify({
    id: `lab-${key}`, seq: 1, type: 'lab', labKey: key, name, value, unit,
    refLow: lo, refHigh: hi, atUTC: Date.now() - daysAgo * 86400000,
    atOffset: 0, loggedUTC: Date.now(), loggedOffset: 0, source: 'compendium',
  });
  await page.goto('/index.html#capture');
  await page.locator('#import-details summary').click();
  await page.locator('#import-file').setInputFiles({
    name: 'labs.ndjson', mimeType: 'application/x-ndjson',
    buffer: Buffer.from([
      line('crea', 'Creatinine', 2.5, 'mg/dL', 0.5, 1.5, 15),
      line('phos', 'Phosphorus', 2.9, 'mg/dL', 2.5, 6.1, 204),
      line('weight', 'Body weight', 79.1, 'lb', 78, 82, 208),
    ].join('\n')),
  });
  await expect(page.locator('#toast')).toContainText('Added 3');

  await page.goto('/index.html#body');
  const water = page.locator('.sys', { hasText: 'Kidneys and water' });
  await expect(water).toContainText('Creatinine');
  await expect(water).toContainText('above range');
  await expect(water).toContainText('0.5–1.5');
  // A six-month-old value must not be presented as current.
  await expect(water.locator('.lab.stale')).toHaveCount(1);
  await expect(water).toContainText('days old');
  // And the app must draw no conclusion from a group of values.
  await expect(water).toContainText('no conclusion drawn');
});

test('a stale weight makes every mg/kg figure say so', async ({ page }) => {
  await page.goto('/index.html#capture');
  await page.locator('#import-details summary').click();
  await page.locator('#import-file').setInputFiles({
    name: 'w.ndjson', mimeType: 'application/x-ndjson',
    buffer: Buffer.from(JSON.stringify({
      id: 'lab-weight', seq: 1, type: 'lab', labKey: 'weight', name: 'Body weight',
      value: 79.1, valueKg: 35.88, unit: 'lb', atUTC: Date.now() - 208 * 86400000,
      atOffset: 0, loggedUTC: Date.now(), loggedOffset: 0, source: 'compendium',
    })),
  });
  await page.goto('/index.html#now');
  await expect(page.locator('#now')).toContainText('mg/kg per dose');
  await expect(page.locator('#now')).toContainText('so this figure is out of date');
});

test('the quick check appears once its definitions are brought in', async ({ page }) => {
  const def = (key, label, every) => JSON.stringify({
    id: `checkdef-${key}`, seq: 1, type: 'checkdef', checkKey: key, label,
    detail: 'from her records', every, atUTC: Date.now() - 3600000, atOffset: 0,
    loggedUTC: Date.now(), loggedOffset: 0, source: 'Watch List',
  });
  await page.goto('/index.html#capture');
  await expect(page.locator('.checkrow')).toHaveCount(0);

  await page.locator('#import-details summary').click();
  await page.locator('#import-file').setInputFiles({
    name: 'checks.ndjson', mimeType: 'application/x-ndjson',
    buffer: Buffer.from([def('cheek', 'Cheek bump unchanged', 'weekly'),
                         def('breathing', 'Breathing calm at rest', 'daily')].join('\n')),
  });
  await expect(page.locator('#toast')).toContainText('Added 2');
  await expect(page.locator('.checkrow')).toHaveCount(2);

  await page.locator('[data-check="cheek"][data-cval="ok"]').click();
  await expect(page.locator('.checkrow')).toHaveCount(1);
});

test('marking a check as changed says it is worth telling the vet', async ({ page }) => {
  await page.goto('/index.html#capture');
  await page.locator('#import-details summary').click();
  await page.locator('#import-file').setInputFiles({
    name: 'c.ndjson', mimeType: 'application/x-ndjson',
    buffer: Buffer.from(JSON.stringify({
      id: 'checkdef-cheek', seq: 1, type: 'checkdef', checkKey: 'cheek',
      label: 'Cheek bump unchanged', detail: 'watch for growth or shrinking',
      every: 'weekly', atUTC: Date.now() - 3600000, atOffset: 0,
      loggedUTC: Date.now(), loggedOffset: 0, source: 'Watch List',
    })),
  });
  await page.locator('[data-check="cheek"][data-cval="changed"]').click();
  await expect(page.locator('#toast')).toContainText('Worth mentioning to his vet');
});

test('the helper page works with an empty log and never tells anyone to dose', async ({ page }) => {
  // The person who needs this page may never have opened the app, and the log
  // may be empty. It has to be useful anyway.
  await page.goto('/index.html#helper');
  const h = page.locator('.helper');
  await expect(h).toBeVisible();
  await expect(h).toContainText('Bridger');
  await expect(h).toContainText('(406) 548-4226');
  await expect(h).toContainText('Trouble breathing');
  await expect(h).toContainText('Do not give any medicine unless Rikki or a vet tells you to');
  await expect(h).toContainText('Ask Rikki what he has had before giving anything');
  // It states the goals of care, because a stranger would not know them.
  await expect(h).toContainText('no CPR and no hospitalisation');
});

test('the helper page shows what he has actually had, once something is logged', async ({ page }) => {
  await page.goto('/index.html#log');
  await page.locator('[data-give="furosemide"]').click();
  await page.goto('/index.html#helper');
  await expect(page.locator('.helper')).toContainText('Furosemide');
  await expect(page.locator('.helper')).toContainText('last at');
});

test('the Understand tab carries the guide, and says it is a draft', async ({ page }) => {
  await page.goto('/index.html#understand');
  const u = page.locator('#understand-body');
  await expect(u.locator('.draft')).toContainText('Draft, not yet vet-reviewed');
  await expect(u).toContainText('Urgent signs');
  await expect(u).toContainText('Reading lab values');
  // Rendered as a document, not raw markup.
  await expect(u.locator('article.guide h3').first()).toBeVisible();
  expect(await u.innerText()).not.toContain('##');
  // And no dangling references to files that do not exist in the app.
  expect(await u.innerText()).not.toContain('../');
});

test('a pain check records his own signs, and calls itself hers', async ({ page }) => {
  // She can start one whenever she wants — it is not only offered after a dose.
  await page.goto('/index.html#capture');
  await page.locator('#pain-open').click();

  await expect(page.locator('.painrow')).toHaveCount(6);
  await expect(page.locator('.card.pain')).toContainText('Right hind leg gives out');
  await expect(page.locator('.card.pain')).toContainText('not a clinical score');

  await page.locator('[data-pain="0"][data-pval="2"]').click();
  await page.locator('[data-pain="1"][data-pval="1"]').click();
  await page.locator('#pain-save').click();
  await expect(page.locator('#toast')).toContainText('3 of 12');
});

test('a circle can be marked good, mixed or hard', async ({ page }) => {
  await page.goto('/index.html#capture');
  await page.locator('[data-day="bad"]').click();
  await expect(page.locator('#toast')).toContainText('Marked');
  await expect(page.locator('[data-day="bad"]')).toHaveClass(/primary/);
  await page.locator('[data-day="good"]').click();
  await expect(page.locator('[data-day="good"]')).toHaveClass(/primary/);
});

test('the observed relief window is withheld, and says what it is waiting for', async ({ page }) => {
  await page.goto('/index.html#log');
  await page.locator('[data-give="tramadol"]').click();
  await page.goto('/index.html#body');
  const block = page.locator('.sys', { hasText: 'What his own checks say' });
  await expect(block).toContainText('Published window');
  await expect(block).toContainText('qualifying checks so far');
  await expect(block).toContainText('no recommendation is made from this');
});

test('night mode follows the log, not the clock', async ({ page }) => {
  await page.goto('/index.html#log');
  await expect(page.locator('body')).not.toHaveClass(/night/);
  await page.locator('[data-mark="sleep"]').click();
  await expect(page.locator('body')).toHaveClass(/night/);
  await page.locator('[data-mark="wake"]').click();
  await expect(page.locator('body')).not.toHaveClass(/night/);
});

test('a spreadsheet can be saved, and it is named so git cannot publish it', async ({ page }) => {
  await page.goto('/index.html#capture');
  await page.locator('#backup-details summary').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-csv').click(),
  ]);
  // .gitignore already carries *.export.* — the name is the safeguard.
  expect(download.suggestedFilename()).toBe('luke.export.csv');
  await expect(page.locator('#toast')).toContainText('opens in Numbers');
});
