/* Luke's Dose Compass — saying it instead of tapping it.

   Rikki asked for this directly: "I could talk through the medications as I'm
   giving them to him, and no buttons or typing would be necessary."

   Three rules, in order of importance:
     1. The recording is kept, always. A failed transcript costs a convenience;
        a discarded recording costs her own voice describing his last weeks.
     2. Nothing becomes a dose without her confirming it (S3).
     3. The buttons stay. They work when the microphone is denied, when there
        is no signal, and when she is too tired to talk. */

import { readEvents, logDose, logObservation, importEvents, recent, inOrder, liveEvents } from './store.js';
import { startRecording, recordingSupported, putAudio, getAudio } from './audio.js';
import { parse, describe as describeParse } from './parse.js';

let regimen = null;
let recorder = null;
let pending = null;      // { parsed, audioId, blob, ms } waiting for her confirmation
let onChange = () => {};

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

  const mic = !recordingSupported()
    ? '<p class="unknown">This browser cannot record. The buttons below still work.</p>'
    : recorder
      ? `<button class="mic recording" type="button" id="mic-stop">
           <span class="mic-dot"></span> Stop and save
           <span class="mic-sub">Recording… say what you gave him</span></button>`
      : `<button class="mic" type="button" id="mic-start">
           <span class="mic-icon" aria-hidden="true">●</span> Talk it through
           <span class="mic-sub">Say what you gave him. The recording is always kept.</span></button>`;

  const notes = recent(events, ['note', 'meal', 'water', 'out'], Date.now(), 48);

  root.innerHTML = `<a class="back" href="#home">&larr; Luke</a>
    <h2>Tell it what happened</h2>

    ${mic}
    ${pendingCard()}

    <p class="k">Or tap</p>
    <div class="chips">
      <button class="chip" type="button" data-obs="meal" data-val="all">Ate it all</button>
      <button class="chip" type="button" data-obs="meal" data-val="half">Ate about half</button>
      <button class="chip" type="button" data-obs="meal" data-val="none">Wouldn't eat</button>
      <button class="chip" type="button" data-obs="water" data-val="some">Drank</button>
      <button class="chip" type="button" data-obs="out" data-val="pee">Peed</button>
      <button class="chip" type="button" data-obs="out" data-val="stool">Stool</button>
    </div>

    <p class="k">Recent · ${notes.length} in the last 48 hours</p>
    <div class="entries">${notes.length ? notes.map(noteRow).join('')
      : '<p class="unknown">Nothing yet. Talk to it, or tap something above.</p>'}</div>

    <details class="why">
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

function noteRow(e) {
  const when = new Date(e.atUTC + (e.atOffset || 0) * 60000);
  const hh = String(when.getUTCHours()).padStart(2, '0');
  const mm = String(when.getUTCMinutes()).padStart(2, '0');
  const label = e.type === 'meal' ? `Ate: ${e.value || 'some'}`
    : e.type === 'water' ? `Drank: ${e.value || 'some'}`
    : e.type === 'out' ? (e.value === 'stool' ? 'Stool' : 'Peed')
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
    const t = ev.target.closest('#mic-start,#mic-stop,#pending-yes,#pending-note,#pending-no,[data-obs],[data-play]');
    if (!t) return;
    if (t.id === 'mic-start')    { startMic(); return; }
    if (t.id === 'mic-stop')     { stopMic(); return; }
    if (t.id === 'pending-yes')  { commitPending(false); return; }
    if (t.id === 'pending-note') { commitPending(true); return; }
    if (t.id === 'pending-no')   { pending = null; onChange(); say('Proposal discarded. The recording is kept.'); return; }
    if (t.dataset.play)          { play(t.dataset.play); return; }
    if (t.dataset.obs) {
      let outcome = 'Logged.';
      try { logObservation(t.dataset.obs, { value: t.dataset.val }); }
      catch (err) { outcome = `NOT SAVED — ${err.message}`; }
      onChange();
      say(outcome);
    }
  });

  document.addEventListener('change', (ev) => {
    if (ev.target && ev.target.id === 'import-file' && ev.target.files && ev.target.files[0]) {
      doImport(ev.target.files[0]);
    }
  });
}

export const __test = { pendingCard, noteRow };
