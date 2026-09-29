/* Luke's Dose Compass — keeping the phone and the Mac holding the same log.

   The log is append-only, which is what makes this safe. Two devices never
   disagree about a dose: they only ever know about different subsets of them.
   Merging is therefore the union of every event id either side has seen. There
   is no "which version wins", and so no way for a sync to lose a dose.

   The store is a private repository Rikki owns, rikkikkir/luke-log, holding one
   newline-delimited file. Every sync is a commit, so the history is also a
   backup she can walk back through.

   THE KEY IS IN A PATH-SCOPED COOKIE, NOT localStorage, AND THAT IS DELIBERATE.
   Every GitHub Pages site under rikkikkir.github.io shares one browser origin,
   so localStorage written here is readable by script on any of her other pages
   — including several with large generated HTML files. A cookie scoped to this
   app's path is not. Verified in WebKit: from another page on the same site,
   localStorage returned the secret and the cookie returned empty.

   Sync never blocks logging. The local log is the truth the screen renders;
   this runs behind it and catches up when there is a network. */

import { readEvents, writeEvents, why } from './store.js';

const REPO = 'rikkikkir/luke-log';
const PATH = 'events.ndjson';
const API = 'https://api.github.com';
const COOKIE = 'luke_sync_key';
const STATE_KEY = 'luke.sync.state.v1';
const MAX_RETRIES = 4;

/* ------------------------------------------------------------------- the key */

function appPath() {
  // '/luke-dose-compass/' in production, '/' when served from a folder root.
  return new URL('./', document.baseURI).pathname;
}

export function readKey() {
  const match = document.cookie.split('; ').find((c) => c.startsWith(COOKIE + '='));
  return match ? decodeURIComponent(match.slice(COOKIE.length + 1)) : null;
}

export function saveKey(token) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  // Ten years: this is a device-local secret she can revoke on GitHub at any
  // moment, and an expiry that logs her out mid-crisis helps nobody.
  document.cookie = `${COOKIE}=${encodeURIComponent(token)}; path=${appPath()}` +
    `; max-age=${10 * 365 * 24 * 3600}; SameSite=Strict${secure}`;
}

export function forgetKey() {
  document.cookie = `${COOKIE}=; path=${appPath()}; max-age=0; SameSite=Strict`;
}

export function hasKey() { return !!readKey(); }

/* ----------------------------------------------------------------- the state */

export function readState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch { return {}; }
}
function writeState(patch) {
  const next = { ...readState(), ...patch };
  try { localStorage.setItem(STATE_KEY, JSON.stringify(next)); } catch { /* not fatal */ }
  return next;
}

/* ------------------------------------------------------------------- the wire */

async function call(path, options = {}) {
  const key = readKey();
  if (!key) throw new Error('no key on this device');
  const res = await fetch(API + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401) throw new Error('the key was rejected — it may have been revoked');
  if (res.status === 404) throw new Error('cannot see the log repository with this key');
  return res;
}

const encode = (text) => btoa(unescape(encodeURIComponent(text)));
const decode = (b64) => decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));

/* Parses leniently on purpose. A half-written line — a phone killed mid-write,
   a truncated download — must cost that one line, never the whole log. */
export function parseLog(text) {
  const events = [];
  let damaged = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.id && parsed.type) events.push(parsed);
    } catch { damaged++; }
  }
  return { events, damaged };
}

export function serialiseLog(events) {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

/* The whole merge. Union by id, because nothing is ever edited: an undo is its
   own event, so two devices can never hold different versions of one record. */
export function merge(mine, theirs) {
  const mineIds = new Set(mine.map((e) => e.id));
  const theirIds = new Set(theirs.map((e) => e.id));

  const byId = new Map();
  for (const e of theirs) byId.set(e.id, e);
  for (const e of mine) if (!byId.has(e.id)) byId.set(e.id, e);

  return {
    events: [...byId.values()].sort((a, b) => (a.atUTC - b.atUTC) || ((a.seq || 0) - (b.seq || 0))),
    newToMe: theirs.filter((e) => !mineIds.has(e.id)).length,
    newToThem: mine.filter((e) => !theirIds.has(e.id)).length,
  };
}

/* ------------------------------------------------------------------ the cycle */

export async function syncOnce() {
  // 1. what the repository holds
  const res = await call(`/repos/${REPO}/contents/${encodeURIComponent(PATH)}?ref=main`);
  if (!res.ok && res.status !== 404) throw new Error(`could not read the log (${res.status})`);

  let remoteEvents = [];
  let sha = null;
  let damaged = 0;
  if (res.ok) {
    const body = await res.json();
    sha = body.sha;
    const parsed = parseLog(decode(body.content || ''));
    remoteEvents = parsed.events;
    damaged = parsed.damaged;
  }

  // 2. merge
  const mine = readEvents();
  const { events, newToThem } = merge(mine, remoteEvents);

  // 3. take everything home first, so a failed upload still leaves this device
  //    better informed than it was.
  if (events.length !== mine.length) writeEvents(events);

  // 4. push, only if this device knows something the repository does not
  if (newToThem === 0) {
    return writeState({ lastSync: Date.now(), lastError: null, damaged, pushed: 0 });
  }

  const put = await call(`/repos/${REPO}/contents/${encodeURIComponent(PATH)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `${newToThem} event${newToThem === 1 ? '' : 's'} from ${deviceName()}`,
      content: encode(serialiseLog(events)),
      ...(sha ? { sha } : {}),
    }),
  });

  // 409 means the other device wrote while we were thinking. Not an error:
  // start again, and the merge will simply include whatever they added.
  if (put.status === 409 || put.status === 422) return { conflict: true };
  if (!put.ok) throw new Error(`could not save the log (${put.status})`);

  return writeState({ lastSync: Date.now(), lastError: null, damaged, pushed: newToThem });
}

export async function sync() {
  if (!hasKey()) return { skipped: 'no key' };
  if (!navigator.onLine) return writeState({ lastError: 'offline' });
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await syncOnce();
      if (result && result.conflict) continue;   // the other device won the race
      return result;
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) return writeState({ lastError: why(err) });
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return writeState({ lastError: 'gave up after several tries' });
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'the iPhone';
  if (/iPad/.test(ua)) return 'the iPad';
  if (/Macintosh/.test(ua)) return 'the Mac';
  return 'a device';
}

/* Confirms a freshly pasted key really can read AND write, before telling her
   she is set up. A key that can read but not write would look fine for days
   and then quietly lose every dose logged on this device. */
export async function testKey() {
  const res = await call(`/repos/${REPO}`);
  if (!res.ok) throw new Error(`cannot reach the log repository (${res.status})`);
  const repo = await res.json();
  if (!repo.private) throw new Error('that repository is public — stop and tell Claude');
  if (!repo.permissions || !repo.permissions.push) {
    throw new Error('this key can read the log but not add to it. It needs Contents: Read and write.');
  }
  return { ok: true, repo: repo.full_name };
}

export function describeState() {
  const s = readState();
  if (!hasKey()) return { word: 'Not set up', detail: 'This device is not sharing its log.' };
  if (s.lastError === 'offline') return { word: 'Offline', detail: 'Will catch up when there is signal.' };
  if (s.lastError) return { word: 'Not syncing', detail: s.lastError };
  if (!s.lastSync) return { word: 'Not yet', detail: 'No sync has run on this device.' };
  const mins = Math.round((Date.now() - s.lastSync) / 60000);
  const when = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)}h ago`;
  return { word: 'In sync', detail: `Last checked ${when}.`, damaged: s.damaged || 0 };
}
