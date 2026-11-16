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
const PARTS = ['popoutGrid', 'asymGrid', 'motionGrid', 'searchDisplay', 'proximityGrid', 'regionDots', 'contour', 'sectors', 'symmetryBands',
  'baselineChart', 'areaPictures', 'dualAxisChart', 'aspectChart', 'lightnessSquares', 'barChart', 'groupedBars', 'lineChart', 'scatter', 'markTable',
  'heatmap', 'camoScene', 'camoSearchScene'];
// Classes without a color of their own; style.css gives each a look (line, text, fill with the ink or paper of the theme)
const PLAIN_CLASSES = ['camo-line', 'camo-mark', 'camo-outline', 'fig-axis', 'fig-axisname', 'fig-barline', 'fig-break', 'fig-cellnum', 'fig-cross',
  'fig-dot', 'fig-frame', 'fig-frame-small', 'fig-legend', 'fig-link', 'fig-mark', 'fig-missing', 'fig-nofill', 'fig-outline', 'fig-pattern',
  'fig-rule', 'fig-series', 'fig-spine', 'fig-stroke', 'fig-textbar', 'fig-tick', 'fig-title', 'fig-trail', 'fixation', 'line-dashed',
  'mark-pressed', 'mark-target', 'stim-outline', 'stim-solid', 'ta-end', 'ta-middle', 'ta-start'];

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
    else if (s.type === 'ellipse') { add(a.cx - a.rx, a.cy - a.ry); add(a.cx + a.rx, a.cy + a.ry); }
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
const rendered = (use, values, extra = {}) => JSON.stringify(V.renderUse(use, values, ctx, extra));

test('C: the twenty-two parts are registered', () => {
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
  // 514 before the camouflage experiment, whose small figure has 3 patterns × 2 marks
  assert.equal(n, 520);
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
  take({ shapes: [...V.fixationShapes(), ...V.markShapes({ pressed: 0, target: 35 }), ...V.mothSample().shapes] });
  // The moving entry with a non-rest pose: the main figure and the two small ones show the fig-trail dots of the frame-by-frame step
  const motionPose = { pose: { u: 0.5, env: 1, prev: 0.25 } }, motion = entry('popout-motion'), motionValues = V.controlValues(motion);
  take(V.renderPart(motion.figure.part, { ...motion.figure.params, ...motionValues, seed: motion.figure.seed, ...motionPose }, ctx));
  for (const u of motion.uses) take(V.renderUse(u, motionValues, ctx, motionPose));
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
  const contour = (gap, crossing = 'smooth') => V.renderMain(entry('gestalt-contour'), { gap, crossing }, ctx).shapes;
  // The circle, the square, the two crossing lines and the marks at their ends (two circles for A, two squares for B)
  assert.equal(contour(0).length, 8);
  assert.equal(contour(0)[0].attrs['stroke-dasharray'], undefined);
  assert.equal(contour(0.3)[1].attrs['stroke-dasharray'], '35 15');
  // The two lines differ in color and in the marks at their ends, so that the picture shows which ends belong to one line: crossing
  // smoothly, A runs from the upper left to the lower right; bending where they meet, A runs from the upper left to the upper right
  const marksOf = (shapes, cls) => shapes.filter((x) => x.cls === cls).map((x) => (x.type === 'circle' ? [x.attrs.cx, x.attrs.cy]
    : [x.attrs.x + 5.5, x.attrs.y + 5.5]));
  assert.deepEqual(contour(0).slice(2, 4).map((x) => x.cls), ['stroke-seriesTarget fig-series fig-cross', 'stroke-seriesOthers-0 fig-series fig-cross']);
  assert.deepEqual(marksOf(contour(0), 'fill-seriesTarget'), [[30, 165], [290, 225]]);
  assert.deepEqual(marksOf(contour(0), 'fill-seriesOthers-0'), [[30, 225], [290, 165]]);
  assert.deepEqual(marksOf(contour(0, 'corner'), 'fill-seriesTarget'), [[30, 165], [290, 165]]);
  assert.deepEqual(marksOf(contour(0, 'corner'), 'fill-seriesOthers-0'), [[30, 225], [290, 225]]);
  assert.equal(V.renderMain(entry('figure-ground-area'), { share: 0.2 }, ctx).shapes.length, 9);
  // 3-1: the dark wedges take the share given by the slider, and the bars of the chart beside it are the dark color on the light one
  // (the same two colors as the wedges)
  for (const share of [0.2, 0.5, 0.8]) {
    const wedges = V.renderMain(entry('figure-ground-area'), { share }, ctx).shapes.slice(0, 8);
    assert.deepEqual(wedges.map((w) => w.cls), Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? 'fill-areaDark' : 'fill-areaLight')));
    const bars = V.renderUse(entry('figure-ground-area').uses[0], { share }, ctx).shapes;
    assert.equal(bars[0].cls, 'fill-areaLight');
    assert.ok(bars.slice(1, 7).every((b) => b.cls === 'fill-areaDark' && Math.abs(b.attrs.width - 30 * share) < 1e-9), String(share));
  }
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

test('C: the contour entry: every step of the gap changes both small figures (more missing months; more patches on the edge)', () => {
  const e = entry('gestalt-contour'), [show, hide] = e.uses;
  const steps = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  for (const crossing of ['smooth', 'corner']) {
    const shows = steps.map((gap) => V.renderUse(show, { gap, crossing }, ctx)), hides = steps.map((gap) => V.renderUse(hide, { gap, crossing }, ctx));
    // The showing side: at 0 the lines run across September and October (no band); from 10% a band marks each missing month and one
    // month more goes missing at each step
    assert.deepEqual(shows.map((f) => f.shapes.filter((x) => x.cls === 'fig-missing').length), [0, 2, 3, 4, 5, 6, 7], crossing);
    assert.equal(shows[0].shapes.filter((x) => x.type === 'path' && /fig-series/.test(x.cls)).length, 2, 'one line each at 0');
    // The hiding side: four more patches on the edge at each step
    const outline = pathPoints(hides[0].shapes.find((x) => x.type === 'path' && /fill-camoObj-/.test(x.cls)).attrs.d);
    const at = hides[0].shapes.findIndex((x) => x.type === 'path' && /fill-camoObj-/.test(x.cls));
    const patches = (f) => f.shapes.slice(at + 1).filter((x) => x.type === 'circle' && x.attrs.r >= 10);
    assert.deepEqual(hides.map((f) => patches(f).length), [0, 4, 8, 12, 16, 20, 24], crossing);
    for (let i = 1; i < steps.length; i += 1) {
      assert.notDeepEqual(shows[i], shows[i - 1], `${crossing} show ${steps[i]}`);
      assert.notDeepEqual(hides[i], hides[i - 1], `${crossing} hide ${steps[i]}`);
    }
    // At 60% the patches cover nine tenths of the outline or more, so the outline can hardly be followed
    const covered = outline.filter(([x, y]) => patches(hides[6]).some((c) => Math.hypot(c.attrs.cx - x, c.attrs.cy - y) <= c.attrs.r)).length;
    assert.ok(covered >= 0.9 * outline.length, `covered ${covered} of ${outline.length}`);
  }
});

test('C: the aspect-ratio figure keeps its frame and changes only the plotting area', () => {
  // The largest plotting area is 182 × 140 (room for the title and the scale); from the ratio 182 ÷ 140 = 1.3 the width is the
  // largest, below it the height
  assert.deepEqual(V.SIZES.aspectPlot, [182, 140]);
  assert.equal(V.ASPECT_EDGE, 1.3);
  const known = { all: ['67.3', '51.4', '33.5', '19.0'], last6: ['56.1', '37.6', '21.6', '11.3'] };
  for (const range of ['all', 'last6']) {
    [0.5, 1, 2, 4].forEach((aspect, k) => {
      const fig = V.renderMain(entry('misread-aspect-range'), { aspect, range }, ctx);
      assert.deepEqual([fig.width, fig.height], [280, 220]);
      const [yAxis, xAxis, series] = fig.shapes;
      const pw = xAxis.attrs.x2 - xAxis.attrs.x1, ph = yAxis.attrs.y2 - yAxis.attrs.y1;
      assert.equal(Math.round(pw / ph * 100) / 100, aspect);
      if (aspect >= 1.3) assert.equal(pw, 182); else assert.equal(ph, 140);
      // The average slope stays the known value: the angle depends on the ratio and the data only, and the line as drawn keeps it (within
      // 0.05 degrees: the points of the path are written with two decimals, which moves 18.95 of the ratio 4 to 18.94)
      const loans = D.datasets.libraryLoans24, exact = C.meanAbsAngle(range === 'all' ? loans : loans.slice(-6), aspect);
      assert.equal(C.round1(exact).toFixed(1), known[range][k], `${range} ${aspect}`);
      const p = pathPoints(series.attrs.d), angles = p.slice(1).map(([x, y], i) => Math.atan2(Math.abs(y - p[i][1]), x - p[i][0]) * 180 / Math.PI);
      const drawn = angles.reduce((a, b) => a + b, 0) / angles.length;
      assert.ok(Math.abs(drawn - exact) < 0.05, `${range} ${aspect}: drawn ${drawn}, exact ${exact}`);
      // The title, the axis title, the bottom and top of the vertical axis in books, and the first and last month
      const texts = fig.shapes.filter((s) => s.type === 'text').map((s) => s.text);
      assert.deepEqual(texts, ['架空の図書館の貸出冊数', '貸出冊数（冊）',
        ...(range === 'all' ? ['7,000', '4,000', '1か月目', '24か月目'] : ['6,000', '5,000', '19か月目', '24か月目'])]);
    });
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

// The object and its spots in a camouflage scene: the width of the object (from its outline) and the circles drawn on it
function camoParts(entryId, values) {
  const use = entry(entryId).uses.find((u) => u.side === 'hide'), fig = V.renderUse(use, values, ctx);
  const object = fig.shapes.find((x) => x.type === 'path' && /fill-camoObj-/.test(x.cls));
  const xs = pathPoints(object.attrs.d).map(([x]) => x);
  const at = fig.shapes.indexOf(object);
  const spots = fig.shapes.slice(at + 1).filter((x) => x.type === 'circle').map((x) => ({ x: x.attrs.cx, y: x.attrs.cy, r: x.attrs.r, cls: x.cls }));
  return { fig, width: Math.max(...xs) - Math.min(...xs), spots, background: fig.shapes.slice(0, at) };
}
// A spot has a mirror partner: another spot at the mirrored place (about the middle of the scene), of the same size and color
const partnered = (spots, cx) => spots.filter((o) => spots.some((q) => q !== o && Math.abs(q.x - (2 * cx - o.x)) < 0.02 && Math.abs(q.y - o.y) < 0.02
  && q.r === o.r && q.cls === o.cls));

test('C: the camouflage figure of 3-2: a large object with four large spots on each side, mirrored only for "symmetric"', () => {
  const values = (cue) => ({ cue, regions: 8, swap: false });
  const cx = V.SIZES.small[0] / 2;
  const none = camoParts('figure-ground-symmetry', values('none')), sym = camoParts('figure-ground-symmetry', values('symmetric'));
  const convex = camoParts('figure-ground-symmetry', values('convex'));
  for (const [name, c] of [['none', none], ['symmetric', sym], ['convex', convex]]) {
    // The object is at least half as wide as the scene; its spots are 4 on each side, of radius 7 or more, in the colors kept apart
    // from the object (camoMarks)
    assert.ok(c.width >= V.SIZES.small[0] / 2, `${name}: width ${c.width}`);
    assert.equal(c.spots.length, 8, name);
    assert.ok(c.spots.every((o) => o.r >= 7 && /^fill-camoMarks-\d$/.test(o.cls)), name);
    assert.equal(c.spots.filter((o) => o.x + o.r <= cx).length, 4, `${name}: four on the left`);
    assert.equal(c.spots.filter((o) => o.x - o.r >= cx).length, 4, `${name}: four on the right`);
    // The same sizes and colors on both sides
    const set = (list) => list.map((o) => `${o.r} ${o.cls}`).sort();
    assert.deepEqual(set(c.spots.filter((o) => o.x < cx)), set(c.spots.filter((o) => o.x > cx)), name);
  }
  // Symmetric: every spot has its mirror partner. Otherwise: more than half have none
  assert.equal(partnered(sym.spots, cx).length, 8);
  assert.ok(partnered(none.spots, cx).length <= 4, 'none');
  assert.ok(partnered(convex.spots, cx).length <= 4, 'convex');
  // Bulging outward has no camouflage counterpart: the same picture as none. Between none and symmetric half the spots or more move
  assert.deepEqual(convex.fig, none.fig);
  const moved = sym.spots.filter((o, i) => Math.hypot(o.x - none.spots[i].x, o.y - none.spots[i].y) > 1).length;
  assert.ok(moved >= 4, `moved ${moved}`);
  // The outline of the object is symmetric, and the background is the same in every case
  const outline = pathPoints(none.fig.shapes.find((x) => x.type === 'path' && /fill-camoObj-/.test(x.cls)).attrs.d);
  for (const [x, y] of outline) assert.ok(outline.some(([u, v]) => Math.abs(u - (2 * cx - x)) < 0.02 && Math.abs(v - y) < 0.02), `${x} ${y}`);
  assert.deepEqual(sym.background, none.background);
  // The other camouflage scenes keep their small object (only 2-1 and 3-2 draw the large one)
  assert.ok(camoParts('gestalt-contour', { gap: 0, crossing: 'smooth' }).width < V.SIZES.small[0] / 2);
});

test('C: the camouflage figure of 2-1: a large object with eight large spots, in the colors of the background or in other colors', () => {
  const same = camoParts('gestalt-proximity-similarity', { prox: 0, sim: 'none' });
  const matched = camoParts('gestalt-proximity-similarity', { prox: 0, sim: 'rows' });
  for (const c of [same, matched]) {
    assert.ok(c.width >= V.SIZES.small[0] / 2, `width ${c.width}`);
    assert.equal(c.spots.length, 8);
    assert.ok(c.spots.every((o) => o.r >= 7));
  }
  // The places stay; only the set of colors changes: the object's own colors, or those of the spots of the background
  assert.deepEqual(same.spots.map((o) => [o.x, o.y, o.r]), matched.spots.map((o) => [o.x, o.y, o.r]));
  assert.ok(same.spots.every((o) => /^fill-camoObjSpots-\d$/.test(o.cls)));
  assert.ok(matched.spots.every((o) => /^fill-camoSpots-\d$/.test(o.cls)));
  assert.deepEqual(new Set(matched.background.filter((x) => x.type === 'circle').map((x) => x.cls)),
    new Set(matched.spots.map((o) => o.cls)));
});

test('C: the colors of the small figures and the camouflage scene meet the spec', () => {
  for (const theme of ['light', 'dark']) {
    const p = D.palette[theme];
    for (const c of p.camoSpots) assert.ok(!OKABE_ITO.includes(c), `${theme} camoSpots ${c}`);
    for (const c of p.camoMarks) assert.ok(C.contrastRatio(c, p.camoObj[1]) >= 3, `${theme} camoMarks ${c} on the object`);
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
  // The moving circle: still, one still among the others, small, medium, large, all moving. Figure and ground: none, and symmetric, two bulging
  // regions and eight, each with the bands in the dark color or (swapped) in the light color
  const expected = { 'popout-feature': 12, 'popout-asymmetry': 5, 'popout-motion': 6, 'gestalt-proximity-similarity': 9, 'gestalt-region-connection': 3,
    'gestalt-contour': 5, 'figure-ground-area': 3, 'figure-ground-symmetry': 7, 'misread-area': 4, 'misread-dual-axis': 2, 'search-camo': 3 };
  for (const [id, n] of Object.entries(expected)) {
    const { keys } = readKeys(id, id === 'popout-asymmetry' ? TIMES : [{}]);
    assert.equal(keys.length, n, `${id}: ${keys.join(', ')}`);
    for (const k of keys) assert.ok(typeof M.ja[k] === 'string' && typeof M.en[k] === 'string', k);
  }
  // The axis raised a little (5, 10, 15: the difference is still small) or more, each with the notes of the mark and of the line chart
  const base = readKeys('misread-baseline');
  assert.deepEqual(base.keys.sort(), ['baseRead.line', 'baseRead.mark', 'baseRead.raised', 'baseRead.raisedSmall', 'baseRead.zero']);
  assert.deepEqual(base.lists.filter((l) => l.startsWith('baseRead.raised')).sort(),
    ['baseRead.raised', 'baseRead.raised+baseRead.line', 'baseRead.raised+baseRead.mark', 'baseRead.raised+baseRead.mark+baseRead.line',
      'baseRead.raisedSmall', 'baseRead.raisedSmall+baseRead.line', 'baseRead.raisedSmall+baseRead.mark',
      'baseRead.raisedSmall+baseRead.mark+baseRead.line']);
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
  // The camouflage card: one sentence for each pattern, the same with the mark on or off
  for (const pattern of C.CAMO_PATTERNS) {
    for (const mark of ['off', 'on']) assert.deepEqual(V.readCases(D, 'search-camo', { pattern, mark }), [{ key: `camoRead.${pattern}`, values: {} }]);
  }
});

test('C: the reading sentences use the rounded values shown for their borders', () => {
  const contour = (gap) => V.readCases(D, 'gestalt-contour', { gap, crossing: 'smooth' })[0];
  assert.deepEqual([0, 0.1, 0.3, 0.4, 0.6].map((g) => contour(g).key),
    ['contourRead.gap0', 'contourRead.gapLow', 'contourRead.gapLow', 'contourRead.gapHigh', 'contourRead.gapHigh']);
  assert.equal(contour(0.3).values.p, '30');
  const area = (share) => V.readCases(D, 'figure-ground-area', { share })[0].key;
  assert.deepEqual([0.2, 0.4, 0.5, 0.6, 0.8].map(area),
    ['areaRead.darkNarrow', 'areaRead.darkNarrow', 'areaRead.equal', 'areaRead.lightNarrow', 'areaRead.lightNarrow']);
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
    // A moving entry: bound controls take effect only when the figures are moving, so test with a mid-stroke pose
    const extra = e.safety.motion === 'onPlay' ? { pose: { u: 0.25, env: 1, prev: null } } : {};
    for (const u of e.uses) {
      const before = rendered(u, defaults, extra);
      for (const c of e.controls) {
        const changes = V.controlOptions(c).filter((v) => rendered(u, { ...defaults, [c.id]: v }, extra) !== before);
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
        assert.equal(ja, 'この図を変える操作：違いの種類・違いの大きさ・周りのばらつき');
        assert.equal(en, 'Changes with: Kind of difference, Size of the difference, Variety around it');
      } else {
        // Direction and shape are not drawn in the small figures: the line says so (the entry's own line, not the line of every entry)
        assert.equal(ja, '「方向」と「形」の違いは小さな図に描いていないので、いまの設定ではこの図は変わりません。');
        assert.equal(en, 'The small figures do not draw Direction or Shape, so this one does not change.');
        assert.deepEqual(V.linkedLine(pf, u, { ...d1, kind }), { key: 'popLinkedNone', controls: [] });
      }
    }
  }
  const line = (id, side) => { const e = entry(id); return V.linkedText(M, 'ja', e, e.uses.find((u) => u.side === side), V.controlValues(e)); };
  assert.equal(line('gestalt-proximity-similarity', 'show'), 'この図を変える操作：点の間隔・形の変え方');
  assert.equal(line('gestalt-proximity-similarity', 'hide'), 'この図を変える操作：形の変え方');
  assert.equal(line('gestalt-contour', 'show'), 'この図を変える操作：輪郭の途切れ・交わり方');
  assert.equal(line('gestalt-contour', 'hide'), 'この図を変える操作：輪郭の途切れ');
  assert.equal(line('figure-ground-symmetry', 'hide'), 'この図を変える操作：手がかり');
  // A small figure that no control is bound to never changes: it says so, not "with the current settings"
  assert.equal(line('misread-baseline', 'readable'), 'この図は、操作しても変わりません。');
  assert.equal(line('misread-dual-axis', 'readable'), 'この図は、操作しても変わりません。');
  assert.equal(line('misread-aspect-range', 'readable'), 'この図は、操作しても変わりません。');
  assert.equal(line('misread-area', 'readable'), 'この図を変える操作：値の比');
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
  assert.deepEqual(vm.tabs.map((t) => t.id), ['popout', 'search', 'gestalt', 'figure-ground', 'misread', 'illusion']);
  assert.deepEqual(vm.tabs.map((t) => t.entries.length), [3, 2, 3, 2, 4, 1]);
  assert.deepEqual(vm.tabs.map((t) => (t.next ? t.next.labelKey : null)),
    ['tabSearch', 'tabGestalt', 'tabFigureGround', 'tabMisread', 'tabIllusion', null]);
  assert.deepEqual(vm.tabs[4].leadKeys, ['misreadLead', 'misreadFictional']);
  // The boxes at the end of the Figure-and-ground tab (clues for spotting camouflage) and the Misreading tab (checks when reading a chart)
  assert.deepEqual(vm.tabs.map((t) => t.endBoxes.map((b) => b.id)), [[], [], [], ['camo-clues'], ['chart-checks'], []]);
  for (const tab of vm.tabs) {
    for (const e of tab.entries) {
      // The search time card has the showing side only, so its heading names that side alone; the camouflage card the hiding side
      const heading = { misread: 'usesHeadingReadable', search: e.id === 'search-camo' ? 'usesHeadingHide' : 'usesHeadingShow' }[tab.id] || 'usesHeading';
      assert.equal(e.usesHeadingKey, heading, e.id);
      assert.equal(e.gapHeadingKey, e.id === 'search-camo' ? 'camoGapHeading' : 'gapHeading', e.id);
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
  // 3-2: there is no cue to swap while the cue is none; choosing a cue makes the switch pressable again
  const swap = entry('figure-ground-symmetry').controls.find((c) => c.id === 'swap');
  assert.deepEqual(['none', 'symmetric', 'convex'].map((cue) => V.controlEnabled(swap, { cue, regions: 8, swap: false })), [false, true, true]);
  assert.equal(swap.disabledNoteKey, 'cueNeeded');
  // While a switch cannot be pressed it shows the value that the figure uses; the choice itself stays and shows again later
  assert.equal(V.shownValue(mark, { bottom: 0, chart: 'bar', mark: 'shown' }), 'none');
  assert.equal(V.shownValue(mark, { bottom: 40, chart: 'bar', mark: 'shown' }), 'shown');
  assert.equal(V.shownValue(swap, { cue: 'none', regions: 8, swap: true }), false);
  assert.equal(V.shownValue(swap, { cue: 'convex', regions: 8, swap: true }), true);
  // A control without offValue shows its value as it is (the shape of 1-1 while another kind is chosen)
  assert.equal(V.shownValue(ctl('shape'), { ...d1, shape: 'tl' }), 'tl');
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

// ===== popout-motion: the view returns the right pose for an idle, a playing and a next-frame state =====
test('C: motionPose maps the clock state to the drawing (idle → rest, playing → sinusoid, frames → full with a prev)', () => {
  assert.deepEqual(V.motionPose({ phase: 'idle', t: 0, frame: 0 }, 3), { u: 0, env: 0, prev: null });
  const mid = V.motionPose({ phase: 'playing', t: 1.5 }, 3);
  assert.ok(mid.env === 1, 'env ramps to 1 after `ramp` seconds and stays there');
  assert.ok(mid.u > 0, 'u advances');
  const start = V.motionPose({ phase: 'playing', t: 0.1 }, 3);
  assert.ok(start.env > 0 && start.env < 1, 'env ramps in from 0 over the first `ramp` seconds');
  const end = V.motionPose({ phase: 'playing', t: 2.9 }, 3);
  assert.ok(end.env > 0 && end.env < 1, 'env ramps back down to 0 in the last `ramp` seconds');
  const frame = V.motionPose({ phase: 'frames', frame: 3 }, 3);
  assert.deepEqual(frame, { u: 0.75, env: 1, prev: 0.5 });
  const frame1 = V.motionPose({ phase: 'frames', frame: 1 }, 3);
  assert.equal(frame1.prev, 0, 'the previous frame of frame 1 is 0 (the still figure)');
});

test('C: popout-motion keeps the same number of shapes while moving (so a redraw can patch attributes in place)', () => {
  const motion = D.entries.find((e) => e.id === 'popout-motion');
  const defaults = V.controlValues(motion);
  const atRest = V.renderMain(motion, defaults, ctx, undefined, { pose: { u: 0, env: 0, prev: null } });
  const inPlay = V.renderMain(motion, defaults, ctx, undefined, { pose: { u: 0.25, env: 1, prev: null } });
  assert.equal(atRest.shapes.length, inPlay.shapes.length, 'no trails added when prev is null');
  assert.equal(atRest.shapes.length, 36, 'six-by-six grid of circles');
  const withPrev = V.renderMain(motion, defaults, ctx, undefined, { pose: { u: 0.5, env: 1, prev: 0.25 } });
  const target = withPrev.shapes.filter((s) => s.cls === 'fig-trail').length;
  assert.equal(target, 1, 'the one circle that moves adds one trail dot (amount=medium, others=still)');
  const allTrails = V.renderMain(motion, { amount: 'medium', others: 'random' }, ctx, undefined, { pose: { u: 0.5, env: 1, prev: 0.25 } })
    .shapes.filter((s) => s.cls === 'fig-trail').length;
  assert.equal(allTrails, 36, 'with others=random every circle moves and leaves a trail dot');
});

test('C: popout-motion does not change the fill colors of the circles while the pose changes', () => {
  const motion = D.entries.find((e) => e.id === 'popout-motion');
  const defaults = V.controlValues(motion);
  const fillsAt = (pose) => V.renderMain(motion, defaults, ctx, undefined, { pose })
    .shapes.filter((s) => s.cls.startsWith('fill-')).map((s) => s.cls);
  const rest = fillsAt({ u: 0, env: 0, prev: null });
  const play = fillsAt({ u: 0.4, env: 1, prev: null });
  assert.deepEqual(play, rest, 'motion never recolors a circle (no flashing)');
});

// ===== The camouflage experiment: the scene part (the small figure and the square of the test) and the results =====
const box = (list) => [Math.min(...list.map((p) => p[0])), Math.min(...list.map((p) => p[1])), Math.max(...list.map((p) => p[0])),
  Math.max(...list.map((p) => p[1]))];

test('C: the camouflage scene: the bark ground, the background spots, the moth shape with its patches, and the mark only when asked', () => {
  const use = entry('search-camo').uses[0];
  const plain = V.renderUse(use, { pattern: 'match', mark: 'off' }, ctx), marked = V.renderUse(use, { pattern: 'match', mark: 'on' }, ctx);
  assert.deepEqual([plain.width, plain.height], [360, 360]);
  assert.deepEqual([plain.shapes[0].type, plain.shapes[0].cls], ['rect', 'fill-bark-1']);
  assert.equal(plain.shapes.filter((s) => s.type === 'ellipse').length, C.CAMO.ground);
  const paths = plain.shapes.filter((s) => s.type === 'path');
  assert.equal(paths.length, 1 + C.CAMO.patches, 'the moth shape and its patches');
  assert.equal(pathPoints(paths[0].attrs.d).length, 3, 'the moth shape is the first path, a triangle');
  assert.equal(paths[0].cls, 'fill-bark-1', 'in the color of the ground');
  assert.equal(plain.shapes.filter((s) => s.cls.includes('camo-mark')).length, 0);
  // The mark: one dashed triangle around the moth shape, drawn last; the rest of the scene stays the same
  const mark = marked.shapes.at(-1);
  assert.equal(mark.cls, 'stroke-barkMark camo-mark');
  assert.deepEqual(marked.shapes.slice(0, -1), plain.shapes);
  const m = box(pathPoints(mark.attrs.d)), moth = box(pathPoints(paths[0].attrs.d));
  assert.ok(m[0] < moth[0] && m[1] < moth[1] && m[2] > moth[2] && m[3] > moth[3], 'the mark goes around the moth shape');
  // A pattern changes the patches of the object only: the ground, the spots and the place stay
  const patterned = (pattern) => V.renderUse(use, { pattern, mark: 'off' }, ctx).shapes;
  const ground = (shapes) => shapes.filter((s) => s.type !== 'path');
  for (const pattern of ['disrupt', 'symmetric']) {
    assert.deepEqual(ground(patterned(pattern)), ground(plain.shapes), pattern);
    assert.deepEqual(patterned(pattern).find((s) => s.type === 'path'), paths[0], `${pattern}: the same moth shape`);
    assert.notDeepEqual(patterned(pattern), plain.shapes, pattern);
  }
  // The square of the test is drawn by the same part, with the cell and the seed of the try
  const scene = V.renderPart('camoSearchScene', { seed: 5, pattern: 'disrupt', cell: 0, mark: true }, ctx);
  assertInside(scene, 'the scene with the moth shape in the top-left cell');
  assert.deepEqual(box(pathPoints(scene.shapes.find((s) => s.type === 'path').attrs.d)), [6, 18, 54, 42]);
  // The sample of the shape to find in the dialog: a triangle with its base at the top, twice as wide as it is high
  const sample = box(pathPoints(V.mothSample().shapes[0].attrs.d));
  assert.equal((sample[2] - sample[0]) / (sample[3] - sample[1]), 2);
});

test('C: the bark colors of the camouflage experiment: the same in both themes, darkest to lightest, not Okabe–Ito, and the mark 3:1 on each', () => {
  const { light, dark } = D.palette;
  assert.deepEqual(light.bark, dark.bark);
  assert.equal(light.barkMark, dark.barkMark);
  assert.equal(light.bark.length, 4);
  const lum = light.bark.map((c) => C.relativeLuminance(c));
  assert.deepEqual(lum.slice().sort((a, b) => a - b), lum, 'bark-0 is the darkest, bark-3 the lightest');
  for (const c of light.bark) {
    assert.ok(!OKABE_ITO.includes(c), c);
    assert.ok(C.contrastRatio(light.barkMark, c) >= 3, `the mark on ${c}: ${C.contrastRatio(light.barkMark, c).toFixed(2)}`);
  }
  // The dark and the light patches of the disruptive pattern stand apart from each other and from the ground
  assert.ok(C.contrastRatio(light.bark[C.CAMO.darkest], light.bark[C.CAMO.lightest]) >= 3);
});

// A camouflage summary from known times (right taps), time-outs and wrong spots of each pattern
function camoSummary(times, { timeouts = {}, wrong = {}, aborted = false } = {}) {
  const records = [];
  for (const [pattern, list] of Object.entries(times)) {
    for (const rt of list) records.push({ pattern, target: 0, cell: 0, outcome: 'correct', rt, input: 'mouse' });
  }
  for (const [pattern, n] of Object.entries(timeouts)) {
    for (let i = 0; i < n; i += 1) records.push({ pattern, target: 0, cell: null, outcome: 'timeout', rt: 10000, input: null });
  }
  for (const [pattern, n] of Object.entries(wrong)) {
    for (let i = 0; i < n; i += 1) records.push({ pattern, target: 0, cell: 1, outcome: 'wrong', rt: 1500, input: 'mouse' });
  }
  return C.summarizeCamo(records, { aborted });
}
const KNOWN_CAMO = () => camoSummary({ match: [1200, 1450, 2000, 3100], disrupt: [2500, 2649, 3000], symmetric: [800, 950] },
  { timeouts: { disrupt: 2 }, wrong: { symmetric: 1 } });

test('C: the camouflage results: the rows of the table give the median in seconds with one decimal, and none when it is not given', () => {
  assert.deepEqual(V.camoResultRows(KNOWN_CAMO()).map((r) => [r.pattern, r.labelKey, r.median, r.valid, r.notFound, r.wrong]), [
    ['match', 'ctl.search-camo.pattern.match', '1.7', 4, 0, 0],
    ['disrupt', 'ctl.search-camo.pattern.disrupt', '2.6', 3, 2, 0],
    ['symmetric', 'ctl.search-camo.pattern.symmetric', null, 2, 0, 1]]);
  assert.deepEqual(V.camoResultRows(null).map((r) => [r.measured, r.median, r.valid, r.notFound, r.wrong]), Array(3).fill([false, null, null, null, null]));
  // The rounding of the table is the one the sentences compare (1.45 s is 1.5, not 1.4)
  assert.equal(V.camoResultRows(camoSummary({ match: [1450, 1450, 1450] }))[0].median, '1.5');
});

const CAMO_CHART_CLASSES = ['fig-axis', 'fig-axisname', 'fig-legend', 'fig-tick', 'fill-seriesTarget', 'res-dot', 'ta-middle', 'ta-start'];
test('C: the camouflage chart: a bar per pattern with a median, a dot per valid round, the names of the patterns, and a scale of 0 to 10 s', () => {
  const t = (key) => M.ja[key], fig = V.camoResultChart(KNOWN_CAMO(), { t });
  assert.deepEqual([fig.width, fig.height], [V.CAMO_CHART.width, V.CAMO_CHART.height]);
  assertInside({ ...fig, shapes: fig.shapes.filter((s) => s.type !== 'text') }, 'camouflage chart');
  assert.ok(classesOf(fig).every((c) => CAMO_CHART_CLASSES.includes(c)), classesOf(fig).join(' '));
  const bars = fig.shapes.filter((s) => s.type === 'rect');
  assert.equal(bars.length, 2, 'no bar for a pattern without a median');
  assert.ok(bars.every((b) => b.cls === 'fill-seriesTarget'), 'one color for every bar: the names tell them apart');
  assert.equal(fig.shapes.filter((s) => s.type === 'circle').length, 4 + 3 + 2, 'a dot for each valid round');
  // The bar of the background-matching pattern ends at its median (1,725 ms) on the scale from 14 (0 s) to 262 (10 s)
  assert.ok(Math.abs(bars[0].attrs.x + bars[0].attrs.width - (14 + 1725 / 10000 * 248)) < 0.01);
  const texts = (f) => f.shapes.filter((s) => s.type === 'text').map((s) => [s.attrs.x, s.attrs.y, s.text]);
  assert.deepEqual(texts(fig).map((x) => x[2]), [M.ja.camoResAxis, ...C.CAMO_PATTERNS.map((p) => M.ja[`ctl.search-camo.pattern.${p}`]),
    '0', '2', '4', '6', '8', '10']);
  // The frame, the names and the scale do not move with the values
  const other = V.camoResultChart(camoSummary({ match: [9000, 9500, 9900], disrupt: [300, 400, 500], symmetric: [5000, 5000, 5000] }), { t });
  assert.deepEqual(texts(other), texts(fig));
  assert.deepEqual([other.width, other.height], [fig.width, fig.height]);
  // The longest name in English stays inside the chart (about 5.6 px per letter of 11 px)
  const longest = Math.max(...C.CAMO_PATTERNS.map((p) => M.en[`ctl.search-camo.pattern.${p}`].length));
  assert.ok(V.CAMO_CHART.x0 + longest * 5.6 <= V.CAMO_CHART.width, String(longest));
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'style.css'), 'utf8');
  for (const c of ['res-dot', 'camo-mark']) assert.ok(css.includes('.' + c + ' {'), c);
});

// ===== The settings added for the figures of the questions: without them, the figures of the cards stay as they were =====
const texts = (fig) => flat(fig.shapes).filter((s) => s.type === 'text').map((s) => s.text);
const question = (id) => D.groups.flatMap((g) => g.checks).find((q) => q.id === id);
const questionFigure = (id, i = 0) => V.renderCheckFigure(question(id).figures[i], ctx);

test('C: barChart takes the heights of its popout bars (values); without them it draws the popout bars of the data', () => {
  const base = { mode: 'popout', popKind: 'color', popDiff: 'large', popVariety: 'mixed' };
  assert.deepEqual(V.renderPart('barChart', base, ctx), V.renderPart('barChart', { ...base, values: D.datasets.popBars }, ctx));
  const plain = V.renderPart('barChart', base, ctx).shapes.filter((s) => s.type === 'rect');
  assert.deepEqual(plain.map((b) => Math.round(b.attrs.height / 1.2)), D.datasets.popBars);
  const values = [46, 60, 52, 88, 57, 66, 50, 63];
  const bars = V.renderPart('barChart', { ...base, values }, ctx).shapes.filter((s) => s.type === 'rect');
  assert.deepEqual(bars.map((b) => Math.round(b.attrs.height / 1.2)), values);
  // The fourth bar (the tallest) keeps the highlight; without colors given, the other seven take three colors in turn
  assert.deepEqual(bars.map((b) => b.cls), ['fill-popOthers-0', 'fill-popOthers-1', 'fill-popOthers-2', 'fill-popColor-3', 'fill-popOthers-1',
    'fill-popOthers-2', 'fill-popOthers-0', 'fill-popOthers-1']);
  // The question of the Pop out tab gives the other seven bars six colors (more varied than three), so that the fourth one does not stand out
  const { others } = question('popout-color-bars').figures[0].params;
  const asked = questionFigure('popout-color-bars').shapes.filter((s) => s.type === 'rect');
  assert.deepEqual(asked.map((b) => b.cls), [...others.slice(0, 3).map((c) => 'fill-' + c), 'fill-popColor-3', ...others.slice(3).map((c) => 'fill-' + c)]);
  assert.deepEqual([others.length, new Set(others).size], [7, 6]);
  assert.ok(!others.includes('popColor-3'), 'none of them has the color of the fourth bar');
  assert.deepEqual(questionFigure('popout-color-bars'), V.renderPart('barChart', { ...base, values, others }, ctx));
});

test('C: lineChart (search) takes the color and line of each series (styles); without them the series follow the kind of search', () => {
  const classes = (fig) => fig.shapes.filter((s) => s.type === 'path').map((s) => s.cls);
  const legend = (fig) => fig.shapes.filter((s) => s.type === 'line' && s.cls.includes('fig-series')).map((s) => s.cls);
  const conj = ['stroke-seriesTarget', 'stroke-seriesTarget line-dashed', 'stroke-seriesTarget', 'stroke-seriesOthers-0 line-dashed',
    'stroke-seriesOthers-1 line-dashed', 'stroke-seriesOthers-2 line-dashed'].map((c) => c + ' fig-series');
  const feature = ['stroke-seriesOthers-0', 'stroke-seriesTarget', 'stroke-seriesOthers-1', 'stroke-seriesOthers-2', 'stroke-seriesOthers-0',
    'stroke-seriesOthers-1'].map((c) => c + ' fig-series');
  for (const [search, want] of [['conjunction', conj], ['feature', feature]]) {
    const fig = V.renderPart('lineChart', { mode: 'search', search }, ctx);
    assert.deepEqual([classes(fig), legend(fig)], [want, want], search);
  }
  const { styles } = question('search-legend-line').figures[0].params;
  const fig = questionFigure('search-legend-line'), want = styles.map(([c, d]) => `stroke-${c}${d ? ' line-dashed' : ''} fig-series`);
  assert.deepEqual([classes(fig), legend(fig)], [want, want], 'the lines and the samples of the legend');
  // Blue and dashed: line D only; blue: B, D and F; dashed: A, C, D and E
  const letters = (pick) => styles.map((s, i) => (pick(s) ? 'ABCDEF'[i] : '')).join('');
  assert.deepEqual([letters(([c, d]) => c === 'seriesTarget' && d), letters(([c]) => c === 'seriesTarget'), letters(([, d]) => d)], ['D', 'BDF', 'ACDE']);
  // The series keep their values
  assert.deepEqual(fig.shapes.filter((s) => s.type === 'path').map((s) => s.attrs.d),
    V.renderPart('lineChart', { mode: 'search' }, ctx).shapes.filter((s) => s.type === 'path').map((s) => s.attrs.d));
});

test('C: baselineChart takes three values and the key of its title; without them it draws the loans of the fictional library', () => {
  const card = { bottom: 45, chart: 'bar', mark: 'none' };
  assert.deepEqual(V.renderPart('baselineChart', card, ctx), V.renderPart('baselineChart', { ...card, values: D.datasets.libraryLoans3 }, ctx));
  assert.deepEqual(texts(V.renderPart('baselineChart', card, ctx)), ['架空の図書館の貸出冊数', '貸出冊数（百冊）', '45', '50', '55', '60', '4月', '5月',
    '6月']);
  const fig = questionFigure('misread-value-ratio');
  // The title names the values and their unit, so the axis has no title of its own; the ticks are 45, 50, 55 and 60 (every 5 on an axis of 15)
  assert.deepEqual(texts(fig), ['架空の書店の販売冊数（百冊）', '45', '50', '55', '60', '4月', '5月', '6月']);
  // The heights above the bottom 45 are 5, 10 and 15: June's bar three times as tall as April's, the values 1.2 times
  const bars = fig.shapes.filter((s) => s.type === 'rect'), unit = bars[0].attrs.height / 5;
  assert.deepEqual(bars.map((b) => Math.round(b.attrs.height / unit)), [5, 10, 15]);
  assert.equal(C.baselineRatio([50, 55, 60], 45), 3);
  assert.deepEqual(V.renderPart('baselineChart', { ...card, values: [50, 55, 60], titleKey: 'checkBookstoreTitle' }, ctx), fig);
});

test('C: the ticks of the axis-bottom chart: every 5 when the axis spans 20 or less (the bottom at 40 and above), else every 10', () => {
  const ticks = (bottom) => texts(V.renderPart('baselineChart', { bottom, chart: 'bar', mark: 'none' }, ctx)).filter((s) => /^\d+$/.test(s)).map(Number);
  assert.deepEqual(ticks(0), [0, 10, 20, 30, 40, 50, 60]);
  assert.deepEqual(ticks(5), [5, 10, 20, 30, 40, 50, 60]);
  assert.deepEqual(ticks(35), [35, 40, 50, 60]);
  assert.deepEqual(ticks(40), [40, 45, 50, 55, 60]);
  assert.deepEqual(ticks(45), [45, 50, 55, 60]);
  assert.deepEqual(ticks(50), [50, 55, 60]);
  for (const bottom of entry('misread-baseline').controls.find((c) => c.id === 'bottom').values) {
    const list = ticks(bottom), step = 60 - bottom <= 20 ? 5 : 10;
    assert.deepEqual([list[0], list.at(-1)], [bottom, 60], `bottom ${bottom}`);
    for (let i = 2; i < list.length; i += 1) assert.equal(list[i] - list[i - 1], step, `bottom ${bottom}: ${list.join(' ')}`);
  }
});

test('C: heatmap takes the values of its two numbered cells (pair); without them both cells have the same value', () => {
  const same = D.datasets.heatSame;
  assert.deepEqual(V.renderPart('heatmap', { spread: 1 }, ctx), V.renderPart('heatmap', { spread: 1, pair: [same, same] }, ctx));
  assert.deepEqual(texts(V.renderPart('heatmap', { spread: 0.75 }, ctx)), [String(same), String(same)]);
  const fig = questionFigure('illusion-heat-numbers'), cells = fig.shapes.filter((s) => s.type === 'rect').map((s) => s.cls);
  assert.deepEqual(texts(fig), ['46', '56']);
  // 46 and 56 are away from the borders of the steps (45 and 55): steps 5 and 6. The cells around keep 10 and 90 (steps 1 and 9)
  assert.deepEqual([cells[6], cells[18]], ['fill-heat-5', 'fill-heat-6']);
  const around = (r, k) => [-1, 0, 1].flatMap((dr) => [-1, 0, 1].map((dk) => [r + dr, k + dk])).filter(([a, b]) => a !== r || b !== k);
  assert.deepEqual(around(1, 1).map(([r, k]) => cells[r * 5 + k]), Array(8).fill('fill-heat-1'), 'all eight around 46 are 10');
  assert.equal(around(3, 3).filter(([r, k]) => cells[r * 5 + k] === 'fill-heat-9').length, 7, 'seven of the eight around 56 are 90');
  const others = D.datasets.heat5.flat().filter((c) => typeof c === 'number');
  assert.deepEqual([Math.min(...others), Math.max(...others)], [30, 70]);
});

test('C: the figures of the questions stay inside their frames and show what their questions are about', () => {
  for (const g of D.groups) {
    for (const q of g.checks) {
      q.figures.forEach((f, i) => {
        const fig = V.renderCheckFigure(f, ctx);
        assertInside(f.part === V.RESULT_CHART ? { ...fig, shapes: fig.shapes.filter((s) => s.type !== 'text') } : fig, `${q.id} ${i}`);
      });
    }
  }
  // The results of the camouflage test with the fictional medians: three bars (2.4, 3.6 and 1.7 s on the scale of 10 s), no dot of a round
  const results = questionFigure('search-camo-results'), bars = results.shapes.filter((s) => s.type === 'rect');
  assert.deepEqual(bars.map((b) => Math.round(b.attrs.width / (V.CAMO_CHART.x1 - V.CAMO_CHART.x0) * 100) / 10), [2.4, 3.6, 1.7]);
  assert.equal(results.shapes.filter((s) => s.type === 'circle').length, 0);
  assert.deepEqual(texts(results).slice(1, 4), C.CAMO_PATTERNS.map((p) => M.ja[`ctl.search-camo.pattern.${p}`]));
  // A and B: the same scene, with one straight line on the object of B
  const [la, lb] = [questionFigure('popout-added-line', 0), questionFigure('popout-added-line', 1)];
  assert.deepEqual(lb.shapes.filter((s) => s.cls !== 'camo-line'), la.shapes);
  assert.equal(lb.shapes.filter((s) => s.cls === 'camo-line').length, 1);
  // Sixteen large spots on the edge of B, in the colors of the spots of the background; nothing else differs
  const [ea, eb] = [questionFigure('gestalt-edge-spots', 0), questionFigure('gestalt-edge-spots', 1)];
  const added = eb.shapes.slice(ea.shapes.length - 1, -1);
  assert.deepEqual([...eb.shapes.slice(0, ea.shapes.length - 1), eb.shapes.at(-1)], ea.shapes);
  assert.equal(added.length, 16);
  assert.ok(added.every((s) => s.type === 'circle' && s.attrs.r >= 10 && /^fill-camoSpots-[0-2]$/.test(s.cls)), 'the colors of the background spots');
  // The right half of B mirrors its left half; A has its own right half (the left halves are the same)
  const spots = (fig) => {
    const at = fig.shapes.findIndex((s) => s.type === 'path' && /fill-camoObj-/.test(s.cls));
    return fig.shapes.slice(at + 1).filter((s) => s.type === 'circle').map((s) => ({ x: s.attrs.cx, y: s.attrs.cy, r: s.attrs.r, cls: s.cls }));
  };
  const [ma, mb] = [spots(questionFigure('figure-ground-mirror', 0)), spots(questionFigure('figure-ground-mirror', 1))];
  assert.deepEqual(ma.slice(0, 4), mb.slice(0, 4));
  assert.equal(partnered(mb, V.SIZES.small[0] / 2).length, 8);
  assert.ok(partnered(ma, V.SIZES.small[0] / 2).length <= 4);
  // The bars of the stores: A leaves wide gaps between the stores, B spaces the twelve bars evenly
  const steps = (fig) => {
    const xs = fig.shapes.filter((s) => s.type === 'rect' && (s.cls === 'fill-groups-0' || s.cls.includes('fig-barline'))).map((s) => s.attrs.x);
    return xs.slice(1).map((x, i) => Math.round(x - xs[i]));
  };
  assert.deepEqual(steps(questionFigure('gestalt-store-bars', 0)), [11, 11, 11, 31, 11, 11, 11, 31, 11, 11, 11]);
  assert.deepEqual(steps(questionFigure('gestalt-store-bars', 1)), Array(11).fill(11));
  // The markers of the scatter plots: open zigzags in A, filled closed shapes in B, at the same twelve points
  const [sa, sb] = [questionFigure('figure-ground-markers', 0), questionFigure('figure-ground-markers', 1)];
  assert.ok(sa.shapes.filter((s) => s.type === 'path').every((s) => s.cls.includes('fig-nofill') && !s.attrs.d.includes('Z')));
  assert.ok(sb.shapes.filter((s) => s.type === 'path').every((s) => s.cls === 'fill-seriesTarget' && s.attrs.d.endsWith('Z')));
  // Two axes: the right one up to 250 mm, and three crossings
  assert.deepEqual(texts(questionFigure('misread-line-order')).filter((x) => ['0', '125', '250'].includes(x)), ['0', '0', '125', '250']);
  assert.equal(C.dualAxisCrossings(D.datasets.townTemp, D.datasets.townRain, [0, 30], [0, 250]), 3);
  // The right background lighter with the white layer; the object in the color of the left background
  const split = questionFigure('illusion-split-edge');
  assert.deepEqual(split.shapes.filter((s) => s.cls === 'fill-veil').map((s) => [s.attrs.x, s.attrs['fill-opacity']]), [[100, 0.55]]);
  assert.ok(split.shapes.some((s) => s.type === 'path' && s.cls === 'fill-camoObj-0'));
  assert.equal(D.palette.light.camoObj[0], D.palette.light.camoBase);
});

test('C: Next frame (reduced motion) marks where each moving shape was with a dashed outline of its own size, over the figure', () => {
  const motion = entry('popout-motion'), still = { amount: 'medium', others: 'still' }, all = { amount: 'medium', others: 'random' };
  const pose = { pose: { u: 0.5, env: 1, prev: 0.25 } };
  const main = V.renderMain(motion, still, ctx, undefined, pose);
  const rings = main.shapes.filter((s) => s.cls === 'fig-trail'), circles = main.shapes.filter((s) => s.cls === 'fill-stimCool');
  assert.equal(rings.length, 1);
  assert.equal(rings[0].attrs.r, circles[0].attrs.r, 'as large as the circles');
  assert.ok(main.shapes.indexOf(rings[0]) > main.shapes.indexOf(circles.at(-1)), 'over the circles');
  // The frame before (a quarter of a stroke) put the moving circle at the right end of its stroke: the ring is 12 to the right of one circle
  assert.ok(circles.some((c) => Math.abs(rings[0].attrs.cx - c.attrs.cx - V.MOTION.grid[2]) < 1e-6 && rings[0].attrs.cy === c.attrs.cy));
  const [show, hide] = motion.uses.map((u) => V.renderUse(u, still, ctx, pose));
  const lineRings = show.shapes.filter((s) => s.cls === 'fig-trail'), marks = show.shapes.filter((s) => s.type === 'circle' && /^fill-series/.test(s.cls));
  assert.equal(lineRings.length, 1);
  assert.equal(lineRings[0].attrs.r, marks[0].attrs.r, 'as large as the markers');
  assert.ok(show.shapes.indexOf(lineRings[0]) > show.shapes.indexOf(marks.at(-1)), 'over the markers');
  // The camouflage: the outline of the moving object at its place in the frame before (the same points, moved)
  const outlines = hide.shapes.filter((s) => s.cls === 'fig-trail');
  assert.equal(outlines.length, 1);
  const ring = pathPoints(outlines[0].attrs.d);
  const bodies = hide.shapes.filter((s) => s.type === 'g').map((g) => pathPoints(g.children[0].attrs.d));
  const same = bodies.filter((b) => b.length === ring.length && b.every(([x, y], i) => Math.abs(ring[i][0] - x - (ring[0][0] - b[0][0])) < 0.02
    && Math.abs(ring[i][1] - y - (ring[0][1] - b[0][1])) < 0.02));
  assert.equal(same.length, 5, 'the outline has the shape of the objects');
  assertInside(hide, 'the outline stays inside the scene');
  // Every moving shape gets its outline (with the others moving: 36 circles, 4 markers and 5 objects); at rest, none
  assert.equal(V.renderMain(motion, all, ctx, undefined, pose).shapes.filter((s) => s.cls === 'fig-trail').length, 36);
  assert.deepEqual(motion.uses.map((u) => V.renderUse(u, all, ctx, pose).shapes.filter((s) => s.cls === 'fig-trail').length), [4, 5]);
  assert.deepEqual(motion.uses.map((u) => V.renderUse(u, all, ctx).shapes.filter((s) => s.cls === 'fig-trail').length), [0, 0]);
  // The look of the outline: a dashed line without a fill, in the ink of the page (style.css)
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'style.css'), 'utf8');
  assert.match(css, /\.fig-trail \{ fill: none; stroke: var\(--ink\); stroke-width: 2; stroke-dasharray: 4 3; \}/);
});
