/* The parser. Every test here is a sentence Rikki might actually say, not a
   clean demo sentence. Nothing it produces becomes a dose without her
   confirming, so the bar is "does it get her right often enough to be faster
   than tapping" — not perfection. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseWhen, describe as describeParse } from '../parse.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const regimen = JSON.parse(readFileSync(join(root, 'regimen.json'), 'utf8'));
const keys = (p) => p.doses.map((d) => d.drugKey).sort();

test('"he\'s had everything" means the whole round', () => {
  // The phrase she will say most often, and the one that saves the most taps.
  const p = parse("he's had everything", regimen, { round: 'wake' });
  const inRound = regimen.drugs.filter((d) => (d.rounds || []).includes('wake')).map((d) => d.key).sort();
  assert.deepEqual(keys(p), inRound);
  assert.ok(inRound.length >= 6, 'his wake round is most of his drugs');
});

test('the other ways she might say the same thing', () => {
  for (const phrase of ['he had his meds', 'gave him the tray', 'all his pills are done', 'his round is done']) {
    assert.ok(parse(phrase, regimen).doses.length > 0, `"${phrase}" produced nothing`);
  }
});

test('named drugs with spoken counts', () => {
  const p = parse('gave him three furosemide and a tramadol', regimen);
  assert.deepEqual(keys(p), ['furosemide', 'tramadol']);
  assert.equal(p.doses.find((d) => d.drugKey === 'furosemide').tablets, 3);
  assert.equal(p.doses.find((d) => d.drugKey === 'tramadol').tablets, 1);
});

test('digits work as well as words', () => {
  const p = parse('2 simethicone', regimen);
  assert.equal(p.doses[0].tablets, 2);
});

test('a drug called by its other name is still found', () => {
  assert.deepEqual(keys(parse('gave him his lasix', regimen)), ['furosemide']);
  assert.deepEqual(keys(parse('grapiprant done', regimen)), ['galliprant']);
});

test('"another pain pill" resolves to the as-needed pain drug, and says it assumed', () => {
  // In her head there is one pain pill. The app has to know which.
  const p = parse('I gave him another pain pill', regimen);
  assert.deepEqual(keys(p), ['tramadol']);
  assert.equal(p.doses[0].assumed, true, 'an inference must be visibly an inference');
});

test('no count spoken falls back to what the regimen says, not to one', () => {
  const p = parse('gave him his furosemide', regimen);
  assert.equal(p.doses[0].tablets, 3, 'his furosemide is three tablets');
});

/* -------------------------------------------------------------- when */

test('relative times', () => {
  assert.equal(parseWhen('I gave it about twenty minutes ago'), 20);
  assert.equal(parseWhen('an hour ago'), 60);
  assert.equal(parseWhen('two hours ago'), 120);
  assert.equal(parseWhen('30 mins ago'), 30);
  assert.equal(parseWhen('just now'), 0);
  assert.equal(parseWhen('he had everything'), 0, 'no time said means now');
});

/* ------------------------------------------------------- food and the rest */

test('"he ate about half" is a meal with an amount in words, not a number', () => {
  const p = parse('he ate about half and left the carrots', regimen);
  const meal = p.observations.find((o) => o.type === 'meal');
  assert.equal(meal.value, 'half');
  assert.match(meal.text, /left the carrots/, 'her own words are kept');
});

test('refusing food is recorded as its own thing', () => {
  // A dog who stops eating is the signal that matters most.
  for (const phrase of ["he wouldn't eat", "he didn't want it", 'he refused his food']) {
    const meal = parse(phrase, regimen).observations.find((o) => o.type === 'meal');
    assert.equal(meal.value, 'none', `"${phrase}"`);
  }
});

test('he gobbled it means all of it', () => {
  assert.equal(parse('he gobbled the whole bowl', regimen).observations[0].value, 'all');
});

test('water and what came out', () => {
  assert.equal(parse('he drank a lot', regimen).observations.find((o) => o.type === 'water').type, 'water');
  assert.equal(parse('he peed outside', regimen).observations.find((o) => o.type === 'out').value, 'pee');
  assert.equal(parse('he pooped', regimen).observations.find((o) => o.type === 'out').value, 'stool');
});

test('one sentence can carry doses, food and a time all at once', () => {
  const p = parse("he's had everything and ate about half, that was twenty minutes ago", regimen);
  assert.ok(p.doses.length >= 6);
  assert.equal(p.observations.find((o) => o.type === 'meal').value, 'half');
  assert.equal(p.minutesAgo, 20);
});

/* ------------------------------------------------ the failure cases matter */

test('a sentence it cannot read produces nothing rather than a guess', () => {
  const p = parse('he seems a bit off tonight, I don\'t know', regimen);
  assert.equal(p.doses.length, 0);
  assert.equal(p.understoodNothing, true, 'and it says so, so the note is kept as a note');
});

test('trailing off is normal, not an error', () => {
  const p = parse("he's been up twice already and", regimen);
  assert.equal(p.doses.length, 0);
  assert.ok(p.heard.includes('twice'), 'her words are kept whatever happens');
});

test('empty input is safe', () => {
  const p = parse('', regimen);
  assert.equal(p.doses.length, 0);
  assert.equal(p.understoodNothing, true);
});

test('a drug not in the regimen is never invented', () => {
  const p = parse('I gave him some gabapentin', regimen);
  assert.equal(p.doses.length, 0, 'the app only knows the drugs it has been told about');
});

test('the same drug is never counted twice in one sentence', () => {
  const p = parse("he's had everything including his furosemide", regimen);
  const furo = p.doses.filter((d) => d.drugKey === 'furosemide');
  assert.equal(furo.length, 1);
});

test('what she sees is plain enough to check at 4 AM', () => {
  const p = parse('gave him three furosemide twenty minutes ago', regimen);
  const lines = describeParse(p, regimen);
  assert.ok(lines.some((l) => /Furosemide × 3/.test(l)));
  assert.ok(lines.some((l) => /20 minutes ago/.test(l)));
});
