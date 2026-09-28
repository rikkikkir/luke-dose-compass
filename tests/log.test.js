/* The dose log's rules. These are the tests that matter: a wrong answer here
   either loses a dose Luke had or invents one he didn't.
   Run with: node --test tests/*.test.js */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDose, makeMark, makeVoid, isLive, liveEvents, inOrder,
  lastDose, dosesInWindow, tabletsInWindow, checkAgainstMax,
  furosemideWindow, windowFor, limitsOf, HOUR,
} from '../store.js';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const regimen = JSON.parse(readFileSync(join(root, 'regimen.json'), 'utf8'));
const drug = (key) => regimen.drugs.find((d) => d.key === key);

const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);   // a fixed instant, so nothing depends on "now"

function push(events, e) { events.push(e); return e; }
function doseAt(events, key, msAgo, now, tablets) {
  return push(events, makeDose({ drug: drug(key), tablets, minutesAgo: msAgo / 60000, now, events }));
}

/* ------------------------------------------------------------ time is elapsed */

test('elapsed time is pure subtraction, so a DST change cannot move it', () => {
  // 2026-11-01 09:00 UTC is the US fall-back instant. A naive implementation
  // that reconstructs local clock time gets 25 hours here instead of 24.
  const before = Date.UTC(2026, 10, 1, 1, 0, 0);
  const after = Date.UTC(2026, 10, 2, 1, 0, 0);
  assert.equal(after - before, 24 * HOUR);

  // And across the spring-forward gap, where 2am local does not exist.
  const springBefore = Date.UTC(2027, 2, 14, 8, 0, 0);
  const springAfter = Date.UTC(2027, 2, 15, 8, 0, 0);
  assert.equal(springAfter - springBefore, 24 * HOUR);
});

test('a dose keeps both the time it happened and the time it was logged', () => {
  const events = [];
  const d = makeDose({ drug: drug('furosemide'), minutesAgo: 20, now: T0, events });
  assert.equal(d.loggedUTC, T0);
  assert.equal(d.atUTC, T0 - 20 * 60000);
  assert.ok(d.atUTC < d.loggedUTC, 'a backdated dose happened before it was logged');
});

/* ------------------------------------------------------------ append-only, S5 */

test('an undo stops a dose counting, and an undo of the undo brings it back', () => {
  const events = [];
  const d = doseAt(events, 'furosemide', 0, T0);
  assert.equal(liveEvents(events).length, 1);

  const v1 = push(events, makeVoid({ targetId: d.id, now: T0 + 1000, events }));
  assert.equal(liveEvents(events).length, 0, 'voided');
  assert.equal(isLive(d, events), false);

  push(events, makeVoid({ targetId: v1.id, now: T0 + 2000, events }));
  assert.equal(isLive(d, events), true, 'undo of the undo restores the dose');
  assert.equal(liveEvents(events).length, 1);

  // Nothing was ever removed. That is the whole point of S5.
  assert.equal(events.length, 3);
});

test('a voided dose stops counting toward the total', () => {
  const events = [];
  doseAt(events, 'furosemide', 0, T0);
  const second = doseAt(events, 'furosemide', 0, T0);
  assert.equal(tabletsInWindow(events, 'furosemide', T0, T0 - 24 * HOUR), 4);

  push(events, makeVoid({ targetId: second.id, now: T0 + 1000, events }));
  assert.equal(tabletsInWindow(events, 'furosemide', T0, T0 - 24 * HOUR), 2);
});

/* ------------------------------------------------------------ backdating order */

test('a backdated dose sorts before a dose already logged', () => {
  const events = [];
  const logged = doseAt(events, 'opioid', 0, T0);                 // now
  const earlier = doseAt(events, 'opioid', 3 * HOUR, T0 + 1000);  // "3 hours ago", logged later

  const order = inOrder(liveEvents(events)).map((e) => e.id);
  assert.deepEqual(order, [earlier.id, logged.id], 'ordered by when it happened, not when it was typed');
  assert.equal(lastDose(events, 'opioid', T0 + 1000).id, logged.id);
});

test('a clock that jumps backwards does not reorder the log', () => {
  const events = [];
  const first = doseAt(events, 'opioid', 0, T0);
  const second = doseAt(events, 'opioid', 0, T0 - 2 * HOUR);   // device clock jumped back
  assert.ok(second.seq > first.seq, 'append order is held by seq, not by the clock');
});

/* ------------------------------------------------------------ the window boundary */

test('the rolling window boundary is exact', () => {
  const events = [];
  const from = T0 - 24 * HOUR;
  doseAt(events, 'opioid', 24 * HOUR, T0);            // exactly on the edge
  assert.equal(dosesInWindow(events, 'opioid', T0, from).length, 1, 'the edge is inside');

  const older = [];
  doseAt(older, 'opioid', 24 * HOUR + 1, T0);         // one millisecond older
  assert.equal(dosesInWindow(older, 'opioid', T0, from).length, 0, 'one ms past the edge is outside');
});

/* ------------------------------------- the window a drug is actually counted over */

test('a drug given by round is counted over the wake cycle, not a rolling 24 hours', () => {
  // This is the difference between a useful warning and a nightly false alarm.
  // Rikki's cycle averages 25.4 hours, so a rolling 24-hour window would
  // routinely hold more than one cycle of a twice-a-round drug.
  const events = [];
  push(events, makeMark({ type: 'wake', now: T0 - 6 * HOUR, events }));
  const win = windowFor(drug('furosemide'), events, T0);
  assert.equal(win.basis, 'cycle');
  assert.equal(win.from, T0 - 6 * HOUR);
  assert.equal(win.label, 'this wake cycle');
});

test('an as-needed drug is counted over a rolling 24 hours', () => {
  const events = [];
  push(events, makeMark({ type: 'wake', now: T0 - 6 * HOUR, events }));
  const win = windowFor(drug('opioid'), events, T0);
  assert.equal(win.basis, 'rolling');
  assert.equal(win.from, T0 - 24 * HOUR);
});

test('with no wake logged the app falls back and says so, rather than inventing a cycle', () => {
  const win = windowFor(drug('furosemide'), [], T0);
  assert.equal(win.basis, 'rolling');
  assert.equal(win.estimated, true);
});

test('a full cycle of furosemide does not trigger a false alarm', () => {
  const events = [];
  push(events, makeMark({ type: 'wake', now: T0 - 20 * HOUR, events }));
  doseAt(events, 'furosemide', 19 * HOUR, T0);     // wake round, 2 tablets
  doseAt(events, 'furosemide', 2 * HOUR, T0);      // sleep-prep round, 2 tablets
  // 4 tablets = 320 mg = exactly the label. Not over.
  assert.equal(checkAgainstMax(drug('furosemide'), events, { now: T0, tablets: 0 }), null);
});

/* ------------------------------------------------- warnings, and never blocking */

test('a dose past the label is reported, and is still logged', () => {
  const events = [];
  push(events, makeMark({ type: 'wake', now: T0 - 10 * HOUR, events }));
  doseAt(events, 'furosemide', 9 * HOUR, T0);
  doseAt(events, 'furosemide', 4 * HOUR, T0);

  const passed = checkAgainstMax(drug('furosemide'), events, { now: T0 });
  assert.ok(passed, 'a third dose passes the 320 mg label and is reported');
  assert.ok(passed.some((p) => p.unit === 'mg' && p.max === 320));

  // Nothing in the model can refuse. checkAgainstMax returns a description,
  // never a veto: there is no "allowed" field to consult.
  assert.equal(typeof passed, 'object');
  assert.ok(!('allowed' in passed), 'the check describes, it does not decide');
});

test('a drug with no known limit produces no warning and invents no number', () => {
  const events = [];
  for (let i = 0; i < 6; i++) doseAt(events, 'antacid', i * HOUR, T0);
  assert.equal(checkAgainstMax(drug('antacid'), events, { now: T0 }), null);
  assert.equal(limitsOf(drug('antacid')).minGapHours, null, 'unknown stays null, never 0');
});

test('no drug in the seed has an invented minimum gap', () => {
  // S1: the app never suggests timing the vet did not give. If this test ever
  // fails, someone has filled in a number nobody prescribed.
  for (const d of regimen.drugs) {
    assert.equal(d.minGapHours, null, `${d.key} has a minimum gap that no vet set`);
  }
});

test('an unknown strength is never counted as zero milligrams', () => {
  const events = [];
  for (let i = 0; i < 10; i++) doseAt(events, 'opioid', i * 60000, T0);
  const limits = limitsOf(drug('opioid'));
  assert.equal(limits.strengthMg, null);
  // The milligram ceiling is skipped entirely rather than passing on a zero.
  const passed = checkAgainstMax(drug('opioid'), events, { now: T0 }) || [];
  assert.ok(!passed.some((p) => p.unit === 'mg'));
});

/* -------------------------------------------------- the limits ride on the dose */

test('a dose keeps the limits that applied when it was logged', () => {
  const events = [];
  const d = doseAt(events, 'furosemide', 0, T0);
  assert.equal(d.limitsAtDose.maxPer24hMg, 320);
  assert.equal(d.limitsAtDose.source, 'compendium');

  // The regimen changes afterwards. The old entry is unaffected, because the
  // limits were copied onto it rather than pointed at.
  const changed = { ...drug('furosemide'), maxPer24hMg: 160 };
  const later = makeDose({ drug: changed, now: T0 + HOUR, events });
  assert.equal(d.limitsAtDose.maxPer24hMg, 320);
  assert.equal(later.limitsAtDose.maxPer24hMg, 160);
});

/* ------------------------------------------------------- the furosemide window */

test('the furosemide window is a range at every stage, and never a bare number', () => {
  const fx = regimen.effects.furosemide;
  const stages = [10, 45, 90, 240, 500].map((mins) => furosemideWindow(mins * 60000, fx));
  for (const s of stages) {
    assert.ok(s.icon && s.word, 'status carries an icon and a word, never colour alone (S4)');
    assert.ok(s.line.length > 10);
  }
  assert.equal(stages[2].phase, 'peak', '90 minutes is inside the 1-2 hour peak');
  assert.equal(stages[4].phase, 'past', '500 minutes is past the 6 hour window');
});

test('the furosemide figures carry their sources and their variability', () => {
  const fx = regimen.effects.furosemide;
  assert.ok(fx.sources.length >= 2);
  assert.match(fx.variability, /10% to 100%/, 'the absorption spread must be stated, not hidden');
});
