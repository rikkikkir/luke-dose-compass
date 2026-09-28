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
    await expect(page.getByText('retching without bringing anything up')).toBeVisible();
    await expect(page.getByText('Draft, not yet vet-reviewed')).toBeVisible();
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
  // 320 mg a day is 4 tablets. A fifth and sixth pass the label.
  for (let i = 0; i < 3; i++) await page.locator('[data-give="furosemide"]').click();
  await expect(page.locator('#toast')).toContainText('the label says 320');
  // Reported, not refused: the entries are all there.
  await expect(page.locator('.entry')).toHaveCount(3);
});

test('undo removes a dose from the count but keeps the record', async ({ page }) => {
  await page.goto('/index.html#log');
  await page.locator('[data-give="opioid"]').click();
  await expect(page.locator('.entry')).toHaveCount(1);

  await page.locator('.entry .x').first().click();
  await expect(page.locator('#toast')).toContainText('kept in the record');
  await expect(page.locator('.entry')).toHaveCount(0);
});

test('a wake round logs in one tap and one confirm', async ({ page }) => {
  await page.goto('/index.html#log');
  await page.locator('[data-round="wake"]').click();          // tap
  await page.locator('#sheet-ok').click();                    // confirm
  // Furosemide is the drug set for the wake round in the seed.
  await expect(page.locator('.entry')).toContainText('Furosemide given');
});

test('naming a drug sticks, and the app stops calling it a placeholder', async ({ page }) => {
  await page.goto('/index.html#drugs');
  await page.fill('[data-drug="opioid"][data-field="name"]', 'Tramadol');
  await page.fill('[data-drug="opioid"][data-field="strengthMg"]', '50');
  await page.click('#drugs-save');
  await expect(page.locator('#drugs-msg')).toContainText('Saved');

  await page.reload();
  await page.goto('/index.html#drugs');
  await expect(page.locator('[data-drug="opioid"][data-field="name"]')).toHaveValue('Tramadol');

  // A dose logged now should carry the real strength through to Now.
  await page.goto('/index.html#log');
  await page.locator('[data-give="opioid"]').click();
  await page.goto('/index.html#now');
  await expect(page.locator('#now')).toContainText('Tramadol');
  await expect(page.locator('#now')).toContainText('100 mg');
});

test('an empty box means unknown, not zero', async ({ page }) => {
  // The whole point of "reality, not fiction": clearing a number must leave
  // the app saying it does not know, never treating the gap as a limit of 0.
  await page.goto('/index.html#drugs');
  await page.fill('[data-drug="furosemide"][data-field="maxPer24hMg"]', '');
  await page.click('#drugs-save');
  await expect(page.locator('#drugs-msg')).toContainText('Saved');

  await page.goto('/index.html#log');
  for (let i = 0; i < 4; i++) await page.locator('[data-give="furosemide"]').click();
  // No ceiling is known any more, so there is nothing to warn about.
  await expect(page.locator('#toast')).not.toContainText('the label says');
  await expect(page.locator('.entry')).toHaveCount(4);
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
  expect(text).toContain('still a placeholder');
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
  await expect(page.locator('#sync-msg')).not.toHaveText('', { timeout: 15000 });
  // Still offering setup, because a key that failed its check is discarded.
  await page.reload();
  await page.goto('/index.html#log');
  await expect(page.locator('#synckey')).toBeVisible();
});
