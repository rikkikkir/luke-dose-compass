/* Guards against the three ways this app can silently brick itself.
   Run with: node --test */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(root, name), 'utf8');

const html = read('index.html');
const sw = read('sw.js');
const contacts = JSON.parse(read('contacts.json'));

test('the version in index.html matches the version in sw.js', () => {
  // If these drift, a deploy either never reaches the phone or reports the
  // wrong version when Rikki tells us what she is running.
  const inHtml = html.match(/name="app-version"\s+content="([^"]+)"/)?.[1];
  const inSw = sw.match(/const VERSION = '([^']+)'/)?.[1];
  assert.ok(inHtml, 'index.html has no app-version meta tag');
  assert.ok(inSw, 'sw.js has no VERSION constant');
  assert.equal(inHtml, inSw);

  const inFooter = html.match(/id="version">v([0-9.\-]+)/)?.[1];
  assert.equal(inFooter, inSw, 'the footer shows a different version');
});

test('every file in the service worker precache list exists', () => {
  // A file added and not listed works online and fails offline — and offline
  // is the only case that matters for this app.
  const list = sw.match(/const SHELL = \[([\s\S]*?)\];/)?.[1] ?? '';
  const paths = [...list.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
  assert.ok(paths.length >= 8, 'precache list looks too short');
  for (const path of paths) {
    assert.ok(existsSync(join(root, path)), `precached but missing on disk: ${path}`);
  }
});

test("the emergency number baked into sw.js matches Bridger's real number", () => {
  // sw.js carries a second copy of this number as its last resort when both
  // the cache and the network are gone. Two copies of a life-safety number is
  // a risk; this test is the mitigation.
  const bridger = contacts.primary.find((c) => c.id === 'bridger');
  assert.ok(bridger, 'contacts.json has no bridger entry');
  assert.ok(
    sw.includes(`tel:${bridger.tel}`),
    `sw.js fallback does not carry ${bridger.tel}`
  );
  assert.ok(
    html.includes(`tel:${bridger.tel}`),
    `index.html does not carry ${bridger.tel}`
  );
});

test('every phone number in contacts.json is a valid E.164 US number', () => {
  // The iOS dialer is most reliable with the +1 form.
  for (const entry of [...contacts.primary, ...contacts.unconfirmed]) {
    assert.match(entry.tel, /^\+1\d{10}$/, `${entry.name}: ${entry.tel}`);
  }
});

test('index.html renders the card without JavaScript', () => {
  // The single most important resilience property: a broken app.js must
  // degrade to a fully working static card, never a blank screen.
  for (const entry of contacts.primary) {
    assert.ok(html.includes(entry.phone), `${entry.phone} is not in the markup`);
  }
  assert.ok(html.includes('Urgent signs'), 'urgent signs are not in the markup');
  assert.ok(html.includes('Draft, not yet vet-reviewed'), 'the draft banner is missing (VQ-15)');
});
