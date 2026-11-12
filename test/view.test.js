'use strict';
// C: the figure parts and view helpers in atlas-view.js (no DOM): every figure stays inside its viewBox for every control value,
// the counts of shapes, the classes that carry colors, the cases of the reading sentences, and which small figure each control moves.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../atlas-core.js');
const D = require('../atlas-data.js');
const V = require('../atlas-view.js');
const M = require('../messages.js');

const ctx = { t: (key) => { const v = M.ja[key]; if (typeof v !== 'string') throw new Error('missing ' + key); return v; }, data: D };
const entry = (id) => D.entries.find((e) => e.id === id);
const OKABE_ITO = ['#000000', '#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7'];
const PARTS = ['popoutGrid', 'asymGrid', 'searchDisplay', 'proximityGrid', 'regionDots', 'contour', 'sectors', 'symmetryBands', 'baselineChart',
  'areaPictures', 'dualAxisChart', 'aspectChart', 'barChart', 'groupedBars', 'lineChart', 'scatter', 'markTable', 'camoScene'];
// Classes without a color of their own; style.css gives each a look (line, text, fill with the ink or paper of the theme)
const PLAIN_CLASSES = ['camo-line', 'camo-outline', 'fig-axis', 'fig-axisname', 'fig-barline', 'fig-break', 'fig-dot', 'fig-frame', 'fig-frame-small',
  'fig-legend', 'fig-link', 'fig-mark', 'fig-nofill', 'fig-outline', 'fig-pattern', 'fig-rule', 'fig-series', 'fig-spine', 'fig-stroke', 'fig-textbar',
  'fig-tick', 'fig-title', 'fixation', 'line-dashed', 'mark-pressed', 'mark-target', 'stim-outline', 'stim-solid', 'ta-end', 'ta-middle', 'ta-start'];

// ----- bounding box of a shape list (paths use M, L, A and Z; arcs are sampled from their center) -----
function arcPoints(x0, y0, r, large, sweep, x1, y1) {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, dx = (x1 - x0) / 2, dy = (y1 - y0) / 2, d = Math.hypot(dx, dy);
  const h = Math.sqrt(Math.max(0, r * r - d * d)), sign = large === sweep ? -1 : 1;
  const cx = mx + sign * h * (-dy / d), cy = my + sign * h * (dx / d);
  const a0 = Math.atan2(y0 - cy, x0 - cx);
  let a1 = Math.atan2(y1 - cy, x1 - cx);
  if (sweep) { while (a1 < a0) a1 += 2 * Math.PI; } else { while (a1 > a0) a1 -= 2 * Math.PI; }
  return Array.from({ length: 33 }, (_, i) => { const a = a0 + (a1 - a0) * i / 32; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
}
function pathPoints(d) {
  const tokens = d.match(/[MLAZ]|-?\d+(?:\.\d+)?/g), out = [];
  let i = 0, cmd = null, cur = [0, 0];
  while (i < tokens.length) {
    if (/[MLAZ]/.test(tokens[i])) { cmd = tokens[i]; i += 1; if (cmd === 'Z') continue; }
    if (cmd === 'M' || cmd === 'L') { cur = [Number(tokens[i]), Number(tokens[i + 1])]; out.push(cur); i += 2; }
    else if (cmd === 'A') {
      const [r, , , large, sweep, x, y] = tokens.slice(i, i + 7).map(Number);
      out.push(...arcPoints(cur[0], cur[1], r, large, sweep, x, y));
      cur = [x, y]; i += 7;
    } else throw new Error('unexpected path token ' + tokens[i] + ' in ' + d);
  }
  return out;
}
function points(shapes, ox = 0, oy = 0, out = []) {
  for (const s of shapes) {
    const a = s.attrs;
    if (s.type === 'g') {
      const m = /^translate\((-?[\d.]+) (-?[\d.]+)\)$/.exec(a.transform || 'translate(0 0)');
      points(s.children, ox + Number(m[1]), oy + Number(m[2]), out);
      continue;
    }
    const add = (x, y) => out.push([ox + x, oy + y]);
    if (s.type === 'rect') { add(a.x, a.y); add(a.x + a.width, a.y + a.height); assert.ok(a.width >= 0 && a.height >= 0); }
    else if (s.type === 'circle') { add(a.cx - a.r, a.cy - a.r); add(a.cx + a.r, a.cy + a.r); }
    else if (s.type === 'line') { add(a.x1, a.y1); add(a.x2, a.y2); }
    else if (s.type === 'text') { add(a.x, a.y); assert.ok(s.text.length > 0); }
    else if (s.type === 'path') for (const [x, y] of pathPoints(a.d)) add(x, y);
    else throw new Error('unknown shape type ' + s.type);
    for (const v of Object.values(a)) if (typeof v === 'number') assert.ok(Number.isFinite(v), JSON.stringify(s));
  }
  return out;
}
function assertInside(fig, label) {
  for (const [x, y] of points(fig.shapes)) {
    assert.ok(x >= -1e-6 && x <= fig.width + 1e-6 && y >= -1e-6 && y <= fig.height + 1e-6, `${label}: (${x}, ${y}) outside ${fig.width}×${fig.height}`);
  }
}
const flat = (shapes) => shapes.flatMap((s) => (s.type === 'g' ? flat(s.children) : [s]));
const classesOf = (fig) => flat(fig.shapes).flatMap((s) => s.cls.split(' ').filter(Boolean));
// Every combination of the control values of an entry
function combos(e) {
  let list = [{}];
  for (const c of e.controls) list = list.flatMap((v) => V.controlOptions(c).map((x) => ({ ...v, [c.id]: x })));
  return list;
}
const rendered = (use, values) => JSON.stringify(V.renderUse(use, values, ctx));

test('C: the eighteen parts are registered', () => {
  assert.deepEqual(V.partNames(), PARTS);
  assert.throws(() => V.renderPart('pieChart3d', {}, ctx), /unknown part/);
});

test('C: every figure of every entry stays inside its viewBox for every combination of control values', () => {
  let n = 0;
  for (const e of D.entries) {
    for (const values of combos(e)) {
      const main = V.renderMain(e, values, ctx);
      if (main) assertInside(main, `${e.id} main ${JSON.stringify(values)}`);
      for (const u of e.uses) assertInside(V.renderUse(u, values, ctx), `${e.id} ${u.side} ${JSON.stringify(values)}`);
      n += 1;
    }
  }
  assert.equal(n, 503);
  // The 1-1 and 1-2 figures stay inside with other seeds as well
  for (let seed = 1; seed <= 30; seed += 1) {
    for (const kind of ['color', 'direction', 'size', 'shape', 'lightness']) {
      for (const shape of ['circleSquare', 'tl']) {
        assertInside(V.renderMain(entry('popout-feature'), { ...V.controlValues(entry('popout-feature')), kind, shape, diff: 'large',
          variety: 'mixed' }, ctx, seed), `popout seed ${seed} ${kind}`);
      }
    }
    assertInside(V.renderMain(entry('popout-asymmetry'), { target: 'noLine', count: 18 }, ctx, seed), `asym seed ${seed}`);
  }
});

test('C: the color classes refer to palette entries of both themes, and the other classes are the known plain ones', () => {
  const used = new Set();
  const take = (fig) => classesOf(fig).forEach((c) => used.add(c));
  for (const e of D.entries) {
    for (const values of combos(e)) {
      const main = V.renderMain(e, values, ctx);
      if (main) take(main);
      for (const u of e.uses) take(V.renderUse(u, values, ctx));
    }
  }
  for (const set of ['color', 'fill']) {
    const t = C.makeSearchTrials({ search: 'conjunction', set, rng: C.xorshift32(3) });
    take(V.renderPart('searchDisplay', { items: t.main[0].items, set }, ctx));
    for (const k of ['target', 'same-dir', 'same-color']) take(V.sampleShapes(k, set));
  }
  take({ shapes: [...V.fixationShapes(), ...V.markShapes({ pressed: 0, target: 35 })] });
  const plain = new Set();
  for (const cls of used) {
    const m = /^(?:fill|stroke)-([a-zA-Z]+)(?:-(\d+))?$/.exec(cls);
    if (!m) { plain.add(cls); continue; }
    for (const theme of ['light', 'dark']) {
      const v = D.palette[theme][m[1]];
      assert.ok(v !== undefined, `${cls} in ${theme}`);
      if (m[2] === undefined) assert.equal(typeof v, 'string', cls);
      else assert.ok(Array.isArray(v) && Number(m[2]) < v.length, `${cls} in ${theme}`);
    }
  }
  assert.deepEqual([...plain].sort(), PLAIN_CLASSES);
});

test('C: the counts of shapes in the main figures', () => {
  const pf = entry('popout-feature'), d1 = V.controlValues(pf);
  assert.deepEqual(d1, { kind: 'color', shape: 'circleSquare', diff: 'large', variety: 'uniform', count: 18 });
  assert.equal(V.renderMain(pf, d1, ctx).shapes.length, 18);
  assert.equal(V.renderMain(pf, { ...d1, count: 6 }, ctx).shapes.length, 6);
  assert.equal(V.renderMain(pf, { ...d1, count: 12 }, ctx).shapes.length, 12);
  const asym = (target) => V.renderMain(entry('popout-asymmetry'), { target, count: 18 }, ctx).shapes;
  assert.equal(asym('withLine').filter((s) => s.type === 'circle').length, 18);
  assert.equal(asym('withLine').filter((s) => s.type === 'line').length, 1);
  assert.equal(asym('noLine').filter((s) => s.type === 'line').length, 17);
  assert.equal(V.renderMain(entry('gestalt-proximity-similarity'), { prox: 0, sim: 'none' }, ctx).shapes.length, 36);
  assert.equal(V.renderMain(entry('gestalt-proximity-similarity'), { prox: 0, sim: 'rows' }, ctx).shapes.filter((s) => s.type === 'rect').length, 18);
  const region = (link) => V.renderMain(entry('gestalt-region-connection'), { link }, ctx).shapes;
  assert.equal(region('none').length, 8);
  assert.equal(region('frame').filter((s) => s.type === 'rect').length, 2);
  assert.equal(region('line').filter((s) => s.type === 'line').length, 2);
  const contour = (gap) => V.renderMain(entry('gestalt-contour'), { gap, crossing: 'smooth' }, ctx).shapes;
  assert.equal(contour(0).length, 4);
  assert.equal(contour(0)[0].attrs['stroke-dasharray'], undefined);
  assert.equal(contour(0.3)[1].attrs['stroke-dasharray'], '35 15');
  assert.equal(V.renderMain(entry('figure-ground-area'), { share: 0.2, swap: false }, ctx).shapes.length, 9);
  for (const regions of [2, 8]) {
    assert.equal(V.renderMain(entry('figure-ground-symmetry'), { cue: 'convex', regions, swap: false }, ctx).shapes.length, regions);
  }
  const base = (chart) => V.renderMain(entry('misread-baseline'), { bottom: 50, chart, mark: 'shown' }, ctx).shapes;
  assert.equal(base('bar').filter((s) => s.cls === 'fill-seriesTarget').length, 3);
  assert.equal(base('line').filter((s) => s.cls === 'fill-seriesTarget').length, 3);
  assert.equal(base('bar').filter((s) => s.cls === 'fig-break').length, 1);
  assert.equal(V.renderMain(entry('misread-baseline'), { bottom: 0, chart: 'bar', mark: 'shown' }, ctx).shapes.filter((s) => s.cls === 'fig-break').length,
    0, 'no break mark when the axis starts at 0');
  const dual = V.renderMain(entry('misread-dual-axis'), { rightTop: 200 }, ctx).shapes;
  assert.equal(dual.filter((s) => s.type === 'circle' && s.cls === 'fill-seriesTarget').length, 13, '12 months and the legend sample');
  const search = V.renderPart('searchDisplay', { items: C.makeSearchTrials({ search: 'feature', rng: C.xorshift32(1) }).main[0].items }, ctx);
  assert.ok([3, 6, 12, 18].includes(search.shapes.length));
});

test('C: the aspect-ratio figure keeps its frame and changes only the plotting area', () => {
  for (const aspect of [0.5, 1, 2, 4]) {
    const fig = V.renderMain(entry('misread-aspect-range'), { aspect, range: 'all' }, ctx);
    assert.deepEqual([fig.width, fig.height], [280, 220]);
    const [yAxis, xAxis] = fig.shapes;
    const pw = xAxis.attrs.x2 - xAxis.attrs.x1, ph = yAxis.attrs.y2 - yAxis.attrs.y1;
    assert.equal(Math.round(pw / ph * 100) / 100, aspect);
    if (aspect >= 1.3) assert.equal(pw, 260); else assert.equal(ph, 200);
  }
});

test('C: the main 1-1 figure follows the kind of difference', () => {
  const pf = entry('popout-feature'), d1 = V.controlValues(pf);
  const lay = (v) => V.popoutLayout({ ...pf.figure.params, ...d1, ...v, seed: pf.figure.seed });
  const color = lay({});
  assert.equal(color.items.filter((i) => i.target).length, 1);
  assert.equal(color.items[0].cls, 'fill-popColor-3');
  assert.ok(color.items.slice(1).every((i) => i.cls === 'fill-popOthers-0'), 'uniform surroundings use one color');
  const mixed = lay({ variety: 'mixed' });
  assert.ok(mixed.items.slice(1).every((i) => /^fill-popOthers-[0-2]$/.test(i.cls)));
  assert.ok(new Set(mixed.items.slice(1).map((i) => i.cls)).size > 1);
  for (const [diff, angle] of [['same', 0], ['small', 20], ['medium', 45], ['large', 90]]) {
    const dir = lay({ kind: 'direction', diff, variety: 'mixed' });
    assert.equal(dir.items[0].angle, angle);
    if (angle > 0) assert.ok(dir.items.slice(1).every((i) => angle - i.angle >= angle / 2 - 1e-9), `others keep half the difference at ${diff}`);
  }
  for (const [diff, scale] of [['same', 1], ['small', 1.25], ['medium', 1.5], ['large', 2]]) assert.equal(lay({ kind: 'size', diff }).items[0].scale, scale);
  const light = lay({ kind: 'lightness', diff: 'small', variety: 'some' });
  assert.equal(light.items[0].cls, 'fill-popLight-1');
  assert.ok(light.items.slice(1).every((i) => /^fill-popLightOthers-[01]$/.test(i.cls)));
  const tl = lay({ kind: 'shape', shape: 'tl' });
  assert.equal(tl.items[0].form, 'T');
  assert.ok(tl.items.slice(1).every((i) => i.form === 'L' && [0, 90, 180, 270].includes(i.rot)));
  assert.deepEqual(lay({ kind: 'shape' }).items.map((i) => i.form), ['circle', ...Array(17).fill('square')]);
  // The same seed keeps the same places whatever the kind
  assert.deepEqual(lay({ kind: 'size' }).items.map((i) => i.cell), color.items.map((i) => i.cell));
  assert.equal(V.findLayout('popout-feature', { ...d1, seed: 5 }).target, V.popoutLayout({ ...d1, seed: 5 }).items[0].cell);
  assert.equal(V.findLayout('popout-asymmetry', { target: 'withLine', count: 18, seed: 5 }).items.filter((i) => i.line).length, 1);
});

test('C: the texts of "Find and tap" exist in both languages', () => {
  for (const key of ['findPress', 'findCover', 'findTime', 'findWrong', 'findReveal', 'findShown', 'findKeyboard', 'reshuffle']) {
    assert.equal(typeof M.ja[key], 'string', key);
    assert.equal(typeof M.en[key], 'string', key);
  }
  const marks = V.markShapes({ pressed: 7, target: 35 });
  assert.equal(marks.filter((s) => s.cls === 'mark-pressed' && s.type === 'circle').length, 1);
  assert.equal(marks.filter((s) => s.cls === 'mark-target' && s.type === 'rect' && s.attrs.rx > 0).length, 2, 'double rounded square');
  assertInside({ width: 360, height: 360, shapes: V.markShapes({ pressed: 0, target: 35 }) }, 'marks');
});

test('C: the colors of the small figures and the camouflage scene meet the spec', () => {
  for (const theme of ['light', 'dark']) {
    const p = D.palette[theme];
    for (const c of p.camoSpots) assert.ok(!OKABE_ITO.includes(c), `${theme} camoSpots ${c}`);
    assert.ok(!OKABE_ITO.includes(p.camoBase));
    assert.deepEqual(p.camoObj, [0, 0.3, 0.6, 1].map((t) => C.mixHex(p.camoBase, p.camoFar, t)), theme);
    assert.deepEqual(p.popColor, [0, 0.3, 0.6, 1].map((t) => C.mixHex(p.stimCool, p.stimHot, t)), theme);
    assert.equal(p.popOthers[0], p.stimCool);
    assert.equal(p.seriesTarget, p.stimCool);
    for (const c of p.seriesOthers) assert.ok(OKABE_ITO.includes(c) && c !== '#000000' && c !== '#f0e442', `${theme} ${c}`);
  }
  const { light, dark } = D.palette;
  assert.deepEqual([light.stimCool, light.stimHot, dark.stimCool, dark.stimHot], ['#0072b2', '#d55e00', '#56b4e9', '#e69f00']);
  assert.deepEqual(light.popLight, [0, 0.13, 0.26, 0.39].map((t) => C.mixHex(light.stimCool, '#000000', t)));
  assert.deepEqual(dark.popLight, [0, 0.25, 0.52, 0.79].map((t) => C.mixHex(dark.stimCool, '#ffffff', t)));
  assert.deepEqual(light.popLightOthers, [0, 0.13, 0.25].map((t) => C.mixHex(light.stimCool, '#ffffff', t)));
  assert.deepEqual(dark.popLightOthers, [0, 0.11, 0.21].map((t) => C.mixHex(dark.stimCool, '#000000', t)));
  assert.deepEqual(light.camoObjLight, [0, 0.13, 0.26, 0.39].map((t) => C.mixHex(light.camoBase, '#000000', t)));
  assert.deepEqual(dark.camoObjLight, [0, 0.25, 0.52, 0.79].map((t) => C.mixHex(dark.camoBase, '#ffffff', t)));
  // The stimuli, the series and the bars in the charts keep 3:1 against the paper in both themes
  for (const theme of ['light', 'dark']) {
    const p = D.palette[theme];
    for (const c of [p.stimCool, p.stimHot, ...p.popColor, ...p.popOthers, ...p.popLight, ...p.popLightOthers, p.seriesTarget, ...p.seriesOthers,
      ...p.groups, p.regionA, p.ink]) {
      assert.ok(C.contrastRatio(c, p.paper) >= 3, `${theme} ${c} ${C.contrastRatio(c, p.paper).toFixed(2)}`);
    }
  }
});

// The reading sentences an entry can choose, over every combination of its control values
function readKeys(id, extras = [{}]) {
  const keys = new Set(), lists = new Set();
  for (const values of combos(entry(id))) {
    for (const extra of extras) {
      const cases = V.readCases(D, id, values, extra);
      cases.forEach((c) => keys.add(c.key));
      lists.add(cases.map((c) => c.key).join('+'));
    }
  }
  return { keys: [...keys], lists: [...lists] };
}

test('C: the reading sentences: every chosen key exists, and the number of cases matches the spec', () => {
  const TIMES = [{}, { times: { withLine: 0.7, noLine: null } }, { times: { withLine: null, noLine: 2.1 } }, { times: { withLine: 0.7, noLine: 2.1 } }];
  const expected = { 'popout-feature': 12, 'popout-asymmetry': 5, 'gestalt-proximity-similarity': 9, 'gestalt-region-connection': 3,
    'gestalt-contour': 5, 'figure-ground-area': 3, 'figure-ground-symmetry': 4, 'misread-area': 4, 'misread-dual-axis': 2 };
  for (const [id, n] of Object.entries(expected)) {
    const { keys } = readKeys(id, id === 'popout-asymmetry' ? TIMES : [{}]);
    assert.equal(keys.length, n, `${id}: ${keys.join(', ')}`);
    for (const k of keys) assert.ok(typeof M.ja[k] === 'string' && typeof M.en[k] === 'string', k);
  }
  const base = readKeys('misread-baseline');
  assert.deepEqual(base.keys.sort(), ['baseRead.line', 'baseRead.mark', 'baseRead.raised', 'baseRead.zero']);
  assert.deepEqual(base.lists.filter((l) => l.startsWith('baseRead.raised')).sort(),
    ['baseRead.raised', 'baseRead.raised+baseRead.line', 'baseRead.raised+baseRead.mark', 'baseRead.raised+baseRead.mark+baseRead.line']);
  assert.ok(base.lists.includes('baseRead.zero'));
  const aspect = readKeys('misread-aspect-range');
  assert.deepEqual(aspect.keys.filter((k) => /steep|mid|flat/.test(k)).sort(), ['aspectRead.flat', 'aspectRead.mid', 'aspectRead.steep']);
  assert.deepEqual(aspect.keys.filter((k) => /all|last6/.test(k)).sort(), ['aspectRead.all', 'aspectRead.last6']);
  // The 1-1 cases follow the steps: same → same, shape → the two shape sentences
  const pf = (v) => V.readCases(D, 'popout-feature', { ...V.controlValues(entry('popout-feature')), ...v }).map((c) => c.key);
  assert.deepEqual(pf({ diff: 'same', variety: 'mixed' }), ['popRead.same']);
  assert.deepEqual(pf({ diff: 'small', variety: 'some' }), ['popRead.S.some']);
  assert.deepEqual(pf({ kind: 'shape', shape: 'tl' }), ['popRead.shapeTL']);
  assert.deepEqual(pf({ kind: 'shape', shape: 'circleSquare' }), ['popRead.shapeCurve']);
  // Proximity −2 and −1 → rows, 0 → even, 1 and 2 → cols
  for (const [prox, side] of [[-2, 'rows'], [-1, 'rows'], [0, 'even'], [1, 'cols'], [2, 'cols']]) {
    assert.deepEqual(V.readCases(D, 'gestalt-proximity-similarity', { prox, sim: 'cols' }).map((c) => c.key), [`proxRead.${side}.cols`]);
  }
  // The number of every key the stacked sentences need (readKeysAll) equals the keys above
  assert.equal(V.readKeysAll(D, 'popout-feature').length, 12);
  assert.equal(V.readKeysAll(D, 'popout-asymmetry', TIMES).length, 5);
  assert.deepEqual(V.readCases(D, 'search-time', { view: 'feature' }), []);
});

test('C: the reading sentences use the rounded values shown for their borders', () => {
  const contour = (gap) => V.readCases(D, 'gestalt-contour', { gap, crossing: 'smooth' })[0];
  assert.deepEqual([0, 0.1, 0.3, 0.4, 0.6].map((g) => contour(g).key),
    ['contourRead.gap0', 'contourRead.gapLow', 'contourRead.gapLow', 'contourRead.gapHigh', 'contourRead.gapHigh']);
  assert.equal(contour(0.3).values.p, '30');
  const area = (share) => V.readCases(D, 'figure-ground-area', { share, swap: false })[0].key;
  assert.deepEqual([0.2, 0.4, 0.5, 0.6, 0.8].map(area),
    ['areaRead.filledNarrow', 'areaRead.filledNarrow', 'areaRead.equal', 'areaRead.emptyNarrow', 'areaRead.emptyNarrow']);
  const deg = (aspect, range) => V.readCases(D, 'misread-aspect-range', { aspect, range })[0];
  assert.deepEqual([0.5, 1, 2, 4].map((a) => deg(a, 'all').values.deg), ['67.3', '51.4', '33.5', '19.0']);
  assert.deepEqual([0.5, 1, 2, 4].map((a) => deg(a, 'all').key), ['aspectRead.steep', 'aspectRead.mid', 'aspectRead.mid', 'aspectRead.flat']);
  assert.deepEqual([0.5, 1, 2, 4].map((a) => deg(a, 'last6').key), ['aspectRead.mid', 'aspectRead.mid', 'aspectRead.flat', 'aspectRead.flat']);
  assert.deepEqual([200, 300, 400, 600].map((m) => V.numbersCase(D, 'misread-dual-axis', { rightTop: m }).values.n), ['2', '3', '0', '0']);
  assert.deepEqual([0, 25, 40, 50].map((b) => V.numbersCase(D, 'misread-baseline', { bottom: b, chart: 'bar', mark: 'none' }).values.r),
    ['1.12', '1.22', '1.50', '4.00']);
  assert.deepEqual(V.numbersCase(D, 'misread-area', { ratio: 2, stretch: 'area' }).values, { v: '2.00', h: '1.41', a: '2.00' });
  assert.deepEqual(V.numbersCase(D, 'misread-area', { ratio: 2, stretch: 'both' }).values, { v: '2.00', h: '2.00', a: '4.00' });
  assert.equal(V.numbersCase(D, 'gestalt-contour', { gap: 0, crossing: 'smooth' }), null);
});

test('C: a control moves only the small figures it is bound to, and the line under each small figure names it', () => {
  for (const e of D.entries) {
    const defaults = V.controlValues(e);
    for (const u of e.uses) {
      const before = rendered(u, defaults);
      for (const c of e.controls) {
        const changes = V.controlOptions(c).filter((v) => rendered(u, { ...defaults, [c.id]: v }) !== before);
        if (Object.hasOwn(u.bind || {}, c.id)) assert.ok(changes.length > 0, `${e.id} ${u.side}: ${c.id} should move the figure`);
        else assert.deepEqual(changes, [], `${e.id} ${u.side}: ${c.id} should not move the figure`);
      }
    }
  }
});

test('C: the linked line of 1-1 for each of the five kinds, and of the other entries', () => {
  const pf = entry('popout-feature'), d1 = V.controlValues(pf);
  for (const kind of ['color', 'direction', 'size', 'shape', 'lightness']) {
    for (const u of pf.uses) {
      const ja = V.linkedText(M, 'ja', pf, u, { ...d1, kind }), en = V.linkedText(M, 'en', pf, u, { ...d1, kind });
      if (['color', 'lightness', 'size'].includes(kind)) {
        assert.equal(ja, 'この図が変わる操作：違いの種類・違いの大きさ・周りのばらつき');
        assert.equal(en, 'Changes with: Kind of difference, Size of the difference, Variety around it');
      } else {
        assert.equal(ja, 'いまの設定では、この図は変わりません。');
        assert.equal(en, 'With the current settings, this figure does not change.');
      }
    }
  }
  const line = (id, side) => { const e = entry(id); return V.linkedText(M, 'ja', e, e.uses.find((u) => u.side === side), V.controlValues(e)); };
  assert.equal(line('gestalt-proximity-similarity', 'show'), 'この図が変わる操作：近さ・似かた');
  assert.equal(line('gestalt-proximity-similarity', 'hide'), 'この図が変わる操作：似かた');
  assert.equal(line('gestalt-contour', 'show'), 'この図が変わる操作：輪郭の途切れ・交わり方');
  assert.equal(line('gestalt-contour', 'hide'), 'この図が変わる操作：輪郭の途切れ');
  assert.equal(line('figure-ground-symmetry', 'hide'), 'この図が変わる操作：手がかり');
  assert.equal(line('misread-baseline', 'readable'), 'いまの設定では、この図は変わりません。');
  assert.equal(line('misread-area', 'readable'), 'この図が変わる操作：値の比');
});

test('C: each title contains its underlined terms in both languages, and each term has a meaning', () => {
  for (const e of D.entries) {
    assert.ok(e.titleTerms.length > 0, e.id);
    for (const t of e.titleTerms) {
      assert.ok(M.ja[`item.${e.id}.title`].includes(t.ja), `${e.id} ja ${t.ja}`);
      assert.ok(M.en[`item.${e.id}.title`].includes(t.en), `${e.id} en ${t.en}`);
      for (const lang of ['ja', 'en']) assert.equal(typeof M[lang][t.term + 'Meaning'], 'string', `${lang} ${t.term}`);
    }
  }
});

test('C: the view model lists the tabs in order with their entries, headings and next tab', () => {
  const vm = V.buildViewModel(D);
  assert.deepEqual(vm.tabs.map((t) => t.id), ['popout', 'search', 'gestalt', 'figure-ground', 'misread']);
  assert.deepEqual(vm.tabs.map((t) => t.entries.length), [2, 1, 3, 2, 4]);
  assert.deepEqual(vm.tabs.map((t) => (t.next ? t.next.labelKey : null)), ['tabSearch', 'tabGestalt', 'tabFigureGround', 'tabMisread', null]);
  assert.deepEqual(vm.tabs[4].leadKeys, ['misreadLead', 'misreadFictional']);
  for (const tab of vm.tabs) {
    for (const e of tab.entries) {
      // The search time card has the showing side only, so its heading names that side alone
      assert.equal(e.usesHeadingKey, tab.id === 'misread' ? 'usesHeadingReadable' : tab.id === 'search' ? 'usesHeadingShow' : 'usesHeading', e.id);
      for (const key of [e.titleKey, e.oneLineKey, e.howToKey, e.usesHeadingKey, ...e.uses.map((u) => u.labelKey), ...e.uses.map((u) => u.titleKey),
        ...e.controls.map((c) => c.labelKey), ...e.controls.flatMap((c) => c.optionKeys)]) {
        assert.equal(typeof M.ja[key], 'string', `${e.id} ${key}`);
        assert.equal(typeof M.en[key], 'string', `${e.id} ${key}`);
      }
    }
  }
  const pf = vm.tabs[0].entries[0];
  assert.deepEqual(pf.actions, ['reshuffle', 'find']);
  assert.equal(pf.safety.colorHintKey, 'colorHint');
  assert.deepEqual(pf.controls.find((c) => c.id === 'diff').optionKeys,
    ['ctl.popout-feature.diff.same', 'ctl.popout-feature.diff.small', 'ctl.popout-feature.diff.medium', 'ctl.popout-feature.diff.large']);
  assert.deepEqual(vm.tabs[2].entries[0].controls[0].optionKeys.map((k) => k.split('.').pop()), ['rowsMuch', 'rows', 'even', 'cols', 'colsMuch']);
  assert.equal(vm.tabs[1].entries[0].experiment, true);
  assert.equal(vm.tabs[1].entries[0].mainTitleKey, null);
});

test('C: which controls are enabled', () => {
  const pf = entry('popout-feature'), d1 = V.controlValues(pf);
  const ctl = (id) => pf.controls.find((c) => c.id === id);
  assert.equal(V.controlEnabled(ctl('shape'), d1), false);
  assert.equal(V.controlEnabled(ctl('shape'), { ...d1, kind: 'shape' }), true);
  assert.equal(V.controlEnabled(ctl('diff'), { ...d1, kind: 'shape' }), false);
  assert.equal(V.controlEnabled(ctl('variety'), { ...d1, kind: 'shape' }), false);
  assert.equal(V.controlEnabled(ctl('diff'), d1), true);
  const mark = entry('misread-baseline').controls.find((c) => c.id === 'mark');
  assert.equal(V.controlEnabled(mark, { bottom: 0 }), false);
  assert.equal(V.controlEnabled(mark, { bottom: 5 }), true);
});

test('C: the small figures of the search tab: one blue dashed line among blue solid and other dashed lines, or one blue line', () => {
  const st = entry('search-time');
  const lines = (view) => V.renderUse(st.uses[0], { view }, ctx).shapes.filter((s) => s.type === 'path');
  const conj = lines('conjunction'), feature = lines('feature');
  assert.equal(conj.length, 6);
  assert.equal(conj.filter((s) => s.cls.includes('stroke-seriesTarget') && s.cls.includes('line-dashed')).length, 1);
  assert.equal(conj.filter((s) => s.cls.includes('stroke-seriesTarget') && !s.cls.includes('line-dashed')).length, 2);
  assert.equal(conj.filter((s) => s.cls.includes('stroke-seriesOthers') && s.cls.includes('line-dashed')).length, 3);
  assert.equal(feature.filter((s) => s.cls.includes('stroke-seriesTarget')).length, 1);
  assert.ok(feature.every((s) => !s.cls.includes('line-dashed')));
});

// ----- The results of the search experiment -----
// A whole block from known times: 8 right answers per number of bars and presence, each at base + slope × bars
function knownBlock(present, absent) {
  const records = [];
  for (const setSize of C.SET_SIZES) {
    for (const [isPresent, [base, slope]] of [[true, present], [false, absent]]) {
      for (let k = 0; k < 8; k += 1) records.push({ setSize, present: isPresent, outcome: 'correct', rt: base + slope * setSize, input: 'key' });
    }
  }
  return C.summarizeBlock(records);
}
test('C: a negative number on the screen has the minus sign (U+2212), not a hyphen; the value itself is unchanged', () => {
  const block = knownBlock([560, -2], [500, 10]);
  const rows = V.resultRows({ feature: block, conjunction: null });
  assert.deepEqual([rows[0].slope, rows[1].slope], ['\u22122.0', '10.0']);
  assert.ok(Math.abs(block.rows.present.slope + 2) < 1e-9, 'the computed slope stays a number');
  // A slope that is shown as 0.0 has no sign
  assert.equal(V.resultRows({ feature: knownBlock([500, -0.04], [500, 1]), conjunction: null })[0].slope, '0.0');
  assert.deepEqual([V.numberText(-12.5), V.numberText(0), V.numberText(18), V.numberText('-0.5')], ['\u221212.5', '0', '18', '\u22120.5']);
  // The ticks of the chart are written the same way (they start at 0, so none of them is negative)
  const fig = V.resultChart({ feature: block, conjunction: null }, { wide: true, t: (k) => k });
  const ticks = fig.shapes.filter((sh) => sh.type === 'text' && /fig-tick/.test(sh.cls)).map((sh) => sh.text);
  assert.ok(ticks.length >= 8 && ticks.every((x) => /^[0-9]+$/.test(x)), ticks.join(' '));
});
const CHART_CLASSES = ['fig-axis', 'fig-axisname', 'fig-legend', 'fig-series', 'fig-tick', 'fill-seriesOthers-0', 'fill-seriesTarget', 'line-dashed',
  'res-leader', 'res-open', 'stroke-seriesOthers-0', 'stroke-seriesTarget', 'ta-end', 'ta-middle', 'ta-start'];

test('C: the rows of the result table: middle values in whole ms, the slope with one decimal, accuracy in %, and none when not measured', () => {
  const rows = V.resultRows({ feature: knownBlock([500, 2], [500, 5]), conjunction: null });
  assert.deepEqual(rows.map((r) => r.id), ['feature.present', 'feature.absent', 'conjunction.present', 'conjunction.absent']);
  assert.deepEqual(rows.map((r) => r.labelKey), ['resRowFeatureYes', 'resRowFeatureNo', 'resRowConjYes', 'resRowConjNo']);
  assert.deepEqual(rows[0].medians, [506, 512, 524, 536]);
  assert.deepEqual(rows[1].medians, [515, 530, 560, 590]);
  assert.deepEqual([rows[0].slope, rows[1].slope, rows[0].accuracy, rows[0].excluded], ['2.0', '5.0', 100, 0]);
  for (const r of rows.slice(2)) {
    assert.deepEqual([r.measured, r.medians, r.slope, r.accuracy, r.excluded], [false, [null, null, null, null], null, null, null]);
  }
  // There = a solid line and a filled mark, not there = a dashed line and an open mark; feature = circles, conjunction = triangles
  assert.deepEqual(rows.map((r) => [r.marker, r.open]), [['circle', false], ['circle', true], ['triangle', false], ['triangle', true]]);
});

test('C: the result chart: the vertical axis from 0, a mark per middle value, the names at the line ends on wide screens only', () => {
  assert.deepEqual([999, 1000, 1001, 2000, 2001, 3999].map((m) => V.resultTop(m)),
    [{ top: 1000, step: 250 }, { top: 1000, step: 250 }, { top: 1500, step: 500 }, { top: 2000, step: 500 }, { top: 3000, step: 1000 },
      { top: 4000, step: 1000 }]);
  // The two feature rows end close together: their names keep 13 apart
  const results = { feature: knownBlock([500, 2], [520, 2]), conjunction: knownBlock([600, 20], [620, 50]) };
  const t = (key) => M.ja[key];
  for (const wide of [false, true]) {
    const fig = V.resultChart(results, { wide, t });
    assertInside({ ...fig, shapes: fig.shapes.filter((s) => s.type !== 'text') }, 'result chart');
    const shapes = flat(fig.shapes), cls = new Set(classesOf(fig));
    assert.ok([...cls].every((c) => CHART_CLASSES.includes(c)), [...cls].join(' '));
    assert.equal(shapes.filter((s) => s.type === 'circle').length, 8, 'feature: 8 middle values');
    assert.equal(shapes.filter((s) => s.type === 'path' && !s.cls.includes('fig-series')).length, 8, 'conjunction: 8 triangles');
    assert.equal(shapes.filter((s) => s.cls.includes('fig-series')).length, 4, 'four lines');
    assert.equal(shapes.filter((s) => s.cls.includes('line-dashed')).length, 2, 'not there = dashed');
    const names = shapes.filter((s) => s.cls.includes('fig-legend'));
    assert.equal(names.length, wide ? 4 : 0);
    assert.equal(shapes.filter((s) => s.cls.includes('res-leader')).length, wide ? 4 : 0);
    const ys = names.map((s) => s.attrs.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i += 1) assert.ok(ys[i] - ys[i - 1] >= 13 - 0.01, ys.join(' '));
    // The axis starts at 0; the longest middle value here is 1,520 ms, so the top is 2,000
    assert.equal(fig.top, 2000);
    assert.ok(shapes.some((s) => s.type === 'text' && s.text === '0'));
  }
  // A single middle value: a mark and no line
  const one = V.resultChart({ feature: C.summarizeBlock([3, 3, 3, 3].map((setSize) => ({ setSize, present: true, outcome: 'correct', rt: 600 }))),
    conjunction: null }, { wide: true, t });
  assert.equal(flat(one.shapes).filter((s) => s.cls.includes('fig-series')).length, 0);
  assert.equal(flat(one.shapes).filter((s) => s.type === 'circle').length, 1);
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'style.css'), 'utf8');
  for (const c of ['res-leader', 'res-open']) assert.ok(css.includes('.' + c + ' {'), c);
});

test('C: the legend keys of the result chart and the description of the small chart of the search tab', () => {
  const key = V.resultKey('conjunction.absent');
  assert.deepEqual(key.shapes.map((s) => s.cls), ['stroke-seriesOthers-0 fig-series line-dashed', 'stroke-seriesOthers-0 res-open']);
  assert.deepEqual(V.resultKey('feature.present').shapes.map((s) => s.type), ['line', 'circle']);
  const st = entry('search-time');
  for (const view of ['feature', 'conjunction']) {
    for (const lang of ['ja', 'en']) assert.ok(V.descText(M, lang, st, { view }, 'show').length > 10, view);
  }
  assert.equal(V.descCase(st, { view: 'feature' }, 'main'), null);
});
