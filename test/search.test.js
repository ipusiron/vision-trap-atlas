'use strict';
// D: the progress of "Find and tap" and of the search experiment in atlas-search.js, driven by a fake clock and a fake
// requestAnimationFrame, and the cases of the result sentences (resultCases) at their borders.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../atlas-core.js');
const D = require('../atlas-data.js');
const V = require('../atlas-view.js');
const S = require('../atlas-search.js');

// A fake clock and frame queue: frame(ts) sets the clock and runs the callbacks waiting for the next frame
function fakeTime() {
  let t = 0;
  const queue = [];
  return {
    now: () => t,
    raf: (cb) => { queue.push(cb); },
    frame: (ts) => { t = ts; for (const cb of queue.splice(0)) cb(ts); },
    set: (ts) => { t = ts; },
    pending: () => queue.length,
  };
}
const seeds = (...list) => { let i = 0; return () => list[i++ % list.length]; };
const pf = D.entries.find((e) => e.id === 'popout-feature');
const pfDefaults = V.controlValues(pf);

function findSession(clock, seedList = [11, 12, 13]) {
  const events = [];
  const session = S.createFind({ now: clock.now, raf: clock.raf, seed32: seeds(...seedList),
    layout: (seed) => V.findLayout('popout-feature', { ...pfDefaults, seed }), onChange: (st) => events.push(st) });
  return { session, events };
}
// Shows the figure: tap the cover at `at`, then two frames
function reveal(clock, session, at) {
  session.pressCover({ timeStamp: at });
  clock.frame(at + 16);
  assert.equal(session.state().phase, 'shown');
  clock.frame(at + 33);
  assert.equal(session.state().phase, 'timing');
  assert.equal(session.state().t0, at + 33, 'the clock starts at the frame after the one that showed the figure');
}

test('D: Find and tap: the time runs from the frame after the figure appears to the timeStamp of the tap', () => {
  const clock = fakeTime(), { session } = findSession(clock);
  assert.equal(session.state().phase, 'idle');
  session.press({ detail: 1 });
  const st = session.state();
  assert.equal(st.phase, 'cover');
  assert.equal(st.seed, 11);
  assert.equal(st.target, V.popoutLayout({ ...pfDefaults, seed: 11 }).items[0].cell);
  session.pressCell(st.target, { timeStamp: 50 });
  assert.equal(session.state().phase, 'cover', 'shapes cannot be tapped under the cover');
  reveal(clock, session, 100);
  session.pressCell(st.target, { timeStamp: 133 + 700 });
  const done = session.state();
  assert.equal(done.phase, 'done');
  assert.equal(done.timeMs, 700);
  assert.deepEqual(done.result, { key: 'findTime', values: { t: '0.7' } });
  assert.deepEqual(done.marks, { pressed: null, target: st.target });
});

test('D: Find and tap: a wrong shape gives findWrong with both marks and no time; an empty cell does nothing', () => {
  const clock = fakeTime(), { session } = findSession(clock);
  session.press({ detail: 1 });
  const st = session.state();
  reveal(clock, session, 0);
  const empty = Array.from({ length: 36 }, (_, i) => i).find((c) => !st.items.some((it) => it.cell === c));
  session.pressCell(empty, { timeStamp: 500 });
  assert.equal(session.state().phase, 'timing', 'a cell without a shape does nothing');
  const other = st.items.find((it) => !it.target).cell;
  session.pressCell(other, { timeStamp: 600 });
  const done = session.state();
  assert.deepEqual(done.result, { key: 'findWrong', values: {} });
  assert.deepEqual(done.marks, { pressed: other, target: st.target });
  assert.equal(done.timeMs, null);
});

test('D: Find and tap: after 10 seconds "Show the answer" appears; showing it marks the shape and keeps no time', () => {
  const clock = fakeTime(), { session } = findSession(clock);
  session.press({ detail: 1 });
  reveal(clock, session, 1000);
  clock.frame(10999);
  assert.equal(session.state().revealOffered, false);
  session.showAnswer();
  assert.equal(session.state().phase, 'timing', 'the answer cannot be shown before the offer');
  clock.frame(11000);
  assert.equal(session.state().revealOffered, true, '10 seconds after the cover was tapped');
  assert.equal(clock.pending(), 0, 'the frame loop stops once the offer is shown');
  session.showAnswer();
  const done = session.state();
  assert.deepEqual(done.result, { key: 'findShown', values: {} });
  assert.deepEqual(done.marks, { pressed: null, target: done.target });
  assert.equal(done.timeMs, null);
});

test('D: Find and tap: from the keyboard it does not start; pressing again rearranges with a new seed; reset stops it', () => {
  const clock = fakeTime(), { session } = findSession(clock);
  session.press({ detail: 0 });
  assert.equal(session.state().phase, 'idle');
  assert.deepEqual(session.state().result, { key: 'findKeyboard', values: {} });
  session.press({ detail: 1 });
  const first = session.state().seed;
  session.press({ detail: 2 });
  assert.notEqual(session.state().seed, first);
  assert.equal(session.state().seed, 12, 'the keyboard press did not use a seed');
  session.pressCover({ timeStamp: 0 });
  session.reset();
  clock.frame(16);
  clock.frame(33);
  assert.equal(session.state().phase, 'idle', 'frames scheduled before the reset do nothing');
});

// ----- the experiment -----
// The bar to find is answered correctly with rt = base + slope × setSize (present and absent can differ)
function correctAnswer(trial) { return trial.present ? 'present' : 'absent'; }
function createExp(clock, opts = {}) {
  return S.createExperiment({ now: clock.now, raf: clock.raf, seed32: seeds(opts.seed || 77), search: opts.search || 'conjunction',
    set: opts.set || 'color', granularity: opts.granularity ?? 0.1, onChange: opts.onChange });
}
// Runs one try: waits through the fixation point, answers at rt after the display start, then waits through feedback and the gap
function runTry(clock, exp, { rt, answer, input = 'key' }) {
  let t = clock.now();
  const st0 = exp.state();
  assert.equal(st0.phase, 'fixation');
  clock.frame(t += 16);            // the fixation point is on screen
  clock.frame(t += 500);           // 500 ms later the display is made visible
  assert.equal(exp.state().phase, 'stimulus');
  assert.equal(exp.state().visible, true);
  clock.frame(t += 16);            // the next frame is the display start
  const t0 = t;
  const trial = exp.state().trial;
  exp.respond({ answer: answer ? answer(trial) : correctAnswer(trial), timeStamp: t0 + rt(trial), input });
  assert.equal(exp.state().phase, 'feedback');
  assert.equal(exp.state().visible, false, 'the display is cleared during the feedback');
  clock.frame(t = t0 + rt(trial) + 500);
  assert.equal(exp.state().phase, 'gap');
  clock.frame(t += 300);
  return trial;
}
function runBlock(clock, exp, rtFn, input = 'key') {
  exp.start();
  for (let i = 0; i < 8; i += 1) runTry(clock, exp, { rt: rtFn, input });
  assert.equal(exp.state().phase, 'practiceDone');
  exp.proceed();
  for (let i = 0; i < 32; i += 1) runTry(clock, exp, { rt: rtFn, input });
  assert.equal(exp.state().phase, 'done');
}

test('D: one try runs fixation 500 → display → answer → feedback 500 → gap 300, and the time counts from the display start', () => {
  const clock = fakeTime(), exp = createExp(clock);
  assert.equal(exp.state().phase, 'ready');
  exp.start();
  assert.equal(exp.state().phase, 'fixation');
  assert.deepEqual(exp.state().progress, { block: 'practice', i: 1, total: 8 });
  clock.frame(1000);
  clock.frame(1499);
  assert.equal(exp.state().phase, 'fixation');
  clock.frame(1500);
  assert.equal(exp.state().phase, 'stimulus');
  clock.frame(1516);
  const trial = exp.state().trial;
  exp.respond({ answer: correctAnswer(trial), timeStamp: 1516 + 620, input: 'key' });
  const st = exp.state();
  assert.deepEqual(st.feedback, { key: 'fbCorrect', values: { t: '0.62' } });
  assert.equal(st.practiceRecords[0].rt, 620);
  assert.equal(st.practiceRecords[0].outcome, 'correct');
  clock.frame(2136 + 499);
  assert.equal(exp.state().phase, 'feedback');
  clock.frame(2136 + 500);
  assert.equal(exp.state().phase, 'gap');
  clock.frame(2636 + 299);
  assert.equal(exp.state().phase, 'gap');
  clock.frame(2636 + 300);
  assert.equal(exp.state().phase, 'fixation');
  assert.deepEqual(exp.state().progress, { block: 'practice', i: 2, total: 8 });
});

test('D: an answer during the fixation point is early and goes to the end once; a repeated key is ignored', () => {
  const clock = fakeTime(), exp = createExp(clock);
  exp.start();
  clock.frame(10);
  exp.respond({ answer: 'present', timeStamp: 100, input: 'key', repeat: true });
  assert.equal(exp.state().phase, 'fixation', 'a repeated key does nothing');
  exp.respond({ answer: 'present', timeStamp: 100, input: 'key' });
  assert.deepEqual(exp.state().feedback, { key: 'fbEarly', values: {} });
  assert.equal(exp.state().practiceRecords[0].outcome, 'early');
  clock.frame(600);
  clock.frame(900);
  assert.deepEqual(exp.state().progress, { block: 'practice', i: 1, total: 8 }, 'the early try is not counted as done');
  // An answer under 200 ms after the display start is early as well
  clock.frame(916);
  clock.frame(1416);
  clock.frame(1432);
  exp.respond({ answer: 'present', timeStamp: 1432 + 199, input: 'key' });
  assert.deepEqual(exp.state().feedback, { key: 'fbEarly', values: {} });
});

test('D: no answer within 4000 ms is a timeout', () => {
  const clock = fakeTime(), exp = createExp(clock);
  exp.start();
  clock.frame(0);
  clock.frame(500);
  clock.frame(516);
  clock.frame(516 + 3999);
  assert.equal(exp.state().phase, 'stimulus');
  clock.frame(516 + 4000);
  assert.deepEqual(exp.state().feedback, { key: 'fbTimeout', values: {} });
  assert.equal(exp.state().practiceRecords[0].outcome, 'timeout');
  assert.equal(exp.state().practiceRecords[0].rt, 4000);
});

test('D: wrong answers give fbMiss and fbFalse', () => {
  const clock = fakeTime(), exp = createExp(clock);
  exp.start();
  const outcomes = [];
  for (let i = 0; i < 8; i += 1) {
    runTry(clock, exp, { rt: () => 700, answer: (trial) => (trial.present ? 'absent' : 'present') });
    outcomes.push(exp.state().practiceRecords.at(-1).outcome);
  }
  assert.deepEqual([...new Set(outcomes)].sort(), ['falseAlarm', 'miss']);
});

test('D: a full block (8 practice and 32 recorded tries) gives the known slopes; the practice tries are not in the summary', () => {
  const clock = fakeTime(), exp = createExp(clock);
  runBlock(clock, exp, (trial) => (trial.present ? 450 + 10 * trial.setSize : 500 + 25 * trial.setSize));
  const st = exp.state();
  assert.equal(st.practiceRecords.length, 8);
  assert.equal(st.records.length, 32);
  assert.equal(st.mainTotal, 32);
  // Four recorded tries for each number of items with the bar there and not there
  for (const n of C.SET_SIZES) for (const present of [true, false]) {
    assert.equal(st.records.filter((r) => r.setSize === n && r.present === present).length, 4, `${n} ${present}`);
  }
  const s = exp.summary();
  assert.ok(Math.abs(s.rows.present.slope - 10) < 1e-9);
  assert.ok(Math.abs(s.rows.present.intercept - 450) < 1e-9);
  assert.ok(Math.abs(s.rows.absent.slope - 25) < 1e-9);
  assert.equal(s.ratio, 2.5);
  assert.equal(s.answered, 32);
  assert.equal(s.aborted, false);
  assert.equal(s.mixedInput, false);
});

test('D: an early try in the recorded block is moved to the end once, so the block still ends with 32 counted tries', () => {
  const clock = fakeTime(), exp = createExp(clock);
  exp.start();
  for (let i = 0; i < 8; i += 1) runTry(clock, exp, { rt: () => 600 });
  exp.proceed();
  // The first recorded try: answer during the fixation point
  clock.frame(clock.now() + 16);
  const first = exp.state().trial;
  exp.respond({ answer: 'present', timeStamp: clock.now() + 1, input: 'key' });
  clock.frame(clock.now() + 600);
  clock.frame(clock.now() + 300);
  let tries = 0;
  while (exp.state().phase !== 'done') { runTry(clock, exp, { rt: () => 600 }); tries += 1; }
  assert.equal(tries, 32, 'the early try comes back at the end');
  const st = exp.state();
  assert.equal(st.records.length, 33);
  assert.equal(st.records[0].outcome, 'early');
  assert.deepEqual([st.records.at(-1).setSize, st.records.at(-1).present, st.records.at(-1).requeued], [first.setSize, first.present, true]);
});

test('D: an excluded try is counted once per try shown, however often it is pressed too early; so one search can exclude more than 32', () => {
  const clock = fakeTime(), exp = createExp(clock);
  exp.start();
  for (let i = 0; i < 8; i += 1) runTry(clock, exp, { rt: () => 600 });
  exp.proceed();
  let shown = 0, presses = 0;
  while (exp.state().phase !== 'done') {
    let t = clock.now();
    clock.frame(t += 16);
    assert.equal(exp.state().phase, 'fixation');
    // Two presses during the fixation point: the first is too early; the second comes during the line of the result and does nothing
    exp.respond({ answer: 'present', timeStamp: t + 1, input: 'key' });
    exp.respond({ answer: 'absent', timeStamp: t + 2, input: 'key' });
    presses += 2;
    shown += 1;
    clock.frame(t += 600);
    clock.frame(t += 300);
  }
  const st = exp.state(), s = exp.summary();
  assert.equal(presses, 128);
  assert.equal(shown, 64, 'each of the 32 tries is shown again once after its first too-early press');
  assert.equal(st.records.length, 64);
  assert.ok(st.records.every((r) => r.outcome === 'early'));
  assert.equal(st.records.filter((r) => r.requeued).length, 32, 'a try is done again only once');
  assert.deepEqual([s.rows.present.excluded, s.rows.absent.excluded], [32, 32], 'one excluded count per try shown, not per press');
  // The note under the table says so (the excluded counts of one search can add up to more than its 32 recorded tries)
  assert.ok(s.rows.present.excluded + s.rows.absent.excluded > C.SET_SIZES.length * 2 * C.MAIN_REPS);
});

test('D: a hidden page stops the try without counting it, then "Resume" goes on; Esc stops and keeps the results', () => {
  const clock = fakeTime(), exp = createExp(clock);
  exp.start();
  for (let i = 0; i < 8; i += 1) runTry(clock, exp, { rt: () => 600 });
  exp.proceed();
  for (let i = 0; i < 3; i += 1) runTry(clock, exp, { rt: () => 600, input: i === 0 ? 'touch' : 'key' });
  clock.frame(clock.now() + 16);
  clock.frame(clock.now() + 500);
  assert.equal(exp.state().phase, 'stimulus');
  exp.setHidden(true);
  assert.equal(exp.state().phase, 'paused');
  assert.deepEqual(exp.state().feedback, { key: 'expHidden', values: {} });
  assert.equal(exp.state().records.at(-1).outcome, 'hidden');
  const pending = clock.pending();
  clock.frame(clock.now() + 5000);
  assert.equal(exp.state().phase, 'paused', 'nothing runs while paused');
  assert.ok(pending <= 1);
  exp.setHidden(false);
  assert.equal(exp.state().phase, 'paused', 'coming back shows "Resume" and waits');
  exp.resume();
  assert.equal(exp.state().phase, 'fixation');
  assert.deepEqual(exp.state().progress, { block: 'main', i: 4, total: 32 });
  runTry(clock, exp, { rt: () => 600 });
  exp.abort();
  const st = exp.state();
  assert.equal(st.phase, 'aborted');
  assert.deepEqual(st.feedback, { key: 'expAborted', values: {} });
  const s = exp.summary();
  assert.equal(s.aborted, true);
  assert.equal(s.mixedInput, true, 'touch and keys were mixed');
  assert.equal(s.measured, 4, 'the hidden try is not counted');
  clock.frame(clock.now() + 1000);
  assert.equal(exp.state().phase, 'aborted');
});

test('D: stopping before any recorded try leaves no summary', () => {
  const clock = fakeTime(), exp = createExp(clock);
  exp.start();
  runTry(clock, exp, { rt: () => 600 });
  exp.abort();
  assert.equal(exp.summary(), null);
  assert.equal(exp.state().practiceRecords.length, 1);
});

test('D: the timer resolution is measured before the block: 1 ms and 16.667 ms', () => {
  const grain = (g) => { let t = 0; return () => { t += 0.01; return Math.floor(t / g) * g; }; };
  for (const g of [1, 16.667]) {
    const clock = fakeTime();
    const exp = S.createExperiment({ now: grain(g), raf: clock.raf, seed32: seeds(5), search: 'feature' });
    assert.ok(Math.abs(exp.state().granularity - g) < 1e-6, String(g));
  }
});

test('D: the same seed gives the same order of tries; the color and fill sets keep the same layout', () => {
  const a = createExp(fakeTime(), { seed: 99 }), b = createExp(fakeTime(), { seed: 99, set: 'fill' });
  a.start();
  b.start();
  assert.deepEqual(a.state().trial, b.state().trial);
  assert.equal(a.seed, 99);
});

// ----- result sentences -----
// A block summary with given slopes (null = not measured), error counts and marks
function block({ a = null, b = null, errors = 0, answered = 32, aborted = false, mixed = false, granularity = 0.1 } = {}) {
  const ratioState = a === null || b === null ? null : C.round1(a) < 1 ? 'below1' : 'ok';
  return {
    rows: { present: { slope: a }, absent: { slope: b } }, ratioState,
    ratio: ratioState === 'ok' ? C.round1(C.round1(b) / C.round1(a)) : null,
    errors, answered, aborted, mixedInput: mixed, granularity,
  };
}
const keys = (cases) => cases.map((c) => c.key);

test('D: resultCases: nothing, one search, both searches', () => {
  assert.deepEqual(C.resultCases({}), [{ key: 'resNone', values: {} }]);
  const one = C.resultCases({ feature: block({ a: 3.1, b: 25.1 }) });
  assert.deepEqual(keys(one), ['resOneFeature', 'resRatioHigh', 'resDevice', 'resLimits']);
  assert.deepEqual(one[0].values, { a: 3.1, b: 25.1 });
  assert.deepEqual(one[1].values, { search: 'feature', r: 8.1 });
  assert.deepEqual(keys(C.resultCases({ conjunction: block({ a: 28.7, b: 67.1 }) })), ['resOneConj', 'resRatioTypical', 'resDevice', 'resLimits']);
  const both = C.resultCases({ feature: block({ a: 3.1, b: 25.1 }), conjunction: block({ a: 28.7, b: 67.1 }) });
  assert.deepEqual(keys(both), ['resBoth', 'resCmpLarger', 'resRatioHigh', 'resRatioTypical', 'resDevice', 'resLimits']);
  assert.deepEqual(both[0].values, { fa: 3.1, fb: 25.1, ca: 28.7, cb: 67.1 });
  assert.deepEqual(both[1].values, { d: 42 });
});

test('D: resultCases: both searches measured, but only one has both slopes (the other stopped early): that one opens the sentences', () => {
  const stopped = block({ a: null, b: null, aborted: true });
  const featureOnly = C.resultCases({ feature: block({ a: 3.1, b: 25.1 }), conjunction: stopped });
  assert.deepEqual(keys(featureOnly), ['resOneFeature', 'resRatioHigh', 'resNoSlope', 'resNoSlope', 'resNoSlopeWhy', 'resPartial', 'resDevice',
    'resLimits']);
  assert.deepEqual(featureOnly[0].values, { a: 3.1, b: 25.1 });
  const conjOnly = C.resultCases({ feature: block({ a: 4, b: null, aborted: true }), conjunction: block({ a: 28.7, b: 67.1 }) });
  assert.deepEqual(keys(conjOnly), ['resOneConj', 'resRatioTypical', 'resNoSlope', 'resNoSlopeWhy', 'resPartial', 'resDevice', 'resLimits']);
  assert.deepEqual(conjOnly[0].values, { a: 28.7, b: 67.1 });
  // Neither has both slopes: no opening sentence
  assert.deepEqual(keys(C.resultCases({ feature: block({ a: 4, b: null }), conjunction: block({ a: null, b: 9 }) })),
    ['resNoSlope', 'resNoSlope', 'resNoSlopeWhy', 'resDevice', 'resLimits']);
});

test('D: the end of a run shows the most important sentence only: the comparison, else the one search, else why there is no slope', () => {
  const end = (results) => keys(C.resultEndCases(C.resultCases(results)));
  // Both searches with their slopes: the comparison of the absent slopes alone (not the four slopes, not the ratios)
  assert.deepEqual(end({ feature: block({ a: 3.1, b: 25.1 }), conjunction: block({ a: 28.7, b: 67.1 }) }), ['resCmpLarger']);
  assert.deepEqual(end({ feature: block({ a: 3, b: 20 }), conjunction: block({ a: 4, b: 25 }) }), ['resCmpSimilar']);
  // One search: its sentence alone (it says to measure the other); the ratio, the wrong answers and the notes stay in the results area
  assert.deepEqual(end({ feature: block({ a: 3.1, b: 25.1, errors: 8, answered: 31, granularity: 16.667 }) }), ['resOneFeature']);
  assert.deepEqual(end({ conjunction: block({ a: 28.7, b: 67.1, aborted: true, mixed: true }) }), ['resOneConj']);
  // A run without a slope (every press too early): the rows without a slope and why, once
  assert.deepEqual(end({ feature: block({ a: null, b: null }) }), ['resNoSlope', 'resNoSlope', 'resNoSlopeWhy']);
  assert.deepEqual(end({}), []);
  // Every sentence of the end is one of the results area, in the same order
  const results = { feature: block({ a: -1, b: 2, errors: 8, answered: 60 }), conjunction: block({ a: 12, b: null }) };
  const all = keys(C.resultCases(results)), shown = end(results);
  assert.deepEqual(shown, all.filter((k) => shown.includes(k)));
});

test('D: resultCases: the absent-slope difference at 15.0, 14.9, −14.9 and −15.0 (after rounding)', () => {
  assert.equal(C.CMP_STEP, 15);
  const cmp = (fb, cb) => C.resultCases({ feature: block({ a: 2, b: fb }), conjunction: block({ a: 5, b: cb }) })[1];
  assert.deepEqual(cmp(20, 35), { key: 'resCmpLarger', values: { d: 15 } });
  assert.equal(cmp(20, 34.9).key, 'resCmpSimilar');
  assert.equal(cmp(20, 20).key, 'resCmpSimilar');
  assert.equal(cmp(20, 5.1).key, 'resCmpSimilar');
  assert.equal(cmp(20, 5).key, 'resCmpSmaller');
  // The comparison uses the shown values: 10.04 and 25.0 are shown as 10.0 and 25.0, a difference of 15.0
  assert.equal(cmp(10.04, 25).key, 'resCmpLarger');
  assert.equal(cmp(10.05, 25).key, 'resCmpSimilar', '10.05 is shown as 10.1');
  assert.equal(cmp(25, 10.04).key, 'resCmpSmaller', 'a difference of −15.0');
  assert.equal(cmp(25, 10.05).key, 'resCmpSimilar', 'a difference of −14.9');
  // No comparison when one absent slope is missing
  assert.ok(!keys(C.resultCases({ feature: block({ a: 2, b: 20 }), conjunction: block({ a: 5, b: null }) })).some((k) => k.startsWith('resCmp')));
});

test('D: resultCases: the ratio at present 0.9 and ratios 0.9, 1.9, 2.0, 3.0 and 3.1', () => {
  const ratio = (a, b) => C.resultCases({ feature: block({ a, b }) }).find((c) => c.key.startsWith('resRatio'));
  assert.deepEqual(ratio(0.9, 10), { key: 'resRatioNone', values: { search: 'feature' } });
  assert.deepEqual(ratio(10, 9), { key: 'resRatioLow', values: { search: 'feature', r: 0.9 } });
  assert.deepEqual(ratio(10, 19), { key: 'resRatioMid', values: { search: 'feature', r: 1.9 } });
  assert.deepEqual(ratio(10, 20), { key: 'resRatioTypical', values: { search: 'feature', r: 2 } });
  assert.deepEqual(ratio(10, 30), { key: 'resRatioTypical', values: { search: 'feature', r: 3 } });
  assert.deepEqual(ratio(10, 31), { key: 'resRatioHigh', values: { search: 'feature', r: 3.1 } });
  // A ratio of 0 or less (after rounding): the sentence without the ratio
  assert.deepEqual(ratio(10, -5), { key: 'resRatioZeroOrLess', values: { search: 'feature' } });
  assert.deepEqual(ratio(10, 0), { key: 'resRatioZeroOrLess', values: { search: 'feature' } });
  assert.deepEqual(ratio(10, 0.4), { key: 'resRatioZeroOrLess', values: { search: 'feature' } }, '0.04 is shown as 0.0');
  assert.deepEqual(ratio(10, 1), { key: 'resRatioLow', values: { search: 'feature', r: 0.1 } });
  // 0.96 is shown as 1.0, so the ratio is given (3.2 ÷ 1.0)
  assert.deepEqual(ratio(0.96, 3.2), { key: 'resRatioHigh', values: { search: 'feature', r: 3.2 } });
});

test('D: resultCases: negative slopes, missing slopes, a stop, mixed input', () => {
  assert.ok(keys(C.resultCases({ feature: block({ a: -1.2, b: 5 }) })).includes('resNegative'));
  assert.ok(!keys(C.resultCases({ feature: block({ a: -0.04, b: 5 }) })).includes('resNegative'), '−0.04 is shown as 0.0');
  const missing = C.resultCases({ feature: block({ a: 3, b: null }), conjunction: block({ a: null, b: null, aborted: true, mixed: true }) });
  assert.deepEqual(keys(missing), ['resNoSlope', 'resNoSlope', 'resNoSlope', 'resNoSlopeWhy', 'resPartial', 'resMixed', 'resDevice', 'resLimits']);
  assert.deepEqual(missing.filter((c) => c.key === 'resNoSlope').map((c) => c.values.row), ['feature.absent', 'conjunction.present', 'conjunction.absent']);
  // Why there is no slope: once, and only when a row has none
  assert.ok(!keys(C.resultCases({ feature: block({ a: 3, b: 20 }) })).includes('resNoSlopeWhy'));
});

test('D: resultCases: wrong answers at 10.0%, 10.1% and 10.9% of the answered tries (compared before rounding; {p} is a whole percent)', () => {
  const errs = (errors, answered) => C.resultCases({ feature: block({ a: 3, b: 20, errors, answered }) }).find((c) => c.key === 'resErrors');
  assert.equal(errs(6, 60), undefined, '10.0%');
  assert.equal(errs(100, 1000), undefined, '10.0% of 1000');
  assert.deepEqual(errs(101, 1000), { key: 'resErrors', values: { search: 'feature', n: 101, p: 10 } }, '10.1% is over 10%, shown as 10');
  assert.deepEqual(errs(109, 1000), { key: 'resErrors', values: { search: 'feature', n: 109, p: 11 } });
  assert.deepEqual(errs(7, 64), { key: 'resErrors', values: { search: 'feature', n: 7, p: 11 } });
});

test('D: resultCases: the timer resolution note at 1 ms and 16.667 ms', () => {
  const coarse = (g) => C.resultCases({ feature: block({ a: 3, b: 20, granularity: g }) }).find((c) => c.key === 'resCoarse');
  assert.equal(coarse(1), undefined);
  assert.equal(coarse(null), undefined);
  assert.deepEqual(coarse(16.667), { key: 'resCoarse', values: { g: 16.7 } });
  assert.deepEqual(coarse(4.96), { key: 'resCoarse', values: { g: 5 } }, '4.96 is shown as 5.0');
});

test('D: resultCases follows the order of the screen', () => {
  const full = C.resultCases({
    feature: block({ a: -1, b: 2, errors: 8, answered: 60, mixed: true, aborted: true, granularity: 16.667 }),
    conjunction: block({ a: 12, b: null }),
  });
  assert.deepEqual(keys(full), ['resOneFeature', 'resRatioNone', 'resNegative', 'resNoSlope', 'resNoSlopeWhy', 'resPartial', 'resMixed', 'resErrors',
    'resCoarse', 'resDevice', 'resLimits']);
  const order = ['resNone', 'resOneFeature', 'resOneConj', 'resBoth', 'resCmpLarger', 'resCmpSimilar', 'resCmpSmaller', 'resRatioNone',
    'resRatioZeroOrLess', 'resRatioLow', 'resRatioMid', 'resRatioTypical', 'resRatioHigh', 'resNegative', 'resNoSlope', 'resNoSlopeWhy', 'resPartial',
    'resMixed', 'resErrors', 'resCoarse', 'resDevice', 'resLimits'];
  const rank = (k) => (k.startsWith('resRatio') ? order.indexOf('resRatioNone') : k.startsWith('resCmp') ? order.indexOf('resCmpLarger')
    : k.startsWith('resOne') || k === 'resBoth' ? order.indexOf('resBoth') : order.indexOf(k));
  const ranks = keys(full).map(rank);
  assert.deepEqual(ranks, ranks.slice().sort((x, y) => x - y));
});

test('D: the summary of a real block goes through resultCases', () => {
  const clock = fakeTime(), exp = createExp(clock, { search: 'feature', seed: 3 });
  runBlock(clock, exp, (trial) => (trial.present ? 480 + 3 * trial.setSize : 520 + 10 * trial.setSize));
  const feature = exp.summary();
  const clock2 = fakeTime(), exp2 = createExp(clock2, { search: 'conjunction', seed: 4 });
  runBlock(clock2, exp2, (trial) => (trial.present ? 450 + 20 * trial.setSize : 500 + 50 * trial.setSize), 'mouse');
  const cases = C.resultCases({ feature, conjunction: exp2.summary() });
  assert.deepEqual(keys(cases), ['resBoth', 'resCmpLarger', 'resRatioHigh', 'resRatioTypical', 'resDevice', 'resLimits']);
  // The summary keeps the feature pair it was measured with
  assert.equal(feature.set, 'color');
  assert.equal(C.summarizeBlock([], {}).set, null);
  assert.deepEqual(cases[0].values, { fa: 3, fb: 10, ca: 20, cb: 50 });
  assert.deepEqual(cases[1].values, { d: 40 });
});

// ===== The camouflage experiment =====
const camoExp = (clock, opts = {}) => S.createCamoExperiment({ now: clock.now, raf: clock.raf, seed32: seeds(opts.seed || 21),
  onChange: opts.onChange });
// One try: through the fixation point to the display, then `how`: right (the cell of the moth shape), wrong, early (150 ms) or timeout
function camoTry(clock, exp, { rt = 1200, how = 'right', input = 'mouse' } = {}) {
  let t = clock.now();
  assert.equal(exp.state().phase, 'fixation');
  clock.frame(t += 16);              // the fixation point is on screen
  clock.frame(t += 500);             // 500 ms later the pattern is made visible
  assert.equal(exp.state().phase, 'stimulus');
  assert.equal(exp.state().visible, true);
  clock.frame(t += 16);              // the next frame is the display start
  const t0 = t, trial = exp.state().trial;
  if (how === 'timeout') {
    clock.frame(t0 + 9999);
    assert.equal(exp.state().phase, 'stimulus', 'still searching at 9,999 ms');
    clock.frame(t = t0 + 10000);
  } else {
    t = t0 + (how === 'early' ? 150 : rt);
    exp.respond({ cell: how === 'wrong' ? (trial.cell + 1) % 36 : trial.cell, timeStamp: t, input });
  }
  const st = exp.state(), marked = how === 'wrong' || how === 'timeout';
  assert.equal(st.phase, 'feedback');
  assert.deepEqual([st.visible, st.mark], [marked, marked], 'the pattern stays with the mark after a wrong spot or a time-out');
  clock.frame(t + (marked ? 999 : 499));
  assert.equal(exp.state().phase, 'feedback');
  clock.frame(t += marked ? 1000 : 500);
  assert.equal(exp.state().phase, 'gap');
  assert.deepEqual([exp.state().visible, exp.state().mark], [false, false]);
  clock.frame(t += 300);
  return trial;
}

test('D: makeCamoTrials: 3 practice rounds (one of each pattern) and 15 recorded rounds (five of each), mixed by the seed', () => {
  assert.deepEqual([C.CAMO_PRACTICE_REPS, C.CAMO_MAIN_REPS, C.CAMO_TIMEOUT_MS], [1, 5, 10000]);
  for (const seed of [1, 7, 2026]) {
    const t = C.makeCamoTrials({ rng: C.xorshift32(seed) });
    assert.equal(t.practice.length, 3);
    assert.equal(t.main.length, 15);
    for (const pattern of C.CAMO_PATTERNS) {
      assert.equal(t.practice.filter((x) => x.pattern === pattern).length, 1, pattern);
      assert.equal(t.main.filter((x) => x.pattern === pattern).length, 5, pattern);
    }
    const all = [...t.practice, ...t.main];
    for (const x of all) assert.ok(Number.isInteger(x.cell) && x.cell >= 0 && x.cell < 36 && x.seed > 0);
    // Never the same cell twice in a row
    for (let i = 1; i < all.length; i += 1) assert.notEqual(all[i].cell, all[i - 1].cell, `${seed} ${i}`);
    assert.deepEqual(C.makeCamoTrials({ rng: C.xorshift32(seed) }), t, 'the same seed gives the same rounds');
  }
  const orders = new Set([1, 2, 3, 4, 5, 6].map((seed) => C.makeCamoTrials({ rng: C.xorshift32(seed) }).main.map((x) => x.pattern).join()));
  assert.ok(orders.size > 1, 'the order is mixed by the seed');
});

test('D: classifyCamo at 199, 200, 9,999 and 10,000 ms, a wrong spot and the fixation point', () => {
  const c = (cell, rt, phase = 'stimulus') => C.classifyCamo({ phase, cell, target: 8, rt });
  assert.equal(c(8, 199), 'early');
  assert.equal(c(8, 200), 'correct');
  assert.equal(c(8, 9999), 'correct');
  assert.equal(c(8, 10000), 'timeout');
  assert.equal(c(null, 10000), 'timeout');
  assert.equal(c(9, 900), 'wrong');
  assert.equal(c(3, 120), 'early', 'too early wins over a wrong spot');
  assert.equal(c(8, 900, 'fixation'), 'early');
});

test('D: a camouflage try: fixation 500, the pattern, a tap, the result 0.5 s (right) or the mark 1 s (wrong spot, time-out), gap 300', () => {
  const clock = fakeTime(), exp = camoExp(clock);
  assert.equal(exp.state().phase, 'ready');
  exp.start();
  assert.deepEqual(exp.state().progress, { block: 'practice', i: 1, total: 3 });
  assert.equal(exp.state().tries, 1);
  camoTry(clock, exp, { rt: 1500 });
  let st = exp.state();
  assert.deepEqual(st.practiceRecords[0], { pattern: st.practiceRecords[0].pattern, target: st.practiceRecords[0].target,
    cell: st.practiceRecords[0].target, outcome: 'correct', rt: 1500, input: 'mouse', requeued: false });
  camoTry(clock, exp, { how: 'wrong', input: 'key' });
  camoTry(clock, exp, { how: 'timeout' });
  st = exp.state();
  assert.deepEqual(st.practiceRecords.map((r) => r.outcome), ['correct', 'wrong', 'timeout']);
  assert.equal(st.practiceRecords[2].rt, 10000);
  assert.equal(st.phase, 'practiceDone');
  assert.equal(st.records.length, 0, 'the practice is not recorded');
  assert.equal(exp.summary(), null);
  // The feedback keys
  const keys = [];
  const clock2 = fakeTime(), exp2 = camoExp(clock2, { onChange: (s) => { if (s.feedback) keys.push(s.feedback.key); } });
  exp2.start();
  camoTry(clock2, exp2);
  camoTry(clock2, exp2, { how: 'wrong' });
  camoTry(clock2, exp2, { how: 'timeout' });
  assert.deepEqual([...new Set(keys)], ['camoFbCorrect', 'camoFbWrong', 'camoFbTimeout']);
});

test('D: the camouflage test: 3 practice and 15 recorded rounds; an early tap goes to the end once; a hidden page stops the try; the summary', () => {
  const clock = fakeTime(), exp = camoExp(clock, { seed: 33 });
  exp.start();
  // An early tap during the fixation point: not counted, the round comes back at the end of the practice
  clock.frame(clock.now() + 16);
  exp.respond({ cell: 0, timeStamp: clock.now(), input: 'touch' });
  assert.deepEqual(exp.state().feedback, { key: 'fbEarly', values: {} });
  assert.equal(exp.state().visible, false);
  clock.frame(clock.now() + 500);
  clock.frame(clock.now() + 300);
  let tries = 0;
  while (exp.state().phase !== 'practiceDone') { camoTry(clock, exp); tries += 1; }
  assert.equal(tries, 3, 'the early round comes back once');
  assert.equal(exp.state().practiceRecords.length, 4);
  assert.equal(exp.state().practiceRecords.at(-1).requeued, true);
  exp.proceed();
  assert.deepEqual(exp.state().progress, { block: 'main', i: 1, total: 15 });
  // A repeated key does nothing
  clock.frame(clock.now() + 16);
  exp.respond({ cell: 1, timeStamp: clock.now(), input: 'key', repeat: true });
  assert.equal(exp.state().phase, 'fixation');
  clock.frame(clock.now() + 500);
  clock.frame(clock.now() + 16);
  // A hidden page during the display: the try stops, does not count, and comes back at the end
  exp.setHidden(true);
  assert.equal(exp.state().phase, 'paused');
  assert.deepEqual(exp.state().feedback, { key: 'expHidden', values: {} });
  clock.frame(clock.now() + 5000);
  assert.equal(exp.state().phase, 'paused', 'nothing runs while paused');
  exp.resume();
  const kinds = ['right', 'right', 'wrong', 'right', 'timeout', 'right', 'right', 'early', 'right', 'right', 'right', 'right', 'right', 'right',
    'right', 'right', 'right'];
  let n = 0;
  while (exp.state().phase !== 'done') { camoTry(clock, exp, { how: kinds[n], rt: 900 + 100 * n, input: n === 3 ? 'key' : 'mouse' }); n += 1; }
  assert.equal(n, 16, 'the 14 rounds after the hidden one, then the hidden round and the early round once more at the end');
  const st = exp.state();
  assert.equal(st.records.filter((r) => r.outcome === 'hidden').length, 1);
  assert.equal(st.records.filter((r) => r.outcome === 'early').length, 1);
  assert.equal(st.mainTotal, 15);
  const s = exp.summary();
  assert.equal(s.measured, st.records.length - 1, 'the hidden try is not counted');
  for (const pattern of C.CAMO_PATTERNS) {
    const rs = st.records.filter((r) => r.pattern === pattern && r.outcome !== 'hidden' && r.outcome !== 'early');
    assert.equal(rs.length, 5, `five counted rounds of ${pattern}`);
  }
  assert.equal(s.mixedInput, true, 'one key among the taps');
  assert.equal(s.aborted, false);
  // Stopping keeps the results; nothing runs afterwards
  const clock3 = fakeTime(), exp3 = camoExp(clock3, { seed: 5 });
  exp3.start();
  for (let i = 0; i < 3; i += 1) camoTry(clock3, exp3);
  exp3.proceed();
  camoTry(clock3, exp3, { rt: 800 });
  exp3.abort();
  assert.deepEqual(exp3.state().feedback, { key: 'expAborted', values: {} });
  assert.equal(exp3.summary().aborted, true);
  assert.equal(exp3.summary().measured, 1);
  clock3.frame(clock3.now() + 1000);
  assert.equal(exp3.state().phase, 'aborted');
});

test('D: summarizeCamo: a median from 3 valid rounds but not from 2; not found and wrong spots counted; the times in their order', () => {
  assert.equal(C.MIN_VALID, 3);
  const r = (pattern, outcome, rt, input = 'mouse') => ({ pattern, target: 4, cell: outcome === 'wrong' ? 5 : 4, outcome, rt, input });
  const s = C.summarizeCamo([r('match', 'correct', 1200), r('match', 'correct', 900), r('match', 'correct', 1500), r('match', 'timeout', 10000),
    r('disrupt', 'correct', 2000), r('disrupt', 'correct', 2600), r('disrupt', 'wrong', 1800), r('disrupt', 'wrong', 2100), r('disrupt', 'timeout', 10000),
    r('symmetric', 'correct', 700), r('symmetric', 'correct', 650), r('symmetric', 'correct', 190), r('symmetric', 'early', 150),
    r('symmetric', 'hidden', null)]);
  assert.deepEqual(s.rows.match, { n: 4, valid: 3, times: [1200, 900, 1500], median: 1200, timeout: 1, wrong: 0, early: 0 });
  assert.deepEqual(s.rows.disrupt, { n: 5, valid: 2, times: [2000, 2600], median: null, timeout: 1, wrong: 2, early: 0 });
  // A right tap under 200 ms is not valid; the hidden try is not counted
  assert.deepEqual(s.rows.symmetric, { n: 4, valid: 2, times: [700, 650], median: null, timeout: 0, wrong: 0, early: 1 });
  assert.deepEqual([s.measured, s.aborted, s.mixedInput], [13, false, false]);
  assert.equal(C.summarizeCamo([r('match', 'correct', 900), r('match', 'correct', 800, 'key')], { aborted: true }).mixedInput, true);
});

test('D: camoResultCases: longer, sooner or no clear difference at 20% of the background-matching median, compared after rounding to 0.1 s', () => {
  assert.equal(C.CAMO_SIMILAR, 0.2);
  const summary = (match, disrupt, symmetric, extra = {}) => ({ rows: { match: { median: match }, disrupt: { median: disrupt },
    symmetric: { median: symmetric } }, aborted: false, mixedInput: false, ...extra });
  const keys = (cases) => cases.map((c) => c.key);
  assert.deepEqual(C.camoResultCases(null), [{ key: 'camoResNone', values: {} }]);
  // 2.0 s for the background-matching pattern: 2.4 s is 0.4 s longer (20%, a difference), 2.3 s is not
  assert.deepEqual(C.camoResultCases(summary(2000, 2400, 1600)), [{ key: 'camoResLonger', values: { pattern: 'disrupt', d: 0.4 } },
    { key: 'camoResShorter', values: { pattern: 'symmetric', d: 0.4 } }]);
  assert.deepEqual(C.camoResultCases(summary(2000, 2349, 1650)), [{ key: 'camoResSimilar', values: { pattern: 'disrupt' } },
    { key: 'camoResSimilar', values: { pattern: 'symmetric' } }], '2.349 s is shown as 2.3; 1.65 s as 1.7');
  assert.deepEqual(keys(C.camoResultCases(summary(2049, 2450, 1550))), ['camoResLonger', 'camoResShorter'], '2.049 is 2.0; 2.45 is 2.5; 1.55 is 1.6');
  assert.deepEqual(C.camoResultCases(summary(1450, 3450, 1450))[0], { key: 'camoResLonger', values: { pattern: 'disrupt', d: 2 } }, '1.45 is 1.5');
  // A median missing: no sentence for that pattern, and the sentence of too few valid rounds
  assert.deepEqual(keys(C.camoResultCases(summary(2000, null, 2800))), ['camoResLonger', 'camoResFew']);
  assert.deepEqual(keys(C.camoResultCases(summary(null, 2000, 2800))), ['camoResFew']);
  assert.deepEqual(keys(C.camoResultCases(summary(2000, 2100, 1990, { aborted: true, mixedInput: true }))),
    ['camoResSimilar', 'camoResSimilar', 'camoResPartial', 'resMixed']);
  // Rounds left out because they were too early twice: the sentence that says why the table has fewer rounds, with their number
  assert.deepEqual(C.camoResultCases(summary(2000, 2100, 1990, { dropped: 2, aborted: true })).slice(2),
    [{ key: 'camoResEarly', values: { n: 2 } }, { key: 'camoResPartial', values: {} }]);
  assert.ok(!keys(C.camoResultCases(summary(2000, 2100, 1990, { dropped: 0 }))).includes('camoResEarly'));
});

test('D: summarizeCamo counts the rounds left out: too early, and too early again when done once more (an early round counted once)', () => {
  const r = (pattern, outcome, rt, requeued = false) => ({ pattern, target: 4, cell: 4, outcome, rt, input: 'mouse', requeued });
  // Five rounds of each pattern: two first presses too early, one of them too early again when done once more
  const records = [r('match', 'early', 150), r('match', 'correct', 1200), r('match', 'correct', 900), r('match', 'correct', 1500),
    r('match', 'timeout', 10000), r('disrupt', 'early', 120), r('disrupt', 'correct', 2000), r('disrupt', 'correct', 2600), r('disrupt', 'correct', 2100),
    r('disrupt', 'wrong', 1800), ...['correct', 'correct', 'correct', 'correct', 'correct'].map((o, i) => r('symmetric', o, 700 + 50 * i)),
    r('match', 'correct', 1300, true), r('disrupt', 'early', 160, true)];
  const s = C.summarizeCamo(records);
  assert.equal(s.dropped, 1);
  const total = (p) => s.rows[p].valid + s.rows[p].timeout + s.rows[p].wrong;
  assert.deepEqual(C.CAMO_PATTERNS.map(total), [5, 4, 5], 'the table adds up to 15 rounds less the one left out');
  assert.equal(C.CAMO_PATTERNS.reduce((n, p) => n + total(p), 0) + s.dropped, C.CAMO_PATTERNS.length * C.CAMO_MAIN_REPS);
  assert.deepEqual(C.camoResultCases(s).find((c) => c.key === 'camoResEarly'), { key: 'camoResEarly', values: { n: 1 } });
  // A hidden page and an early press done again and answered: nothing left out
  assert.equal(C.summarizeCamo([r('match', 'early', 150), r('match', 'correct', 900, true), r('match', 'hidden', null)]).dropped, 0);
});

// ===== createMotion: the clock that moves popout-motion (push to play, stop after `seconds`, stop button and next-frame) =====

test('D: createMotion: push to play, the state updates every frame, and it stops at seconds', () => {
  const clock = fakeTime();
  const events = [];
  const motion = S.createMotion({ raf: clock.raf, seconds: 3, onChange: (st) => events.push(st) });
  assert.deepEqual(motion.state(), { phase: 'idle', t: 0, frame: 0 });
  motion.play();
  assert.equal(motion.state().phase, 'playing');
  // t0 is the first frame timestamp; after that t = (ts - t0) / 1000 (500 → 0, 1500 → 1, 2500 → 2, then 3600 → 3.1)
  clock.frame(500); clock.frame(1500); clock.frame(2500);
  assert.equal(motion.state().phase, 'playing');
  assert.ok(Math.abs(motion.state().t - 2) < 0.001);
  clock.frame(3600);
  assert.equal(motion.state().phase, 'idle', 'stops once seconds elapse');
  assert.equal(clock.pending(), 0, 'no more frames scheduled');
});

test('D: createMotion: a stop before the end goes idle immediately and drops the remaining frames', () => {
  const clock = fakeTime();
  const motion = S.createMotion({ raf: clock.raf, seconds: 3 });
  motion.play();
  clock.frame(500); clock.frame(1000);
  motion.stop();
  assert.equal(motion.state().phase, 'idle');
  const before = clock.pending();
  clock.frame(2000);
  assert.equal(motion.state().phase, 'idle', 'the queued frame is a no-op (the new token dropped it)');
  assert.ok(clock.pending() <= before);
});

test('D: createMotion: Next frame cycles 1 through 4 and starts over at 1 (stays in idle when stopped)', () => {
  const clock = fakeTime();
  const motion = S.createMotion({ raf: clock.raf, seconds: 3, frames: 4 });
  for (const expected of [1, 2, 3, 4, 1, 2]) {
    motion.nextFrame();
    assert.equal(motion.state().phase, 'frames');
    assert.equal(motion.state().frame, expected);
  }
  motion.stop();
  assert.equal(motion.state().phase, 'idle');
  assert.equal(motion.state().frame, 0, 'stop resets the frame counter');
});

test('D: createMotion: reset (the same as stop) ends a run without an extra onChange when nothing was playing', () => {
  const clock = fakeTime();
  const events = [];
  const motion = S.createMotion({ raf: clock.raf, seconds: 3, onChange: (st) => events.push(st) });
  motion.reset();
  assert.equal(events.length, 0);
  motion.play();
  clock.frame(100);
  const seen = events.length;
  motion.reset();
  assert.equal(events.length, seen + 1);
  assert.equal(motion.state().phase, 'idle');
});

test('D: createMotion rejects out-of-range seconds (0 or more than 5)', () => {
  const clock = fakeTime();
  assert.throws(() => S.createMotion({ raf: clock.raf, seconds: 0 }), /0 < seconds <= 5/);
  assert.throws(() => S.createMotion({ raf: clock.raf, seconds: 6 }), /0 < seconds <= 5/);
});
