/* The dose log's rules, and what the body view is allowed to claim.
   A wrong answer here either loses a dose Luke had, invents one he didn't,
   or tells Rikki something about his body that nobody actually knows.
   Run with: node --test tests/*.test.js */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDose, makeMark, makeVoid, isLive, liveEvents, inOrder,
  lastDose, dosesInWindow, tabletsInWindow, checkAgainstMax,
  effectWindow, buildupState, bodyState, windowFor, limitsOf, HOUR,
} from '../store.js';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const regimen = JSON.parse(readFileSync(join(root, 'regimen.json'), 'utf8'));
const drug = (key) => regimen.drugs.find((d) => d.key === key);

const T0 = Date.UTC(2026, 8, 29, 12, 0, 0);

function push(events, e) { events.push(e); return e; }
function doseAt(events, key, msAgo, now, tablets) {
  return push(events, makeDose({ drug: drug(key), tablets, minutesAgo: msAgo / 60000, now, events }));
}

/* ------------------------------------------------------------ time is elapsed */

test('elapsed time is pure subtraction, so a DST change cannot move it', () => {
  assert.equal(Date.UTC(2026, 10, 2, 1) - Date.UTC(2026, 10, 1, 1), 24 * HOUR);
  assert.equal(Date.UTC(2027, 2, 15, 8) - Date.UTC(2027, 2, 14, 8), 24 * HOUR);
});

test('a dose keeps both the time it happened and the time it was logged', () => {
  const d = makeDose({ drug: drug('furosemide'), minutesAgo: 20, now: T0, events: [] });
  assert.equal(d.loggedUTC, T0);
  assert.equal(d.atUTC, T0 - 20 * 60000);
});

/* ------------------------------------------------------------ append-only, S5 */

test('an undo stops a dose counting, and an undo of the undo brings it back', () => {
  const events = [];
  const d = doseAt(events, 'furosemide', 0, T0);
  const v1 = push(events, makeVoid({ targetId: d.id, now: T0 + 1000, events }));
  assert.equal(isLive(d, events), false);
  push(events, makeVoid({ targetId: v1.id, now: T0 + 2000, events }));
  assert.equal(isLive(d, events), true);
  assert.equal(events.length, 3, 'nothing was ever removed');
});

test('a voided dose stops counting toward the total', () => {
  const events = [];
  doseAt(events, 'furosemide', 0, T0);
  const second = doseAt(events, 'furosemide', 0, T0);
  assert.equal(tabletsInWindow(events, 'furosemide', T0, T0 - 24 * HOUR), 6);
  push(events, makeVoid({ targetId: second.id, now: T0 + 1000, events }));
  assert.equal(tabletsInWindow(events, 'furosemide', T0, T0 - 24 * HOUR), 3);
});

/* ------------------------------------------------------------ order and time */

test('a backdated dose sorts before a dose already logged', () => {
  const events = [];
  const logged = doseAt(events, 'tramadol', 0, T0);
  const earlier = doseAt(events, 'tramadol', 3 * HOUR, T0 + 1000);
  assert.deepEqual(inOrder(liveEvents(events)).map((e) => e.id), [earlier.id, logged.id]);
});

test('a clock that jumps backwards does not reorder the log', () => {
  const events = [];
  const first = doseAt(events, 'tramadol', 0, T0);
  const second = doseAt(events, 'tramadol', 0, T0 - 2 * HOUR);
  assert.ok(second.seq > first.seq);
});

test('the rolling window boundary is exact', () => {
  const on = []; doseAt(on, 'tramadol', 24 * HOUR, T0);
  assert.equal(dosesInWindow(on, 'tramadol', T0, T0 - 24 * HOUR).length, 1);
  const past = []; doseAt(past, 'tramadol', 24 * HOUR + 1, T0);
  assert.equal(dosesInWindow(past, 'tramadol', T0, T0 - 24 * HOUR).length, 0);
});

/* ------------------------------------- which window a drug is counted over */

test('a drug given by round is counted over the wake cycle, not a rolling 24 hours', () => {
  // Rikki's cycle averages 25.4 hours. A rolling window would announce Luke
  // was over his label on any cycle shorter than 24 hours, which happens often.
  const events = [];
  push(events, makeMark({ type: 'wake', now: T0 - 6 * HOUR, events }));
  const win = windowFor(drug('furosemide'), events, T0);
  assert.equal(win.basis, 'cycle');
  assert.equal(win.from, T0 - 6 * HOUR);
});

test('an as-needed drug is counted over a rolling 24 hours', () => {
  assert.equal(windowFor(drug('tramadol'), [], T0).basis, 'rolling');
});

test('with no wake logged the app falls back and says so', () => {
  assert.equal(windowFor(drug('furosemide'), [], T0).estimated, true);
});

/* ------------------------------------------------- reported, never blocked */

test('a dose past the label is reported, and the check never vetoes', () => {
  const events = [];
  doseAt(events, 'tramadol', 5 * HOUR, T0);
  doseAt(events, 'tramadol', 1 * HOUR, T0);
  const passed = checkAgainstMax(drug('tramadol'), events, { now: T0 });
  assert.ok(passed, 'a third dose passes the label of 2 a day');
  assert.ok(!('allowed' in passed), 'the check describes, it does not decide');
});

test('a drug with no known maximum never warns and never invents one', () => {
  // Furosemide's real daily maximum at 3 x 40 mg is not known, so there is
  // nothing to be over. Silence here is the correct behaviour.
  const events = [];
  push(events, makeMark({ type: 'wake', now: T0 - 10 * HOUR, events }));
  for (let i = 0; i < 4; i++) doseAt(events, 'furosemide', i * HOUR, T0);
  assert.equal(checkAgainstMax(drug('furosemide'), events, { now: T0 }), null);
});

test('no drug in the seed has an invented minimum gap', () => {
  // S1: the app never suggests timing a vet did not give. If this fails,
  // someone has filled in a number nobody prescribed.
  for (const d of regimen.drugs) {
    assert.equal(d.minGapHours, null, `${d.key} has a gap no vet set`);
  }
});

test('an unknown strength is never counted as zero milligrams', () => {
  const events = [];
  for (let i = 0; i < 10; i++) doseAt(events, 'cosequin', i * 60000, T0);
  assert.equal(limitsOf(drug('cosequin')).strengthMg, null);
  const passed = checkAgainstMax(drug('cosequin'), events, { now: T0 }) || [];
  assert.ok(!passed.some((p) => p.unit === 'mg'));
});

test('a dose keeps the limits that applied when it was logged', () => {
  const events = [];
  const d = doseAt(events, 'tramadol', 0, T0);
  assert.equal(d.limitsAtDose.maxPer24hDoses, 2);
  const changed = { ...drug('tramadol'), maxPer24hDoses: 1 };
  const later = makeDose({ drug: changed, now: T0 + HOUR, events });
  assert.equal(d.limitsAtDose.maxPer24hDoses, 2, 'the old entry is untouched');
  assert.equal(later.limitsAtDose.maxPer24hDoses, 1);
});

/* --------------------------------------------------------- effect windows */

test('one window function serves every drug that has a sourced window', () => {
  for (const key of ['furosemide', 'tramadol', 'galliprant', 'omeprazole', 'simethicone']) {
    const d = drug(key);
    assert.ok(d.window && d.window.kind === 'perDose', `${key} should have a per-dose window`);
    const w = effectWindow(d, 90 * 60000);
    assert.ok(w.icon && w.word, 'icon plus word, never colour alone (S4)');
  }
});

test('a drug with no sourced window shows nothing rather than a guess', () => {
  // The hemp chew has no reliable published time course at this dose in dogs.
  assert.equal(drug('hempchew').window, null);
  assert.equal(effectWindow(drug('hempchew'), 60 * 60000), null);
});

test('a drug that builds over days is never shown as acting today', () => {
  const events = [];
  doseAt(events, 'amantadine', 0, T0);
  const state = buildupState(drug('amantadine'), events, T0 + 2 * 24 * HOUR);
  assert.equal(state.phase, 'building');
  assert.match(state.line, /14–21 days/);
  assert.ok(state.note, 'says the count starts from the first logged dose, not from reality');

  const later = buildupState(drug('amantadine'), events, T0 + 30 * 24 * HOUR);
  assert.equal(later.phase, 'established');
});

test('every drug with a window carries a source and its variability', () => {
  for (const d of regimen.drugs) {
    if (!d.window) continue;
    assert.ok(d.variability, `${d.key} has a window but no variability statement`);
    assert.ok(Array.isArray(d.sources), `${d.key} has no sources array`);
  }
});

/* ------------------------------------------------------------- the body view */

test('a system with nothing acting on it says so rather than looking calm', () => {
  const state = bodyState([], regimen, T0);
  assert.ok(state.length >= 5);
  for (const entry of state) assert.equal(entry.acting.length, 0);
});

test('a logged dose shows up under the body system it acts on', () => {
  const events = [];
  doseAt(events, 'furosemide', 90 * 60000, T0);
  const water = bodyState(events, regimen, T0).find((s) => s.system.key === 'water');
  assert.equal(water.acting.length, 1);
  assert.equal(water.acting[0].drug.key, 'furosemide');
  assert.equal(water.acting[0].state.phase, 'peak', '90 minutes is inside the 1-2 hour peak');
});

test('every claim on the body view carries a certainty tier', () => {
  const events = [];
  doseAt(events, 'tramadol', HOUR, T0);
  doseAt(events, 'hempchew', HOUR, T0);
  for (const entry of bodyState(events, regimen, T0)) {
    for (const a of entry.acting) {
      assert.ok(['known', 'logged', 'extrapolated'].includes(a.tier),
        `${a.drug.key} on ${entry.system.key} has no tier`);
    }
  }
});

test('an interaction only shows when both of its drugs are in the regimen', () => {
  const events = [];
  doseAt(events, 'tramadol', HOUR, T0);
  doseAt(events, 'hempchew', HOUR, T0);
  const alert = bodyState(events, regimen, T0).find((s) => s.system.key === 'alertness');
  assert.ok(alert.interactions.some((i) => i.between.includes('hempchew') && i.between.includes('tramadol')));

  const withoutChew = { ...regimen, drugs: regimen.drugs.filter((d) => d.key !== 'hempchew') };
  const alert2 = bodyState(events, withoutChew, T0).find((s) => s.system.key === 'alertness');
  assert.equal(alert2.interactions.length, 0, 'no drug, no interaction claim');
});

test('the app says it is not a complete interaction check', () => {
  // SPEC-domain originally ruled interactions out entirely. Rikki asked for
  // them. The honest middle is a curated list that admits what it is not.
  assert.match(regimen.interactionsNote, /not a complete interaction check/i);
  assert.match(regimen.interactionsNote, /means nobody has looked it up/i);
});

test('the Galliprant food finding is recorded, because it changes what he gets', () => {
  const note = regimen.foodNotes.find((f) => f.drug === 'galliprant');
  assert.ok(note, 'no food note for Galliprant');
  assert.match(note.text, /4-fold/);
  assert.equal(note.tier, 'known');
});
