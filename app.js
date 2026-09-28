/* Luke's Dose Compass — progressive enhancement only.

   index.html already renders the whole crisis card, with every phone number
   and every urgent sign, in plain markup. Nothing in this file is required for
   the card to work. If this script throws, the card stays exactly as served.

   Two jobs:
     1. refresh the numbers from contacts.json, which the service worker
        fetches network-first, so a correction lands without a version bump
     2. show which version is on screen, and whether a reload is due */

const SCHEMA_UNDERSTOOD = 1;

/* ---- 1. refresh the numbers, or leave the markup alone ---- */

async function refreshContacts() {
  const response = await fetch(new URL('contacts.json', document.baseURI), {
    cache: 'no-store',
  });
  if (!response.ok) return;

  const data = await response.json();

  // A newer schema than this script understands means the markup in the
  // document is the safer of the two. Leave it.
  if (typeof data.schema !== 'number' || data.schema > SCHEMA_UNDERSTOOD) return;

  const all = [...(data.primary || []), ...(data.unconfirmed || [])];
  for (const entry of all) {
    const link = document.querySelector(`a.tel[href="tel:${entry.tel}"]`);
    if (!link) continue;                       // an entry this build does not show
    if (entry.phone) link.textContent = entry.phone;

    const card = link.closest('.call');
    if (!card) continue;
    const hours = card.querySelector('.call-hours');
    if (hours && entry.hours) {
      const badge = hours.querySelector('.tick, .mark');
      hours.textContent = ' ' + entry.hours;
      if (badge) hours.prepend(badge);
    }
  }

  if (data.verifiedOn) {
    const el = document.getElementById('version');
    if (el) el.dataset.verified = data.verifiedOn;
  }
}

/* ---- 2. version line ---- */

function markupVersion() {
  const meta = document.querySelector('meta[name="app-version"]');
  return meta ? meta.content : 'unknown';
}

function askWorkerVersion() {
  const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!worker) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== 'sw-version') return;
    if (data.version === markupVersion()) return;

    // Not a bug: the worker has already taken over and the next launch will be
    // current. Say so plainly rather than hiding a mismatch.
    const el = document.getElementById('version');
    if (el) el.textContent = `v${markupVersion()} · update pending — close and reopen`;
  });

  worker.postMessage('version');
}

/* Every call is wrapped: a failure here must never reach the card. */
try { refreshContacts().catch(() => {}); } catch { /* keep the markup */ }
try { askWorkerVersion(); } catch { /* keep the version line */ }
