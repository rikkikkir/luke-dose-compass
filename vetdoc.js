/* Luke's Dose Compass — something to show his vets.

   Rikki's framing, and it is what makes this a document rather than a form:
   "I'd like to be able to share with them what I'm creating so that they can
   learn and understand as well."

   So this is not a questionnaire. It explains what the app knows about Luke,
   where every figure came from, and — the part a clinical reader will care
   about most — WHAT IT REFUSES TO CLAIM. Sources and certainty are the
   substance here, not decoration: a vet will check them.

   It generates from the regimen and the log, so it works with nothing
   imported and nothing set up. */

import {
  readEvents, liveEvents, inOrder, lastDose, cycleLength, cycleHours, cfg, HOUR,
} from './store.js';

const pad = (n) => String(n).padStart(2, '0');

function localStamp(e) {
  const d = new Date(e.atUTC + (e.atOffset || 0) * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function drugLine(d) {
  const strength = d.strengthMg ? `${d.strengthMg} mg` : 'strength not recorded';
  const per = d.tabletsPerDose ? ` × ${d.tabletsPerDose} per dose` : '';
  const total = d.strengthMg && d.tabletsPerDose ? ` = ${d.strengthMg * d.tabletsPerDose} mg` : '';
  const when = (d.rounds || []).length ? ` · ${d.rounds.join(' and ')} round` : (d.asNeeded ? ' · as needed' : ' · timing not recorded');
  return `- **${d.name}**${d.alsoCalled ? ` (${d.alsoCalled})` : ''} — ${strength}${per}${total}${when}  \n  _source: ${d.source || 'unknown'}_`;
}

export function buildVetDoc(regimen, { events = readEvents(), now = Date.now(), days = 14 } = {}) {
  if (!regimen) return '';
  const L = [];
  const cycle = cycleLength(events, now);

  L.push('# Luke — what this app knows, and how');
  L.push('');
  L.push(`Generated ${new Date(now).toDateString()} from Rikki's own log.`);
  L.push('');
  L.push('This is a caregiving tool, not a medical device. It never diagnoses, never recommends a dose, and never suggests when to give one. Everything below is either something Rikki recorded, or a published figure with its source named. Where neither exists, this says so rather than estimating.');
  L.push('');

  /* ---- how time is counted, because it is not a normal day ---- */
  L.push('## How time is counted here');
  L.push('');
  L.push(`Rikki and Luke live on a non-24-hour cycle of about **${cycleHours()} hours**, and wake and sleep together. The app draws time in ${cycleHours()}-hour circles rather than calendar days.`);
  if (!cycle.estimated) {
    L.push('');
    L.push(`Measured across her last ${cycle.samples} wake-to-wake spans: mean **${cycle.hours.toFixed(1)} h**, shortest ${cycle.min.toFixed(1)} h, longest ${cycle.max.toFixed(1)} h.`);
    if (cycle.note) L.push(`_${cycle.note}_`);
  }
  L.push('');
  L.push('**One thing this app deliberately does not do:** predict when the next round will fall. Her cycle varies far too much for that to be honest, so no timing here is a forecast of her.');
  L.push('');
  L.push(`Drug-label limits are still counted in **24 hours**, because a label's "twice a day" means a 24-hour day and not hers. The app names which window it is using every time it shows a total.`);
  L.push('');

  /* ---- the regimen as actually given ---- */
  L.push('## What Luke is actually given');
  L.push('');
  (regimen.drugs || []).forEach((d) => L.push(drugLine(d)));
  L.push('');

  /* ---- what is estimated, and on what basis ---- */
  L.push('## What the app estimates, and from what');
  L.push('');
  L.push('Each of these is a published time window, not a simulated blood level. All are shown to Rikki as ranges with the word "likely".');
  L.push('');
  for (const d of regimen.drugs || []) {
    if (!d.window) continue;
    if (d.window.kind === 'perDose') {
      const w = d.window;
      L.push(`**${d.name}** — onset ${w.onsetMinFrom}–${w.onsetMinTo} min · peak ${w.peakHoursFrom}–${w.peakHoursTo} h · fading by ${w.durationHoursFrom}–${w.durationHoursTo} h`);
    } else {
      L.push(`**${d.name}** — builds over ${d.window.daysToEffectFrom}–${d.window.daysToEffectTo} days rather than acting per dose`);
    }
    if (d.variability) L.push(`  \n  ${d.variability}`);
    for (const s of d.sources || []) L.push(`  \n  _Source: ${s}_`);
    L.push('');
  }

  /* ---- the part a clinician will care about most ---- */
  L.push('## What the app refuses to estimate, and why');
  L.push('');
  L.push('**No minimum gap is enforced for any drug.** Nothing in Luke\'s records sets one, and the app will not invent a dose interval that no vet prescribed. It therefore does not block a dose — it shows what has been given and leaves the decision with Rikki.');
  L.push('');
  const noWindow = (regimen.drugs || []).filter((d) => !d.window);
  if (noWindow.length) {
    L.push(`**No time course is shown for:** ${noWindow.map((d) => d.name).join(', ')} — there is no reliable published figure at these doses in dogs, so the app shows nothing rather than a plausible shape.`);
    L.push('');
  }
  const noMax = (regimen.drugs || []).filter((d) => d.maxPer24hMg == null && d.maxPer24hDoses == null);
  if (noMax.length) {
    L.push(`**No daily maximum is recorded for:** ${noMax.map((d) => d.name).join(', ')}.`);
    L.push('');
  }

  /* ---- interactions, and what that claim is worth ---- */
  if ((regimen.interactions || []).length) {
    L.push('## Interactions noted');
    L.push('');
    L.push(`_${regimen.interactionsNote || ''}_`);
    L.push('');
    for (const i of regimen.interactions) {
      L.push(`- ${i.text}  \n  _${i.tier === 'known' ? 'Published' : 'Extrapolated'}${(i.sources || []).length ? ': ' + i.sources.join('; ') : ''}_`);
    }
    L.push('');
  }

  /* ---- the questions ---- */
  L.push('## Questions Rikki is carrying');
  L.push('');
  const asked = [];
  for (const d of regimen.drugs || []) {
    for (const u of d.unknowns || []) asked.push(`- **${d.name}:** ${u}`);
  }
  for (const f of regimen.foodNotes || []) {
    const drug = (regimen.drugs || []).find((x) => x.key === f.drug);
    asked.push(`- **${drug ? drug.name : f.drug}, timing with food:** ${f.text}`);
  }
  if (asked.length) asked.forEach((a) => L.push(a));
  else L.push('_None recorded._');
  L.push('');

  /* ---- the log ---- */
  L.push(`## What actually happened, last ${days} days`);
  L.push('');
  const from = now - days * 24 * HOUR;
  const live = inOrder(liveEvents(events)).filter((e) => e.atUTC >= from && e.atUTC <= now);
  const nameOf = (k) => ((regimen.drugs || []).find((d) => d.key === k) || {}).name || k;

  if (!live.length) {
    L.push('_Nothing logged in this period._');
  } else {
    let day = '';
    for (const e of live) {
      const stamp = localStamp(e);
      const thisDay = stamp.slice(0, 10);
      if (thisDay !== day) { day = thisDay; L.push(''); L.push(`**${day}**`); }
      const t = stamp.slice(11);
      if (e.type === 'dose') {
        const d = (regimen.drugs || []).find((x) => x.key === e.drugKey);
        const mg = d && d.strengthMg ? ` (${e.tablets * d.strengthMg} mg)` : '';
        L.push(`- ${t} ${nameOf(e.drugKey)} ${e.tablets}${mg}${e.pastMax ? '  **[past the label]**' : ''}`);
      } else if (e.type === 'wake')  L.push(`- ${t} — woke —`);
      else if (e.type === 'sleep')   L.push(`- ${t} — sleep started —`);
      else if (e.type === 'meal')    L.push(`- ${t} ate: ${e.value || 'amount not recorded'}${e.text ? ` — "${e.text}"` : ''}`);
      else if (e.type === 'water')   L.push(`- ${t} drank: ${e.value || 'amount not recorded'}`);
      else if (e.type === 'out')     L.push(`- ${t} ${e.value === 'stool' ? 'stool' : 'urinated'}`);
      else if (e.type === 'note' && e.text) L.push(`- ${t} note: "${e.text}"`);
    }
  }
  L.push('');
  L.push('---');
  L.push('');
  L.push('_An undone entry does not appear above. The original record is kept but does not count — nothing is ever deleted from the log._');

  return L.join('\n');
}

/* A very small renderer for exactly the markdown this file emits. The document
   is meant to be read by a vet, and asterisks on screen do not read as a
   document. The copy button still hands over the markdown, which is what a
   message or a chat wants. */
function toHtml(md) {
  const inline = (t) => t
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/_([^_]+)_/g, '<i>$1</i>');

  const out = [];
  let list = false;
  const closeList = () => { if (list) { out.push('</ul>'); list = false; } };

  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line) { closeList(); continue; }
    if (line === '---') { closeList(); out.push('<hr>'); continue; }
    if (line.startsWith('## ')) { closeList(); out.push(`<h3>${inline(line.slice(3))}</h3>`); continue; }
    if (line.startsWith('# ')) { closeList(); out.push(`<h2>${inline(line.slice(2))}</h2>`); continue; }
    if (line.startsWith('- ')) {
      if (!list) { out.push('<ul>'); list = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    // A line that only continues the one above it (two-space markdown break).
    if (/^\s{2,}/.test(raw) && list) { out.push(`<li class="cont">${inline(line.trim())}</li>`); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

export function renderVetDoc(root, regimen) {
  if (!regimen) { root.innerHTML = '<p class="unknown">Loading…</p>'; return; }
  const text = buildVetDoc(regimen);

  root.innerHTML = `<a class="back" href="#home">&larr; Luke</a>
    <h2>For his vets</h2>
    <p class="vsub">What this app knows about Luke, where each figure came from, and what it refuses to claim. Written to be read by someone clinical.</p>
    <div class="sheet-actions no-print">
      <button class="btn primary" type="button" id="vet-copy">Copy it all</button>
      <button class="btn" type="button" id="vet-print">Print</button>
    </div>
    <article class="vetdoc">${toHtml(text)}</article>`;
}

export function attachVetDoc(regimenRef, say) {
  document.addEventListener('click', async (ev) => {
    const t = ev.target.closest('#vet-copy,#vet-print');
    if (!t) return;
    const regimen = regimenRef();
    if (t.id === 'vet-print') { window.print(); return; }
    try {
      await navigator.clipboard.writeText(buildVetDoc(regimen));
      say('Copied. Paste it into an email, a message, or your Claude chat.');
    } catch {
      say('Could not reach the clipboard — select the text below and copy it.');
    }
  });
}
