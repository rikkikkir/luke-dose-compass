/* Luke's Dose Compass — the event log.

   Append-only (S5): nothing is ever edited or removed. An undo appends a
   'void' event pointing at the original, and a void can itself be voided.

   Every event carries the UTC moment it HAPPENED and the UTC moment it was
   LOGGED, each with the timezone offset in force at the time. All arithmetic
   uses elapsed milliseconds between UTC instants, so a daylight-saving change
   or a drive into another timezone cannot move a countdown. Clock time is only
   ever a label.

   The limits that applied to a dose are copied ONTO the dose, not referenced.
   An old entry therefore keeps the rules that were in force when it was
   logged, even after the regimen changes, and an exported record explains
   itself with no other file.

   This app does not block doses. See DECISIONS.md: no drug in Luke's regimen
   has a prescribed minimum gap, S1 forbids the app suggesting timing the vet
   did not give, and Rikki asked not to be locked out. Passing a prescribed
   maximum is recorded and shown, never prevented. */

export const EVENTS_KEY = 'luke.events.v1';
export const REGIMEN_KEY = 'luke.regimen.v1';
export const BACKUP_KEY = 'luke.lastBackup.v1';

export const HOUR = 3600000;
export const WINDOW_HOURS = 24;

/* ---------------------------------------------------------------- storage */

/* Falls back to memory so a private window, a blocked-storage setting, or a
   node test never throws. The app warns separately when storage is not
   durable; it never crashes. */
const memory = new Map();

function backing() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('luke.probe', '1');
      localStorage.removeItem('luke.probe');
      return localStorage;
    }
  } catch { /* fall through */ }
  return {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, v),
    removeItem: (k) => memory.delete(k),
  };
}

export function storageIsDurable() {
  try {
    return typeof localStorage !== 'undefined' && backing() === localStorage;
  } catch { return false; }
}

export function readEvents() {
  try {
    const raw = backing().getItem(EVENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];   // never let a corrupt blob take the app down
  }
}

/* Writes, then reads back and confirms the new record is really there.

   The screen must never say "given" from hope. If the write failed — a full
   disk, a browser refusing storage — she has to find out now, while she still
   remembers giving the dose, not at the next lockout count. */
export function writeEvents(events) {
  const json = JSON.stringify(events);
  backing().setItem(EVENTS_KEY, json);
  const readBack = backing().getItem(EVENTS_KEY);
  if (readBack !== json) throw new Error('the dose was not saved');
  return events;
}

/* -------------------------------------------------------------- the model */

export function nextSeq(events) {
  return events.reduce((max, e) => (e.seq > max ? e.seq : max), 0) + 1;
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* A dose. minutesAgo backdates it: the event time moves, the logged time
   does not, and both are kept. */
export function makeDose({ drug, tablets, minutesAgo = 0, now = Date.now(), events = [] }) {
  const atUTC = now - minutesAgo * 60000;
  const offset = -new Date(atUTC).getTimezoneOffset();
  return {
    id: newId(),
    seq: nextSeq(events),
    type: 'dose',
    drugKey: drug.key,
    tablets: tablets ?? drug.tabletsPerDose ?? 1,
    atUTC,
    atOffset: offset,
    loggedUTC: now,
    loggedOffset: -new Date(now).getTimezoneOffset(),
    limitsAtDose: limitsOf(drug),
    pastMax: null,      // filled in by logDose
  };
}

export function makeMark({ type, minutesAgo = 0, now = Date.now(), events = [] }) {
  const atUTC = now - minutesAgo * 60000;
  return {
    id: newId(),
    seq: nextSeq(events),
    type,                            // 'wake' | 'sleep'
    atUTC,
    atOffset: -new Date(atUTC).getTimezoneOffset(),
    loggedUTC: now,
    loggedOffset: -new Date(now).getTimezoneOffset(),
  };
}

export function makeVoid({ targetId, now = Date.now(), events = [] }) {
  return {
    id: newId(),
    seq: nextSeq(events),
    type: 'void',
    voids: targetId,
    atUTC: now,
    atOffset: -new Date(now).getTimezoneOffset(),
    loggedUTC: now,
    loggedOffset: -new Date(now).getTimezoneOffset(),
  };
}

export function limitsOf(drug) {
  return {
    maxPerDoseTablets: drug.maxPerDoseTablets ?? null,
    maxPer24hMg: drug.maxPer24hMg ?? null,
    maxPer24hDoses: drug.maxPer24hDoses ?? null,
    maxPer24hTablets: drug.maxPer24hTablets ?? null,
    minGapHours: drug.minGapHours ?? null,      // null everywhere today, and that is the point
    strengthMg: drug.strengthMg ?? null,
    source: drug.source ?? 'unknown',
  };
}

/* --------------------------------------------------------------- liveness */

/* An event is live unless a LIVE void points at it. Undo of an undo therefore
   brings the original back. A void always has a higher seq than its target,
   so the recursion terminates. */
export function isLive(event, events) {
  const seen = new Map();
  function live(e) {
    if (seen.has(e.id)) return seen.get(e.id);
    seen.set(e.id, true);
    const killers = events.filter((x) => x.type === 'void' && x.voids === e.id);
    const result = !killers.some((k) => live(k));
    seen.set(e.id, result);
    return result;
  }
  return live(event);
}

export function liveEvents(events) {
  return events.filter((e) => e.type !== 'void' && isLive(e, events));
}

/* Sorted by when things HAPPENED, with seq breaking ties. seq is what keeps a
   backdated entry, or a device whose clock jumped, in a stable order. */
export function inOrder(events) {
  return [...events].sort((a, b) => (a.atUTC - b.atUTC) || (a.seq - b.seq));
}

/* ------------------------------------------------------------- the questions */

export function lastDose(events, drugKey, now = Date.now()) {
  const doses = inOrder(liveEvents(events))
    .filter((e) => e.type === 'dose' && e.drugKey === drugKey && e.atUTC <= now);
  return doses.length ? doses[doses.length - 1] : null;
}

/* Which window a drug's total should be counted over.

   This matters more than it looks. Rikki's cycle averages 25.4 hours, so a
   rolling 24-hour window routinely contains more than one cycle's worth of a
   twice-a-round drug. Counting furosemide that way would announce that Luke is
   over his daily label on any cycle shorter than 24 hours — which happens
   often — and a warning that cries wolf every few nights is worse than no
   warning at all.

   So: a drug given by round is counted over the wake cycle, because that is
   how she actually gives it. An as-needed drug is counted over a rolling 24
   hours, because that is what "2 a day" on a label means. The window in use is
   always named on screen. */
export function windowFor(drug, events, now = Date.now()) {
  const byRound = (drug.rounds || []).length > 0;
  if (byRound) {
    const wake = lastWake(events, now);
    if (wake) return { from: wake.atUTC, label: 'this wake cycle', basis: 'cycle' };
    // No wake logged yet, so the cycle is unknown. Fall back to the rolling
    // window and say so, rather than inventing a cycle start.
    return { from: now - WINDOW_HOURS * HOUR, label: 'the last 24 hours', basis: 'rolling', estimated: true };
  }
  return { from: now - WINDOW_HOURS * HOUR, label: 'the last 24 hours', basis: 'rolling' };
}

export function dosesInWindow(events, drugKey, now = Date.now(), from = null) {
  const start = from == null ? now - WINDOW_HOURS * HOUR : from;
  return liveEvents(events).filter(
    (e) => e.type === 'dose' && e.drugKey === drugKey && e.atUTC >= start && e.atUTC <= now
  );
}

export function tabletsInWindow(events, drugKey, now = Date.now(), from = null) {
  return dosesInWindow(events, drugKey, now, from).reduce((n, e) => n + (e.tablets || 0), 0);
}

export function lastWake(events, now = Date.now()) {
  const wakes = inOrder(liveEvents(events)).filter((e) => e.type === 'wake' && e.atUTC <= now);
  return wakes.length ? wakes[wakes.length - 1] : null;
}

/* Would this dose pass a maximum the vet actually prescribed? Reported, never
   enforced. Returns null when nothing is known, which is the common case —
   an unknown limit produces silence, not a guess. */
export function checkAgainstMax(drug, events, { tablets, now = Date.now() } = {}) {
  const limits = limitsOf(drug);
  const n = tablets ?? drug.tabletsPerDose ?? 1;
  const win = windowFor(drug, events, now);
  const passed = [];

  if (limits.maxPerDoseTablets != null && n > limits.maxPerDoseTablets) {
    passed.push({ limit: 'in one dose', max: limits.maxPerDoseTablets, value: n, unit: 'tablets' });
  }
  if (limits.maxPer24hDoses != null) {
    const count = dosesInWindow(events, drug.key, now, win.from).length + 1;
    if (count > limits.maxPer24hDoses) {
      passed.push({ limit: `in ${win.label}`, max: limits.maxPer24hDoses, value: count, unit: 'doses' });
    }
  }
  if (limits.maxPer24hTablets != null) {
    const t = tabletsInWindow(events, drug.key, now, win.from) + n;
    if (t > limits.maxPer24hTablets) {
      passed.push({ limit: `in ${win.label}`, max: limits.maxPer24hTablets, value: t, unit: 'tablets' });
    }
  }
  // An unknown strength must never be treated as zero: that would make every
  // milligram ceiling silently unreachable. No strength, no milligram check.
  if (limits.maxPer24hMg != null && limits.strengthMg != null) {
    const mg = (tabletsInWindow(events, drug.key, now, win.from) + n) * limits.strengthMg;
    if (mg > limits.maxPer24hMg) {
      passed.push({ limit: `in ${win.label}`, max: limits.maxPer24hMg, value: mg, unit: 'mg' });
    }
  }
  return passed.length ? passed : null;
}

/* --------------------------------------------------------- effect windows */

/* One function for every drug, driven by regimen.json, rather than a function
   per drug. A drug with no sourced window returns null and the screen shows
   nothing — never a guess dressed as a window. */
export function effectWindow(drug, elapsedMs) {
  const w = drug && drug.window;
  if (!w || w.kind !== 'perDose' || elapsedMs == null) return null;
  const mins = elapsedMs / 60000;
  const { onsetMinFrom, onsetMinTo, peakHoursFrom, peakHoursTo,
          durationHoursFrom, durationHoursTo } = w;

  if (mins < onsetMinFrom) {
    return { phase: 'starting', icon: '·', word: 'Just given',
      line: `Likely starts working in about ${onsetMinFrom}–${onsetMinTo} minutes.` };
  }
  if (mins < peakHoursFrom * 60) {
    return { phase: 'onset', icon: '○', word: 'Starting',
      line: `Strongest effect is likely ${peakHoursFrom}–${peakHoursTo} hours after the dose.` };
  }
  if (mins <= peakHoursTo * 60) {
    return { phase: 'peak', icon: '●', word: 'Strongest now',
      line: 'This is the window where the effect is likely at its strongest.' };
  }
  if (mins <= durationHoursTo * 60) {
    return { phase: 'easing', icon: '◐', word: 'Easing',
      line: `Usually fading by around ${durationHoursFrom}–${durationHoursTo} hours after the dose.` };
  }
  return { phase: 'past', icon: '✓', word: 'Likely past',
    line: `Past the usual ${durationHoursFrom}–${durationHoursTo} hour window.` };
}

/* Amantadine and Cosequin do not act per dose. They build, and the honest
   thing to show is how far into that build he is. */
export function buildupState(drug, events, now = Date.now()) {
  const w = drug && drug.window;
  if (!w || w.kind !== 'buildsOverDays') return null;
  const doses = inOrder(liveEvents(events)).filter(
    (e) => e.type === 'dose' && e.drugKey === drug.key && e.atUTC <= now
  );
  if (!doses.length) return { phase: 'none', icon: '·', word: 'Not logged yet', line: '' };

  const days = (now - doses[0].atUTC) / (24 * HOUR);
  const { daysToEffectFrom, daysToEffectTo } = w;
  const dayNumber = Math.floor(days) + 1;
  if (days < daysToEffectFrom) {
    return { phase: 'building', icon: '○', word: 'Still building', days,
      line: `Takes ${daysToEffectFrom}–${daysToEffectTo} days of daily dosing before any benefit shows. This is day ${dayNumber}.`,
      note: 'The log only knows what it was told, so this counts from the first dose recorded here, not from when he actually started.' };
  }
  return { phase: 'established', icon: '●', word: 'Established', days,
    line: `Past the ${daysToEffectFrom}–${daysToEffectTo} days it usually takes to build. This is day ${dayNumber}.` };
}

/* --------------------------------------------------------- the body view */

/* What is acting on each part of him right now. Everything returned carries a
   tier: known (published and cited), logged (her own record), or extrapolated.
   A system with nothing acting on it says so rather than looking calm. */
export function bodyState(events, regimen, now = Date.now()) {
  if (!regimen || !regimen.systems) return [];

  return regimen.systems.map((system) => {
    const acting = [];

    for (const drug of regimen.drugs || []) {
      const act = (drug.acts || []).find((a) => a.system === system.key);
      if (!act) continue;

      const last = lastDose(events, drug.key, now);
      const build = buildupState(drug, events, now);

      if (build) {
        if (build.phase !== 'none') {
          acting.push({ drug, act, state: build, kind: 'builds', tier: act.tier, last });
        }
        continue;
      }
      if (!last) continue;

      const state = effectWindow(drug, now - last.atUTC);
      if (state) acting.push({ drug, act, state, kind: 'window', tier: act.tier, last });
      else acting.push({ drug, act, state: null, kind: 'logged-only', tier: act.tier, last });
    }

    const interactions = (regimen.interactions || []).filter(
      (i) => (i.systems || []).includes(system.key)
             && i.between.every((k) => (regimen.drugs || []).some((d) => d.key === k))
    );

    /* A caveat belongs to a system when it says so, or when its drug is acting
       here. This is how a real fact about amantadine and kidneys reaches the
       water system without being dressed up as an interaction between two
       drugs, which it is not. */
    const caveats = (regimen.drugs || []).flatMap((drug) => {
      const actsHere = acting.some((a) => a.drug.key === drug.key);
      return (drug.caveats || [])
        .filter((c) => (c.systems ? c.systems.includes(system.key) : actsHere))
        .map((c) => ({ ...c, drug: drug.name }));
    });

    return { system, acting, interactions, caveats };
  });
}

/* ------------------------------------------------------------------ writes */

export function logDose(drug, { tablets, minutesAgo = 0, now = Date.now() } = {}) {
  const events = readEvents();
  const dose = makeDose({ drug, tablets, minutesAgo, now, events });
  dose.pastMax = checkAgainstMax(drug, events, { tablets: dose.tablets, now });
  events.push(dose);
  writeEvents(events);
  return dose;
}

export function logMark(type, { minutesAgo = 0, now = Date.now() } = {}) {
  const events = readEvents();
  const mark = makeMark({ type, minutesAgo, now, events });
  events.push(mark);
  writeEvents(events);
  return mark;
}

export function undo(targetId, { now = Date.now() } = {}) {
  const events = readEvents();
  const v = makeVoid({ targetId, now, events });
  events.push(v);
  writeEvents(events);
  return v;
}

/* ------------------------------------------------------------------ export */

export function exportPayload(events = readEvents(), regimen = null) {
  return {
    app: 'luke-dose-compass',
    exportedAt: new Date().toISOString(),
    schema: 1,
    events,
    regimen,
  };
}

export function markBackedUp(now = Date.now()) {
  backing().setItem(BACKUP_KEY, String(now));
  return now;
}

export function daysSinceBackup(now = Date.now()) {
  const raw = backing().getItem(BACKUP_KEY);
  if (!raw) return null;
  return (now - Number(raw)) / (24 * HOUR);
}

/* ------------------------------------------------------------ the regimen */

/* regimen.json ships the seed. Rikki's own edits live on her device and win.
   A drug she has corrected keeps her values; a drug she has not touched keeps
   the seed, so a corrected seed still reaches her. Doses already logged are
   untouched either way, because their limits were copied onto them. */

export function readLocalRegimen() {
  try {
    const raw = backing().getItem(REGIMEN_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Array.isArray(parsed.drugs) ? parsed : null;
  } catch { return null; }
}

export function writeLocalRegimen(drugs, now = Date.now()) {
  const payload = { schema: 1, editedAt: now, drugs };
  const json = JSON.stringify(payload);
  backing().setItem(REGIMEN_KEY, json);
  if (backing().getItem(REGIMEN_KEY) !== json) throw new Error('the change was not saved');
  return payload;
}

export function mergeRegimen(seed, local) {
  if (!local) return seed;
  const byKey = new Map((seed.drugs || []).map((d) => [d.key, d]));
  for (const mine of local.drugs) {
    const base = byKey.get(mine.key) || {};
    // 'source' becomes 'Rikki' the moment she touches a drug, so the screen can
    // stop calling a value a placeholder once a real one replaces it.
    byKey.set(mine.key, { ...base, ...mine });
  }
  return { ...seed, drugs: [...byKey.values()] };
}

/* ------------------------------------------------------------- plain text */

/* For pasting into her Claude chat project. Plain text beats a spreadsheet
   here: the point is a conversation about what happened, and half the drugs
   still have no name, which the header says out loud so the reader is not
   left guessing. */
export function asText(events, regimen, { days = 7, now = Date.now() } = {}) {
  const from = now - days * 24 * HOUR;
  const live = inOrder(liveEvents(events)).filter((e) => e.atUTC >= from && e.atUTC <= now);
  const drugOf = (k) => (regimen.drugs || []).find((d) => d.key === k);

  const lines = [];
  lines.push(`Luke — dose log, the last ${days} days`);
  lines.push(`Copied ${new Date(now).toDateString()}`);
  lines.push('');
  lines.push('WHAT IS KNOWN ABOUT EACH DRUG');
  for (const d of regimen.drugs || []) {
    const known = d.strengthMg ? `${d.strengthMg} mg tablets` : 'strength unknown';
    const per = d.tabletsPerDose ? `, ${d.tabletsPerDose} per dose` : '';
    const cap = d.maxPer24hMg ? `, label max ${d.maxPer24hMg} mg/day`
      : d.maxPer24hDoses ? `, label max ${d.maxPer24hDoses} doses/day` : '';
    const gap = d.minGapHours ? `, minimum gap ${d.minGapHours} h` : ', no minimum gap has been set by a vet';
    lines.push(`- ${d.name}: ${known}${per}${cap}${gap} (source: ${d.source || 'unknown'})`);
    if (d.placeholder) lines.push(`    still a placeholder — no real name or strength${d.vq ? ` (${d.vq})` : ''}`);
  }
  lines.push('');
  lines.push('WHAT HAPPENED');
  if (!live.length) lines.push('(nothing logged in this period)');

  let day = '';
  for (const e of live) {
    const local = new Date(e.atUTC + e.atOffset * 60000);
    const thisDay = local.toISOString().slice(0, 10);
    if (thisDay !== day) { day = thisDay; lines.push(''); lines.push(local.toUTCString().slice(0, 16)); }
    const hh = String(local.getUTCHours()).padStart(2, '0');
    const mm = String(local.getUTCMinutes()).padStart(2, '0');
    if (e.type === 'wake') { lines.push(`  ${hh}:${mm}  — we woke —`); continue; }
    if (e.type === 'sleep') { lines.push(`  ${hh}:${mm}  — sleep started —`); continue; }
    const d = drugOf(e.drugKey);
    const mg = d && d.strengthMg ? ` (${e.tablets * d.strengthMg} mg)` : '';
    const flag = e.pastMax ? '   [past the label]' : '';
    lines.push(`  ${hh}:${mm}  ${d ? d.name : e.drugKey}  ${e.tablets} tablet${e.tablets === 1 ? '' : 's'}${mg}${flag}`);
  }

  lines.push('');
  lines.push('NOTES');
  lines.push('- Times are when the dose was given, not when it was typed in.');
  lines.push('- An undone dose is not listed; the original record is kept but does not count.');
  lines.push('- This app does not block doses and does not recommend them.');
  return lines.join('\n');
}

/* ===========================================================================
   Everything that is not a dose.

   Tonight's question was about food, and the app could not hold a word of it.
   These are the other things that act on him: what he ate, what he drank,
   what came out, where he was, how he seemed. Same event shape as a dose, same
   append-only rules, same two timestamps, so the log stays one thing.
   =========================================================================== */

export const OBSERVATION_TYPES = ['meal', 'water', 'out', 'note', 'where', 'mood', 'weather'];

export function makeObservation({ type, value, text, audioId, minutesAgo = 0,
                                  now = Date.now(), events = [], source = 'Rikki' }) {
  const atUTC = now - minutesAgo * 60000;
  return {
    id: newId(),
    seq: nextSeq(events),
    type,
    value: value ?? null,        // 'all' | 'half' | 'none' | a number | a place
    text: text ?? null,          // her own words, which are the part worth keeping
    audioId: audioId ?? null,    // a recording lives in IndexedDB under this id
    source,                      // 'Rikki' | 'oura' | 'maven' | 'tractive'
    atUTC,
    atOffset: -new Date(atUTC).getTimezoneOffset(),
    loggedUTC: now,
    loggedOffset: -new Date(now).getTimezoneOffset(),
  };
}

export function logObservation(type, opts = {}) {
  const events = readEvents();
  const o = makeObservation({ type, ...opts, events });
  events.push(o);
  writeEvents(events);
  return o;
}

export function recent(events, types, now = Date.now(), hours = 24) {
  const from = now - hours * HOUR;
  return inOrder(liveEvents(events))
    .filter((e) => types.includes(e.type) && e.atUTC > from && e.atUTC <= now)
    .reverse();
}

export function lastOf(events, type, now = Date.now()) {
  const all = inOrder(liveEvents(events)).filter((e) => e.type === type && e.atUTC <= now);
  return all.length ? all[all.length - 1] : null;
}

/* Did he eat, and how much? The body view needs this because Galliprant's
   absorption depends on it, and because a dog who stops eating is the thing
   that matters most. */
export function ateRecently(events, now = Date.now(), hours = 3) {
  const meals = recent(events, ['meal'], now, hours);
  if (!meals.length) return null;
  const m = meals[0];
  return { at: m.atUTC, amount: m.value, text: m.text, agoMs: now - m.atUTC };
}

/* ---------------------------------------------------------------- import */

/* Merging someone else's copy of the log, from a file or from the shared repo.
   Union by id, exactly like sync: an event is immutable and an undo is its own
   event, so two copies can only ever know different subsets of one history.
   Nothing is overwritten and nothing is dropped. */
export function importEvents(incoming, { now = Date.now() } = {}) {
  if (!Array.isArray(incoming)) throw new Error('that file does not look like a log');
  const mine = readEvents();
  const known = new Set(mine.map((e) => e.id));

  const usable = incoming.filter((e) => e && e.id && e.type && Number.isFinite(e.atUTC));
  const added = usable.filter((e) => !known.has(e.id));
  const skipped = incoming.length - usable.length;

  if (added.length) {
    const merged = [...mine, ...added].sort((a, b) => (a.atUTC - b.atUTC) || ((a.seq || 0) - (b.seq || 0)));
    writeEvents(merged);
  }
  return { added: added.length, alreadyHad: usable.length - added.length, skipped, total: readEvents().length };
}

/* ===========================================================================
   The config, her circles, and what is still working in him.

   TWO UNITS OF TIME, AND THE APP ALWAYS SAYS WHICH IT IS USING:

     25.4 hours  the day Rikki and Luke actually live in. How time is drawn.
     24 hours    only for "the label says 2 a day". A drug label's day is not
                 hers, and collapsing the two produced false over-the-label
                 warnings before this was separated out.

   Nothing here predicts when she will wake. Her last thirty wake-to-wake
   spans ran from 14.2 to 59.8 hours; predicting from the mean misses by about
   nine hours. The 25.4-hour circle is a FRAME, not a forecast.
   =========================================================================== */

let CONFIG = null;

/* CLAUDE.md: "the app reads default settings from this file" and "change the
   number in config.defaults.json, never in prose." The file shipped from the
   first deploy and was never actually read until now. */
export async function loadConfig(baseURI) {
  try {
    const url = new URL('config.defaults.json', baseURI || 'http://localhost/');
    const res = await fetch(url, { cache: 'no-store' });
    CONFIG = await res.json();
  } catch {
    CONFIG = null;          // every caller passes a fallback
  }
  return CONFIG;
}

export function setConfig(c) { CONFIG = c; }

/* Each entry is { value, source, note }, so the source travels with the number. */
export function cfg(path, fallback) {
  if (!CONFIG) return fallback;
  const entry = path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), CONFIG);
  if (entry && typeof entry === 'object' && 'value' in entry) return entry.value;
  return entry === undefined ? fallback : entry;
}

export function cfgSource(path) {
  if (!CONFIG) return null;
  const entry = path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), CONFIG);
  return entry && entry.source ? { source: entry.source, note: entry.note } : null;
}

export const cycleHours = () => cfg('cycle.defaultHours', 25.4);

/* --------------------------------------------------- how long her cycles run

   DESCRIPTION ONLY. Never consulted to predict. Returns the spread and the
   sample count, because a bare mean across spans of 14 to 60 hours would be
   false precision. */
export function cycleLength(events, now = Date.now()) {
  const over = cfg('cycle.averageOverCycles', 7);
  const wakes = inOrder(liveEvents(events)).filter((e) => e.type === 'wake' && e.atUTC <= now);

  if (wakes.length < 2) {
    return { hours: cycleHours(), min: null, max: null, samples: 0, estimated: true,
      note: `No measured cycles yet, so this is the ${cycleHours()} hour figure from settings.` };
  }

  const spans = [];
  for (let i = 1; i < wakes.length; i++) spans.push((wakes[i].atUTC - wakes[i - 1].atUTC) / HOUR);
  const recent = spans.slice(-over);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;

  // A span far longer than a plausible cycle is more likely a gap in the data
  // than a sixty-hour day. Her own Oura archive tracks ring-off periods.
  const suspect = recent.filter((s) => s > 40).length;

  return {
    hours: mean, min: Math.min(...recent), max: Math.max(...recent),
    samples: recent.length, estimated: false, suspect,
    note: suspect
      ? `${suspect} of these ${recent.length} spans is longer than any plausible cycle, and is more likely a gap in the data than a real day.`
      : null,
  };
}

/* ------------------------------------------------------------ her circles

   Fixed 25.4-hour chunks, anchored to the most recent wake so the current
   circle starts when she actually got up. Her words: "I want the
   representation of time to be seen in about 25.4 hour circles or chunks." */
export function circles(events, now = Date.now(), count = 7) {
  const span = cycleHours() * HOUR;
  const live = inOrder(liveEvents(events));
  const wakes = live.filter((e) => e.type === 'wake' && e.atUTC <= now);

  /* A wake mark is the honest anchor: the circle starts when she got up.
     Without one, anchoring at `now` would put everything logged even a moment
     ago into the PREVIOUS circle. So fall back to the oldest thing logged
     within the last circle's length, which keeps recent activity together,
     and only to `now` when there is nothing at all. */
  const recentFirst = live.find((e) => e.atUTC > now - span && e.atUTC <= now);
  const anchor = wakes.length ? wakes[wakes.length - 1].atUTC
    : (recentFirst ? recentFirst.atUTC : now);

  // Walk back from the anchor in whole circles.
  const out = [];
  for (let i = 0; i < count; i++) {
    const start = anchor - i * span;
    const end = start + span;
    // Inclusive of `now`: with no wake logged the current circle begins at
    // `now`, so a strict `<` made it empty and anything logged immediately
    // fell out of its own circle.
    const cap = Math.min(end, now);
    const inside = inOrder(liveEvents(events))
      .filter((e) => e.atUTC >= start && (e.atUTC < cap || (e.atUTC === cap && cap === now)));
    out.push({
      index: i, start, end, span,
      current: i === 0,
      events: inside,
      doses: inside.filter((e) => e.type === 'dose'),
      meals: inside.filter((e) => e.type === 'meal'),
      water: inside.filter((e) => e.type === 'water'),
      notes: inside.filter((e) => e.type === 'note'),
      anchoredToWake: wakes.length > 0,
    });
  }
  return out;
}

/* Where she is in the current circle, 0 to 1. Used to place the marker. */
export function positionInCircle(circle, now = Date.now()) {
  return Math.max(0, Math.min(1, (now - circle.start) / circle.span));
}

/* ------------------------------------------- what is still working in him

   Needs no prediction of her at all: a time she logged plus a figure that was
   published and cited. A drug with no sourced window produces nothing. */
export function stillWorking(events, regimen, now = Date.now(), aheadHours = 12) {
  if (!regimen) return [];
  const out = [];

  for (const drug of regimen.drugs || []) {
    const w = drug.window;
    if (!w || w.kind !== 'perDose') continue;
    const last = lastDose(events, drug.key, now);
    if (!last) continue;

    const elapsed = now - last.atUTC;
    const state = effectWindow(drug, elapsed);
    if (!state || state.phase === 'past') continue;

    const endsFrom = last.atUTC + w.durationHoursFrom * HOUR;
    const endsTo = last.atUTC + w.durationHoursTo * HOUR;
    if (endsTo < now) continue;
    if (endsFrom > now + aheadHours * HOUR) continue;

    out.push({
      drug, state, last,
      endsFromMs: Math.max(0, endsFrom - now),
      endsToMs: Math.max(0, endsTo - now),
      systems: (drug.acts || []).map((a) => a.system),
    });
  }

  return out.sort((a, b) => a.endsFromMs - b.endsFromMs);
}

/* The sentence that changes her night. Grounded entirely in a dose she logged
   and a published peak: nothing here guesses when she will sleep, only where
   the peak falls relative to when she says the sleep round happened. */
export function sleepDisruption(events, regimen, now = Date.now()) {
  const drug = (regimen.drugs || []).find((d) => d.key === 'furosemide');
  if (!drug || !drug.window) return null;
  const last = lastDose(events, drug.key, now);
  if (!last) return null;

  // Only meaningful for the sleep-prep dose, so only when a sleep mark is the
  // most recent round marker or the dose is very recent.
  const sleepMark = lastOf(events, 'sleep', now);
  const isSleepRound = sleepMark && Math.abs(sleepMark.atUTC - last.atUTC) < 2 * HOUR;
  const veryRecent = now - last.atUTC < 3 * HOUR;
  if (!isSleepRound && !veryRecent) return null;

  const w = drug.window;
  return {
    drug,
    givenAgoMs: now - last.atUTC,
    peakFromMs: last.atUTC + w.peakHoursFrom * HOUR - now,
    peakToMs: last.atUTC + w.peakHoursTo * HOUR - now,
    peakHoursFrom: w.peakHoursFrom,
    peakHoursTo: w.peakHoursTo,
    relativeToSleep: isSleepRound ? (last.atUTC - sleepMark.atUTC) : null,
    vq: 'VQ-18',
  };
}

/* ===========================================================================
   Luke's own laboratory history.

   All of this was already in Rikki's records — the compendium publishes every
   recorded value — while the app carried a handful hardcoded from a dated
   snapshot. Hardcoding meant it could not see a trend and, worse, could not
   notice when a number had gone stale. His weight is the sharpest case: the
   app treated 79.1 lb as current when the measurement is from March.

   Brought in as events like everything else, so they sync, they never
   overwrite, and each one carries the day it was taken.
   =========================================================================== */

/* How old a value may be before the app stops presenting it as current. */
export const STALE_DAYS = 90;

export function latestLabs(events, now = Date.now()) {
  const out = new Map();
  for (const e of inOrder(liveEvents(events))) {
    if (e.type !== 'lab' || e.atUTC > now) continue;
    out.set(e.labKey, e);          // inOrder ascending, so the last wins
  }
  return out;
}

export function labStatus(lab, now = Date.now()) {
  if (!lab) return null;
  const ageDays = (now - lab.atUTC) / (24 * HOUR);
  const high = lab.refHigh != null && lab.value > lab.refHigh;
  const low = lab.refLow != null && lab.value < lab.refLow;
  return {
    lab,
    ageDays,
    stale: ageDays > STALE_DAYS,
    high, low,
    // Icon plus word, never colour alone (S4).
    icon: high ? '▲' : low ? '▼' : '✓',
    word: high ? 'above range' : low ? 'below range' : 'in range',
    range: lab.refLow != null && lab.refHigh != null ? `${lab.refLow}–${lab.refHigh}` : null,
  };
}

/* Luke's most recent weight, in kilograms, with how old it is.

   This exists because a milligrams-per-kilogram figure computed against a
   seven-month-old weight is not a milligrams-per-kilogram figure. The app
   must say how old the number is wherever it uses it. */
export function currentWeightKg(events, now = Date.now()) {
  const lab = latestLabs(events, now).get('weight');
  if (!lab) return null;
  const kg = lab.valueKg != null ? lab.valueKg : lab.value * 0.45359237;
  const ageDays = (now - lab.atUTC) / (24 * HOUR);
  return { kg, ageDays, at: lab.atUTC, stale: ageDays > STALE_DAYS, source: lab.source || 'unknown' };
}

/* Values that describe the same thing, grouped so a vet reading them sees the
   picture rather than a list. DESCRIPTION ONLY — the app never names a
   condition and never draws a conclusion from a group (S7). */
export const LAB_GROUPS = [
  { key: 'kidney', name: 'Kidney', system: 'water',
    labs: ['crea', 'bun', 'sdma', 'phos', 'buncrea'] },
  { key: 'liver', name: 'Liver and protein', system: 'gut',
    labs: ['alt', 'alkp', 'alb', 'tprot'] },
  { key: 'blood', name: 'Blood count', system: 'breathing',
    labs: ['mono', 'lymph', 'plt', 'hct', 'wbc'] },
];

/* Deliberately NOT a "fluid balance" group.

   An earlier version grouped sodium, chloride, osmolality and haematocrit and
   told Rikki they pointed one way. Checked against the reference ranges in her
   own records: sodium, chloride and haematocrit are all IN range, and
   osmolality has no published range at all. The story was invented from
   memory while the real numbers sat in the file.

   Markers are now shown with their own ranges and their own dates, grouped
   only by the organ they describe, and the app draws no picture from them
   (S7). Noticing a pattern across values is a vet's job. */

export function labGroup(groupKey, events, now = Date.now()) {
  const group = LAB_GROUPS.find((g) => g.key === groupKey);
  if (!group) return null;
  const latest = latestLabs(events, now);
  const found = group.labs.map((k) => labStatus(latest.get(k), now)).filter(Boolean);
  return found.length ? { ...group, values: found } : null;
}

/* ===========================================================================
   The things to notice, from her own Watch List.

   Her records already hold a thirty-second daily check, three lumps under
   watch, and — the most valuable single line anywhere in them —

       "The number of carrots Luke asks for each day is the household's
        quietest, most reliable signal. A drop in carrot count tends to come
        hours to days before any other sign he's feeling off."

   A leading indicator, found by the people who live with him, that no drug
   window or lab value can match. It gets first-class treatment here.

   Check definitions arrive as events so they stay in her private log, sync
   like everything else, and can be edited without a release.
   =========================================================================== */

export function checkDefs(events, now = Date.now()) {
  const defs = new Map();
  for (const e of inOrder(liveEvents(events))) {
    if (e.type !== 'checkdef' || e.atUTC > now) continue;
    defs.set(e.checkKey, e);          // a later definition supersedes an earlier one
  }
  return [...defs.values()];
}

export function lastCheck(events, checkKey, now = Date.now()) {
  const all = inOrder(liveEvents(events))
    .filter((e) => e.type === 'check' && e.checkKey === checkKey && e.atUTC <= now);
  return all.length ? all[all.length - 1] : null;
}

/* Due by elapsed time, not by calendar: a "daily" check on a 25.4-hour day is
   due once per circle, and a week is seven of those. */
export function checksDue(events, now = Date.now()) {
  const circle = cycleHours() * HOUR;
  return checkDefs(events, now).map((def) => {
    const last = lastCheck(events, def.checkKey, now);
    const period = def.every === 'weekly' ? circle * 7 : circle;
    const sinceMs = last ? now - last.atUTC : null;
    return {
      def, last,
      due: !last || sinceMs >= period,
      sinceMs,
      periodMs: period,
      changed: last && last.value === 'changed',
    };
  });
}

/* A carrot count lived here, built on a line in her archives describing it as
   his most reliable signal. She says that was exaggerated: she does not count
   them, he gets as many as he wants, and he pursues.

   Removed rather than reshaped. The pursuing is real and belongs in the
   appetite check in her own words; the number was never hers. Her archives
   hold embellished material — a prior audit of that site found two outright
   fabrications — so anything taken from them is a claim to check, not a fact
   to build on. This app got that wrong once already today. */

/* A generic append for event kinds that are neither a dose nor an observation
   — a check, a definition, anything later. Same rules, same shape. */
export function logEvent(fields, { now = Date.now() } = {}) {
  const events = readEvents();
  const e = {
    id: newId(), seq: nextSeq(events),
    atUTC: now, atOffset: -new Date(now).getTimezoneOffset(),
    loggedUTC: now, loggedOffset: -new Date(now).getTimezoneOffset(),
    source: 'Rikki',
    ...fields,
  };
  events.push(e);
  writeEvents(events);
  return e;
}
