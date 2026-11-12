/* Vision Trap Atlas - MIT (c) 2026 ipusiron. */
// 計算部（UMD・依存なし・DOM非依存）。
// 乱数・ます目の配置・探す実験の試行と集計・結果の文の場合分け・誤読の比・図の形の計算（点・線・扇形・破線）を持つ。
// 乱数は種つきの xorshift32 だけを使う（同じ種なら同じ並びになり、テストで座標を確かめられる）。
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AtlasCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ===== 探す実験の決まり =====
  const SET_SIZES = Object.freeze([3, 6, 12, 18]);
  const EARLY_MS = 200;     // これより速い反応は早すぎとして数えない
  const TIMEOUT_MS = 4000;  // 表示の上限と集計の上限を同じ値にする
  const MAIN_REPS = 4;      // 本番の回数：段（図形の数）ごと・ある／ないごとに4回（4段×2×4＝32回）
  const PRACTICE_REPS = 1;  // 練習の回数：段ごと・ある／ないごとに1回（8回）
  // 中央値を出すのに要る有効な回の数。1つの条件は4回なので、押し間違いが1回あっても中央値が出るように3回にする
  const MIN_VALID = 3;
  const MIN_POINTS = 3;     // 傾きを出すのに要る段の数
  // 「ない」の傾きの差で文を選ぶ幅（ミリ秒／項目）。判定の境目ではない。4回の中央値から出した2つの傾きの差のぶれ（約15ミリ秒／項目
  // と見積もった）の1つ分にそろえる
  const CMP_STEP = 15;
  const ERROR_PERCENT = 10; // 押し間違いの文を出す割合（答えた回に対する%）
  const COARSE_MS = 5;      // 時刻の細かさの注記を出す値

  // ===== 小道具 =====
  const round1 = (x) => Math.round(x * 10) / 10;
  const round2 = (x) => Math.round(x * 100) / 100;
  const fixed = (x, digits = 2) => Number(x.toFixed(digits));

  // ===== 乱数 =====
  function xorshift32(seed) {
    let x = seed >>> 0 || 1;
    return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
  }
  function randInt(rng, n) { return Math.floor(rng() * n / 2 ** 32); }
  // 0 以上 1 未満
  function unit(rng) { return rng() / 2 ** 32; }
  // Fisher–Yates。元の配列は変えない
  function shuffle(array, rng) {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = randInt(rng, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ===== ます目の配置 =====
  // 一辺 size の正方形を cols×rows に分け、重ならないマスを n 個選ぶ。中心はマスの幅の ±jitter ずらす。
  // 返す順はマスを選んだ順（乱数の順）なので、先頭を探すものにしても位置は偏らない
  function gridLayout({ n, size, rng, cols = 6, rows = 6, jitter = 0.15 }) {
    if (!Number.isInteger(n) || n < 0 || n > cols * rows) throw new RangeError('n must be 0..' + cols * rows);
    const cw = size / cols, ch = size / rows;
    const cells = shuffle(Array.from({ length: cols * rows }, (_, i) => i), rng).slice(0, n);
    return cells.map((cell) => {
      const c = cell % cols, r = Math.floor(cell / cols);
      const dx = (unit(rng) * 2 - 1) * jitter * cw, dy = (unit(rng) * 2 - 1) * jitter * ch;
      return { cell, x: (c + 0.5) * cw + dx, y: (r + 0.5) * ch + dy };
    });
  }

  // ===== 探す実験の試行 =====
  // kind：target（探す棒）・same-dir（ほかの色〈塗り〉・同じ方向）・same-color（同じ色〈塗り〉・ほかの方向）
  function trialItems(search, setSize, present, rng, size) {
    const places = gridLayout({ n: setSize, size, rng });
    const others = present ? setSize - 1 : setSize;
    let kinds;
    if (search === 'feature') kinds = Array(others).fill('same-dir');
    else {
      const half = Math.floor(others / 2);
      kinds = [...Array(half).fill('same-dir'), ...Array(half).fill('same-color')];
      // ほかの棒の数が奇数のとき、余りの1本をどちらにするかは乱数で決める
      if (others % 2 === 1) kinds.push(randInt(rng, 2) === 0 ? 'same-dir' : 'same-color');
    }
    if (present) kinds.unshift('target');
    return places.map((p, i) => ({ cell: p.cell, x: p.x, y: p.y, kind: kinds[i] }));
  }

  // 1ブロック＝練習（各段×ある・ない×practiceReps）と本番（各段×ある・ない×reps）。回数を固定して乱数で混ぜる
  function makeSearchTrials({ search, set = 'color', setSizes = SET_SIZES, reps = MAIN_REPS, practiceReps = PRACTICE_REPS, rng, size = 360 }) {
    if (search !== 'feature' && search !== 'conjunction') throw new Error('unknown search ' + search);
    if (set !== 'color' && set !== 'fill') throw new Error('unknown set ' + set);
    const build = (k) => shuffle(setSizes.flatMap((setSize) => [true, false].flatMap((present) =>
      Array.from({ length: k }, () => ({ setSize, present })))), rng)
      .map((t) => ({ setSize: t.setSize, present: t.present, items: trialItems(search, t.setSize, t.present, rng, size) }));
    const practice = build(practiceReps);
    const main = build(reps);
    return { search, set, practice, main };
  }

  // 反応の分類。answer は 'present'・'absent'・null（答えなし）
  function classify({ phase, present, answer, rt }) {
    if (phase === 'fixation') return 'early';
    if (answer === null || answer === undefined || rt >= TIMEOUT_MS) return 'timeout';
    if (rt < EARLY_MS) return 'early';
    if ((answer === 'present') === present) return 'correct';
    return present ? 'miss' : 'falseAlarm';
  }

  // 早すぎた回とページが隠れた回を、ブロックの最後へ1回だけ回す（回した回はもう回さない）
  function requeue(trials, index) {
    const t = trials[index];
    if (!t || t.requeued) return trials.slice();
    return [...trials, { ...t, requeued: true }];
  }

  // ===== 集計 =====
  function median(values) {
    if (!values.length) return null;
    const a = values.slice().sort((x, y) => x - y), m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  // 最小二乗の直線。点が3つ未満なら null
  function fitLine(points) {
    if (points.length < MIN_POINTS) return null;
    const n = points.length;
    const mx = points.reduce((s, p) => s + p.x, 0) / n, my = points.reduce((s, p) => s + p.y, 0) / n;
    const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    if (sxx === 0) return null;
    const sxy = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
    const slope = sxy / sxx;
    return { slope, intercept: my - slope * mx };
  }
  const isValid = (r) => r.outcome === 'correct' && r.rt >= EARLY_MS && r.rt < TIMEOUT_MS;
  const isError = (r) => r.outcome === 'miss' || r.outcome === 'falseAlarm';

  // records＝本番の回の記録 { setSize, present, outcome, rt, input }。outcome が hidden の回（ページが隠れた）は数えない。
  // set＝測った特徴の組（color・fill。結果に書くため、そのまま持たせる）
  function summarizeBlock(records, { aborted = false, granularity = null, set = null } = {}) {
    const counted = records.filter((r) => r.outcome !== 'hidden');
    const rows = {};
    for (const present of [true, false]) {
      const cells = {};
      let correct = 0, errors = 0, early = 0, timeout = 0;
      for (const setSize of SET_SIZES) {
        const rs = counted.filter((r) => r.setSize === setSize && r.present === present);
        const rts = rs.filter(isValid).map((r) => r.rt);
        const cell = {
          n: rs.length, valid: rts.length, median: rts.length >= MIN_VALID ? median(rts) : null,
          correct: rs.filter((r) => r.outcome === 'correct').length, errors: rs.filter(isError).length,
          early: rs.filter((r) => r.outcome === 'early').length, timeout: rs.filter((r) => r.outcome === 'timeout').length,
        };
        cells[setSize] = cell;
        correct += cell.correct; errors += cell.errors; early += cell.early; timeout += cell.timeout;
      }
      const fit = fitLine(SET_SIZES.filter((n) => cells[n].median !== null).map((n) => ({ x: n, y: cells[n].median })));
      const answered = correct + errors;
      rows[present ? 'present' : 'absent'] = {
        cells, slope: fit ? fit.slope : null, intercept: fit ? fit.intercept : null,
        correct, errors, early, timeout, answered, accuracy: answered ? correct / answered : null, excluded: early + timeout + errors,
      };
    }
    // 比は表示と同じ丸め（小数1桁）のあとの傾きで計算する。「ある」の傾きが1ミリ秒／項目未満なら出さない
    let ratio = null, ratioState = null;
    if (rows.present.slope !== null && rows.absent.slope !== null) {
      const a = round1(rows.present.slope), b = round1(rows.absent.slope);
      if (a < 1) ratioState = 'below1';
      else { ratioState = 'ok'; ratio = round1(b / a); }
    }
    const inputs = new Set(counted.filter((r) => r.input).map((r) => (r.input === 'key' ? 'key' : 'pointer')));
    const errors = rows.present.errors + rows.absent.errors, answered = rows.present.answered + rows.absent.answered;
    return {
      rows, ratio, ratioState, errors, answered, mixedInput: inputs.size > 1, aborted: !!aborted, granularity, set,
      measured: counted.length,
    };
  }

  // 結果の文のキーと差し込む値（画面の表示の順）。数は表示と同じ丸めのあとの値で比べる。
  // results＝{ feature: summarizeBlock の結果か null, conjunction: 同じ }
  function resultCases(results) {
    const f = results.feature || null, c = results.conjunction || null;
    if (!f && !c) return [{ key: 'resNone', values: {} }];
    const out = [];
    const slopes = (b) => (b && b.rows.present.slope !== null && b.rows.absent.slope !== null
      ? { a: round1(b.rows.present.slope), b: round1(b.rows.absent.slope) } : null);
    // 文の頭（resBoth・resOne*）は、「ある」と「ない」の傾きがそろった探し方で選ぶ。両方を測っても、片方が途中で止まって
    // 傾きがそろわなければ、そろった側の resOne* を出す
    const fs = slopes(f), cs = slopes(c);
    if (fs && cs) out.push({ key: 'resBoth', values: { fa: fs.a, fb: fs.b, ca: cs.a, cb: cs.b } });
    else if (fs) out.push({ key: 'resOneFeature', values: { a: fs.a, b: fs.b } });
    else if (cs) out.push({ key: 'resOneConj', values: { a: cs.a, b: cs.b } });
    if (f && c && f.rows.absent.slope !== null && c.rows.absent.slope !== null) {
      const d = round1(round1(c.rows.absent.slope) - round1(f.rows.absent.slope));
      if (d >= CMP_STEP) out.push({ key: 'resCmpLarger', values: { d } });
      else if (d > -CMP_STEP) out.push({ key: 'resCmpSimilar', values: {} });
      else out.push({ key: 'resCmpSmaller', values: {} });
    }
    for (const [search, b] of [['feature', f], ['conjunction', c]]) {
      if (!b || b.ratioState === null) continue;
      if (b.ratioState === 'below1') { out.push({ key: 'resRatioNone', values: { search } }); continue; }
      const r = b.ratio;
      const key = r < 1 ? 'resRatioLow' : r < 2 ? 'resRatioMid' : r <= 3 ? 'resRatioTypical' : 'resRatioHigh';
      out.push({ key, values: { search, r } });
    }
    const all = [f, c].filter(Boolean);
    const anySlopeNegative = all.some((b) => ['present', 'absent'].some((k) => b.rows[k].slope !== null && round1(b.rows[k].slope) < 0));
    if (anySlopeNegative) out.push({ key: 'resNegative', values: {} });
    for (const [search, b] of [['feature', f], ['conjunction', c]]) {
      if (!b) continue;
      for (const k of ['present', 'absent']) if (b.rows[k].slope === null) out.push({ key: 'resNoSlope', values: { row: search + '.' + k } });
    }
    if (all.some((b) => b.aborted)) out.push({ key: 'resPartial', values: {} });
    if (all.some((b) => b.mixedInput)) out.push({ key: 'resMixed', values: {} });
    for (const [search, b] of [['feature', f], ['conjunction', c]]) {
      if (!b || !b.answered) continue;
      // 割合は丸める前の値で比べる（10.1%は文を出す）。文に出す{p}だけ整数に丸める
      const rate = b.errors * 100 / b.answered;
      if (rate > ERROR_PERCENT) out.push({ key: 'resErrors', values: { search, n: b.errors, p: Math.round(rate) } });
    }
    const grains = all.map((b) => b.granularity).filter((g) => typeof g === 'number' && Number.isFinite(g));
    if (grains.length) {
      const g = round1(Math.max(...grains));
      if (g >= COARSE_MS) out.push({ key: 'resCoarse', values: { g } });
    }
    out.push({ key: 'resDevice', values: {} }, { key: 'resLimits', values: {} });
    return out;
  }

  // 時刻の細かさ：now を続けて呼び、値が変わったときの差の最小（20回変わるか limitMs たつまで）。変わらなければ null
  function timerGranularity(now, limitMs = 50, maxCalls = 200000) {
    const start = now();
    let last = start, changes = 0, min = Infinity;
    for (let i = 0; i < maxCalls && changes < 20; i += 1) {
      const t = now();
      if (t !== last) {
        const d = t - last;
        if (d > 0 && d < min) min = d;
        last = t; changes += 1;
      }
      if (t - start >= limitMs) break;
    }
    return min === Infinity ? null : min;
  }

  // ===== 色 =====
  const hexRgb = (h) => {
    const m = /^#([0-9a-f]{6})$/i.exec(h);
    if (!m) throw new Error('bad color ' + h);
    return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  };
  // sRGB の値で線形に混ぜた色（小文字の #rrggbb）
  function mixHex(a, b, t) {
    const x = hexRgb(a), y = hexRgb(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  function relativeLuminance(h) {
    const [r, g, b] = hexRgb(h).map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  // WCAG の相対輝度の比
  function contrastRatio(a, b) {
    const x = relativeLuminance(a), y = relativeLuminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  // ===== 図の形 =====
  // 棒（長方形）の4つの角。angle は度で、0＝縦、90＝横
  function barCorners(cx, cy, length, thickness, angle) {
    const t = angle * Math.PI / 180;
    const ux = Math.sin(t), uy = -Math.cos(t), vx = Math.cos(t), vy = Math.sin(t);
    const hl = length / 2, ht = thickness / 2;
    return [[-hl, -ht], [hl, -ht], [hl, ht], [-hl, ht]].map(([a, b]) => [fixed(cx + ux * a + vx * b), fixed(cy + uy * a + vy * b)]);
  }
  const polygonPath = (points) => 'M' + points.map((p) => fixed(p[0]) + ' ' + fixed(p[1])).join(' L') + ' Z';
  const polylinePath = (points) => 'M' + points.map((p) => fixed(p[0]) + ' ' + fixed(p[1])).join(' L');

  // 6×6 の点。近さ（−2〜2）：横の間隔＝s×(1＋0.2×値)、縦の間隔＝s×(1−0.2×値)。似かた：none・rows・cols
  function proximityDots(prox, sim, s = 1) {
    if (![-2, -1, 0, 1, 2].includes(prox)) throw new RangeError('prox must be -2..2');
    if (!['none', 'rows', 'cols'].includes(sim)) throw new Error('unknown similarity ' + sim);
    const dx = s * (1 + 0.2 * prox), dy = s * (1 - 0.2 * prox);
    const dots = [];
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        const shape = sim === 'rows' ? (row % 2 ? 'square' : 'circle') : sim === 'cols' ? (col % 2 ? 'square' : 'circle') : 'circle';
        dots.push({ row, col, x: fixed((col - 2.5) * dx, 6), y: fixed((row - 2.5) * dy, 6), shape });
      }
    }
    return { dx: fixed(dx, 6), dy: fixed(dy, 6), dots };
  }

  // 輪郭を segments 個の区間に分け、各区間の終わりを gap（0〜1）の割合だけ欠く stroke-dasharray。途切れ0なら破線なし
  function dashForGap(perimeter, gap, segments = 8) {
    if (gap <= 0) return 'none';
    const l = perimeter / segments;
    return fixed(l * (1 - gap)) + ' ' + fixed(l * gap);
  }

  // 円を count 個の扇形に分け、1つおきに塗る。隣り合う2つ（合わせて 720/count 度）のうち、塗った扇形の角度＝合わせた角度×share
  function sectorPaths(share, count = 8) {
    if (count % 2 !== 0 || count < 2) throw new RangeError('count must be even');
    const pair = 720 / count, filled = fixed(pair * share, 6), empty = fixed(pair - pair * share, 6);
    const sectors = [];
    for (let i = 0; i < count / 2; i += 1) {
      const start = i * pair;
      sectors.push({ start: fixed(start, 6), end: fixed(start + filled, 6), filled: true });
      sectors.push({ start: fixed(start + filled, 6), end: fixed(start + pair, 6), filled: false });
    }
    return { filled, empty, sectors };
  }
  // 扇形の path。角度は度で、0＝上、時計回り
  function sectorPath(cx, cy, r, start, end) {
    const pt = (a) => { const t = a * Math.PI / 180; return [fixed(cx + r * Math.sin(t)), fixed(cy - r * Math.cos(t))]; };
    const [x0, y0] = pt(start), [x1, y1] = pt(end);
    const large = end - start > 180 ? 1 : 0;
    return `M${fixed(cx)} ${fixed(cy)} L${x0} ${y0} A${fixed(r)} ${fixed(r)} 0 ${large} 1 ${x1} ${y1} Z`;
  }

  // ===== 誤読の比 =====
  // 下端からの高さの比＝（最大−下端）÷（最小−下端）
  function baselineRatio(values, bottom) {
    const max = Math.max(...values), min = Math.min(...values);
    if (min <= bottom) throw new RangeError('bottom must be below every value');
    return (max - bottom) / (min - bottom);
  }
  // 絵の伸ばし方。height＝高さだけ、both＝縦横とも、area＝面積を値の比に合わせる
  function areaScales(v, mode) {
    if (mode === 'height') return { h: v, w: 1, a: v };
    if (mode === 'both') return { h: v, w: v, a: v * v };
    if (mode === 'area') return { h: Math.sqrt(v), w: Math.sqrt(v), a: v };
    throw new Error('unknown mode ' + mode);
  }
  // 2本の線が交わる回数：各月の値をそれぞれの軸で0〜1にした差の符号が、隣の月とのあいだで入れ替わる回数（差が0の月は数えない）
  function dualAxisCrossings(left, right, leftRange, rightRange) {
    const norm = (v, [lo, hi]) => (v - lo) / (hi - lo);
    const signs = left.map((v, i) => Math.sign(norm(v, leftRange) - norm(right[i], rightRange))).filter((s) => s !== 0);
    let n = 0;
    for (let i = 1; i < signs.length; i += 1) if (signs[i] !== signs[i - 1]) n += 1;
    return n;
  }
  // 最小と最大を10の倍数に広げた範囲
  function niceRange(values) {
    return [Math.floor(Math.min(...values) / 10) * 10, Math.ceil(Math.max(...values) / 10) * 10];
  }
  // 線分ごとの傾きの角度の絶対値の平均（度）。aspect＝描く面の幅÷高さ。縦軸は niceRange
  function meanAbsAngle(values, aspect) {
    const [lo, hi] = niceRange(values);
    const steps = values.length - 1;
    let sum = 0;
    for (let i = 1; i < values.length; i += 1) {
      const dy = Math.abs(values[i] - values[i - 1]) / (hi - lo), dx = aspect / steps;
      sum += Math.atan2(dy, dx) * 180 / Math.PI;
    }
    return sum / steps;
  }

  // ===== データの検査 =====
  const SIDES = ['show', 'hide', 'readable', 'read'];
  const MOTIONS = ['none', 'onPlay'];
  const CONTROL_TYPES = ['choice', 'range', 'toggle'];
  // 違反があれば例外。options.parts＝登録済みの図の部品の名前
  function validateData(data, options = {}) {
    const fail = (msg) => { throw new Error('invalid data: ' + msg); };
    const parts = options.parts ? new Set(options.parts) : null;
    const groups = new Set();
    for (const g of data.groups) {
      if (groups.has(g.id)) fail('duplicate group ' + g.id);
      groups.add(g.id);
    }
    const ids = new Set();
    for (const e of data.entries) {
      if (ids.has(e.id)) fail('duplicate entry ' + e.id);
      ids.add(e.id);
      if (!groups.has(e.group)) fail('unknown group ' + e.group + ' in ' + e.id);
      if (parts && e.figure && !parts.has(e.figure.part)) fail('unknown part ' + e.figure.part + ' in ' + e.id);
      const controls = new Map();
      for (const c of e.controls) {
        if (controls.has(c.id)) fail('duplicate control ' + c.id + ' in ' + e.id);
        if (!CONTROL_TYPES.includes(c.type)) fail('unknown control type ' + c.type + ' in ' + e.id);
        controls.set(c.id, c);
      }
      if (e.uses.length > 2) fail('too many uses in ' + e.id);
      for (const u of e.uses) {
        if (!SIDES.includes(u.side)) fail('unknown side ' + u.side + ' in ' + e.id);
        for (const p of [].concat(u.part)) if (parts && !parts.has(p)) fail('unknown part ' + p + ' in ' + e.id);
        for (const k of Object.keys(u.bind || {})) if (!controls.has(k)) fail('unknown control ' + k + ' in bind of ' + e.id);
        for (const k of Object.keys(u.bindWhen || {})) if (!controls.has(k)) fail('unknown control ' + k + ' in bindWhen of ' + e.id);
      }
      for (const s of e.sources) if (!Object.hasOwn(data.sources, s)) fail('unknown source ' + s + ' in ' + e.id);
      for (const r of e.related) if (!Object.hasOwn(data.relatedTools, r)) fail('unknown related tool ' + r + ' in ' + e.id);
      const sf = e.safety;
      if (!sf || sf.flashes !== false) fail('flashes must be false in ' + e.id);
      if (!MOTIONS.includes(sf.motion)) fail('unknown motion ' + sf.motion + ' in ' + e.id);
      if (!(sf.maxSeconds >= 0 && sf.maxSeconds <= 5)) fail('maxSeconds must be 0..5 in ' + e.id);
      if (sf.motion === 'onPlay' && !(sf.maxSeconds > 0)) fail('motion needs maxSeconds in ' + e.id);
      if (sf.stripes && !sf.noticeKey) fail('stripes need a notice in ' + e.id);
      if (sf.colorOnly && !sf.colorAlt) fail('colorOnly needs a switch in ' + e.id);
    }
    for (const [id, s] of Object.entries(data.sources)) if (!['A', 'B', 'C'].includes(s.level)) fail('bad level of ' + id);
    return true;
  }

  return Object.freeze({
    SET_SIZES, EARLY_MS, TIMEOUT_MS, MAIN_REPS, PRACTICE_REPS, MIN_VALID, MIN_POINTS, CMP_STEP, ERROR_PERCENT, COARSE_MS,
    round1, round2, xorshift32, randInt, unit, shuffle, gridLayout, makeSearchTrials, classify, requeue, median, fitLine,
    summarizeBlock, resultCases, timerGranularity, mixHex, relativeLuminance, contrastRatio, barCorners, polygonPath, polylinePath,
    proximityDots, dashForGap, sectorPaths, sectorPath, baselineRatio, areaScales, dualAxisCrossings, niceRange, meanAbsAngle,
    validateData,
  });
}));
