/* Vision Trap Atlas - MIT (c) 2026 ipusiron. */
// 「探して押す」（1-1・1-2）と探す実験の進行（UMD・DOM非依存）。
// 時計（now）・描画の予約（raf）・乱数の種（seed32）を外から受け取る。テストでは偽の時計と偽の raf を渡す。
// 時刻はどれも performance.now() と同じ時計：表示の開始＝図を見えるようにしたフレームの次の raf の引数、押した時刻＝event.timeStamp。
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./atlas-core.js'));
  else root.AtlasSearch = factory(root.AtlasCore);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  // 実験の1回の流れ（ミリ秒）。注視点・結果の文・間の長さは画面の決まり、早すぎと時間切れは集計と同じ値
  const TIMING = Object.freeze({ fixation: 500, feedback: 500, gap: 300, timeout: Core.TIMEOUT_MS, early: Core.EARLY_MS, reveal: 10000 });
  const fmt = (x, digits) => (Math.round(x * 10 ** digits) / 10 ** digits).toFixed(digits);
  const stampOf = (event, now) => (event && typeof event.timeStamp === 'number' ? event.timeStamp : now());

  // ===== 「探して押す」 =====
  // layout(seed) は { items: [{ cell, … }], target: cell } を返す（図と同じ配置）。
  // 段：idle → cover（板「ここを押すと始まります」）→ shown（図を出したフレーム）→ timing（時計が動いている）→ done
  function createFind({ now, raf, seed32, layout, onChange = () => {}, timing = {} }) {
    const T = { ...TIMING, ...timing };
    const s = { phase: 'idle', seed: null, items: [], target: null, t0: null, coverAt: null, revealOffered: false, result: null, marks: null,
      timeMs: null };
    let token = 0;
    const emit = () => onChange(snapshot());
    const snapshot = () => ({ ...s, items: s.items.slice(), marks: s.marks ? { ...s.marks } : null, result: s.result ? { ...s.result } : null });

    // 「探して押す」のボタン。キーボードで選んだとき（click の detail が 0）は始めず、実験の案内を出す。押し直すたびに新しい種で並べ直す
    function press(event) {
      token += 1;
      if (event && event.detail === 0) {
        Object.assign(s, { phase: 'idle', t0: null, revealOffered: false, marks: null, timeMs: null, result: { key: 'findKeyboard', values: {} } });
        emit();
        return;
      }
      const seed = seed32() >>> 0 || 1, lay = layout(seed);
      Object.assign(s, { phase: 'cover', seed, items: lay.items, target: lay.target, t0: null, coverAt: null, revealOffered: false, result: null,
        marks: null, timeMs: null });
      emit();
    }
    // 板を押す：次のフレームで図を見えるようにし、その次のフレームの時刻から測る
    function pressCover(event) {
      if (s.phase !== 'cover') return;
      s.coverAt = stampOf(event, now);
      const my = ++token;
      raf((ts1) => {
        if (my !== token) return;
        s.phase = 'shown'; s.shownAt = ts1;
        emit();
        raf((ts2) => {
          if (my !== token) return;
          s.phase = 'timing'; s.t0 = ts2;
          watch(my);
        });
      });
    }
    // 板を押してから10秒たっても答えがなければ「答えを見る」を出す
    function watch(my) {
      raf((ts) => {
        if (my !== token || s.phase !== 'timing') return;
        if (ts - s.coverAt >= T.reveal) { s.revealOffered = true; emit(); return; }
        watch(my);
      });
    }
    // 図形のあるマスを押す（図形のないマスは何も起きない）
    function pressCell(cell, event) {
      if (s.phase !== 'timing' && s.phase !== 'shown') return;
      if (!s.items.some((it) => it.cell === cell)) return;
      token += 1;
      const start = s.phase === 'timing' ? s.t0 : s.shownAt;
      if (cell === s.target) {
        s.timeMs = stampOf(event, now) - start;
        s.result = { key: 'findTime', values: { t: fmt(s.timeMs / 1000, 1) } };
        s.marks = { pressed: null, target: s.target };
      } else {
        s.timeMs = null;
        s.result = { key: 'findWrong', values: {} };
        s.marks = { pressed: cell, target: s.target };
      }
      s.phase = 'done';
      emit();
    }
    // 「答えを見る」：探すものに印を付け、この回の時間は記録しない
    function showAnswer() {
      if (s.phase !== 'timing' || !s.revealOffered) return;
      token += 1;
      Object.assign(s, { phase: 'done', timeMs: null, result: { key: 'findShown', values: {} }, marks: { pressed: null, target: s.target } });
      emit();
    }
    // 並べ直す・設定を変えたときなど：測っている途中なら止めて、初めの状態に戻す
    function reset() {
      token += 1;
      Object.assign(s, { phase: 'idle', t0: null, coverAt: null, revealOffered: false, result: null, marks: null, timeMs: null });
      emit();
    }
    return { press, pressCover, pressCell, showAnswer, reset, state: snapshot };
  }

  // ===== 探す実験 =====
  // 段：ready → fixation → stimulus → feedback → gap → （次の回）… → practiceDone → … → done。ほかに paused（ページが隠れた）・aborted
  const FEEDBACK = { correct: 'fbCorrect', miss: 'fbMiss', falseAlarm: 'fbFalse', early: 'fbEarly', timeout: 'fbTimeout' };
  // 1回の実験＝練習8回と本番32回（段ごと・ある／ないごとに練習1回・本番4回。AtlasCoreの既定値）
  function createExperiment({ now, raf, seed32, search, set = 'color', onChange = () => {}, timing = {}, granularity,
    reps = Core.MAIN_REPS, practiceReps = Core.PRACTICE_REPS }) {
    const T = { ...TIMING, ...timing };
    const seed = seed32() >>> 0 || 1;
    const trials = Core.makeSearchTrials({ search, set, rng: Core.xorshift32(seed), reps, practiceReps });
    const s = {
      search, set, phase: 'ready', block: 'practice', list: trials.practice.slice(), index: 0, resolved: 0, total: trials.practice.length,
      progress: null, trial: null, visible: false, fixStart: null, shownAt: null, t0: null, fbStart: null, gapStart: null, feedback: null,
      practiceRecords: [], records: [], hidden: 0, aborted: false,
      // 時刻の細かさはブロックの開始の前に測る
      granularity: granularity !== undefined ? granularity : Core.timerGranularity(now),
    };
    let token = 0;
    const emit = () => onChange(state());
    function state() {
      return {
        search: s.search, set: s.set, phase: s.phase, block: s.block, progress: s.progress ? { ...s.progress } : null,
        trial: s.trial, visible: s.visible, feedback: s.feedback ? { ...s.feedback } : null, granularity: s.granularity,
        records: s.records.slice(), practiceRecords: s.practiceRecords.slice(), aborted: s.aborted, mainTotal: trials.main.length,
      };
    }
    function loop() {
      const my = token;
      raf((ts) => {
        if (my !== token) return;
        step(ts);
        if (my === token && ['fixation', 'stimulus', 'feedback', 'gap'].includes(s.phase)) loop();
      });
    }
    function beginTrial() {
      s.trial = s.list[s.index];
      s.progress = { block: s.block, i: Math.min(s.resolved + 1, s.total), total: s.total };
      Object.assign(s, { phase: 'fixation', visible: false, fixStart: null, shownAt: null, t0: null, feedback: null });
      emit();
    }
    function step(ts) {
      if (s.phase === 'fixation') {
        if (s.fixStart === null) s.fixStart = ts;
        else if (ts - s.fixStart >= T.fixation) { s.phase = 'stimulus'; s.visible = true; s.shownAt = ts; emit(); }
      } else if (s.phase === 'stimulus') {
        // 図を見えるようにしたフレームの次のフレームの時刻が、表示の開始
        if (s.t0 === null) s.t0 = ts;
        else if (ts - s.t0 >= T.timeout) finish(Core.classify({ phase: 'stimulus', present: s.trial.present, answer: null, rt: ts - s.t0 }),
          ts - s.t0, null, ts);
      } else if (s.phase === 'feedback') {
        if (ts - s.fbStart >= T.feedback) { s.phase = 'gap'; s.gapStart = ts; s.feedback = null; emit(); }
      } else if (s.phase === 'gap') {
        if (ts - s.gapStart >= T.gap) next();
      }
    }
    function record(outcome, rt, input) {
      const r = { setSize: s.trial.setSize, present: s.trial.present, outcome, rt, input, requeued: !!s.trial.requeued };
      (s.block === 'practice' ? s.practiceRecords : s.records).push(r);
      // 早すぎた回とページが隠れた回は、ブロックの最後へ1回だけ回す（回した回は、もう回さない）
      if ((outcome === 'early' || outcome === 'hidden') && !s.trial.requeued) s.list = Core.requeue(s.list, s.index);
      else s.resolved += 1;
    }
    function finish(outcome, rt, input, at) {
      record(outcome, rt, input);
      s.visible = false;
      s.phase = 'feedback';
      s.fbStart = at;
      s.feedback = { key: FEEDBACK[outcome], values: outcome === 'correct' ? { t: fmt(rt / 1000, 2) } : {} };
      emit();
    }
    function next() {
      s.index += 1;
      if (s.index < s.list.length) { beginTrial(); return; }
      token += 1;
      s.visible = false; s.feedback = null; s.trial = null;
      s.phase = s.block === 'practice' ? 'practiceDone' : 'done';
      emit();
    }
    function start() {
      if (s.phase !== 'ready') return;
      token += 1; beginTrial(); loop();
    }
    // 練習のあと「続ける」で本番へ
    function proceed() {
      if (s.phase !== 'practiceDone') return;
      Object.assign(s, { block: 'main', list: trials.main.slice(), index: 0, resolved: 0, total: trials.main.length });
      token += 1; beginTrial(); loop();
    }
    // 答え：answer＝'present'・'absent'、input＝'key'・'mouse'・'touch'・'pen'。キーの押しっぱなし（repeat）は無視する
    function respond({ answer, timeStamp, input, repeat = false }) {
      if (repeat) return;
      const at = typeof timeStamp === 'number' ? timeStamp : now();
      if (s.phase === 'fixation') { finish('early', null, input, at); return; }
      if (s.phase !== 'stimulus') return;
      // 図を見えるようにしたフレームの直後で、まだ表示の開始の時刻がないときは早すぎとして扱う
      if (s.t0 === null) { finish('early', at - s.shownAt, input, at); return; }
      const rt = at - s.t0;
      finish(Core.classify({ phase: 'stimulus', present: s.trial.present, answer, rt }), rt, input, at);
    }
    // ページが隠れたとき：その回を止めて数えず、ページに戻ったら「再開」で続ける
    function setHidden(hidden) {
      if (!hidden || !['fixation', 'stimulus', 'feedback', 'gap'].includes(s.phase)) return;
      token += 1;
      if (s.phase === 'fixation' || s.phase === 'stimulus') { record('hidden', null, null); s.hidden += 1; }
      Object.assign(s, { phase: 'paused', visible: false, feedback: { key: 'expHidden', values: {} } });
      emit();
    }
    function resume() {
      if (s.phase !== 'paused') return;
      s.feedback = null;
      token += 1;
      next();
      if (['fixation', 'stimulus', 'feedback', 'gap'].includes(s.phase)) loop();
    }
    // 中断（ボタンと Esc）。それまでの結果は残す
    function abort() {
      if (['done', 'aborted'].includes(s.phase)) return;
      token += 1;
      Object.assign(s, { phase: 'aborted', aborted: true, visible: false, feedback: { key: 'expAborted', values: {} } });
      emit();
    }
    // 本番の記録の集計（本番の記録が1つもなければ null）。練習の回は入れない
    function summary() {
      if (!s.records.length) return null;
      return Core.summarizeBlock(s.records, { aborted: s.aborted, granularity: s.granularity, set: s.set });
    }
    return { start, proceed, respond, setHidden, resume, abort, summary, state, seed };
  }

  return Object.freeze({ TIMING, createFind, createExperiment });
}));
