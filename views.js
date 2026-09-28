/* Luke's Dose Compass — the Now and Log screens.

   These two screens need JavaScript. The crisis card does not, and must never
   be able to break because something here does: every entry point below is
   wrapped, and index.html carries the crisis card in plain markup. */

import {
  readEvents, liveEvents, inOrder, lastDose, dosesInWindow, tabletsInWindow,
  lastWake, logDose, logMark, undo, checkAgainstMax, furosemideWindow,
  storageIsDurable, windowFor, HOUR, WINDOW_HOURS,
} from './store.js';

let regimen = null;
let backdateMinutes = 0;             // applies to the next dose logged
const justLogged = new Map();        // drugKey -> ms, for the double-tap mirror
const DOUBLE_TAP_MS = 12000;

/* ------------------------------------------------------------------ format */

/* Elapsed time, always. Clock time is only ever a secondary label. */
export function elapsed(ms) {
  if (ms == null) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m ago` : `${h}h ago`;
}

function clockLabel(utc, offsetMinutes) {
  // Render in the offset that was in force when the event happened, so an
  // entry logged in another timezone still reads as the time she saw.
  const shifted = new Date(utc + offsetMinutes * 60000);
  const h = shifted.getUTCHours();
  const m = String(shifted.getUTCMinutes()).padStart(2, '0');
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m}${ampm}`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* --------------------------------------------------------------- the Now screen */

function totalsLine(drug, events, now) {
  const win = windowFor(drug, events, now);
  const doses = dosesInWindow(events, drug.key, now, win.from);
  if (!doses.length) return `Nothing in ${win.label}.`;
  const tablets = tabletsInWindow(events, drug.key, now, win.from);
  const parts = [`${doses.length} ${doses.length === 1 ? 'dose' : 'doses'}`];
  if (tablets) parts.push(`${tablets} ${tablets === 1 ? 'tablet' : 'tablets'}`);
  if (drug.strengthMg) parts.push(`${tablets * drug.strengthMg} mg`);
  let line = parts.join(' · ') + ` in ${win.label}`;

  // State the prescribed ceiling beside the total, as information, never as a gate.
  if (drug.maxPer24hMg && drug.strengthMg) line += ` · the label says ${drug.maxPer24hMg} mg a day`;
  else if (drug.maxPer24hDoses) line += ` · the label says ${drug.maxPer24hDoses} a day`;
  return line + '.';
}

function nowRow(drug, events, now) {
  const last = lastDose(events, drug.key, now);
  const since = last ? now - last.atUTC : null;

  let body = `<p class="row-when">${last
    ? `Last given <b>${esc(elapsed(since))}</b>, at ${esc(clockLabel(last.atUTC, last.atOffset))}`
    : 'Not logged yet'}</p>`;

  body += `<p class="row-total">${esc(totalsLine(drug, events, now))}</p>`;

  // The one drug where every number is real, so the only one the app
  // says anything about. Always a range, always with the caveat.
  if (drug.key === 'furosemide' && last && regimen?.effects?.furosemide) {
    const w = furosemideWindow(since, regimen.effects.furosemide);
    if (w) {
      body += `<p class="window"><span class="window-state">${w.icon} ${esc(w.word)}</span> ${esc(w.line)}</p>`;
      body += `<details class="why"><summary>Where this comes from</summary>
        <p>${esc(regimen.effects.furosemide.variability)}</p>
        <ul>${regimen.effects.furosemide.sources.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details>`;
    }
  }

  if (!drug.modelled) {
    const why = drug.placeholder
      ? `The app has no name or strength for this one${drug.vq ? ` (${esc(drug.vq)})` : ''}, so it logs the dose and says nothing about what it is doing in him.`
      : 'Logged only. The app does not estimate what this one is doing.';
    body += `<p class="unknown">? ${why}</p>`;
  }

  return `<li class="drug-card">
    <div class="drug-head"><span class="dot" style="background:var(${drug.colour})"></span>
      <span class="drug-name">${esc(drug.name)}${drug.alsoCalled ? ` <span class="also">(${esc(drug.alsoCalled)})</span>` : ''}</span>
      ${drug.placeholder ? '<span class="tag">needs real numbers</span>' : ''}
    </div>${body}</li>`;
}

export function renderNow(root, now = Date.now()) {
  const events = readEvents();
  if (!regimen) { root.innerHTML = '<p class="unknown">Loading the regimen…</p>'; return; }

  const wake = lastWake(events, now);
  const header = wake
    ? `<p class="vsub">Awake ${esc(elapsed(now - wake.atUTC)).replace(' ago', '')} · since ${esc(clockLabel(wake.atUTC, wake.atOffset))}</p>`
    : '<p class="vsub">No wake logged yet</p>';

  const ordered = [...regimen.drugs].sort((a, b) => (b.modelled ? 1 : 0) - (a.modelled ? 1 : 0));

  root.innerHTML = `<a class="back" href="#home">&larr; Luke</a>
    <h2>Right now</h2>${header}
    <ul class="drugs">${ordered.map((d) => nowRow(d, events, now)).join('')}</ul>
    <p class="foot-note">Times are estimates, not a schedule. The app never recommends a dose — that is between you and the vet.</p>`;
}

/* --------------------------------------------------------------- the Log screen */

function giveButton(drug, events, now) {
  const recent = justLogged.get(drug.key);
  const mirroring = recent && now - recent < DOUBLE_TAP_MS;
  const label = mirroring
    ? `logged ${Math.round((now - recent) / 1000)}s ago — tap again for a second`
    : 'Give';
  return `<button class="give${mirroring ? ' mirror' : ''}" type="button" data-give="${drug.key}"
    aria-label="${mirroring ? `${esc(drug.name)} was just logged. Tap again to log another dose.` : `Log ${esc(drug.name)} given`}">${esc(label)}</button>`;
}

function logRow(drug, events, now) {
  const last = lastDose(events, drug.key, now);
  const win = windowFor(drug, events, now);
  const doses = dosesInWindow(events, drug.key, now, win.from).length;
  const sub = `${last ? esc(elapsed(now - last.atUTC)) : 'not given'} · ${doses} ${win.basis === 'cycle' ? 'this cycle' : 'in 24h'}`;
  return `<div class="medrow">
    <span class="dot" style="background:var(${drug.colour})"></span>
    <div><div class="medname">${esc(drug.name)}</div><div class="medsub">${sub}</div></div>
    ${giveButton(drug, events, now)}
  </div>`;
}

function entryText(e) {
  if (e.type === 'wake') return 'We woke';
  if (e.type === 'sleep') return 'Sleep started';
  const drug = regimen?.drugs.find((d) => d.key === e.drugKey);
  const name = drug ? drug.name : e.drugKey;
  const t = e.tablets ? ` · ${e.tablets} ${e.tablets === 1 ? 'tablet' : 'tablets'}` : '';
  return `${name} given${t}`;
}

export function renderLog(root, now = Date.now()) {
  const events = readEvents();
  if (!regimen) { root.innerHTML = '<p class="unknown">Loading the regimen…</p>'; return; }

  const backdates = [[0, 'now'], [20, '20 min ago'], [60, '1h ago'], [120, '2h ago']];
  const chips = backdates.map(([m, label]) =>
    `<button class="chip" type="button" data-back="${m}" aria-pressed="${backdateMinutes === m}">${label}</button>`).join('');

  const recent = inOrder(liveEvents(events)).filter((e) => e.atUTC <= now).reverse().slice(0, 10);

  root.innerHTML = `<a class="back" href="#home">&larr; Luke</a>
    <h2>Log</h2>

    <div class="marks">
      <button class="btn" type="button" data-mark="wake">We woke</button>
      <button class="btn" type="button" data-mark="sleep">Sleep started</button>
    </div>

    <button class="bigbtn round" type="button" data-round="wake">
      <span><span class="bigbtn-label">Wake round</span>
      <span class="bigbtn-sub">Opens a pre-checked list to confirm</span></span></button>
    <button class="bigbtn round" type="button" data-round="sleep">
      <span><span class="bigbtn-label">Sleep-prep round</span>
      <span class="bigbtn-sub">Opens a pre-checked list to confirm</span></span></button>
    <div id="sheet"></div>

    <p class="k">When was it given?</p>
    <div class="chips">${chips}</div>

    <div class="rows">${regimen.drugs.map((d) => logRow(d, events, now)).join('')}</div>

    <p class="k">Recent · tap × to undo</p>
    <div class="entries">${recent.length ? recent.map((e) => `<div class="entry">
        <span class="etime">${esc(clockLabel(e.atUTC, e.atOffset))}</span>
        <span>${esc(entryText(e))}</span>
        <button class="x" type="button" data-undo="${e.id}" aria-label="Undo ${esc(entryText(e))}">×</button>
      </div>`).join('') : '<p class="unknown">Nothing logged yet. Tap Give on any drug above.</p>'}</div>`;
}

function openSheet(round) {
  const sheet = document.getElementById('sheet');
  if (!sheet) return;
  const inRound = regimen.drugs.filter((d) => (d.rounds || []).includes(round));
  const others = regimen.drugs.filter((d) => !(d.rounds || []).includes(round));
  const box = (d, checked) => `<label><input type="checkbox" ${checked ? 'checked' : ''} data-r="${d.key}"> ${esc(d.name)}${d.tabletsPerDose ? ` · ${d.tabletsPerDose}` : ''}</label>`;
  sheet.innerHTML = `<div class="card sheet">
    <span class="k">Confirm ${round === 'wake' ? 'wake' : 'sleep-prep'} doses</span>
    ${inRound.map((d) => box(d, true)).join('')}
    ${others.length ? `<span class="k dim">Not set for this round</span>${others.map((d) => box(d, false)).join('')}` : ''}
    <div class="sheet-actions">
      <button class="btn primary" type="button" id="sheet-ok">Confirm</button>
      <button class="btn" type="button" id="sheet-no">Cancel</button>
    </div></div>`;
}

function say(message) {
  const el = document.getElementById('toast');
  if (el) el.textContent = message;
}

function describePastMax(drug, passed) {
  return passed.map((p) => `${p.value} ${p.unit} ${p.limit} — the label says ${p.max}`).join('; ');
}

/* ------------------------------------------------------------------ wiring */

function give(drugKey, now = Date.now()) {
  const drug = regimen.drugs.find((d) => d.key === drugKey);
  if (!drug) return;
  const passed = checkAgainstMax(drug, readEvents(), { now });

  let dose;
  try {
    dose = logDose(drug, { minutesAgo: backdateMinutes, now });
  } catch (err) {
    // Never say "given" unless it was really written down.
    say(`NOT SAVED. ${drug.name} was not recorded — tap Give again. (${err.message})`);
    return;
  }

  justLogged.set(drugKey, now);
  backdateMinutes = 0;
  // Nothing is blocked. If a prescribed ceiling was passed, say so plainly.
  say(passed
    ? `${drug.name} logged. That puts him at ${describePastMax(drug, passed)}.`
    : `${drug.name} logged${dose.atUTC < now - 60000 ? `, ${elapsed(now - dose.atUTC)}` : ''}.`);
  refresh();
}

export function refresh(now = Date.now()) {
  try {
    const nowEl = document.getElementById('now-body');
    const logEl = document.getElementById('log-body');
    if (nowEl) renderNow(nowEl, now);
    if (logEl) renderLog(logEl, now);
    banner();
  } catch (err) {
    console.warn('render failed', err);   // the crisis card is untouched
  }
}

/* iOS clears a Safari tab's storage after seven days of not visiting.
   A Home Screen app is exempt and resets its own counter with use. So the
   installed app is where the log is safe, and a tab is where it is not. */
function isStandalone() {
  try {
    return navigator.standalone === true
      || window.matchMedia('(display-mode: standalone)').matches;
  } catch { return false; }
}

function banner() {
  const el = document.getElementById('storagebanner');
  if (!el) return;
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (!storageIsDurable()) {
    el.textContent = 'This browser is not saving anything. Doses logged here will be lost.';
    el.hidden = false;
  } else if (iOS && !isStandalone()) {
    el.innerHTML = 'You are in Safari. Doses logged here can disappear after 7 days and will not show in the Home Screen app. Open <b>Luke</b> from your Home Screen instead.';
    el.hidden = false;
  } else if (!iOS && !isStandalone()) {
    el.textContent = 'This is not the logging device. Doses belong on the phone; this copy will not see them.';
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

export async function start() {
  try {
    const res = await fetch(new URL('regimen.json', document.baseURI), { cache: 'no-store' });
    regimen = await res.json();
  } catch {
    regimen = { drugs: [], effects: {} };
  }
  try { navigator.storage?.persist?.(); } catch { /* usually false on iOS; harmless */ }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-give],[data-back],[data-mark],[data-round],[data-undo],#sheet-ok,#sheet-no');
    if (!t) return;
    const now = Date.now();

    if (t.dataset.give) { give(t.dataset.give, now); return; }
    if (t.dataset.back != null) { backdateMinutes = Number(t.dataset.back); refresh(now); return; }
    if (t.dataset.mark) {
      logMark(t.dataset.mark, { now });
      say(t.dataset.mark === 'wake' ? 'Wake logged.' : 'Sleep start logged.');
      refresh(now); return;
    }
    if (t.dataset.round) { openSheet(t.dataset.round); return; }
    if (t.id === 'sheet-no') { document.getElementById('sheet').innerHTML = ''; return; }
    if (t.id === 'sheet-ok') {
      const picked = [...document.querySelectorAll('#sheet input[data-r]:checked')].map((i) => i.dataset.r);
      for (const key of picked) {
        const drug = regimen.drugs.find((d) => d.key === key);
        if (drug) logDose(drug, { minutesAgo: backdateMinutes, now });
      }
      backdateMinutes = 0;
      document.getElementById('sheet').innerHTML = '';
      refresh(now);
      say(picked.length ? `Logged: ${picked.length} ${picked.length === 1 ? 'drug' : 'drugs'}.` : 'Nothing selected.');
      return;
    }
    if (t.dataset.undo) {
      undo(t.dataset.undo, { now });
      refresh(now);
      say('Undone. The original is kept in the record.');
    }
  });

  refresh();
  // The double-tap mirror counts down, so the rows need to tick.
  setInterval(() => { if (justLogged.size) refresh(); }, 3000);
}

export const __test = { elapsed, clockLabel, totalsLine, describePastMax };
