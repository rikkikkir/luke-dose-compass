/* Luke's Dose Compass — turning what she said into things she can confirm.

   Designed from the sentence she will actually say at 4 AM, not from a clean
   demo sentence. The real ones are "he's had everything", "I gave him another
   pain pill", "he ate about half, didn't want the carrots" — often trailing
   off. The vocabulary is nine drugs, some numbers, a few verbs and a handful
   of time phrases. That is a small closed grammar, which is what makes this
   tractable at all.

   NOTHING HERE EVER BECOMES A DOSE ON ITS OWN. Everything is a proposal she
   confirms (S3). A wrong reading is therefore a correction, not a bad record,
   and anything unparsed stays as a note with its recording attached. */

const NUMBERS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  half: 0.5, 'a half': 0.5, couple: 2, both: 2,
};

const ROUND_WORDS = [
  'everything', 'all his meds', 'all his medicine', 'all of them', 'his meds',
  'his medicine', 'his medication', 'his medications', 'the round', 'his round',
  'the whole round', 'his pills', 'all his pills', 'the tray', 'his tray',
];

const AMOUNTS = [
  [/\b(all of it|all|everything|the whole (bowl|lot)|cleaned (it|the bowl))\b/, 'all'],
  [/\b(most|nearly all|almost all)\b/, 'most'],
  [/\b(about )?half\b/, 'half'],
  [/\b(a (little|bit)|some|a few bites|picked at)\b/, 'a little'],
  [/\b(nothing|none|wouldn'?t (eat|touch)|didn'?t (eat|touch|want)|refused)\b/, 'none'],
];

export function normalise(text) {
  return String(text || '').toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* "twenty minutes ago", "an hour ago", "just now", "when we woke" */
export function parseWhen(text) {
  const t = normalise(text);
  if (/\b(just now|right now|now)\b/.test(t)) return 0;
  if (/\bwhen we woke|at wake|this morning\b/.test(t)) return null;   // caller resolves to the wake mark

  const m = t.match(/\b(?:about |around |roughly )?(\d+|[a-z]+)\s*(minute|minutes|min|mins|hour|hours|hr|hrs)\s*(?:ago|back)\b/);
  if (!m) return 0;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : (NUMBERS[m[1]] ?? twentyish(m[1]));
  if (n == null || Number.isNaN(n)) return 0;
  return /hour|hr/.test(m[2]) ? n * 60 : n;
}

/* The tens, which people say far more often than "sixty minutes". */
function twentyish(word) {
  const tens = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, ninety: 90 };
  return tens[word] ?? null;
}

function countBefore(words, index) {
  for (let back = 1; back <= 3 && index - back >= 0; back++) {
    const w = words[index - back];
    if (/^\d+$/.test(w)) return Number(w);
    if (NUMBERS[w] != null) return NUMBERS[w];
    if (['gave', 'had', 'took', 'his', 'the', 'him', 'and', 'a'].includes(w)) continue;
    break;
  }
  return null;
}

/* Every way she might name a drug, built from the regimen rather than hardcoded,
   so adding a drug to the regimen teaches the parser its name for free. */
function aliasesFor(drug) {
  const out = [drug.name, drug.key];
  if (drug.alsoCalled) out.push(...String(drug.alsoCalled).split(/,\s*/));
  return out.map(normalise).filter(Boolean);
}

export function parse(text, regimen, { now = Date.now(), round = 'wake', events = [] } = {}) {
  const raw = String(text || '');
  const t = normalise(raw);
  const drugs = (regimen && regimen.drugs) || [];
  const words = t.split(' ');

  const result = {
    heard: raw,
    minutesAgo: parseWhen(t),
    doses: [],
    observations: [],
    matched: [],        // the phrases that produced something
    understoodNothing: false,
  };

  /* 1. "he's had everything" — the highest-value phrase, because it is the one
        she will say most and the one that saves the most taps. */
  let rest = t;   // what is left once a phrase has been spoken for
  const roundWord = ROUND_WORDS.find((w) => t.includes(w));
  if (roundWord) {
    // "he's had everything and ate about half" - "everything" belongs to the
    // medications, so it must not also be read as the amount of food.
    rest = rest.replace(roundWord, ' ');
    for (const d of drugs) {
      if ((d.rounds || []).includes(round)) {
        result.doses.push({ drugKey: d.key, tablets: d.tabletsPerDose ?? 1, why: `"${roundWord}"` });
      }
    }
    result.matched.push(roundWord);
  }

  /* 2. Named drugs, with a count if one was spoken. */
  for (const d of drugs) {
    for (const alias of aliasesFor(d)) {
      const idx = words.indexOf(alias.split(' ')[0]);
      if (idx === -1 || !t.includes(alias)) continue;
      if (result.doses.some((x) => x.drugKey === d.key)) break;   // already in from the round
      result.doses.push({
        drugKey: d.key,
        tablets: countBefore(words, idx) ?? d.tabletsPerDose ?? 1,
        why: `heard "${alias}"`,
      });
      result.matched.push(alias);
      break;
    }
  }

  /* 3. "another pain pill" — resolved against the drugs he is actually on,
        preferring the as-needed one, because that is what she means. */
  if (/\b(another |a )?(pain|sore|hurting)\s*(pill|tablet|one|dose|med)\b/.test(t)
      || /\bsomething for (the |his )?pain\b/.test(t)) {
    const painDrugs = drugs.filter((d) => (d.acts || []).some((a) => a.system === 'joints'));
    const asNeeded = painDrugs.find((d) => d.asNeeded) || painDrugs[0];
    if (asNeeded && !result.doses.some((x) => x.drugKey === asNeeded.key)) {
      result.doses.push({
        drugKey: asNeeded.key,
        tablets: asNeeded.tabletsPerDose ?? 1,
        why: 'a "pain pill" — the as-needed pain drug he is on',
        assumed: true,
      });
      result.matched.push('pain pill');
    }
  }

  /* 4. Food, water, and what came out. Amount stays a word, never a number:
        "about half" is prose and pretending otherwise would be fiction. */
  if (/\b(ate|eating|fed|food|meal|bowl|breakfast|dinner|snack|gobbled|wouldn'?t eat|didn'?t (eat|want|touch)|refused)\b/.test(t)) {
    const amount = (AMOUNTS.find(([re]) => re.test(rest)) || [])[1] ?? null;
    result.observations.push({ type: 'meal', value: amount, text: raw });
    result.matched.push('food');
  }
  if (/\b(drank|drinking|water|thirsty|lapping)\b/.test(t)) {
    const amount = (AMOUNTS.find(([re]) => re.test(rest)) || [])[1] ?? null;
    result.observations.push({ type: 'water', value: amount, text: raw });
    result.matched.push('water');
  }
  if (/\b(pee|peed|weed|urinated|wee)\b/.test(t)) {
    result.observations.push({ type: 'out', value: 'pee', text: raw });
    result.matched.push('out');
  }
  if (/\b(poo|pooped|poop|stool|bowel|number two)\b/.test(t)) {
    result.observations.push({ type: 'out', value: 'stool', text: raw });
    result.matched.push('out');
  }

  result.understoodNothing = result.doses.length === 0 && result.observations.length === 0;
  return result;
}

/* What to say on screen. Deliberately plain: she should be able to see, in one
   glance at 4 AM, whether it got her right. */
export function describe(parsed, regimen) {
  const nameOf = (key) => {
    const d = (regimen.drugs || []).find((x) => x.key === key);
    return d ? d.name : key;
  };
  const lines = [];
  for (const dose of parsed.doses) {
    lines.push(`${nameOf(dose.drugKey)} × ${dose.tablets}${dose.assumed ? ' (assumed)' : ''}`);
  }
  for (const o of parsed.observations) {
    if (o.type === 'meal')  lines.push(`Ate: ${o.value || 'amount not said'}`);
    if (o.type === 'water') lines.push(`Drank: ${o.value || 'amount not said'}`);
    if (o.type === 'out')   lines.push(o.value === 'stool' ? 'Passed a stool' : 'Peed');
  }
  if (parsed.minutesAgo) lines.push(`Given ${parsed.minutesAgo} minutes ago`);
  return lines;
}
