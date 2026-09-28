/* Merging two devices' logs. The rule this protects: a sync must never lose a
   dose, in any order, however many times it runs. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge, parseLog, serialiseLog } from '../sync.js';

const ev = (id, atUTC, seq = 1) => ({ id, seq, type: 'dose', drugKey: 'furosemide', tablets: 2, atUTC });

test('merging is the union of both sides, by id', () => {
  const phone = [ev('a', 100), ev('b', 200)];
  const mac = [ev('b', 200), ev('c', 300)];
  const { events, newToMe, newToThem } = merge(phone, mac);
  assert.deepEqual(events.map((e) => e.id), ['a', 'b', 'c']);
  assert.equal(newToMe, 1, 'c came from the other device');
  assert.equal(newToThem, 1, 'a is not on the other device yet');
});

test('merging never loses an event, whichever side it started on', () => {
  const phone = [ev('a', 100), ev('b', 300)];
  const mac = [ev('c', 200), ev('d', 400)];
  const merged = merge(phone, mac).events.map((e) => e.id);
  for (const id of ['a', 'b', 'c', 'd']) assert.ok(merged.includes(id), `${id} was lost`);
});

test('merging is order-independent: both devices end up with the same log', () => {
  const phone = [ev('a', 100), ev('b', 300)];
  const mac = [ev('c', 200), ev('d', 400)];
  const onPhone = merge(phone, mac).events.map((e) => e.id);
  const onMac = merge(mac, phone).events.map((e) => e.id);
  assert.deepEqual(onPhone, onMac);
});

test('merging twice changes nothing the second time', () => {
  const phone = [ev('a', 100)];
  const mac = [ev('b', 200)];
  const once = merge(phone, mac).events;
  const twice = merge(once, mac).events;
  assert.deepEqual(once.map((e) => e.id), twice.map((e) => e.id));
  assert.equal(merge(once, once).newToThem, 0, 'nothing left to push');
});

test('a dose and its undo both survive a merge', () => {
  // The undo is its own event, which is why a union can never resurrect a
  // dose that was undone on the other device.
  const dose = ev('a', 100);
  const undo = { id: 'v', seq: 2, type: 'void', voids: 'a', atUTC: 150 };
  const merged = merge([dose], [dose, undo]).events;
  assert.equal(merged.length, 2);
  assert.ok(merged.some((e) => e.type === 'void' && e.voids === 'a'));
});

test('the merged log is ordered by when things happened', () => {
  const merged = merge([ev('late', 900)], [ev('early', 100), ev('mid', 500)]).events;
  assert.deepEqual(merged.map((e) => e.id), ['early', 'mid', 'late']);
});

/* --------------------------------------------------------------- the file */

test('a damaged line costs that line, never the whole log', () => {
  // A phone killed mid-write, or a truncated download. Losing one entry is
  // survivable; losing the file is not.
  const text = [
    JSON.stringify(ev('a', 100)),
    '{"id":"b","type":"dose",TRUNCATED',
    JSON.stringify(ev('c', 300)),
  ].join('\n');
  const { events, damaged } = parseLog(text);
  assert.equal(events.length, 2);
  assert.equal(damaged, 1);
  assert.deepEqual(events.map((e) => e.id), ['a', 'c']);
});

test('lines without an id or a type are ignored rather than trusted', () => {
  const text = ['{"note":"header line, not an event"}', JSON.stringify(ev('a', 100))].join('\n');
  assert.equal(parseLog(text).events.length, 1);
});

test('writing then reading gives back exactly what went in', () => {
  const events = [ev('a', 100), ev('b', 200), { id: 'v', seq: 3, type: 'void', voids: 'a', atUTC: 300 }];
  const round = parseLog(serialiseLog(events)).events;
  assert.deepEqual(round, events);
});

test('blank lines and a trailing newline are harmless', () => {
  const text = '\n' + JSON.stringify(ev('a', 100)) + '\n\n';
  assert.equal(parseLog(text).events.length, 1);
  assert.equal(parseLog(text).damaged, 0);
});
