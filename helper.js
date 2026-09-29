/* Luke's Dose Compass — the page for whoever is standing in for Rikki.

   She is his only caregiver. This week she was at her niece and nephew's every
   day with Luke in tow, which is exactly the situation where someone else ends
   up holding him. If she were ill, or in a waiting room herself, nobody has a
   single page saying what he gets, what to watch, and who to call.

   Design rules, in order:
     1. It must be readable by someone who has never opened this app.
     2. It must be printable, because the person who needs it may not have it
        on a phone.
     3. It must never tell them to give a dose. It says what he is prescribed
        and what has already been given, and leaves every decision to Rikki or
        a vet (S1, S7).
     4. It must be useful with an empty log, because the log may be empty. */

import {
  readEvents, lastDose, dosesInWindow, windowFor, currentWeightKg, checkDefs,
} from './store.js';
import { toHtml } from './md.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ago(ms) {
  if (ms == null) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)} days ago`;
}

function clockOf(e) {
  const d = new Date(e.atUTC + (e.atOffset || 0) * 60000);
  const h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m}${h < 12 ? 'am' : 'pm'}`;
}

function roundList(regimen, round, label) {
  const drugs = (regimen.drugs || []).filter((d) => (d.rounds || []).includes(round));
  if (!drugs.length) return '';
  return `<div class="helper-round">
    <h4>${esc(label)}</h4>
    <ul>${drugs.map((d) => `<li><b>${esc(d.name)}</b>${
      d.tabletsPerDose ? ` — ${d.tabletsPerDose} ${d.tabletsPerDose === 1 ? 'tablet' : 'tablets'}` : ''}${
      d.strengthMg ? ` (${d.strengthMg} mg each)` : ''}</li>`).join('')}</ul>
  </div>`;
}

export function renderHelper(root, regimen, now = Date.now()) {
  if (!regimen) { root.innerHTML = '<p class="unknown">Loading…</p>'; return; }
  const events = readEvents();
  const weight = currentWeightKg(events, now);

  const given = (regimen.drugs || []).map((d) => {
    const last = lastDose(events, d.key, now);
    const win = windowFor(d, events, now);
    const n = dosesInWindow(events, d.key, now, win.from).length;
    return { d, last, n, win };
  }).filter((x) => x.last);

  const asNeeded = (regimen.drugs || []).filter((d) => d.asNeeded);
  const checks = checkDefs(events, now);

  root.innerHTML = `<a class="back no-print" href="#home">&larr; Luke</a>
    <h2>If someone else has Luke</h2>
    <p class="vsub no-print">One page for anyone standing in. Print it, or hand them the phone.</p>
    <div class="sheet-actions no-print">
      <button class="btn primary" type="button" id="helper-print">Print this page</button>
    </div>

    <article class="helper">
      <h3>This is Luke</h3>
      <p>A 12-year-old blue Weimaraner. He has <b>kidney disease</b> and <b>arthritis</b>, and he is in end-of-life care. His goals of care are <b>comfort first</b>: <b>no CPR and no hospitalisation</b>.</p>
      <p>He rises slowly, his right hind leg can give out, and he has fallen. Give him time and room to get up. He gets winded and needs breaks.</p>
      ${weight ? `<p>He weighs about <b>${weight.kg.toFixed(1)} kg</b> (${(weight.kg / 0.45359237).toFixed(0)} lb), last weighed ${new Date(weight.at).toISOString().slice(0, 10)}.</p>` : ''}

      <h3>Call someone if you see</h3>
      <ul class="helper-urgent">
        <li><b>Trouble breathing</b> — fast, laboured, or any struggle. His most serious risk.</li>
        <li><b>A swollen or tight belly</b>, especially with retching that brings nothing up. He is a deep-chested breed and this is an emergency.</li>
        <li><b>Collapse, or he cannot get up</b></li>
        <li><b>Gums that are pale, grey or blue</b> rather than pink</li>
        <li><b>Repeated vomiting</b>, or black tarry stool</li>
        <li><b>No urine for many hours</b> — he is on a strong diuretic</li>
        <li><b>Pain his medicines are not touching</b></li>
      </ul>

      <h3>Who to call</h3>
      <p class="helper-call"><b>Bridger Veterinary Specialists &amp; Emergency — (406) 548-4226</b><br>
        Open 24 hours, every day. They hold his history. <b>Call them first, any hour.</b></p>
      <p>Foothills Veterinary Hospital — (406) 556-0604 · his regular vet, weekdays 8am to 6pm.<br>
        Peaceful Journey — 406-414-7240 · in-home hospice, for a comfort question rather than an emergency.</p>
      <p><b>And call Rikki.</b></p>

      <h3>What he is prescribed</h3>
      <p class="helper-warn"><b>Do not give any medicine unless Rikki or a vet tells you to.</b> This list is here so you can tell them what he is on, and so you can read a label. It is not an instruction.</p>
      ${roundList(regimen, 'wake', 'When he wakes')}
      ${roundList(regimen, 'sleep', 'Before sleep')}
      ${asNeeded.length ? `<div class="helper-round"><h4>Only as needed</h4>
        <ul>${asNeeded.map((d) => `<li><b>${esc(d.name)}</b>${d.strengthMg ? ` ${d.strengthMg} mg` : ''} — for pain, only on Rikki's or a vet's say-so</li>`).join('')}</ul></div>` : ''}
      <p>He takes them wrapped in goat cheese. He eats them willingly.</p>

      <h3>What he has already had</h3>
      ${given.length
        ? `<ul>${given.map(({ d, last, n, win }) => `<li><b>${esc(d.name)}</b> — last at ${clockOf(last)}, ${esc(ago(now - last.atUTC))}${
            n > 1 ? `; ${n} in ${esc(win.label)}` : ''}</li>`).join('')}</ul>`
        : '<p class="unknown">Nothing recorded yet. Ask Rikki what he has had before giving anything.</p>'}

      <h3>Eating and drinking</h3>
      <p>He is a devoted eater and he loves carrots — he gets as many as he wants. <b>Him not wanting food, or not chasing what he loves, is worth telling Rikki straight away.</b></p>
      <p>He is on a diuretic, so he drinks a lot and needs to go out often. Always leave water down.</p>

      ${checks.length ? `<h3>Worth a glance</h3><ul>${checks.map((c) =>
        `<li>${esc(c.label)}</li>`).join('')}</ul>
        <p class="helper-small">From his own records, and not yet confirmed.</p>` : ''}

      <h3>If it is his time</h3>
      <p>His vets have said plainly that if an emergency happens, or his quality of life is truly gone, it is reasonable to let him go peacefully. That decision is Rikki's. <b>Your job is to keep him comfortable and get her on the phone.</b></p>
    </article>

    <p class="foot-note no-print">This page is generated from what is recorded in the app. It never recommends a dose.</p>`;
}

/* ------------------------------------------------------- the Understand tab */

let guideText = null;

export async function loadGuide(baseURI) {
  if (guideText != null) return guideText;
  try {
    const res = await fetch(new URL('guide.md', baseURI), { cache: 'no-store' });
    guideText = await res.text();
  } catch {
    guideText = '';
  }
  return guideText;
}

export function renderUnderstand(root) {
  if (guideText == null) { root.innerHTML = '<p class="unknown">Loading…</p>'; return; }
  if (!guideText) {
    root.innerHTML = `<a class="back" href="#home">&larr; Luke</a>
      <h2>Understanding</h2>
      <p class="unknown">The guide could not be loaded. It will be here next time this device has been online once.</p>`;
    return;
  }
  root.innerHTML = `<a class="back no-print" href="#home">&larr; Luke</a>
    <p class="draft"><span aria-hidden="true">⚠</span> Draft, not yet vet-reviewed</p>
    <article class="vetdoc guide">${toHtml(guideText)}</article>`;
}

export function attachHelper() {
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('#helper-print')) window.print();
  });
}
