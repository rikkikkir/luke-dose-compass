/* Luke's Dose Compass — saying it instead of tapping it.

   Rikki asked for this directly: "I could talk through the medications as I'm
   giving them to him, and no buttons or typing would be necessary."

   Three rules, in order of importance:
     1. The recording is kept, always. A failed transcript costs a convenience;
        a discarded recording costs her own voice describing his last weeks.
     2. Nothing becomes a dose without her confirming it (S3).
     3. The buttons stay. They work when the microphone is denied, when there
        is no signal, and when she is too tired to talk. */

import { readEvents, logDose, logObservation, importEvents, recent, inOrder, liveEvents,
         checksDue, logEvent } from './store.js';
import { startRecording, recordingSupported, putAudio, getAudio } from './audio.js';
import { parse, describe as describeParse } from './parse.js';

let regimen = null;
let recorder = null;
let pending = null;      // { parsed, audioId, blob, ms } waiting for her confirmation
let onChange = () => {};

/* Which expandable sections are open. Re-rendering rebuilds the markup, which
   would close them — so tapping one environment chip would collapse the very
   section she is tapping in, for every tap. Remembered here instead. */
const openSections = new Set();

/* The one status line, at body level, outside every render target. Writing a
   message into markup that is about to be rebuilt is how it disappears. */
function say(text) {
  const el = document.getElementById('toast');
  if (el) el.textContent = text;
}

export function init(reg, refresh) { regimen = reg; onChange = refresh || (() => {}); }

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------------ render */

export function renderCapture(root) {
  if (!regimen) { root.innerHTML = '<p class="unknown">Loading…</p>'; return; }
  const events = readEvents();
  const open = (id) => (openSections.has(id) ? ' open' : '');

  const mic = !recordingSupported()
    ? '<p class="unknown">This browser cannot record. The buttons below still work.</p>'
    : recorder
      ? `<button class="mic recording" type="button" id="mic-stop">
           <span class="mic-dot"></span> Stop and save
           <span class="mic-sub">Recording… say what you gave him</span></button>`
      : `<button class="mic" type="button" id="mic-start">
           <span class="mic-icon" aria-hidden="true">●</span> Talk it through
           <span class="mic-sub">Say what you gave him. The recording is always kept.</span></button>`;

  const notes = recent(events, ['note', 'meal', 'water', 'out', 'where', 'weather', 'sleep', 'who', 'mood', 'weight'], Date.now(), 48);

  root.innerHTML = `<a class="back" href="#home">&larr; Luke</a>
    <h2>Tell it what happened</h2>

    ${mic}
    ${pendingCard()}
    ${checkCard(events)}

    <p class="k">Or tap</p>
    <div class="chips quick-adds">
      <button class="chip" type="button" data-obs="meal" data-val="all">Ate it all</button>
      <button class="chip" type="button" data-obs="meal" data-val="half">Ate about half</button>
      <button class="chip" type="button" data-obs="meal" data-val="none">Wouldn't eat</button>
      <button class="chip" type="button" data-obs="water" data-val="some">Drank</button>
      <button class="chip" type="button" data-obs="out" data-val="pee">Peed</button>
      <button class="chip" type="button" data-obs="out" data-val="stool">Stool</button>
    </div>

    <details class="why env" id="env-details"${open('env-details')}>
      <summary>Where he was, and how he seemed</summary>
      <p class="sync-lead">The third thing that acts on him, after his medicines and his food. Everything here is also understood if you just say it.</p>
      ${envGroup('where', 'Where', ['home', 'the car', 'out walking', "someone else's house", 'the vet'])}
      ${envGroup('weather', 'Air', ['hot', 'cold', 'mild', 'wet'])}
      ${envGroup('sleep', 'Slept', ['well', 'restless', 'up a lot', 'barely'])}
      ${envGroup('who', 'With', ['just me', 'alone', 'visitors', 'children', 'other dogs'])}
      ${envGroup('mood', 'Seemed', ['bright', 'quiet', 'clingy', 'anxious', 'content', 'sore'])}
    </details>

    <details class="why" id="weight-details"${open('weight-details')}>
      <summary>Weigh him</summary>
      <p class="sync-lead">His last recorded weight is from 14 September, and it has been used to work out milligrams per kilogram. Worth refreshing.</p>
      <label class="field"><span>Weight, kg</span>
        <input id="weight-kg" inputmode="decimal" placeholder="e.g. 34.8"></label>
      <div class="sheet-actions"><button class="btn primary" type="button" id="weight-save">Record it</button></div>
    </details>

    <p class="k">Recent · ${notes.length} in the last 48 hours</p>
    <div class="entries">${notes.length ? notes.map(noteRow).join('')
      : '<p class="unknown">Nothing yet. Talk to it, or tap something above.</p>'}</div>

    <details class="why" id="import-details"${open('import-details')}>
      <summary>Bring in a log from a file</summary>
      <p class="sync-lead">For getting an existing log onto this device. Nothing is overwritten — entries are added, and anything already here is left alone.</p>
      <input type="file" id="import-file" accept=".json,.ndjson,.txt" aria-label="Log file">
    </details>`;
}

function pendingCard() {
  if (!pending) return '';
  const { parsed, ms } = pending;
  const lines = describeParse(parsed, regimen);
  const secs = Math.round(ms / 1000);

  return `<div class="card pending">
    <span class="k">Is this right?</span>
    <p class="heard">${parsed.heard
      ? `“${esc(parsed.heard)}”`
      : `<span class="unknown">No transcript — ${secs}s of audio saved. You can still keep it as a note.</span>`}</p>
    ${lines.length
      ? `<ul class="understood">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
      : '<p class="unknown">Nothing recognised as a dose. Saving it as a note keeps the recording and your words.</p>'}
    <div class="sheet-actions">
      ${lines.length ? '<button class="btn primary" type="button" id="pending-yes">Yes, log it</button>' : ''}
      <button class="btn" type="button" id="pending-note">Just save the note</button>
      <button class="btn" type="button" id="pending-no">Discard</button>
    </div>
    <p class="sync-msg">Discard removes the proposal. The recording is kept either way.</p>
  </div>`;
}

/* There WAS a carrot counter here, built on a line in her archives calling
   carrot count "the household's quietest, most reliable signal".

   Rikki: "that carrot count concept has been exaggerated in my archives. he
   loves carrots. i dont count them he gets as many as he wants and he
   pursues."

   So the number was never real. What is real is the pursuing — a dog who
   stops chasing the thing he loves is telling you something. That belongs in
   the appetite check, in her words, as something to notice rather than a
   figure to record. Counting was my invention, not her life. */

/* The thirty-second check from her own records. Due by elapsed time, so a
   "daily" check is once per 25.4-hour circle rather than per calendar day. */
function checkCard(events) {
  const due = checksDue(events);
  if (!due.length) return '';
  const waiting = due.filter((c) => c.due);
  if (!waiting.length) {
    return `<div class="card"><span class="k">The quick check</span>
      <p class="unknown">All ${due.length} done for now. ${due.some((c) => c.changed)
        ? 'One was marked changed \u2014 see below.' : ''}</p></div>`;
  }

  return `<div class="card">
    <span class="k">The quick check \u00b7 ${waiting.length} due</span>
    <p class="sync-lead">Thirty seconds of noticing. Most days, all fine.</p>
    ${waiting.map((c) => `<div class="checkrow">
      <div><p class="check-label">${esc(c.def.label)}</p>
        <p class="check-detail">${esc(c.def.detail)}</p></div>
      <div class="check-actions">
        <button class="btn" type="button" data-check="${esc(c.def.checkKey)}" data-cval="ok">Fine</button>
        <button class="btn" type="button" data-check="${esc(c.def.checkKey)}" data-cval="changed">Changed</button>
      </div>
    </div>`).join('')}
    <p class="tierlabel">From his Watch List \u2014 unconfirmed. That page mixes clinical record with written-up notes, and one claim on it turned out to be exaggerated. Worth checking each of these against what you actually do.</p>
  </div>`;
}

function envGroup(type, label, values) {
  return `<p class="k dim">${label}</p><div class="chips">${values.map((v) =>
    `<button class="chip" type="button" data-obs="${type}" data-val="${esc(v)}">${esc(v)}</button>`).join('')}</div>`;
}

function noteRow(e) {
  const when = new Date(e.atUTC + (e.atOffset || 0) * 60000);
  const hh = String(when.getUTCHours()).padStart(2, '0');
  const mm = String(when.getUTCMinutes()).padStart(2, '0');
  const label = e.type === 'meal' ? `Ate: ${e.value || 'some'}`
    : e.type === 'water' ? `Drank: ${e.value || 'some'}`
    : e.type === 'out' ? (e.value === 'stool' ? 'Stool' : 'Peed')
    : e.type === 'weight' ? `Weighed ${e.value} kg`
    : ['where', 'weather', 'sleep', 'who', 'mood'].includes(e.type)
      ? `${({ where: 'Where', weather: 'Air', sleep: 'Slept', who: 'With', mood: 'Seemed' })[e.type]}: ${e.value}`
      : (e.text || 'Note');
  return `<div class="entry">
    <span class="etime">${hh}:${mm}</span>
    <span>${esc(label)}${e.text && e.type !== 'note' ? ` <span class="unknown">${esc(e.text.slice(0, 80))}</span>` : ''}</span>
    ${e.audioId ? `<button class="x" type="button" data-play="${esc(e.audioId)}" aria-label="Play this recording">▶</button>` : '<span></span>'}
  </div>`;
}

/* ------------------------------------------------------------------ actions */

async function startMic() {
  try {
    recorder = await startRecording();
    onChange();
  } catch (err) {
    recorder = null;
    onChange();
    say(err.message);               // says the buttons still work
  }
}

async function stopMic() {
  if (!recorder) return;
  const handle = recorder;
  recorder = null;
  let result;
  try {
    result = await handle.stop();
  } catch {
    onChange();
    say('The recording failed. Nothing was saved, so log it with the buttons.');
    return;
  }

  // The recording is saved BEFORE anything is parsed, so a parser error can
  // never cost her the audio.
  let audioId = null;
  if (result.blob && result.blob.size) {
    audioId = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    try { await putAudio(audioId, result.blob); }
    catch { audioId = null; say('The recording could not be stored on this device.'); }
  }

  const parsed = parse(result.transcript || '', regimen, { round: 'wake' });
  pending = { parsed, audioId, ms: result.ms };
  onChange();
}

function commitPending(asNoteOnly) {
  if (!pending) return;
  const { parsed, audioId } = pending;
  const minutesAgo = parsed.minutesAgo || 0;
  let count = 0;
  let outcome = '';

  try {
    if (!asNoteOnly) {
      for (const dose of parsed.doses) {
        const drug = regimen.drugs.find((d) => d.key === dose.drugKey);
        if (drug) { logDose(drug, { tablets: dose.tablets, minutesAgo }); count++; }
      }
      for (const o of parsed.observations) {
        logObservation(o.type, { value: o.value, text: o.text, minutesAgo, audioId });
        count++;
      }
    }
    // The note always lands, carrying her words and her recording, whether or
    // not anything was understood.
    if (asNoteOnly || parsed.understoodNothing || audioId) {
      logObservation('note', { text: parsed.heard || null, audioId, minutesAgo });
    }
    outcome = asNoteOnly
      ? 'Saved as a note. The recording is attached.'
      : `Logged ${count} thing${count === 1 ? '' : 's'}. The recording is attached.`;
  } catch (err) {
    outcome = `NOT SAVED — ${err.message}`;
  }
  pending = null;
  onChange();      // re-render FIRST, then speak
  say(outcome);
}

async function play(id) {
  try {
    const blob = await getAudio(id);
    if (!blob) { say('That recording is not on this device.'); return; }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  } catch {
    say('Could not play that recording.');
  }
}

async function doImport(file) {
  try {
    const text = await file.text();
    let events;
    if (file.name.endsWith('.ndjson') || text.trimStart().startsWith('{"')) {
      events = text.split('\n').map((l) => l.trim()).filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } else {
      const parsed = JSON.parse(text);
      events = Array.isArray(parsed) ? parsed : (parsed.events || []);
    }
    const r = importEvents(events);
    onChange();   // re-render FIRST, then speak, or the message is wiped
    say(`Added ${r.added}. Already had ${r.alreadyHad}.${r.skipped ? ` Skipped ${r.skipped} unreadable.` : ''} ${r.total} in the log now.`);
  } catch (err) {
    say(`Could not read that file: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ wiring */

export function attach() {
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('#mic-start,#mic-stop,#pending-yes,#pending-note,#pending-no,#weight-save,[data-obs],[data-play],[data-check]');
    if (!t) return;
    if (t.id === 'mic-start')    { startMic(); return; }
    if (t.id === 'mic-stop')     { stopMic(); return; }
    if (t.id === 'pending-yes')  { commitPending(false); return; }
    if (t.id === 'pending-note') { commitPending(true); return; }
    if (t.id === 'pending-no')   { pending = null; onChange(); say('Proposal discarded. The recording is kept.'); return; }
    if (t.dataset.play)          { play(t.dataset.play); return; }
    if (t.dataset.check) {
      const changed = t.dataset.cval === 'changed';
      let outcome = changed
        ? 'Marked as changed. Worth mentioning to his vet.'
        : 'Checked.';
      try { logEvent({ type: 'check', checkKey: t.dataset.check, value: t.dataset.cval }); }
      catch (err) { outcome = `NOT SAVED — ${err.message}`; }
      onChange(); say(outcome); return;
    }
    if (t.id === 'weight-save') {
      const input = document.getElementById('weight-kg');
      const kg = Number((input && input.value || '').trim());
      if (!kg || Number.isNaN(kg)) { say('Type a weight in kilograms first.'); return; }
      let outcome = `Weight recorded: ${kg} kg. Milligrams per kilogram now use this.`;
      try { logObservation('weight', { value: kg }); }
      catch (err) { outcome = `NOT SAVED — ${err.message}`; }
      onChange();
      say(outcome);
      return;
    }
    if (t.dataset.obs) {
      let outcome = 'Logged.';
      try { logObservation(t.dataset.obs, { value: t.dataset.val }); }
      catch (err) { outcome = `NOT SAVED — ${err.message}`; }
      onChange();
      say(outcome);
    }
  });

  // Remember which sections she opened, so a re-render does not shut them.
  document.addEventListener('toggle', (ev) => {
    const d = ev.target;
    if (!d || d.tagName !== 'DETAILS' || !d.id) return;
    if (d.open) openSections.add(d.id); else openSections.delete(d.id);
  }, true);

  document.addEventListener('change', (ev) => {
    if (ev.target && ev.target.id === 'import-file' && ev.target.files && ev.target.files[0]) {
      doImport(ev.target.files[0]);
    }
  });
}

export const __test = { pendingCard, noteRow };
