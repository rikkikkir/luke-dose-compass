/* Luke's Dose Compass — the Now and Log screens.

   These two screens need JavaScript. The crisis card does not, and must never
   be able to break because something here does: every entry point below is
   wrapped, and index.html carries the crisis card in plain markup. */

import {
  readEvents, liveEvents, inOrder, lastDose, dosesInWindow, tabletsInWindow,
  lastWake, logDose, logMark, undo, checkAgainstMax,
  effectWindow, buildupState, bodyState,
  storageIsDurable, windowFor, HOUR, WINDOW_HOURS,
  readLocalRegimen, writeLocalRegimen, mergeRegimen, asText,
  loadConfig, cycleHours, stillWorking, sleepDisruption, lastOf, opioidResponse,
  labGroup, currentWeightKg, latestLabs, labStatus,
  why,
} from './store.js';
import { renderCircles } from './circles.js';
import { renderVetDoc, attachVetDoc } from './vetdoc.js';
import { renderHelper, renderUnderstand, loadGuide, attachHelper } from './helper.js';
import { hasKey, saveKey, forgetKey, testKey, sync, describeState } from './sync.js';
import { init as initCapture, attach as attachCapture, renderCapture } from './capture.js';

let regimen = null;
let seedRegimen = null;
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

  const weight = currentWeightKg(events, now);
  if (weight && drug.strengthMg && drug.tabletsPerDose) {
    const perKg = (drug.strengthMg * drug.tabletsPerDose) / weight.kg;
    body += `<p class="row-total">${perKg.toFixed(2)} mg/kg per dose, at ${weight.kg.toFixed(1)} kg${
      weight.stale ? ` \u2014 <b>weighed ${Math.round(weight.ageDays)} days ago</b>, so this figure is out of date` : ''}</p>`;
  }

  // One path for every drug now, driven by regimen.json. A drug with no
  // sourced window produces nothing here rather than a guess.
  const state = buildupState(drug, events, now) || (last ? effectWindow(drug, since) : null);

  if (state && state.word) {
    body += `<p class="window"><span class="window-state">${state.icon} ${esc(state.word)}</span> ${esc(state.line || '')}</p>`;
    if (state.note) body += `<p class="unknown">${esc(state.note)}</p>`;
  } else if (last) {
    body += `<p class="unknown">? Logged only. There is no reliable published time course for this one, so the app shows none.</p>`;
  }

  if ((drug.variability || (drug.sources || []).length || (drug.caveats || []).length)) {
    body += `<details class="why"><summary>Where this comes from</summary>
      ${drug.variability ? `<p>${esc(drug.variability)}</p>` : ''}
      ${(drug.caveats || []).map((c) => `<p class="caveat"><b>${c.tier === 'known' ? 'Known' : 'Extrapolated'}:</b> ${esc(c.text)}</p>`).join('')}
      ${(drug.sources || []).length ? `<ul>${drug.sources.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="unknown">No published source for this one.</p>'}
      ${(drug.unknowns || []).length ? `<p class="unknown">Still unknown: ${esc(drug.unknowns.join('; '))}</p>` : ''}
    </details>`;
  }

  return `<li class="drug-card">
    <div class="drug-head"><span class="dot" style="background:var(${drug.colour})"></span>
      <span class="drug-name">${esc(drug.name)}${drug.alsoCalled ? ` <span class="also">(${esc(drug.alsoCalled)})</span>` : ''}</span>
      ${drug.placeholder ? '<span class="tag">needs real numbers</span>' : ''}
    </div>${body}</li>`;
}

/* ------------------------------------------------------------ his body now */

/* SPEC-feel: "understand, empathize, plan, predict and learn how Luke likely
   feels: where in his body, how strongly, and when." Certainty is shown in the
   piece's own language, not in a footnote: known is solid, extrapolated is
   dashed and dimmed. S4 everywhere - icon plus word, ranges not numbers.
   S7 everywhere - this never diagnoses and never recommends a dose. */

function labBlock(system, events, now) {
  const groups = ['kidney', 'hydration', 'liver']
    .map((k) => labGroup(k, events, now))
    .filter((g) => g && g.system === system.key);
  if (!groups.length) return '';

  return groups.map((g) => `<div class="labs">
    <p class="k dim">${esc(g.name)} \u00b7 from his records</p>
    <ul class="lablist">${g.values.map((v) => `<li class="lab${v.stale ? ' stale' : ''}">
      <span class="lab-name">${esc(v.lab.name)}</span>
      <span class="lab-val">${v.lab.value}${v.lab.unit ? ' ' + esc(v.lab.unit) : ''}</span>
      <span class="lab-flag">${v.icon} ${esc(v.word)}${v.range ? ` (${v.range})` : ''}</span>
      <span class="lab-when">${new Date(v.lab.atUTC).toISOString().slice(0, 10)}${v.stale ? ` \u00b7 ${Math.round(v.ageDays)} days old` : ''}</span>
    </li>`).join('')}</ul>
    ${g.note ? `<p class="sys-note">${esc(g.note)}</p>` : ''}
    <p class="tierlabel">From his records \u00b7 values only, no conclusion drawn</p>
  </div>`).join('');
}

function systemCard(entry) {
  const { system, acting, interactions, caveats } = entry;

  if (!acting.length) {
    return `<li class="sys sys-quiet">
      <h3>${esc(system.name)}</h3>
      <p class="unknown">Nothing logged that acts here right now.</p>
      ${labBlock(system, readEvents(), Date.now())}
      <p class="sys-note">${esc(system.note)}</p></li>`;
  }

  const lines = acting.map(({ drug, act, state, kind, tier, last }) => {
    // A drug that builds counts from its FIRST dose, not its last. state.days
    // is computed from the first; last.atUTC is the most recent, which would
    // have read "day 5" for a drug last given four days ago.
    const when = kind === 'builds'
      ? (state && state.days != null ? `day ${Math.floor(state.days) + 1} of dosing` : null)
      : (last ? elapsed(Date.now() - last.atUTC) : null);
    const head = state && state.word
      ? `<span class="window-state">${state.icon} ${esc(state.word)}</span>`
      : '<span class="window-state">\u00b7 Logged</span>';
    return `<div class="sys-drug tier-${tier}">
      <p class="sys-drug-head"><span class="dot" style="background:var(${drug.colour})"></span>
        <b>${esc(drug.name)}</b> ${head}
        ${when ? `<span class="sys-when">${esc(when)}</span>` : ''}</p>
      <p class="sys-effect">${esc(act.effect)}</p>
      ${state && state.line ? `<p class="sys-line">${esc(state.line)}</p>` : ''}
      <p class="tierlabel">${tier === 'known' ? 'From published pharmacology' : tier === 'logged' ? 'From your log' : 'Extrapolated \u2014 a reasonable guess, not a finding'}</p>
    </div>`;
  }).join('');

  const inter = interactions.map((i) => `<p class="sys-inter">\u26a0 ${esc(i.text)}
    <span class="tierlabel">${i.tier === 'known' ? 'From published pharmacology' : 'Extrapolated'}</span></p>`).join('');

  return `<li class="sys">
    <h3>${esc(system.name)}</h3>
    ${lines}${inter}
    ${labBlock(system, readEvents(), Date.now())}
    <details class="why"><summary>What this part assumes</summary>
      <p class="sys-note">${esc(system.note)}</p>
      ${caveats.map((c) => `<p class="caveat"><b>${esc(c.drug)}:</b> ${esc(c.text)}</p>`).join('')}
    </details></li>`;
}

/* What is still working in him. Needs no prediction of her at all: a time she
   logged, plus a figure that was published and cited. */
function forecastBlock(events, now) {
  const running = stillWorking(events, regimen, now, 12);
  const sleep = sleepDisruption(events, regimen, now);

  const sleepLine = sleep ? `<p class="sys-inter"><b>Furosemide went in ${esc(elapsed(sleep.givenAgoMs))}.</b>
    The peak is ${sleep.peakHoursFrom}\u2013${sleep.peakHoursTo} hours after a dose, so it lands
    ${sleep.peakFromMs > 0
      ? `in about ${esc(elapsed(sleep.peakFromMs).replace(' ago', ''))} to ${esc(elapsed(sleep.peakToMs).replace(' ago', ''))}`
      : 'around now'}${sleep.relativeToSleep != null ? ' \u2014 which is inside your sleep' : ''}.
    <span class="tierlabel">From published pharmacology \u00b7 ${esc(sleep.vq)}</span></p>` : '';

  if (!running.length && !sleepLine) return '';

  const rows = running.map((r) => `<li class="sys-drug tier-known">
      <p class="sys-drug-head"><span class="dot" style="background:var(${r.drug.colour})"></span>
        <b>${esc(r.drug.name)}</b> <span class="window-state">${r.state.icon} ${esc(r.state.word)}</span></p>
      <p class="sys-line">Usually fading between ${esc(elapsed(r.endsFromMs).replace(' ago', ''))} and ${esc(elapsed(r.endsToMs).replace(' ago', ''))} from now.</p>
      <p class="tierlabel">From published pharmacology</p></li>`).join('');

  return `<li class="sys">
    <h3>What is still working in him</h3>
    ${sleepLine}
    ${rows ? `<ul class="drugs">${rows}</ul>` : '<p class="unknown">Nothing with a published window is still inside it.</p>'}
    <p class="sys-note">These are windows from the doses you logged, not a schedule. Nothing here says when to give the next one.</p>
  </li>`;
}

/* SPEC-domain: "Show Luke's observed relief window next to the model's
   estimate... The observed window never replaces the model's estimate." */
function responseBlock(events, now) {
  const r = opioidResponse(events, regimen, now);
  if (!r) return '';
  const drug = (regimen.drugs || []).find((d) => d.asNeeded);
  const published = drug && drug.window
    ? `${drug.window.durationHoursFrom}\u2013${drug.window.durationHoursTo} hours`
    : 'not published';

  return `<li class="sys">
    <h3>What his own checks say</h3>
    <p class="sys-effect">Published window for ${esc(drug ? drug.name : 'it')}: <b>${published}</b>.</p>
    ${r.enough
      ? `<p class="sys-effect">His own checks, across ${r.qualifying} that qualified: discomfort tended to return
         <b>about ${r.observed.median.toFixed(1)} hours</b> after a dose, between ${r.observed.from.toFixed(1)} and ${r.observed.to.toFixed(1)}.</p>
         <p class="sys-note">Shown beside the published window, not instead of it.</p>`
      : `<p class="unknown">${r.qualifying} of ${r.need} qualifying checks so far. Below that, there is nothing here worth saying.</p>
         <p class="sys-note">A check qualifies when it is the first high one after a dose, with no other pain medicine in between.</p>`}
    <p class="tierlabel">From your own pain checks \u00b7 no recommendation is made from this</p>
  </li>`;
}

export function renderBody(root, now = Date.now()) {
  if (!regimen) { root.innerHTML = '<p class="unknown">Loading\u2026</p>'; return; }
  const events = readEvents();
  const state = bodyState(events, regimen, now);

  root.innerHTML = `<a class="back" href="#home">&larr; Luke</a>
    <h2>His body, right now</h2>
    <p class="interp">Interpretation, not measurement. Nothing here senses Luke.</p>
    <ul class="systems">${state.map(systemCard).join('')}</ul>
    ${forecastBlock(events, now)}
    ${responseBlock(events, now)}
    <p class="foot-note">${esc(regimen.interactionsNote || '')}</p>
    <p class="foot-note">This never diagnoses and never recommends a dose. What Luke shows you is better evidence than anything on this screen.</p>`;
}

export function renderNow(root, now = Date.now()) {
  const events = readEvents();
  if (!regimen) { root.innerHTML = '<p class="unknown">Loading the regimen…</p>'; return; }

  const wake = lastWake(events, now);
  const header = wake
    ? `<p class="vsub">Awake ${esc(elapsed(now - wake.atUTC)).replace(' ago', '')} · since ${esc(clockLabel(wake.atUTC, wake.atOffset))}</p>`
    : '<p class="vsub">No wake logged yet</p>';

  const ordered = [...regimen.drugs].sort((a, b) => (b.window ? 1 : 0) - (a.window ? 1 : 0));

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
      <a class="btn" href="#drugs">His medicines</a>
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

    ${syncCard()}

    <p class="k">Recent · tap × to undo</p>
    <div class="entries">${recent.length ? recent.map((e) => `<div class="entry">
        <span class="etime">${esc(clockLabel(e.atUTC, e.atOffset))}</span>
        <span>${esc(entryText(e))}</span>
        <button class="x" type="button" data-undo="${e.id}" aria-label="Undo ${esc(entryText(e))}">×</button>
      </div>`).join('') : '<p class="unknown">Nothing logged yet. Tap Give on any drug above.</p>'}</div>`;
}

/* One card per drug, editable in place. Adding or correcting a drug has to
   take under a minute at any hour, with no session open (CLAUDE.md). */
function drugEditor(d) {
  const f = (name, label, value, attrs = '') =>
    `<label class="field"><span>${label}</span>
      <input data-drug="${d.key}" data-field="${name}" value="${value == null ? '' : esc(value)}" ${attrs}></label>`;
  const round = (r, label) => `<label class="inline">
      <input type="checkbox" data-drug="${d.key}" data-round-field="${r}" ${(d.rounds || []).includes(r) ? 'checked' : ''}>
      ${label}</label>`;

  return `<div class="card drug-edit">
    <div class="drug-head"><span class="dot" style="background:var(${d.colour || '--supp'})"></span>
      <span class="drug-name">${esc(d.name)}</span>
      ${d.placeholder ? '<span class="tag">needs real numbers</span>' : ''}</div>
    ${f('name', 'Name on the bottle', d.name)}
    ${f('strengthMg', 'Strength, mg per tablet', d.strengthMg, 'inputmode="decimal" placeholder="unknown"')}
    ${f('tabletsPerDose', 'Tablets per dose', d.tabletsPerDose, 'inputmode="decimal" placeholder="unknown"')}
    <div class="rounds">${round('wake', 'Wake round')} ${round('sleep', 'Sleep-prep round')}</div>
    ${f('maxPer24hMg', 'Most in a day, mg', d.maxPer24hMg, 'inputmode="decimal" placeholder="none set"')}
    ${f('minGapHours', 'Least time between doses, hours', d.minGapHours, 'inputmode="decimal" placeholder="no vet has set one"')}
    <p class="sync-msg">${d.unknowns && d.unknowns.length ? 'Still unknown: ' + esc(d.unknowns.join('; ')) : ''}</p>
  </div>`;
}

export function renderDrugs(root) {
  if (!regimen) { root.innerHTML = '<p class="unknown">Loading\u2026</p>'; return; }
  root.innerHTML = `<a class="back" href="#home">&larr; Luke</a>
    <h2>His medicines</h2>
    <p class="vsub">Change anything here whenever you have the bottle in hand. Doses already logged keep the numbers that applied when you logged them.</p>
    ${regimen.drugs.map(drugEditor).join('')}
    <div class="sheet-actions">
      <button class="btn primary" type="button" id="drugs-save">Save changes</button>
    </div>

    <p class="foot-note">Leaving a box empty means "nobody has told me." The app would rather say unknown than invent a number.</p>`;
}

function saveDrugs() {
  const edited = regimen.drugs.map((d) => {
    const next = { ...d };
    for (const input of document.querySelectorAll(`[data-drug="${d.key}"][data-field]`)) {
      const field = input.dataset.field;
      const raw = input.value.trim();
      if (field === 'name') { next.name = raw || d.name; continue; }
      next[field] = raw === '' ? null : Number(raw);
      if (Number.isNaN(next[field])) next[field] = null;
    }
    next.rounds = ['wake', 'sleep'].filter((r) =>
      document.querySelector(`[data-drug="${d.key}"][data-round-field="${r}"]`)?.checked);
    // Once she has given a drug real numbers it stops being a placeholder.
    if (next.strengthMg != null && next.name !== d.name) { next.placeholder = false; next.source = 'Rikki'; }
    else if (next.strengthMg != null && d.placeholder) { next.placeholder = false; next.source = 'Rikki'; }
    if (next.maxPer24hMg != null && next.strengthMg != null) next.maxPer24hTablets = null;
    return next;
  });

  // Set the message AFTER the re-render, or the render wipes it. Same trap
  // the toast fell into: anything written into HTML we are about to rebuild
  // has to be written afterwards.
  let message;
  try {
    writeLocalRegimen(edited);
    regimen = mergeRegimen(seedRegimen, readLocalRegimen());
    initCapture(regimen, () => refresh());
    message = 'Saved. Doses already logged keep the numbers that applied then.';
  } catch (err) {
    message = `NOT SAVED \u2014 ${why(err)}`;
  }
  refresh();
  say(message);
  // No sync here: the regimen is this device's own, only events are shared.
  // runSync() would re-render asynchronously and wipe the message above.
}

async function copySevenDays() {
  const text = asText(readEvents(), regimen, { days: 7 });
  try {
    await navigator.clipboard.writeText(text);
    say('Seven days copied. Paste it into your Claude chat.');
  } catch {
    // Clipboard refused, which iOS does outside a direct tap. Show it instead.
    const box = document.getElementById('log-body');
    if (box) {
      const pre = document.createElement('pre');
      pre.className = 'textout';
      pre.textContent = text;
      box.appendChild(pre);
      pre.scrollIntoView({ block: 'start' });
    }
    say('Could not reach the clipboard. The text is below \u2014 select and copy it.');
  }
}

function syncCard() {
  if (!hasKey()) {
    return `<div class="card sync setup">
      <span class="k">Share this log with your other device</span>
      <p class="sync-lead">Paste the key from GitHub. It is stored only on this device, in a place your other web pages cannot read, and you can cancel it from GitHub at any time.</p>
      <input id="synckey" type="password" inputmode="text" autocomplete="off" spellcheck="false"
             placeholder="github_pat_\u2026" aria-label="Sync key">
      <div class="sheet-actions">
        <button class="btn primary" type="button" id="sync-save">Connect</button>
      </div>
    </div>
    <div class="sheet-actions"><button class="btn" type="button" id="copy7">Copy the last 7 days</button></div>`;
  }
  const s = describeState();
  return `<div class="card sync">
    <span class="k">Shared log</span>
    <p class="sync-status"><b>${esc(s.word)}</b> \u00b7 ${esc(s.detail)}</p>
    ${s.damaged ? `<p class="sync-msg">${s.damaged} damaged line${s.damaged === 1 ? '' : 's'} in the shared file were skipped.</p>` : ''}
    <div class="sheet-actions">
      <button class="btn" type="button" id="sync-now">Check now</button>
      <button class="btn" type="button" id="copy7">Copy the last 7 days</button>
      <button class="btn" type="button" id="sync-forget">Disconnect this device</button>
    </div>
  </div>`;
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
    say(`NOT SAVED. ${drug.name} was not recorded — tap Give again. (${why(err)})`);
    return;
  }

  justLogged.set(drugKey, now);
  backdateMinutes = 0;
  // Nothing is blocked. If a prescribed ceiling was passed, say so plainly.
  say(passed
    ? `${drug.name} logged. That puts him at ${describePastMax(drug, passed)}.`
    : `${drug.name} logged${dose.atUTC < now - 60000 ? `, ${elapsed(now - dose.atUTC)}` : ''}.`);
  refresh();
  runSync();
}

/* Pasting a key is the one moment to be strict: a key that can read but not
   write would look fine for days and then quietly lose every dose logged here.
   So the key is tested against the real repository before it is saved. */
async function connectSync() {
  const input = document.getElementById('synckey');
  const token = (input?.value || '').trim();
  if (!token) { say('Paste the key first.'); return; }

  say('Checking the key\u2026');
  saveKey(token);
  try {
    await testKey();
    say('Connected. Bringing the two logs together\u2026');
    await sync();
    refresh();
    say('This device is now sharing Luke\u2019s log.');
  } catch (err) {
    forgetKey();                       // never keep a key that did not work
    say(why(err));
  }
}

let syncing = false;
async function runSync(loud = false) {
  if (syncing) return;
  syncing = true;
  if (loud) say('Checking\u2026');
  try {
    await sync();
  } finally {
    syncing = false;
    refresh();
    if (loud) {
      const state = describeState();
      say(`${state.word}. ${state.detail}`);
    }
  }
}

/* "Night mode: dim and warm, for the sleep window." Her cycle is not a clock,
   so this follows the log: on when a sleep is marked and no wake since. */
function nightMode(events, now) {
  const sleep = lastOf(events, 'sleep', now);
  const wake = lastOf(events, 'wake', now);
  const sleeping = sleep && (!wake || wake.atUTC < sleep.atUTC);
  document.body.classList.toggle('night', !!sleeping);
}

export function refresh(now = Date.now()) {
  try {
    nightMode(readEvents(), now);
    const nowEl = document.getElementById('now-body');
    const logEl = document.getElementById('log-body');
    const drugsEl = document.getElementById('drugs-body');
    const bodyEl = document.getElementById('body-body');
    const capEl = document.getElementById('capture-body');
    const cirEl = document.getElementById('circles-body');
    const vetEl = document.getElementById('vet-body');
    const helpEl = document.getElementById('helper-body');
    const undEl = document.getElementById('understand-body');
    if (nowEl) renderNow(nowEl, now);
    if (logEl) renderLog(logEl, now);
    if (drugsEl) renderDrugs(drugsEl);
    if (bodyEl) renderBody(bodyEl, now);
    if (capEl) renderCapture(capEl);
    if (cirEl) renderCircles(cirEl, regimen, now);
    if (vetEl) renderVetDoc(vetEl, regimen);
    if (helpEl) renderHelper(helpEl, regimen, now);
    if (undEl) renderUnderstand(undEl);
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
  const shared = hasKey();

  // Order matters: say the worst true thing first.
  if (!storageIsDurable()) {
    el.textContent = 'This browser is not saving anything. Doses logged here will be lost.';
    el.hidden = false;
    return;
  }
  if (iOS && !isStandalone()) {
    // The seven-day wipe applies to a Safari tab and not to a Home Screen app.
    el.innerHTML = shared
      ? 'You are in Safari. Add <b>Luke</b> to your Home Screen \u2014 a tab forgets its doses after 7 days, and they are only safe once they have reached the shared log.'
      : 'You are in Safari. Doses logged here can disappear after 7 days. Open <b>Luke</b> from your Home Screen instead.';
    el.hidden = false;
    return;
  }
  if (!shared) {
    el.textContent = 'Doses logged here stay on this device. Set up the shared log to join this and your phone together.';
    el.hidden = false;
    return;
  }
  el.hidden = true;   // sharing, and storage is durable: nothing to warn about
}

export async function start() {
  try {
    const res = await fetch(new URL('regimen.json', document.baseURI), { cache: 'no-store' });
    seedRegimen = await res.json();
  } catch {
    seedRegimen = { drugs: [], effects: {} };
  }
  // Her own corrections win over the shipped seed, drug by drug.
  await loadConfig(document.baseURI);   // CLAUDE.md: numbers live in config.defaults.json
  regimen = mergeRegimen(seedRegimen, readLocalRegimen());
  initCapture(regimen, () => refresh());
  attachCapture();
  attachVetDoc(() => regimen, say);
  attachHelper();
  loadGuide(document.baseURI).then(() => refresh());
  try { navigator.storage?.persist?.(); } catch { /* usually false on iOS; harmless */ }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-give],[data-back],[data-mark],[data-round],[data-undo],#sheet-ok,#sheet-no,#sync-save,#sync-now,#sync-forget,#copy7,#drugs-save');
    if (!t) return;
    const now = Date.now();

    if (t.id === 'sync-save')   { connectSync(); return; }
    if (t.id === 'copy7')       { copySevenDays(); return; }
    if (t.id === 'drugs-save')  { saveDrugs(); return; }
    if (t.id === 'sync-now')    { runSync(true); return; }
    if (t.id === 'sync-forget') { forgetKey(); refresh(now); say('This device is no longer sharing its log.'); return; }
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

  // Catch up on opening, on coming back to the app, and when signal returns.
  runSync();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') runSync();
  });
  window.addEventListener('online', () => runSync());
}

export const __test = { elapsed, clockLabel, totalsLine, describePastMax };
