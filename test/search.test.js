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
  assert.deepEqual(keys(featureOnly), ['resOneFeature', 'resRatioHigh', 'resNoSlope', 'resNoSlope', 'resPartial', 'resDevice', 'resLimits']);
  assert.deepEqual(featureOnly[0].values, { a: 3.1, b: 25.1 });
  const conjOnly = C.resultCases({ feature: block({ a: 4, b: null, aborted: true }), conjunction: block({ a: 28.7, b: 67.1 }) });
  assert.deepEqual(keys(conjOnly), ['resOneConj', 'resRatioTypical', 'resNoSlope', 'resPartial', 'resDevice', 'resLimits']);
  assert.deepEqual(conjOnly[0].values, { a: 28.7, b: 67.1 });
  // Neither has both slopes: no opening sentence
  assert.deepEqual(keys(C.resultCases({ feature: block({ a: 4, b: null }), conjunction: block({ a: null, b: 9 }) })),
    ['resNoSlope', 'resNoSlope', 'resDevice', 'resLimits']);
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
  assert.deepEqual(keys(missing), ['resNoSlope', 'resNoSlope', 'resNoSlope', 'resPartial', 'resMixed', 'resDevice', 'resLimits']);
  assert.deepEqual(missing.filter((c) => c.key === 'resNoSlope').map((c) => c.values.row), ['feature.absent', 'conjunction.present', 'conjunction.absent']);
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
  assert.deepEqual(keys(full), ['resOneFeature', 'resRatioNone', 'resNegative', 'resNoSlope', 'resPartial', 'resMixed', 'resErrors', 'resCoarse',
    'resDevice', 'resLimits']);
  const order = ['resNone', 'resOneFeature', 'resOneConj', 'resBoth', 'resCmpLarger', 'resCmpSimilar', 'resCmpSmaller', 'resRatioNone',
    'resRatioZeroOrLess', 'resRatioLow', 'resRatioMid', 'resRatioTypical', 'resRatioHigh', 'resNegative', 'resNoSlope', 'resPartial', 'resMixed',
    'resErrors', 'resCoarse', 'resDevice', 'resLimits'];
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
