'use strict';
// A: the calculation in atlas-core.js against the known values of the spec (random numbers, layout, trials, classification,
// median and least squares, block summary, colors and the ratios of the misreading entries).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../atlas-core.js');

const close = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} != ${expected}`);
const LOANS24 = [40, 42, 41, 44, 46, 45, 48, 50, 49, 52, 54, 53, 56, 58, 57, 60, 62, 61, 60, 58, 57, 55, 54, 52];
const TEMP = [4, 5, 9, 14, 19, 22, 26, 27, 23, 17, 11, 6];
const RAIN = [50, 60, 110, 130, 140, 170, 160, 120, 210, 190, 90, 50];

test('A: xorshift32 gives the known first values, and seed 0 acts as seed 1', () => {
  const take = (seed, n) => { const r = C.xorshift32(seed); return Array.from({ length: n }, () => r()); };
  assert.deepEqual(take(1, 3), [270369, 67634689, 2647435461]);
  assert.deepEqual(take(128, 3), [34607496, 67314328, 1783776432]);
  assert.deepEqual(take(0, 3), take(1, 3));
});

test('A: randInt stays in range; shuffle keeps the items, repeats with the same seed and leaves the input alone', () => {
  const r = C.xorshift32(7);
  for (let i = 0; i < 1000; i += 1) { const v = C.randInt(r, 6); assert.ok(Number.isInteger(v) && v >= 0 && v < 6); }
  const input = Array.from({ length: 36 }, (_, i) => i);
  const a = C.shuffle(input, C.xorshift32(5)), b = C.shuffle(input, C.xorshift32(5)), c = C.shuffle(input, C.xorshift32(6));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual(a.slice().sort((x, y) => x - y), input);
  assert.deepEqual(input, Array.from({ length: 36 }, (_, i) => i));
});

test('A: gridLayout picks distinct cells inside the frame with centers within ±15% of the cell', () => {
  const size = 360, cell = size / 6;
  for (const seed of [1, 128, 2026]) {
    for (const n of [3, 6, 12, 18, 36]) {
      const items = C.gridLayout({ n, size, rng: C.xorshift32(seed) });
      assert.equal(items.length, n);
      assert.equal(new Set(items.map((p) => p.cell)).size, n, 'no repeated cell');
      for (const p of items) {
        assert.ok(p.cell >= 0 && p.cell < 36);
        assert.ok(p.x > 0 && p.x < size && p.y > 0 && p.y < size);
        const cx = (p.cell % 6 + 0.5) * cell, cy = (Math.floor(p.cell / 6) + 0.5) * cell;
        assert.ok(Math.abs(p.x - cx) <= 0.15 * cell + 1e-9 && Math.abs(p.y - cy) <= 0.15 * cell + 1e-9);
      }
    }
  }
  assert.throws(() => C.gridLayout({ n: 37, size, rng: C.xorshift32(1) }), RangeError);
  assert.throws(() => C.gridLayout({ n: -1, size, rng: C.xorshift32(1) }), RangeError);
});

test('A: makeSearchTrials gives 8 practice and 32 recorded tries: 1 and 4 for each number of items with the bar there and not there', () => {
  assert.equal(C.MAIN_REPS, 4);
  assert.equal(C.PRACTICE_REPS, 1);
  for (const search of ['feature', 'conjunction']) {
    for (const set of ['color', 'fill']) {
      const t = C.makeSearchTrials({ search, set, rng: C.xorshift32(42) });
      assert.equal(t.practice.length, 8);
      assert.equal(t.main.length, 32);
      for (const [list, per] of [[t.practice, 1], [t.main, 4]]) {
        for (const n of [3, 6, 12, 18]) {
          for (const present of [true, false]) {
            assert.equal(list.filter((x) => x.setSize === n && x.present === present).length, per, `${search} ${n} ${present}`);
          }
        }
        assert.equal(list.filter((x) => x.present).length, list.length / 2);
        for (const trial of list) {
          assert.equal(trial.items.length, trial.setSize);
          assert.equal(new Set(trial.items.map((i) => i.cell)).size, trial.setSize);
          const kinds = trial.items.map((i) => i.kind);
          assert.equal(kinds.filter((k) => k === 'target').length, trial.present ? 1 : 0);
          const dir = kinds.filter((k) => k === 'same-dir').length, color = kinds.filter((k) => k === 'same-color').length;
          if (search === 'feature') assert.equal(color, 0);
          else assert.ok(Math.abs(dir - color) <= 1, `${dir} vs ${color}`);
        }
      }
    }
  }
  const a = C.makeSearchTrials({ search: 'conjunction', rng: C.xorshift32(9) }), b = C.makeSearchTrials({ search: 'conjunction', rng: C.xorshift32(9) });
  const c = C.makeSearchTrials({ search: 'conjunction', rng: C.xorshift32(10) });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.main, c.main);
  assert.throws(() => C.makeSearchTrials({ search: 'other', rng: C.xorshift32(1) }));
});

test('A: the leftover distractor of an odd count in conjunction search is decided by the random numbers', () => {
  const extras = new Set();
  for (let seed = 1; seed <= 40; seed += 1) {
    const t = C.makeSearchTrials({ search: 'conjunction', rng: C.xorshift32(seed) });
    for (const trial of t.main.filter((x) => x.setSize === 6 && x.present)) {
      const dir = trial.items.filter((i) => i.kind === 'same-dir').length;
      extras.add(dir === 3 ? 'same-dir' : 'same-color');
    }
  }
  assert.deepEqual([...extras].sort(), ['same-color', 'same-dir']);
});

test('A: classify at the borders 199, 200, 3999 and 4000 ms and during the fixation point', () => {
  assert.equal(C.classify({ phase: 'stimulus', present: true, answer: 'present', rt: 199 }), 'early');
  assert.equal(C.classify({ phase: 'stimulus', present: true, answer: 'present', rt: 200 }), 'correct');
  assert.equal(C.classify({ phase: 'stimulus', present: true, answer: 'present', rt: 3999 }), 'correct');
  assert.equal(C.classify({ phase: 'stimulus', present: true, answer: 'present', rt: 4000 }), 'timeout');
  assert.equal(C.classify({ phase: 'stimulus', present: false, answer: null, rt: 4000 }), 'timeout');
  assert.equal(C.classify({ phase: 'fixation', present: true, answer: 'present', rt: null }), 'early');
  assert.equal(C.classify({ phase: 'stimulus', present: true, answer: 'absent', rt: 700 }), 'miss');
  assert.equal(C.classify({ phase: 'stimulus', present: false, answer: 'present', rt: 700 }), 'falseAlarm');
  assert.equal(C.classify({ phase: 'stimulus', present: false, answer: 'absent', rt: 700 }), 'correct');
});

test('A: requeue moves a try to the end only once', () => {
  const list = [{ setSize: 3, present: true }, { setSize: 6, present: false }];
  const once = C.requeue(list, 0);
  assert.equal(once.length, 3);
  assert.deepEqual(once[2], { setSize: 3, present: true, requeued: true });
  const twice = C.requeue(once, 2);
  assert.equal(twice.length, 3, 'a requeued try is not moved again');
  assert.equal(list.length, 2);
});

test('A: median and fitLine give the known values', () => {
  assert.equal(C.median([1, 2, 3, 4]), 2.5);
  assert.equal(C.median([5, 1, 3]), 3);
  assert.equal(C.median([]), null);
  const fit = C.fitLine([{ x: 3, y: 500 }, { x: 6, y: 530 }, { x: 12, y: 590 }, { x: 18, y: 650 }]);
  close(fit.slope, 10);
  close(fit.intercept, 470);
  assert.equal(C.fitLine([{ x: 3, y: 500 }, { x: 6, y: 530 }]), null);
});

// Records for summarizeBlock: valid tries with rt = a + b × setSize (4 per number of items, as in a recorded block)
function records({ present = true, sizes = [3, 6, 12, 18], count = 4, a = 500, b = 10, input = 'key' } = {}) {
  const out = [];
  for (const setSize of sizes) for (let i = 0; i < count; i += 1) out.push({ setSize, present, outcome: 'correct', rt: a + b * setSize, input });
  return out;
}

test('A: summarizeBlock gives medians, slopes and the ratio, and leaves out tries that were hidden', () => {
  const recs = [...records({ present: true, b: 10 }), ...records({ present: false, a: 520, b: 25 }),
    { setSize: 3, present: true, outcome: 'hidden', rt: null, input: null }];
  const s = C.summarizeBlock(recs, { granularity: 0.1 });
  close(s.rows.present.slope, 10);
  close(s.rows.present.intercept, 500);
  close(s.rows.absent.slope, 25);
  assert.equal(s.ratio, 2.5);
  assert.equal(s.ratioState, 'ok');
  assert.equal(s.rows.present.cells[3].n, 4, 'the hidden try is not counted');
  assert.equal(s.rows.present.cells[3].median, 530);
  // The median of every valid try of a row (the numbers of items together): 530, 560, 620 and 680 four times each
  assert.equal(s.rows.present.median, 590);
  assert.equal(s.rows.absent.median, 745);
  assert.equal(C.summarizeBlock(records({ sizes: [3], count: 2 })).rows.present.median, null, 'two valid tries give no median');
  assert.equal(s.mixedInput, false);
  assert.equal(s.aborted, false);
  assert.equal(s.granularity, 0.1);
  assert.equal(s.answered, 32);
  assert.equal(s.errors, 0);
  assert.equal(s.rows.present.accuracy, 1);
});

test('A: summarizeBlock gives a middle value from 3 valid tries but not from 2, and needs 3 numbers of items for a slope', () => {
  assert.equal(C.MIN_VALID, 3);
  // Four tries of one condition with one wrong answer: three valid tries still give the middle value
  const wrong = (setSize, rt = 900) => ({ setSize, present: true, outcome: 'miss', rt, input: 'key' });
  const three = C.summarizeBlock([...records({ sizes: [3], count: 3 }), wrong(3), ...records({ sizes: [6, 12, 18] })]);
  assert.equal(three.rows.present.cells[3].n, 4);
  assert.equal(three.rows.present.cells[3].valid, 3);
  assert.equal(three.rows.present.cells[3].median, 530);
  assert.equal(three.rows.present.cells[3].errors, 1);
  // Two wrong answers: two valid tries give no middle value; the other three numbers of items still give a slope
  const two = C.summarizeBlock([...records({ sizes: [3], count: 2 }), wrong(3), wrong(3), ...records({ sizes: [6, 12, 18] })]);
  assert.equal(two.rows.present.cells[3].valid, 2);
  assert.equal(two.rows.present.cells[3].median, null);
  assert.notEqual(two.rows.present.slope, null, 'three numbers of items still give a slope');
  const s2 = C.summarizeBlock(records({ sizes: [3, 6] }));
  assert.equal(s2.rows.present.slope, null);
  assert.equal(s2.ratio, null);
  assert.equal(s2.ratioState, null);
});

test('A: summarizeBlock counts early, timeout and wrong tries as excluded, and notes mixed input and a stop', () => {
  const recs = [...records({ sizes: [3, 6, 12, 18] }),
    { setSize: 3, present: true, outcome: 'early', rt: 150, input: 'touch' },
    { setSize: 3, present: true, outcome: 'timeout', rt: 4000, input: null },
    { setSize: 6, present: true, outcome: 'miss', rt: 900, input: 'key' },
    { setSize: 6, present: true, outcome: 'correct', rt: 150, input: 'key' }];
  const s = C.summarizeBlock(recs, { aborted: true });
  assert.equal(s.rows.present.excluded, 3);
  assert.equal(s.rows.present.early, 1);
  assert.equal(s.rows.present.timeout, 1);
  assert.equal(s.rows.present.errors, 1);
  assert.equal(s.rows.present.cells[6].valid, 4, 'a correct answer under 200 ms is not valid');
  assert.equal(s.mixedInput, true);
  assert.equal(s.aborted, true);
  assert.equal(s.rows.absent.slope, null);
});

test('A: ratio uses the slopes rounded as shown, and is not given when the present slope is under 1', () => {
  const block = (pa, pb) => C.summarizeBlock([...records({ present: true, b: pa }), ...records({ present: false, b: pb })]);
  assert.equal(block(10.04, 19.96).ratio, 2, '10.0 and 20.0 after rounding');
  const low = block(0.9, 5);
  assert.equal(low.ratio, null);
  assert.equal(low.ratioState, 'below1');
});

test('A: mixHex and contrastRatio give the known colors and ratios', () => {
  assert.equal(C.mixHex('#0072B2', '#D55E00', 0.3), '#406c7d');
  assert.equal(C.mixHex('#0072B2', '#D55E00', 0.6), '#806647');
  assert.equal(C.mixHex('#0072B2', '#D55E00', 0), '#0072b2');
  assert.equal(C.mixHex('#0072B2', '#D55E00', 1), '#d55e00');
  assert.equal(C.mixHex('#56B4E9', '#E69F00', 0.3), '#81aea3');
  assert.equal(C.mixHex('#56B4E9', '#E69F00', 0.6), '#aca75d');
  assert.equal(C.mixHex('#0072B2', '#000000', 0.13), '#00639b');
  assert.equal(C.mixHex('#0072B2', '#000000', 0.26), '#005484');
  assert.equal(C.mixHex('#0072B2', '#000000', 0.39), '#00466d');
  assert.equal(C.mixHex('#56b4e9', '#ffffff', 0.25), '#80c7ef');
  assert.equal(C.mixHex('#56b4e9', '#ffffff', 0.52), '#aedbf4');
  assert.equal(C.mixHex('#56b4e9', '#ffffff', 0.79), '#dceffa');
  assert.equal(C.mixHex('#0072b2', '#ffffff', 0.13), '#2184bc');
  assert.equal(C.mixHex('#0072b2', '#ffffff', 0.25), '#4095c5');
  assert.equal(C.mixHex('#56b4e9', '#000000', 0.11), '#4da0cf');
  assert.equal(C.mixHex('#56b4e9', '#000000', 0.21), '#448eb8');
  assert.equal(C.contrastRatio('#0072B2', '#fffdf7').toFixed(2), '5.10');
  assert.equal(C.contrastRatio('#d55e00', '#fffdf7').toFixed(2), '3.80');
  assert.equal(C.contrastRatio('#56b4e9', '#172940').toFixed(2), '6.37');
  assert.equal(C.contrastRatio('#e69f00', '#172940').toFixed(2), '6.53');
  assert.equal(C.contrastRatio('#000000', '#ffffff').toFixed(2), '21.00');
  assert.throws(() => C.mixHex('blue', '#000000', 0.5));
});

test('A: proximityDots spaces the 6 × 6 dots by the proximity step and shapes them by row or column', () => {
  const g = C.proximityDots(-2, 'none');
  close(g.dx, 0.6);
  close(g.dy, 1.4);
  assert.equal(g.dots.length, 36);
  close(g.dots[1].x - g.dots[0].x, 0.6, 1e-6);
  close(g.dots[6].y - g.dots[0].y, 1.4, 1e-6);
  const even = C.proximityDots(0, 'none');
  close(even.dx, 1);
  close(even.dy, 1);
  const c2 = C.proximityDots(2, 'none');
  close(c2.dx, 1.4);
  close(c2.dy, 0.6);
  assert.ok(C.proximityDots(0, 'rows').dots.every((d) => d.shape === (d.row % 2 ? 'square' : 'circle')));
  assert.ok(C.proximityDots(0, 'cols').dots.every((d) => d.shape === (d.col % 2 ? 'square' : 'circle')));
  assert.ok(C.proximityDots(0, 'none').dots.every((d) => d.shape === 'circle'));
  assert.throws(() => C.proximityDots(3, 'none'), RangeError);
});

test('A: dashForGap gives no dash for 0 and cuts each of the 8 segments by the gap', () => {
  assert.equal(C.dashForGap(400, 0), 'none');
  assert.equal(C.dashForGap(400, 0.3), '35 15');
  assert.equal(C.dashForGap(400, 0.6), '20 30');
  const [dash, gap] = C.dashForGap(2 * Math.PI * 50, 0.1).split(' ').map(Number);
  close(dash + gap, 2 * Math.PI * 50 / 8, 0.02);
});

test('A: sectorPaths splits each 90-degree pair by the share', () => {
  const s = C.sectorPaths(0.2);
  assert.equal(s.filled, 18);
  assert.equal(s.empty, 72);
  assert.equal(s.sectors.length, 8);
  assert.equal(s.sectors.filter((q) => q.filled).length, 4);
  assert.equal(s.sectors[0].start, 0);
  assert.equal(s.sectors.at(-1).end, 360);
  for (let i = 1; i < 8; i += 1) close(s.sectors[i].start, s.sectors[i - 1].end, 1e-6);
  const half = C.sectorPaths(0.5);
  assert.equal(half.filled, 45);
  assert.match(C.sectorPath(160, 120, 100, 0, 90), /^M160 120 L160 20 A100 100 0 0 1 260 120 Z$/);
});

test('A: baselineRatio gives 1.12, 1.22, 1.50 and 4.00 for the bottom at 0, 25, 40 and 50', () => {
  assert.deepEqual([0, 25, 40, 50].map((b) => C.baselineRatio([52, 55, 58], b).toFixed(2)), ['1.12', '1.22', '1.50', '4.00']);
  assert.throws(() => C.baselineRatio([52, 55, 58], 52), RangeError);
});

test('A: areaScales for the value ratio 2', () => {
  assert.deepEqual(C.areaScales(2, 'height'), { h: 2, w: 1, a: 2 });
  assert.deepEqual(C.areaScales(2, 'both'), { h: 2, w: 2, a: 4 });
  const area = C.areaScales(2, 'area');
  assert.equal(area.h.toFixed(2), '1.41');
  close(area.a, 2);
  assert.throws(() => C.areaScales(2, 'other'));
});

test('A: dualAxisCrossings gives 2, 3, 0 and 0 crossings for the right axis top at 200, 300, 400 and 600 mm', () => {
  assert.deepEqual([200, 300, 400, 600].map((m) => C.dualAxisCrossings(TEMP, RAIN, [0, 30], [0, m])), [2, 3, 0, 0]);
  // A month where the two normalized values are equal is left out: the sign goes from minus to plus across it, one crossing
  assert.equal(C.dualAxisCrossings([0, 15, 30], [30, 15, 0], [0, 30], [0, 30]), 1);
});

test('A: niceRange and meanAbsAngle give the known ranges and average slopes', () => {
  assert.deepEqual(C.niceRange(LOANS24), [40, 70]);
  assert.deepEqual(C.niceRange(LOANS24.slice(-6)), [50, 60]);
  assert.deepEqual([0.5, 1, 2, 4].map((a) => C.meanAbsAngle(LOANS24, a).toFixed(1)), ['67.3', '51.4', '33.5', '19.0']);
  assert.deepEqual([0.5, 1, 2, 4].map((a) => C.meanAbsAngle(LOANS24.slice(-6), a).toFixed(1)), ['56.1', '37.6', '21.6', '11.3']);
});

test('A: timerGranularity finds 1 ms and 16.667 ms with fake clocks, and null for a clock that never moves', () => {
  const clock = (step, grain) => { let t = 1000; return () => { t += step; return Math.floor(t / grain) * grain; }; };
  close(C.timerGranularity(clock(0.01, 1)), 1, 1e-6);
  close(C.timerGranularity(clock(0.05, 16.667)), 16.667, 1e-6);
  close(C.timerGranularity(clock(0.001, 0.1)), 0.1, 1e-6);
  assert.equal(C.timerGranularity(() => 5, 50, 1000), null);
});

test('A: barCorners places a vertical bar for 0 degrees and a horizontal bar for 90 degrees', () => {
  const v = C.barCorners(100, 100, 30, 10, 0);
  assert.deepEqual(v, [[95, 115], [95, 85], [105, 85], [105, 115]]);
  const h = C.barCorners(100, 100, 30, 10, 90);
  const xs = h.map((p) => p[0]), ys = h.map((p) => p[1]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [85, 115, 95, 105]);
});

// ===== The camouflage experiment: the scene (pure functions of a seed) =====
// A point on or inside a convex polygon (the edges count as inside, within a small tolerance)
function onOrInside([x, y], poly, eps = 1e-9) {
  const orient = C.signedArea(poly) < 0 ? -1 : 1;
  return poly.every(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length];
    return orient * ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) >= -eps;
  });
}
// The distance from a point to the nearest edge of a polygon
function edgeDistance([x, y], poly) {
  return Math.min(...poly.map(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length], dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  }));
}
const layouts = (seed, cell = null) => Object.fromEntries(C.CAMO_PATTERNS.map((pattern) => [pattern, C.camoSearchLayout({ seed, pattern, cell })]));
const totalArea = (lay) => lay.patches.reduce((sum, p) => sum + p.area, 0);

test('A: polygonArea and clipConvex give the known areas; a convex piece clipped by a convex shape stays one convex piece', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(C.polygonArea(square), 100);
  assert.equal(C.signedArea(square), 100);
  assert.equal(C.signedArea(square.slice().reverse()), -100, 'the sign follows the order of the points');
  const tri = [[0, 0], [10, 0], [0, 10]];
  close(C.polygonArea(C.clipConvex(square, tri)), 50);
  close(C.polygonArea(C.clipConvex(tri, square)), 50);
  close(C.polygonArea(C.clipConvex([[5, -5], [15, -5], [15, 5], [5, 5]], square)), 25);
  assert.deepEqual(C.clipConvex([[20, 20], [30, 20], [30, 30]], square), [], 'nothing is left of a piece outside');
  // The polygon of an ellipse: its points are symmetric about its vertical axis
  const e = C.ellipsePoints(0, 0, 2, 6);
  assert.equal(e.length, C.CAMO.sides);
  for (const [x, y] of e) assert.ok(e.some(([u, v]) => Math.abs(u + x) < 1e-9 && Math.abs(v - y) < 1e-9), `${x} ${y}`);
  assert.equal(C.insideConvex([1, 1], tri), true);
  assert.equal(C.insideConvex([5, 5], tri), false, 'a point on an edge is not inside');
});

test('A: camoSearchLayout: the same seed gives the same scene; the background and the background-matching patches are the same for the three patterns', () => {
  for (const seed of [1, 2603, 4242]) {
    const a = layouts(seed), b = layouts(seed);
    assert.deepEqual(a, b, String(seed));
    assert.deepEqual(a.disrupt.ground, a.match.ground);
    assert.deepEqual(a.symmetric.ground, a.match.ground);
    assert.equal(a.match.ground.length, C.CAMO.ground);
    assert.deepEqual([a.disrupt.cell, a.symmetric.cell], [a.match.cell, a.match.cell]);
    // Another seed: another background
    assert.notDeepEqual(C.camoSearchLayout({ seed: seed + 1 }).ground, a.match.ground);
  }
  // The pattern of the object does not depend on its cell (it is kept relative to the center of the moth shape)
  const at = (cell) => C.camoSearchLayout({ seed: 77, pattern: 'disrupt', cell });
  const shift = (lay) => lay.patches.map((p) => p.points.map(([x, y]) => [x - lay.center[0], y - lay.center[1]]));
  const p0 = shift(at(0)), p35 = shift(at(35));
  p0.forEach((poly, i) => poly.forEach(([x, y], k) => { close(x, p35[i][k][0]); close(y, p35[i][k][1]); }));
  assert.throws(() => C.camoSearchLayout({ seed: 1, pattern: 'plaid' }), /unknown pattern/);
  assert.throws(() => C.camoSearchLayout({ seed: 1, cell: 36 }), RangeError);
});

test('A: camoSearchLayout: the moth shape is a triangle with its base at the top, 80% of a cell wide and half as high, at the center of its cell', () => {
  const step = C.CAMO.size / C.CAMO.grid;
  assert.deepEqual([C.CAMO.size, C.CAMO.grid, C.CAMO.mothW, C.CAMO.mothH], [360, 6, 48, 24]);
  assert.equal(C.CAMO.mothW, 0.8 * step);
  assert.equal(C.CAMO.mothW / C.CAMO.mothH, 2);
  for (let cell = 0; cell < 36; cell += 1) {
    const lay = C.camoSearchLayout({ seed: 9, cell });
    const [A, B, tip] = lay.moth, cx = (cell % 6 + 0.5) * step, cy = (Math.floor(cell / 6) + 0.5) * step;
    assert.deepEqual(lay.center, [cx, cy]);
    // The base at the top (two points on one line), the tip below; the box of the triangle is centered on the cell
    assert.equal(A[1], B[1]);
    assert.ok(tip[1] > A[1]);
    assert.deepEqual([(A[0] + B[0]) / 2, (A[1] + tip[1]) / 2], [cx, cy]);
    assert.deepEqual([B[0] - A[0], tip[1] - A[1], tip[0]], [48, 24, cx]);
    // The mark: a larger triangle around the moth shape, inside the square in every cell
    for (const [x, y] of lay.mark) assert.ok(x >= 0 && x <= 360 && y >= 0 && y <= 360, `cell ${cell}: ${x} ${y}`);
    for (const p of lay.moth) assert.ok(onOrInside(p, lay.mark) && edgeDistance(p, lay.mark) > 1, `cell ${cell}`);
  }
  // Without a cell, the seed chooses it
  const cells = new Set(Array.from({ length: 200 }, (_, i) => C.camoSearchLayout({ seed: i + 1 }).cell));
  assert.ok(cells.size > 30, 'the seeds spread the moth over the grid');
});

// Whether a point is inside a polygon (ray casting)
function inPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

test('A: camoSearchLayout: the patches of the moth shape cover about as much of it as the spots of the background cover the square', () => {
  assert.equal(C.CAMO.patches, 12);
  const share = (points, covered) => points.filter(covered).length / points.length;
  let ground = 0, object = 0;
  for (let seed = 1; seed <= 40; seed += 1) {
    const lay = C.camoSearchLayout({ seed, cell: 14 }), rng = C.xorshift32(seed + 1000);
    const inSquare = Array.from({ length: 400 }, () => [30 + C.unit(rng) * 300, 30 + C.unit(rng) * 300]);
    ground += share(inSquare, ([x, y]) => lay.ground.some((g) => ((x - g.cx) / g.rx) ** 2 + ((y - g.cy) / g.ry) ** 2 <= 1)) / 40;
    const inMoth = Array.from({ length: 800 }, () => [lay.center[0] + (C.unit(rng) - 0.5) * 48, lay.center[1] + (C.unit(rng) - 0.5) * 24])
      .filter((p) => inPolygon(p, lay.moth));
    object += share(inMoth, (p) => lay.patches.some((q) => inPolygon(p, q.points))) / 40;
  }
  // About 45% of the square, and of the moth shape within 5 points
  assert.ok(ground > 0.4 && ground < 0.5, String(ground));
  assert.ok(Math.abs(object - ground) < 0.05, `object ${object.toFixed(3)}, background ${ground.toFixed(3)}`);
});

test('A: camoSearchLayout: the background spots stay inside the square, and the patches inside the moth shape', () => {
  for (const seed of [3, 5, 2603]) {
    for (const [pattern, lay] of Object.entries(layouts(seed))) {
      for (const g of lay.ground) {
        assert.ok(g.cx - g.rx >= 0 && g.cx + g.rx <= 360 && g.cy - g.ry >= 0 && g.cy + g.ry <= 360, `${seed} ${pattern}`);
        assert.ok(g.rx >= C.CAMO.rx[0] && g.rx <= C.CAMO.rx[1] && g.ry >= g.rx * C.CAMO.ratio[0] - 1e-9 && g.ry <= g.rx * C.CAMO.ratio[1] + 1e-9);
        assert.ok(C.CAMO.spots.includes(g.color));
      }
      for (const p of lay.patches) {
        assert.ok(p.points.length >= 3 && p.area > 0, `${seed} ${pattern}`);
        for (const q of p.points) assert.ok(onOrInside(q, lay.moth, 1e-6), `${seed} ${pattern} ${q}`);
      }
    }
  }
});

test('A: camoSearchLayout: the three patterns have the same number of patches and the same total area', () => {
  for (let seed = 1; seed <= 150; seed += 1) {
    const l = layouts(seed), a = totalArea(l.match);
    for (const pattern of ['disrupt', 'symmetric']) {
      assert.equal(l[pattern].patches.length, l.match.patches.length, `${seed} ${pattern}: count`);
      assert.ok(Math.abs(totalArea(l[pattern]) - a) <= 1e-6 * a, `${seed} ${pattern}: ${totalArea(l[pattern])} vs ${a}`);
    }
    // The area of each patch is that of its polygon
    for (const p of l.symmetric.patches) close(p.area, C.polygonArea(p.points));
  }
});

test('A: camoSearchLayout: the symmetric pattern is the same on the left and on the right of the vertical center line', () => {
  for (const seed of [1, 8, 2603, 9999]) {
    const lay = C.camoSearchLayout({ seed, pattern: 'symmetric' }), cx = lay.center[0];
    const mirrored = (poly) => poly.map(([x, y]) => [2 * cx - x, y]);
    const same = (p, q) => p.length === q.length && p.every(([x, y]) => q.some(([u, v]) => Math.abs(u - x) < 1e-6 && Math.abs(v - y) < 1e-6));
    for (const p of lay.patches) {
      assert.ok(lay.patches.some((q) => q.color === p.color && Math.abs(q.area - p.area) < 1e-6 && same(mirrored(p.points), q.points)), String(seed));
    }
    // The background-matching pattern is not symmetric
    const match = C.camoSearchLayout({ seed, pattern: 'match' });
    assert.ok(!match.patches.every((p) => match.patches.some((q) => same(mirrored(p.points), q.points))), `${seed}: match is not symmetric`);
  }
});

test('A: camoSearchLayout: the disruptive pattern moves four patches onto the edge, in the darkest and the lightest bark colors', () => {
  assert.deepEqual([C.CAMO.edges, C.CAMO.darkest, C.CAMO.lightest, C.CAMO.base], [4, 0, 3, 1]);
  for (const seed of [2, 11, 2603]) {
    const { match, disrupt } = layouts(seed);
    const moved = disrupt.patches.map((p, i) => i).filter((i) => JSON.stringify(disrupt.patches[i]) !== JSON.stringify(match.patches[i]));
    assert.equal(moved.length, 4, String(seed));
    assert.deepEqual(moved.map((i) => disrupt.patches[i].color).sort(), [0, 0, 3, 3], 'two darkest and two lightest');
    for (const i of moved) {
      const p = disrupt.patches[i];
      // On the edge: two points or more of the patch lie on the outline of the moth shape
      assert.ok(p.points.filter((q) => edgeDistance(q, disrupt.moth) < 1e-6).length >= 2, `${seed} patch ${i}`);
      // The same area as before the move
      close(p.area, match.patches[i].area, 1e-6 * match.patches[i].area);
    }
  }
});
