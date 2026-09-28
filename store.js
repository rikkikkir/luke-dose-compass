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

/* ------------------------------------------------------- furosemide window */

/* The only drug where every number is real, so the only drug the app says
   anything about. Always a range, always with the variability named: oral
   absorption in dogs runs from 10% to 100%. */
export function furosemideWindow(elapsedMs, effects) {
  if (elapsedMs == null || !effects) return null;
  const mins = elapsedMs / 60000;
  const { onsetMinFrom, onsetMinTo, peakHoursFrom, peakHoursTo,
          durationHoursFrom, durationHoursTo } = effects;

  if (mins < onsetMinFrom) {
    return { phase: 'starting', icon: '·', word: 'Just given',
      line: `Likely starts working in about ${onsetMinFrom}–${onsetMinTo} minutes.` };
  }
  if (mins < peakHoursFrom * 60) {
    return { phase: 'onset', icon: '○', word: 'Starting',
      line: `Strongest effect is likely ${peakHoursFrom}–${peakHoursTo} hours after the dose.` };
  }
  if (mins <= peakHoursTo * 60) {
    return { phase: 'peak', icon: '●', word: 'Likely needs out',
      line: 'This is the window where he most likely needs to go outside.' };
  }
  if (mins <= durationHoursTo * 60) {
    return { phase: 'easing', icon: '◐', word: 'Easing',
      line: `Usually settling by around ${durationHoursFrom}–${durationHoursTo} hours after the dose.` };
  }
  return { phase: 'past', icon: '✓', word: 'Likely settled',
    line: `Past the usual ${durationHoursFrom}–${durationHoursTo} hour window.` };
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
