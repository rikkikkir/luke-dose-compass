/* Luke's Dose Compass — time drawn the way they live it.

   Rikki: "Luke and I live on close to a 25.4 hour day. That might not be exact
   day to day, but I want the representation of time to be seen in about 25.4
   hour circles or chunks."

   That is a FRAME, not a forecast. The app measured her last thirty
   wake-to-wake spans — 14.2 to 59.8 hours — and will not predict when she
   wakes. But a fixed 25.4-hour circle is comparable between chunks, needs no
   wake mark to exist, and is the unit she actually experiences.

   Feel pieces three and four (SPEC-feel.md): one circle for now, and a run of
   circles for the shape of recent days. Certainty is visible in the drawing
   itself: a circle with no wake mark is dashed, because its start is a guess. */

import { circles, positionInCircle, cycleLength, cycleHours, readEvents, HOUR } from './store.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Minimum circles before any shape is claimed. Three points are not a trend,
   and a false trend about a dying dog is the worst thing this app could show. */
const MIN_FOR_SHAPE = 5;

const colourOf = (key, regimen) => {
  const d = (regimen.drugs || []).find((x) => x.key === key);
  return d && d.colour ? `var(${d.colour})` : 'var(--ink3)';
};

function clock(ms, offset) {
  const d = new Date(ms + (offset || 0) * 60000);
  const h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2, '0');
  const ampm = h < 12 ? 'am' : 'pm';
  return `${h % 12 === 0 ? 12 : h % 12}:${m}${ampm}`;
}

/* ------------------------------------------------------------- the dial */

function dial(circle, regimen, now) {
  const R = 116, CX = 150, CY = 150, ringW = 16;
  const at = (fraction, r) => {
    const angle = fraction * Math.PI * 2 - Math.PI / 2;   // 0 at the top: waking
    return [CX + Math.cos(angle) * r, CY + Math.sin(angle) * r];
  };

  const marks = circle.events
    .filter((e) => ['dose', 'meal', 'water', 'out', 'sleep', 'wake'].includes(e.type))
    .map((e) => {
      const f = (e.atUTC - circle.start) / circle.span;
      if (f < 0 || f > 1) return '';
      const [x, y] = at(f, R);
      if (e.type === 'dose') {
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${colourOf(e.drugKey, regimen)}"><title>${esc(e.drugKey)} at ${clock(e.atUTC, e.atOffset)}</title></circle>`;
      }
      const glyph = { meal: '▲', water: '▼', out: '·', sleep: '☾', wake: '☀' }[e.type] || '·';
      const [tx, ty] = at(f, R - 22);
      return `<text x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="middle" font-size="12" fill="var(--ink3)"><title>${esc(e.type)} at ${clock(e.atUTC, e.atOffset)}</title>${glyph}</text>`;
    }).join('');

  const pos = positionInCircle(circle, now);
  const [px, py] = at(pos, R);
  const hoursIn = ((now - circle.start) / HOUR);

  return `<svg viewBox="0 0 300 300" width="100%" role="img"
      aria-label="A ${cycleHours()} hour circle. ${hoursIn.toFixed(1)} hours in, with ${circle.doses.length} doses marked.">
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--sunk)" stroke-width="${ringW}"/>
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--accent)" stroke-width="${ringW}"
      stroke-linecap="round" pathLength="1"
      stroke-dasharray="${pos.toFixed(3)} 1" transform="rotate(-90 ${CX} ${CY})" opacity="0.35"/>
    ${marks}
    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="7" fill="var(--ink)" stroke="var(--bg)" stroke-width="3"/>
    <text x="${CX}" y="${CY - 8}" text-anchor="middle" font-size="13" fill="var(--ink3)">${hoursIn.toFixed(1)} h in</text>
    <text x="${CX}" y="${CY + 16}" text-anchor="middle" font-size="12" fill="var(--ink3)">of ${cycleHours()}</text>
  </svg>`;
}

/* -------------------------------------------------------------- the arc */

function bar(circle, regimen, now) {
  const marks = circle.events.map((e) => {
    const f = (e.atUTC - circle.start) / circle.span;
    if (f < 0 || f > 1) return '';
    const left = (f * 100).toFixed(1);
    if (e.type === 'dose') return `<span class="tick dose" style="left:${left}%;background:${colourOf(e.drugKey, regimen)}" title="${esc(e.drugKey)}"></span>`;
    if (e.type === 'meal') return `<span class="tick meal" style="left:${left}%" title="ate ${esc(e.value || '')}"></span>`;
    if (e.type === 'water') return `<span class="tick water" style="left:${left}%" title="drank"></span>`;
    if (e.type === 'wake') return `<span class="tick wake" style="left:${left}%" title="woke"></span>`;
    if (e.type === 'sleep') return `<span class="tick sleep" style="left:${left}%" title="sleep started"></span>`;
    return '';
  }).join('');

  const d = new Date(circle.start);
  const label = circle.current ? 'now' : `${d.getMonth() + 1}/${d.getDate()}`;
  const ate = circle.meals.length;
  // An empty circle has nothing to report, not zero of everything. Saying "no
  // food logged" about a circle from before she started reads as a finding.
  const summary = circle.events.length === 0
    ? 'nothing logged'
    : `${circle.doses.length} dose${circle.doses.length === 1 ? '' : 's'}`
      + (ate ? `, ate ${ate}×` : ', no food logged');

  return `<div class="circle-row${circle.current ? ' current' : ''}${circle.anchoredToWake ? '' : ' unanchored'}">
    <span class="circle-label">${esc(label)}</span>
    <span class="circle-bar">${marks}</span>
    <span class="circle-sum">${esc(summary)}</span>
  </div>`;
}

/* ------------------------------------------------------------- render */

export function renderCircles(root, regimen, now = Date.now()) {
  if (!regimen) { root.innerHTML = '<p class="unknown">Loading…</p>'; return; }
  const events = readEvents();
  const ring = circles(events, now, 8);
  const current = ring[0];
  const cycle = cycleLength(events, now);

  const enough = ring.filter((c) => c.events.length).length >= MIN_FOR_SHAPE;

  root.innerHTML = `<a class="back" href="#home">&larr; Luke</a>
    <h2>Your circles</h2>
    <p class="interp">Interpretation, not measurement. Time drawn in ${cycleHours()}-hour circles, the day you actually live.</p>

    <div class="card dial-card">${dial(current, regimen, now)}
      <p class="sys-note">${current.anchoredToWake
        ? 'This circle starts at your last logged wake.'
        : 'No wake logged, so this circle starts from now. Log "We woke" and it will line up with your real day.'}</p>
    </div>

    <p class="k">The last ${ring.length} circles</p>
    <div class="circle-arc">${ring.slice().reverse().map((c) => bar(c, regimen, now)).join('')}</div>

    <p class="foot-note">${enough
      ? 'Each row is one ' + cycleHours() + '-hour circle, oldest at the top. Marks are placed where in the circle they happened, so rows are directly comparable.'
      : `Only ${ring.filter((c) => c.events.length).length} circles have anything in them. Below ${MIN_FOR_SHAPE}, this shows the circles and draws no shape — a few points are not a trend.`}</p>

    ${cycle.estimated ? '' : `<details class="why">
      <summary>How long your circles actually run</summary>
      <p>Measured across your last ${cycle.samples} wake-to-wake spans: mean <b>${cycle.hours.toFixed(1)} h</b>, shortest ${cycle.min.toFixed(1)} h, longest ${cycle.max.toFixed(1)} h.</p>
      ${cycle.note ? `<p class="unknown">${esc(cycle.note)}</p>` : ''}
      <p class="unknown">This describes your cycle. It is never used to predict when you will wake — the spread is far too wide for that to be honest.</p>
    </details>`}`;
}
