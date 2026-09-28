/* Luke's Dose Compass — service worker.

   Lives at the repository root so the scope is /luke-dose-compass/.
   Do not move this file into a folder: the scope would shrink to that folder
   and the app would stop working offline.

   Every path below is './'-relative, so it resolves against this script's own
   URL. The same file therefore works on GitHub Pages and on localhost.

   The governing idea is to split assets by VOLATILITY, not by file type:
     - the shell rarely changes and must paint instantly  -> cache-first
     - contacts.json carries facts that could be fatally
       wrong and must be correctable                      -> network-first
   That is what makes a corrected phone number reach the phone without
   depending on the service-worker lifecycle firing correctly. */

const VERSION = '2026-09-28.2';          // bump on EVERY deploy
const CACHE   = `luke-crisis-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './contacts.json',
  './regimen.json',
  './config.defaults.json',
  './store.js',
  './views.js',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

const INDEX_URL = new URL('./index.html', self.location).href;
const DATA_URLS = new Set([
  new URL('./contacts.json', self.location).href,
  new URL('./regimen.json', self.location).href,
]);
const DATA_TIMEOUT_MS = 2000;

/* ---------- install: fill the new cache, touch nothing old ---------- */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    // cache: 'reload' bypasses the browser HTTP cache. GitHub Pages sends
    // Cache-Control: max-age=600, so a plain fetch can precache a file that is
    // ten minutes stale — including a phone number that was just corrected.
    const entries = await Promise.all(SHELL.map(async (path) => {
      const url = new URL(path, self.location).href;
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) throw new Error(`precache failed: ${url} -> ${response.status}`);
      if (response.redirected) {
        // A redirected response cannot be replayed for a navigation request.
        return [url, new Response(await response.blob(), {
          status: 200,
          headers: { 'Content-Type': response.headers.get('Content-Type') || '' },
        })];
      }
      return [url, response];
    }));

    // Write only after every file arrived. A half-filled cache never exists.
    await Promise.all(entries.map(([url, response]) => cache.put(url, response)));

    // If anything above threw, this line is never reached, this worker is
    // discarded, and the previous worker and cache keep serving. That property
    // is what makes a failed deploy harmless rather than catastrophic.
    await self.skipWaiting();
  })());
});

/* ---------- activate: the ONLY place old caches are deleted ---------- */

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('luke-crisis-') && name !== CACHE)
        .map((name) => caches.delete(name))
    );

    await self.clients.claim();

    for (const client of await self.clients.matchAll({ type: 'window' })) {
      client.postMessage({ type: 'sw-activated', version: VERSION });
    }
  })());
});

/* ---------- fetch ---------- */

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // --- the guard ---
  // Returning WITHOUT calling respondWith hands the request back to the browser
  // untouched. tel:, mailto:, sms:, facetime:, blob:, data: and every
  // cross-origin or non-GET request leave here. Passing them through with
  // respondWith(fetch(request)) is NOT equivalent and breaks the dialer path.
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  if (url.origin !== self.location.origin) return;

  // respondWith must be called synchronously — never after an await.
  if (request.mode === 'navigate') { event.respondWith(handleNavigate()); return; }
  if (DATA_URLS.has(url.href))     { event.respondWith(handleData(event, url.href)); return; }
  event.respondWith(handleShell(request));
});

/* Any in-scope navigation gets the precached index, whatever the query or hash.
   This neutralises start_url drift: added to the Home Screen from './',
   './index.html' or './?x=1' all land on the same cached document. */
async function handleNavigate() {
  const cached = await caches.match(INDEX_URL, { cacheName: CACHE });
  if (cached) return cached;
  try {
    return await fetch(INDEX_URL, { cache: 'reload' });
  } catch {
    // Cache gone AND network gone. The worker script is stored separately from
    // Cache Storage, so this last resort can still speak. The number below is a
    // second copy of Bridger's — tests/version.test.js asserts the two agree.
    return new Response(
      '<!doctype html><html lang="en"><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Luke — emergency</title>' +
      '<body style="font:18px/1.6 -apple-system,system-ui,sans-serif;padding:2rem;' +
      'background:#14191B;color:#E6ECEE">' +
      '<p>The crisis card could not load.</p>' +
      '<p>Bridger Veterinary Specialists &amp; Emergency, open 24 hours:</p>' +
      '<p><a style="color:#8CC0D6;font-size:30px;font-weight:600" ' +
      'href="tel:+14065484226">(406) 548-4226</a></p></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

/* Shell: cache-first, no revalidation. The precache list is the contract;
   a miss is a bug the offline test should catch. */
async function handleShell(request) {
  const cached = await caches.match(request, { cacheName: CACHE });
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

/* contacts.json: network-first, hard timeout, cache fallback.
   This is the path a corrected phone number travels. The 2-second abort means
   a dead or captive network costs nothing, because the static card is already
   on screen. */
async function handleData(event, dataUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DATA_TIMEOUT_MS);
  try {
    const response = await fetch(dataUrl, { cache: 'reload', signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw new Error(String(response.status));

    // waitUntil, or the worker may be killed before the write lands.
    const copy = response.clone();
    event.waitUntil(caches.open(CACHE).then((cache) => cache.put(dataUrl, copy)));
    return response;
  } catch {
    clearTimeout(timer);
    const cached = await caches.match(dataUrl, { cacheName: CACHE });
    if (cached) return cached;
    // The page keeps the numbers already rendered in its markup.
    return new Response('{}', {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
}

self.addEventListener('message', (event) => {
  if (event.data === 'version' && event.source) {
    event.source.postMessage({ type: 'sw-version', version: VERSION });
  }
});
