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
