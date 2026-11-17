/* Vision Trap Atlas - MIT (c) 2026 ipusiron. */
// 見せ方の部品（DOM に依存しない）。図の部品は「設定と文言を受け取り、形の一覧を返す関数」で、app.js が SVG の要素にする。
// 形＝{ type: 'rect'|'circle'|'line'|'path'|'text'|'g', attrs, cls, children, text? }。色は書かず、クラス（fill-<名前>・stroke-<名前>）で付ける。
// 計算は AtlasCore を使い、文は messages.js の辞書（M＝{ ja, en }）を引数で受け取る。
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./atlas-core.js'));
  else root.AtlasView = factory(root.AtlasCore);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  // ===== 文の部品 =====
  function fill(template, values = {}) {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));
  }
  // 辞書。ない鍵を引いたら例外にする（書き間違いを見逃さないため）
  function dictionary(M, lang) {
    const D = M[lang];
    if (!D) throw new Error('unknown language ' + lang);
    return new Proxy(D, {
      get(target, key) {
        if (typeof key === 'string' && typeof target[key] !== 'string') throw new Error('missing message ' + key);
        return target[key];
      },
    });
  }
  // 画面に出す数：負の数は半角のハイフンではなくマイナス記号（U+2212）で書く。計算の値は変えない
  const numberText = (x) => String(x).replace(/^-/, '\u2212');
  const f1 = (x) => numberText(Core.round1(x).toFixed(1));
  const f2 = (x) => numberText(Core.round2(x).toFixed(2));

  // ===== 形の部品 =====
  const r2 = (x) => Math.round(x * 100) / 100;
  // 百冊単位の値を、桁区切りの冊数にする（40→4,000）。数字は日英で同じで、単位（冊・books）は文の側に書く。図の縦軸は百冊のまま
  const books = (v) => String(v * 100).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  function el(type, attrs, cls = '') {
    const a = {};
    for (const [k, v] of Object.entries(attrs)) a[k] = typeof v === 'number' ? r2(v) : v;
    return { type, attrs: a, cls, children: [] };
  }
  const rect = (x, y, width, height, cls, more = {}) => el('rect', { x, y, width, height, ...more }, cls);
  const circle = (cx, cy, r, cls) => el('circle', { cx, cy, r }, cls);
  const line = (x1, y1, x2, y2, cls) => el('line', { x1, y1, x2, y2 }, cls);
  const path = (d, cls, more = {}) => el('path', { d, ...more }, cls);
  const text = (x, y, s, cls) => ({ ...el('text', { x, y }, cls), text: String(s) });
  const group = (children, attrs = {}, cls = '') => ({ ...el('g', attrs, cls), children });
  const pts = (list) => Core.polylinePath(list);

  // ===== 決まった大きさ（viewBox） =====
  const SQ = 360, CELL = SQ / 6;       // 1-1・1-2・探す実験（正方形、6×6のます目）
  const W = 320, H = 240;              // ほかの上の図（4:3）
  const SW = 200, SH = 150;            // 小さな図（4:3）
  const AW = 280, AH = 220;            // 縦横の比の図（枠は固定し、中の描く面だけを変える）
  // 縦横の比の図の描く面の最大（幅×高さ）と置く範囲。比が ASPECT_EDGE（＝最大の幅÷高さ＝1.3）以上なら幅を、未満なら高さを最大にする。
  // 上に題と縦軸の題、左に縦軸の目盛り、下に横軸の目盛りを置くため、枠より小さくする
  const AMAXW = 182, AMAXH = 140, ASPECT_EDGE = AMAXW / AMAXH, AX0 = 56, AY0 = 48;

  // ===== 1-1・1-2 の配置（「探して押す」もこの配置を使う） =====
  const DIFF = ['same', 'small', 'medium', 'large'];
  const VARIETY = ['uniform', 'some', 'mixed'];
  const ANGLES = [0, 20, 45, 90];          // 方向の違い（度）
  const SCALES = [1, 1.25, 1.5, 2];        // 大きさの違い（倍）
  const JIT_ANGLE = [0, 10, 20];           // ほかの図形の方向のゆれ（±度）
  const JIT_SCALE = [0, 0.1, 0.2];         // ほかの図形の大きさのゆれ（±）
  const BAR = { length: 30, thickness: 9.6 }; // 棒（マスの50%×16%）
  const BAR_SIZE = { length: 20, thickness: 6 }; // 大きさを比べるときの基準の棒（2倍でもマスからはみ出さない）

  // 探すものは先頭（gridLayout が選んだマスの順は乱数なので、位置は偏らない）
  function popoutLayout(s) {
    const kind = s.kind || 'color', shape = s.shape || 'circleSquare', count = s.count || 18;
    const d = DIFF.indexOf(s.diff || 'large'), v = VARIETY.indexOf(s.variety || 'uniform');
    if (d < 0 || v < 0) throw new Error('unknown step');
    const rng = Core.xorshift32(s.seed);
    const places = Core.gridLayout({ n: count, size: SQ, rng });
    const items = places.map((p, i) => {
      const target = i === 0;
      const it = { cell: p.cell, x: p.x, y: p.y, target, angle: 0, scale: 1, form: 'bar', rot: 0, cls: 'fill-popColor-0' };
      if (kind === 'color') it.cls = target ? `fill-popColor-${d}` : `fill-popOthers-${Core.randInt(rng, v + 1)}`;
      if (kind === 'lightness') it.cls = target ? `fill-popLight-${d}` : `fill-popLightOthers-${Core.randInt(rng, v + 1)}`;
      if (kind === 'direction') {
        // ほかの図形のゆれは、探すものとの差が「違いの大きさ」の半分を下回らない範囲に収める
        const j = (Core.unit(rng) * 2 - 1) * JIT_ANGLE[v];
        it.angle = target ? ANGLES[d] : (d > 0 ? Math.min(j, ANGLES[d] / 2) : j);
      }
      if (kind === 'size') it.scale = target ? SCALES[d] : 1 + (Core.unit(rng) * 2 - 1) * JIT_SCALE[v];
      if (kind === 'shape') {
        it.form = shape === 'tl' ? (target ? 'T' : 'L') : (target ? 'circle' : 'square');
        if (shape === 'tl' && !target) it.rot = Core.randInt(rng, 4) * 90;
      }
      return it;
    });
    return { kind, items, target: items.length ? items[0].cell : null };
  }
  function asymLayout(s) {
    const withLine = (s.target || 'withLine') === 'withLine';
    const places = Core.gridLayout({ n: s.count || 18, size: SQ, rng: Core.xorshift32(s.seed) });
    const items = places.map((p, i) => ({ cell: p.cell, x: p.x, y: p.y, target: i === 0, line: i === 0 ? withLine : !withLine }));
    return { items, target: items.length ? items[0].cell : null };
  }
  // 「探して押す」の配置（項目の id ごと）
  function findLayout(entryId, settings) {
    if (entryId === 'popout-feature') return popoutLayout(settings);
    if (entryId === 'popout-asymmetry') return asymLayout(settings);
    throw new Error('no find layout for ' + entryId);
  }
  const cellCenter = (cell) => [(cell % 6 + 0.5) * CELL, (Math.floor(cell / 6) + 0.5) * CELL];

  // 局所の座標の多角形を回して置く
  function placed(polys, cx, cy, deg) {
    const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    return polys.map((poly) => Core.polygonPath(poly.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]))).join(' ');
  }
  const T_SHAPE = [[[-12, -12], [12, -12], [12, -6], [-12, -6]], [[-3, -6], [3, -6], [3, 12], [-3, 12]]];
  const L_SHAPE = [[[-12, -12], [-6, -12], [-6, 12], [-12, 12]], [[-6, 6], [12, 6], [12, 12], [-6, 12]]];

  function popoutShape(it, kind) {
    if (it.form === 'circle') return circle(it.x, it.y, 12, it.cls);
    if (it.form === 'square') return rect(it.x - 11, it.y - 11, 22, 22, it.cls);
    if (it.form === 'T' || it.form === 'L') return path(placed(it.form === 'T' ? T_SHAPE : L_SHAPE, it.x, it.y, it.rot), it.cls);
    const b = kind === 'size' ? BAR_SIZE : BAR;
    return path(Core.polygonPath(Core.barCorners(it.x, it.y, b.length * it.scale, b.thickness * it.scale, it.angle)), it.cls);
  }

  // ===== 動き（popout-motion）：押したときだけ動く。3つの図を同じ時計（AtlasSearch.createMotion）で動かす =====
  // pose＝{ u: 進んだ往復の数, env: 振れ幅に掛ける0〜1, prev: 前のコマの u（コマ送りのときだけ。ほかは null） }。
  // 止まっている間は u＝0・env＝0（どの物も元の位置）。動いている間は、動き始めと止まる前の ramp 秒で env を0から1へ、1から0へ変えるので、
  // 3秒で止まったときはどの物も元の位置に戻っている。コマ送りは u＝コマ÷4・env＝1（1往復を4コマで：右・元・左・元）
  const MOTION = Object.freeze({
    period: 1.5, ramp: 0.25, frames: 4,
    steps: Object.freeze(['none', 'small', 'medium', 'large']),
    grid: Object.freeze([0, 6, 12, 18]),     // 上の図：片側の振れ幅（viewBox 360 の単位。丸の半径は12、隣の丸との間は36）
    line: Object.freeze([0, 0.25, 0.5, 1]),  // 見せる側：印が終わりの点から最後の区間を戻る割合
    camo: Object.freeze([0, 3, 6, 10]),      // 隠す側：物の片側の振れ幅（viewBox 200 の単位）
    others: 2,                               // 「ばらばらに動く」のほかの物の段（中）
  });
  const REST = Object.freeze({ u: 0, env: 0, prev: null });
  function motionPose(state, seconds) {
    if (!state || state.phase === 'idle') return REST;
    if (state.phase === 'frames') return { u: state.frame / MOTION.frames, env: 1, prev: (state.frame - 1) / MOTION.frames };
    const t = state.t;
    return { u: t / MOTION.period, env: Math.max(0, Math.min(1, t / MOTION.ramp, (seconds - t) / MOTION.ramp)), prev: null };
  }
  // 往復する物のずれ：方向 dir（ラジアン）に、振れ幅 amp × sin(2π(u＋位相)) × env
  function swing(item, u, env) {
    const k = env * item.amp * Math.sin(2 * Math.PI * (u + item.phase));
    return [k * Math.cos(item.dir), k * Math.sin(item.dir)];
  }
  function motionStep(amount) {
    const i = MOTION.steps.indexOf(amount || 'none');
    if (i < 0) throw new Error('unknown motion step ' + amount);
    return i;
  }

  // ===== 図の部品 =====
  const PARTS = {};
  const register = (name, fn) => { PARTS[name] = fn; };

  // 1-1：6×6 のます目に図形 N 個。1つだけ違う
  register('popoutGrid', (s) => {
    const lay = popoutLayout(s);
    return { width: SQ, height: SQ, shapes: lay.items.map((it) => popoutShape(it, lay.kind)) };
  });

  // 1-2：線のある丸と線のない丸
  register('asymGrid', (s) => {
    const lay = asymLayout(s), r = 12, shapes = [];
    for (const it of lay.items) {
      shapes.push(circle(it.x, it.y, r, 'fig-outline'));
      if (it.line) shapes.push(line(it.x, it.y + 0.3 * r, it.x, it.y + 1.6 * r, 'fig-stroke'));
    }
    return { width: SQ, height: SQ, shapes };
  });

  // 動きの項目：6×6 のます目の同じ丸。1つ（種で決めたマス）だけが左右に往復する。「ばらばらに動く」では、ほかの丸がそれぞれの方向と位相で
  // 「中」の振れ幅で動く。丸の色はどの時刻でも同じ（明るさを変えない）。コマ送りでは、前のコマの位置に、動く丸と同じ大きさの破線の輪（動きの跡）を
  // 丸の上に重ねる（色でなく線の形で見せる。丸が少ししか動かない「小」でも輪の全体が見える）
  register('motionGrid', (s) => {
    const rng = Core.xorshift32(s.seed || 1), target = Core.randInt(rng, 36), pose = s.pose || REST;
    const a = motionStep(s.amount), random = s.others === 'random', trails = [], circles = [];
    for (let cell = 0; cell < 36; cell += 1) {
      const [x, y] = cellCenter(cell), dir = Core.unit(rng) * 2 * Math.PI, phase = Core.unit(rng);
      const item = cell === target ? { dir: 0, phase: 0, amp: MOTION.grid[a] } : { dir, phase, amp: random ? MOTION.grid[MOTION.others] : 0 };
      if (pose.prev !== null && item.amp > 0) {
        const [px, py] = swing(item, pose.prev, 1);
        trails.push(circle(x + px, y + py, 12, 'fig-trail'));
      }
      const [dx, dy] = swing(item, pose.u, pose.env);
      circles.push(circle(x + dx, y + dy, 12, 'fill-stimCool'));
    }
    return { width: SQ, height: SQ, shapes: [...circles, ...trails] };
  });

  // 「探して押す」の印：押した図形＝太い丸の線、探すもの＝角の丸い四角の二重線（形で見分ける）
  function markShapes({ pressed = null, target = null }) {
    const shapes = [];
    if (pressed !== null) { const [x, y] = cellCenter(pressed); shapes.push(circle(x, y, 26, 'mark-pressed')); }
    if (target !== null) {
      const [x, y] = cellCenter(target);
      shapes.push(rect(x - 27, y - 27, 54, 54, 'mark-target', { rx: 10 }), rect(x - 22, y - 22, 44, 44, 'mark-target', { rx: 7 }));
    }
    return shapes;
  }

  // 探す実験の図：棒（長さはマスの60%、太さは16%）。縦＝0度、横＝90度。色と塗りはクラス
  const STIM = { length: 0.6 * CELL, thickness: 0.16 * CELL };
  function stimClass(kind, set) {
    if (set === 'fill') return kind === 'same-dir' ? 'stim-outline' : 'stim-solid';
    return kind === 'same-dir' ? 'fill-stimCool' : 'fill-stimHot';
  }
  register('searchDisplay', (s) => ({
    width: SQ, height: SQ,
    shapes: (s.items || []).map((it) => path(Core.polygonPath(Core.barCorners(it.x, it.y, STIM.length, STIM.thickness,
      it.kind === 'same-color' ? 90 : 0)), stimClass(it.kind, s.set || 'color'))),
  }));
  function fixationShapes() {
    const c = SQ / 2;
    return [line(c - 12, c, c + 12, c, 'fixation'), line(c, c - 12, c, c + 12, 'fixation')];
  }
  // 見本の棒（「探す棒：［見本］」「ほかの棒：［見本］」）
  function sampleShapes(kind, set) {
    return { width: 40, height: 40, shapes: [path(Core.polygonPath(Core.barCorners(20, 20, 30, 8, kind === 'same-color' ? 90 : 0)), stimClass(kind, set))] };
  }

  // 2-1：6×6 の点
  register('proximityGrid', (s) => {
    const g = Core.proximityDots(s.prox ?? 0, s.sim || 'none', 28);
    return {
      width: W, height: H,
      shapes: g.dots.map((p) => (p.shape === 'square' ? rect(W / 2 + p.x - 5.5, H / 2 + p.y - 5.5, 11, 11, 'fig-dot')
        : circle(W / 2 + p.x, H / 2 + p.y, 6, 'fig-dot'))),
    };
  });

  // 2-2：近さで2つずつの組に見える8点。隣の組どうし（2と3、6と7の点）を枠で囲むか、線でつなぐ
  const REGION_X = (() => { const xs = []; let x = 28; for (let i = 0; i < 8; i += 1) { xs.push(x); x += i % 2 === 0 ? 24 : 56; } return xs; })();
  register('regionDots', (s) => {
    const link = s.link || 'none', y = H / 2, shapes = [];
    for (const [a, b] of [[1, 2], [5, 6]]) {
      if (link === 'frame') shapes.push(rect(REGION_X[a] - 16, y - 18, REGION_X[b] - REGION_X[a] + 32, 36, 'fig-frame', { rx: 18 }));
      if (link === 'line') shapes.push(line(REGION_X[a], y, REGION_X[b], y, 'fig-link'));
    }
    for (const x of REGION_X) shapes.push(circle(x, y, 7, 'fig-dot'));
    return { width: W, height: H, shapes };
  });

  // 2-3：輪郭が途切れた丸と四角、交わる2本の線。2本は色と両端の印（A＝丸、B＝四角）で分け、どの端どうしが1本の線かを見せる
  // （同じ見た目で描くと、交わる所で折れる2本は、まっすぐ交わる2本と同じ絵になってしまう）
  const CROSS = {
    smooth: [[[30, 165], [290, 225]], [[30, 225], [290, 165]]],
    corner: [[[30, 165], [160, 195], [290, 165]], [[30, 225], [160, 195], [290, 225]]],
  };
  register('contour', (s) => {
    const gap = s.gap || 0, r = 50, side = 100;
    const cDash = Core.dashForGap(2 * Math.PI * r, gap), sDash = Core.dashForGap(4 * side, gap);
    const dash = (d) => (d === 'none' ? {} : { 'stroke-dasharray': d });
    const [a, b] = CROSS[s.crossing || 'smooth'];
    const ends = (p) => [p[0], p[p.length - 1]];
    return {
      width: W, height: H,
      shapes: [
        el('circle', { cx: 85, cy: 85, r, ...dash(cDash) }, 'fig-stroke fig-nofill'),
        rect(175, 35, side, side, 'fig-stroke fig-nofill', dash(sDash)),
        path(pts(a), 'stroke-seriesTarget fig-series fig-cross'), path(pts(b), 'stroke-seriesOthers-0 fig-series fig-cross'),
        ...ends(a).map(([x, y]) => circle(x, y, 6, 'fill-seriesTarget')),
        ...ends(b).map(([x, y]) => rect(x - 5.5, y - 5.5, 11, 11, 'fill-seriesOthers-0')),
      ],
    };
  });

  // 3-1：円を8つの扇形に分け、1つおきに色の濃い扇形と薄い扇形にする（share＝色の濃い扇形の割合）
  register('sectors', (s) => {
    const sp = Core.sectorPaths(s.share ?? 0.5, 8);
    return {
      width: W, height: H,
      shapes: [
        ...sp.sectors.map((q) => path(Core.sectorPath(W / 2, H / 2, 100, q.start, q.end), q.filled ? 'fill-areaDark' : 'fill-areaLight')),
        circle(W / 2, H / 2, 100, 'fig-stroke fig-nofill'),
      ],
    };
  });

  // 3-2：縦の境目で区切った帯。1つおきの領域が手がかり（左右対称・外にふくらむ）を持つ
  register('symmetryBands', (s) => {
    const cue = s.cue || 'none', n = s.regions || 8, swap = !!s.swap;
    const x0 = 20, x1 = 300, y0 = 20, y1 = 220, w = (x1 - x0) / n, amp = Math.min(0.22 * w, 18), steps = 24;
    const isCue = (i) => (i % 2 === 0) !== swap;
    // 境目 k（1〜n−1）の横のずれ（t＝0〜1、上から下）
    const profile = (i, t) => (i % 4 < 2 ? Math.sin(3 * Math.PI * t) : Math.sin(5 * Math.PI * t)) * 0.6 * amp; // 対称の領域ごとの輪郭
    function border(k, t) {
      const left = k - 1, right = k; // 境目の左右の領域
      if (cue === 'none') return 0.6 * amp * Math.sin(2 * Math.PI * t);
      if (cue === 'convex') return (isCue(left) ? 1 : -1) * amp * Math.sin(Math.PI * t);
      // 対称：手がかりを持つ領域は、左右の境目を鏡に映した形にする
      return isCue(left) ? profile(left, t) : -profile(right, t);
    }
    // 端の領域の外側の辺：対称の手がかりを持つときだけ、内側の境目を鏡に映す
    function edge(i, side, t) {
      if (cue !== 'symmetric' || !isCue(i)) return 0;
      return side === 'left' ? -profile(i, t) : profile(i, t);
    }
    const xAt = (k, t, i, side) => {
      const base = x0 + k * w;
      if (k === 0) return base + edge(i, 'left', t);
      if (k === n) return base + edge(i, 'right', t);
      return base + border(k, t);
    };
    const shapes = [];
    for (let i = 0; i < n; i += 1) {
      const leftPts = [], rightPts = [];
      for (let j = 0; j <= steps; j += 1) {
        const t = j / steps, y = y0 + (y1 - y0) * t;
        leftPts.push([xAt(i, t, i, 'left'), y]);
        rightPts.push([xAt(i + 1, t, i, 'right'), y]);
      }
      shapes.push(path(Core.polygonPath([...leftPts, ...rightPts.reverse()]), i % 2 === 0 ? 'fill-regionA' : 'fill-regionB'));
    }
    return { width: W, height: H, shapes };
  });

  // ===== 誤読の上の図 =====
  // 4-1：縦軸の始まり。縦軸の上端は60、下端はつまみ。横軸の目盛りが「4月・5月・6月」なので、横軸の題は置かない。
  // values＝3本の値（百冊。上端60以下で下端より大きい。渡さなければ架空の図書館の貸出冊数）。titleKey＝図の題のキー（値の名前と単位を題に
  // 書くので、縦軸の題は置かない。渡さなければ架空の図書館の貸出冊数の題と縦軸の題）
  register('baselineChart', (s, ctx) => {
    const t = ctx.t, values = s.values || ctx.data.datasets.libraryLoans3, bottom = s.bottom || 0, top = 60;
    const x0 = 64, x1 = 304, y0 = 44, y1 = 196, slot = (x1 - x0) / values.length;
    const yv = (v) => y1 - (v - bottom) / (top - bottom) * (y1 - y0);
    const shapes = [text(W / 2, 18, t(s.titleKey || 'fig.misread-baseline.main.title'), 'fig-title ta-middle')];
    if (!s.titleKey) shapes.push(text(8, 34, t('fig.misread-baseline.main.axisY'), 'fig-axisname ta-start'));
    // The ticks: the bottom, then every 5 when the axis spans 20 or less (45・50・55・60), else every 10 (35・40・50・60)
    const step = top - bottom <= 20 ? 5 : 10, ticks = [bottom];
    for (let v = Math.floor(bottom / step) * step + step; v <= top; v += step) ticks.push(v);
    for (const v of ticks) shapes.push(line(x0 - 4, yv(v), x0, yv(v), 'fig-axis'), text(x0 - 7, yv(v) + 4, v, 'fig-tick ta-end'));
    shapes.push(line(x0, y0, x0, y1, 'fig-axis'), line(x0, y1, x1, y1, 'fig-axis'));
    const cx = values.map((_, i) => x0 + slot * (i + 0.5));
    if ((s.chart || 'bar') === 'line') {
      shapes.push(path(pts(values.map((v, i) => [cx[i], yv(v)])), 'stroke-seriesTarget fig-series'));
      values.forEach((v, i) => shapes.push(circle(cx[i], yv(v), 4, 'fill-seriesTarget')));
    } else values.forEach((v, i) => shapes.push(rect(cx[i] - 22, yv(v), 44, y1 - yv(v), 'fill-seriesTarget')));
    values.forEach((_, i) => shapes.push(text(cx[i], y1 + 16, t('month' + (4 + i)), 'fig-tick ta-middle')));
    if (bottom > 0 && s.mark === 'shown') {
      shapes.push(path(`M${x0 - 7} ${y1 - 10} L${x0 + 7} ${y1 - 16} M${x0 - 7} ${y1 - 4} L${x0 + 7} ${y1 - 10}`, 'fig-break'));
    }
    return { width: W, height: H, shapes };
  });

  // 4-2：本の形の絵2つ。左は値1、右は値の比 v を伸ばし方に合わせて描く
  register('areaPictures', (s, ctx) => {
    const v = s.ratio || 1, sc = Core.areaScales(v, s.stretch || 'both'), base = 214, w0 = 34, h0 = 46;
    const book = (x, w, h) => [rect(x, base - h, w, h, 'fill-seriesTarget'), line(x + 6, base - h, x + 6, base, 'fig-spine')];
    const wB = w0 * sc.w, hB = h0 * sc.h;
    return {
      width: W, height: H,
      shapes: [
        text(W / 2, 18, ctx.t('fig.misread-area.main.title'), 'fig-title ta-middle'),
        ...book(60, w0, h0), ...book(130, wB, hB),
        line(40, base, 290, base, 'fig-axis'),
        text(60 + w0 / 2, 231, '1', 'fig-tick ta-middle'), text(130 + wB / 2, 231, String(v), 'fig-tick ta-middle'),
      ],
    };
  });

  // 4-3：2つの縦軸。左は気温0〜30℃、右は雨の量0〜上端mm
  register('dualAxisChart', (s, ctx) => {
    const t = ctx.t, temp = ctx.data.datasets.townTemp, rain = ctx.data.datasets.townRain, top = s.rightTop || 200;
    const x0 = 52, x1 = 268, y0 = 40, y1 = 196, step = (x1 - x0) / 12;
    const xm = (i) => x0 + step * (i + 0.5), yl = (v) => y1 - v / 30 * (y1 - y0), yr = (v) => y1 - v / top * (y1 - y0);
    const shapes = [
      text(W / 2, 14, t('fig.misread-dual-axis.main.title'), 'fig-title ta-middle'),
      circle(10, 26, 3, 'fill-seriesTarget'), text(18, 30, t('fig.misread-dual-axis.main.axisY'), 'fig-axisname ta-start'),
      rect(303, 23, 6, 6, 'fill-seriesOthers-0'), text(299, 30, t('fig.misread-dual-axis.main.axisY2'), 'fig-axisname ta-end'),
      text(W / 2, 232, t('fig.misread-dual-axis.main.axisX'), 'fig-axisname ta-middle'),
      line(x0, y0, x0, y1, 'fig-axis'), line(x1, y0, x1, y1, 'fig-axis'), line(x0, y1, x1, y1, 'fig-axis'),
    ];
    for (const v of [0, 10, 20, 30]) shapes.push(line(x0 - 4, yl(v), x0, yl(v), 'fig-axis'), text(x0 - 7, yl(v) + 4, v, 'fig-tick ta-end'));
    for (const v of [0, top / 2, top]) shapes.push(line(x1, yr(v), x1 + 4, yr(v), 'fig-axis'), text(x1 + 7, yr(v) + 4, v, 'fig-tick ta-start'));
    for (let i = 0; i < 12; i += 2) shapes.push(text(xm(i), y1 + 15, i + 1, 'fig-tick ta-middle'));
    shapes.push(path(pts(temp.map((v, i) => [xm(i), yl(v)])), 'stroke-seriesTarget fig-series'));
    temp.forEach((v, i) => shapes.push(circle(xm(i), yl(v), 3, 'fill-seriesTarget')));
    shapes.push(path(pts(rain.map((v, i) => [xm(i), yr(v)])), 'stroke-seriesOthers-0 fig-series line-dashed'));
    rain.forEach((v, i) => shapes.push(rect(xm(i) - 3, yr(v) - 3, 6, 6, 'fill-seriesOthers-0')));
    return { width: W, height: H, shapes };
  });

  // 4-4：縦横の比と期間。枠（viewBox 280×220）は変えず、中の描く面だけを変える。描く面は置く範囲（AX0・AY0から最大の幅×高さ）の
  // 中央に置く。線の傾きの角度は、描く面の幅÷高さ（＝比）とデータだけで決まる
  function aspectPlot(aspect) {
    const pw = aspect >= ASPECT_EDGE ? AMAXW : AMAXH * aspect, ph = aspect >= ASPECT_EDGE ? AMAXW / aspect : AMAXH;
    return { px: AX0 + (AMAXW - pw) / 2, py: AY0 + (AMAXH - ph) / 2, pw, ph };
  }
  register('aspectChart', (s, ctx) => {
    const t = ctx.t, all = ctx.data.datasets.libraryLoans24, last6 = (s.range || 'all') === 'last6', values = last6 ? all.slice(-6) : all;
    const { px, py, pw, ph } = aspectPlot(s.aspect || 1), [lo, hi] = Core.niceRange(values);
    const p = values.map((v, i) => [px + i / (values.length - 1) * pw, py + ph - (v - lo) / (hi - lo) * ph]);
    const first = last6 ? all.length - 5 : 1, month = (n) => fill(t('fig.misread-aspect-range.main.month'), { n: String(n) });
    return {
      width: AW, height: AH,
      shapes: [
        line(px, py, px, py + ph, 'fig-axis'), line(px, py + ph, px + pw, py + ph, 'fig-axis'), path(pts(p), 'stroke-seriesTarget fig-series'),
        text(AW / 2, 16, t('fig.misread-aspect-range.main.title'), 'fig-title ta-middle'),
        // 縦軸の題は描く面の上に置き、縦軸の目盛りは下端と上端だけを冊・桁区切りで書く
        text(px - 33, py - 14, t('fig.misread-aspect-range.main.axisY'), 'fig-axisname ta-start'),
        line(px - 3, py, px, py, 'fig-axis'), line(px - 3, py + ph, px, py + ph, 'fig-axis'),
        text(px - 6, py + 4, books(hi), 'fig-tick ta-end'), text(px - 6, py + ph + 4, books(lo), 'fig-tick ta-end'),
        // 横軸の最初と最後の月（縦軸の下端の目盛りと重ならないよう、少し下げる）
        line(px, py + ph, px, py + ph + 3, 'fig-axis'), line(px + pw, py + ph, px + pw, py + ph + 3, 'fig-axis'),
        text(px, py + ph + 21, month(first), 'fig-tick ta-middle'), text(px + pw, py + ph + 21, month(all.length), 'fig-tick ta-middle'),
      ],
    };
  });

  // ===== 目の錯覚の上の図 =====
  // 明るさの対比の項目：同じ灰色の四角2つ。左の四角は暗くなる周り、右の四角は明るくなる周りの上（周りの明るさの差の段＝lightLeft・lightRight の添字）。
  // 「帯でつなぐ」では、四角と同じ灰色の帯で2つをつなぐ。四角と帯の灰色はどの段でも同じ
  const LIGHT_STEPS = [0, 0.25, 0.5, 0.75, 1];
  register('lightnessSquares', (s) => {
    const k = LIGHT_STEPS.indexOf(s.diff ?? 0);
    if (k < 0) throw new Error('unknown step ' + s.diff);
    const shapes = [rect(10, 20, 150, 200, `fill-lightLeft-${k}`), rect(160, 20, 150, 200, `fill-lightRight-${k}`)];
    if (s.compare === 'band') shapes.push(rect(113, 112, 94, 16, 'fill-lightGray'));
    shapes.push(rect(57, 92, 56, 56, 'fill-lightGray'), rect(207, 92, 56, 56, 'fill-lightGray'));
    return { width: W, height: H, shapes };
  });

  // ===== 小さな図（見せる側・読みやすい形） =====
  const FRAME = () => rect(0.5, 0.5, SW - 1, SH - 1, 'fig-frame-small fig-nofill');

  // 棒グラフ。mode＝popout（1-1）・share（3-1）・baseline（4-1の読みやすい形）・pair（4-2の読みやすい形）。
  // popout の values＝8本の高さ（0〜100。渡さなければ popBars。強調する棒は popHighlight の添字のまま）。others＝強調しない棒の色の名前を
  // 左から順に（渡さなければ popOthers を周りのばらつきの数だけ順に使う）
  register('barChart', (s, ctx) => {
    const ds = ctx.data.datasets, mode = s.mode || 'popout', base = 140, scaleY = 1.2, shapes = [];
    if (mode === 'popout') {
      const values = s.values || ds.popBars, hi = ds.popHighlight, slot = 180 / values.length;
      const kind = s.popKind || 'color', d = DIFF.indexOf(s.popDiff || 'large'), v = VARIETY.indexOf(s.popVariety || 'uniform');
      const rng = Core.xorshift32(s.seed || 1);
      const other = (i) => (s.others ? `fill-${s.others[i < hi ? i : i - 1]}` : `fill-popOthers-${i % (v + 1)}`);
      values.forEach((val, i) => {
        let width = 10, cls = 'fill-popColor-0';
        if (kind === 'color') cls = i === hi ? `fill-popColor-${d}` : other(i);
        if (kind === 'lightness') cls = i === hi ? `fill-popLight-${d}` : `fill-popLightOthers-${i % (v + 1)}`;
        if (kind === 'size') width = i === hi ? 10 * SCALES[d] : 10 * (1 + (Core.unit(rng) * 2 - 1) * JIT_SCALE[v]);
        const cx = 10 + slot * (i + 0.5);
        shapes.push(rect(cx - width / 2, base - val * scaleY, width, val * scaleY, cls));
      });
      shapes.push(line(8, base, 192, base, 'fig-axis'));
    } else if (mode === 'share') {
      // 棒は上の図の色の濃い扇形と同じ色、背景は薄い扇形と同じ色。棒の幅の割合＝色の濃い扇形の割合
      const values = ds.shareBars, slot = 180 / values.length, share = s.share ?? 0.5;
      shapes.push(rect(10, 10, 180, base - 10, 'fill-areaLight'));
      values.forEach((val, i) => {
        const width = slot * share, cx = 10 + slot * (i + 0.5);
        shapes.push(rect(cx - width / 2, base - val * scaleY, width, val * scaleY, 'fill-areaDark'));
      });
      shapes.push(line(10, base, 190, base, 'fig-axis'));
    } else if (mode === 'baseline') {
      const values = ds.libraryLoans3, slot = 150 / values.length, k = 120 / 60;
      values.forEach((val, i) => { const cx = 40 + slot * (i + 0.5); shapes.push(rect(cx - 16, base - val * k, 32, val * k, 'fill-seriesTarget')); });
      shapes.push(line(40, 20, 40, base, 'fig-axis'), line(40, base, 190, base, 'fig-axis'));
    } else if (mode === 'pair') {
      const ratio = s.ratio || 1, k = 120 / 4;
      shapes.push(rect(60, base - k, 30, k, 'fill-seriesTarget'), rect(110, base - ratio * k, 30, ratio * k, 'fill-seriesTarget'));
      shapes.push(line(40, 20, 40, base, 'fig-axis'), line(40, base, 170, base, 'fig-axis'));
    } else throw new Error('unknown barChart mode ' + mode);
    return { width: SW, height: SH, shapes };
  });

  // 斜線（45度）と点の模様を、長方形の中だけに描く
  function hatch(x, y, w, h, gap, cls) {
    const out = [];
    for (let c = gap; c < w + h; c += gap) {
      // 直線 u + v = c（u＝右へ、v＝上へ。左下が原点）を長方形で切る
      const u0 = Math.max(0, c - h), u1 = Math.min(w, c);
      if (u1 - u0 < 0.5) continue;
      out.push(line(x + u0, y + h - (c - u0), x + u1, y + h - (c - u1), cls));
    }
    return out;
  }
  function dots(x, y, w, h, gap, cls) {
    const out = [];
    for (let v = y + gap / 2; v < y + h; v += gap) for (let u = x + gap / 2; u < x + w; u += gap) out.push(circle(u, v, 1.2, cls));
    return out;
  }
  // 2-1：3つの組×4本。組のあいだのすき間＝近さ、色と塗り（塗り・斜線・点・枠だけ）＝似かた
  register('groupedBars', (s, ctx) => {
    const groups = ctx.data.datasets.groupBars, prox = s.groupGap ?? 0, sim = s.similarity || 'none', base = 140, k = 1.2;
    const bw = 9, inner = 2, gap = inner + (2 - prox) * 5;
    const total = groups.length * (4 * bw + 3 * inner) + (groups.length - 1) * gap;
    let x = (SW - total) / 2;
    const shapes = [];
    groups.forEach((g, gi) => {
      g.forEach((val, bi) => {
        const st = sim === 'rows' ? bi : sim === 'cols' ? gi : 0, y = base - val * k, h = val * k;
        if (st === 0) shapes.push(rect(x, y, bw, h, 'fill-groups-0'));
        else {
          shapes.push(rect(x, y, bw, h, `stroke-groups-${st} fig-nofill fig-barline`));
          if (st === 1) shapes.push(...hatch(x, y, bw, h, 4, `stroke-groups-${st} fig-pattern`));
          if (st === 2) shapes.push(...dots(x, y, bw, h, 4.5, `fill-groups-${st}`));
        }
        x += bw + (bi < 3 ? inner : 0);
      });
      x += gap;
    });
    shapes.push(line(8, base, 192, base, 'fig-axis'));
    return { width: SW, height: SH, shapes };
  });

  // 折れ線グラフ。mode＝search（タブ2）・contour（2-3）・region（2-2）・aspect（4-4の読みやすい形）・split（4-3の読みやすい形）・
  // motion（動きの項目）。search の styles＝6本の［色の名前, 破線か］（色の名前＝seriesTarget・seriesOthers-0〜2）。線と凡例の見本の両方に使い、
  // 探し方（search）による割り当てより先に使う
  const MOTION_LINES = [1, 0, 3, 5]; // 動きの項目の4本（monthly12.series6 の添字。先頭が強調する1本）
  register('lineChart', (s, ctx) => {
    const ds = ctx.data.datasets, m12 = ds.monthly12, mode = s.mode || 'search', shapes = [];
    const axes = (x0, y0, x1, y1) => [line(x0, y0, x0, y1, 'fig-axis'), line(x0, y1, x1, y1, 'fig-axis')];
    const plot12 = (x0, x1, y0, y1, lo = 0, hi = 100) => ({ x: (i) => x0 + i / 11 * (x1 - x0), y: (v) => y1 - (v - lo) / (hi - lo) * (y1 - y0) });
    if (mode === 'search') {
      const conj = (s.search || 'conjunction') === 'conjunction', P = plot12(14, 158, 12, 138);
      const cls = (i) => {
        if (s.styles) return `stroke-${s.styles[i][0]}${s.styles[i][1] ? ' line-dashed' : ''}`;
        if (conj) return i === m12.target ? 'stroke-seriesTarget line-dashed' : i < 3 ? 'stroke-seriesTarget' : `stroke-seriesOthers-${i - 3} line-dashed`;
        return i === m12.target ? 'stroke-seriesTarget' : `stroke-seriesOthers-${[0, 0, 1, 2, 0, 1][i]}`;
      };
      shapes.push(...axes(14, 12, 158, 138));
      m12.series6.forEach((vals, i) => shapes.push(path(pts(vals.map((v, j) => [P.x(j), P.y(v)])), cls(i) + ' fig-series')));
      m12.series6.forEach((_, i) => {
        const y = 22 + i * 20;
        shapes.push(line(166, y, 182, y, cls(i) + ' fig-series'), text(186, y + 4, 'ABCDEF'[i], 'fig-legend ta-start'));
      });
    } else if (mode === 'contour') {
      // 欠けた月：輪郭の途切れが0のときは、9・10月（missing）をまたいで線を結ぶ（ないデータがあるように見える形）。0より大きいときは、
      // 欠けた月を薄い帯で示して線を切り、10%ごとに欠けた月を1か月ずつ足す（missingMore の順）。1点だけ残った月は点で描く
      const { p, q, meet, missing, missingMore } = m12.cross, P = plot12(14, 168, 12, 138);
      const corner = (s.crossing || 'smooth') === 'corner';
      const A = corner ? [...p.slice(0, meet + 1), ...q.slice(meet + 1)] : p, B = corner ? [...q.slice(0, meet + 1), ...p.slice(meet + 1)] : q;
      const steps = Math.round((s.gap || 0) * 10), joined = steps === 0;
      const gone = joined ? missing : [...missing, ...missingMore.slice(0, steps - 1)];
      const pieces = (vals) => {
        const keep = vals.map((v, i) => (gone.includes(i) ? null : [P.x(i), P.y(v)]));
        if (joined) return [keep.filter(Boolean)];
        const out = []; let cur = [];
        for (const k of keep) { if (k) cur.push(k); else if (cur.length) { out.push(cur); cur = []; } }
        if (cur.length) out.push(cur);
        return out;
      };
      const half = (P.x(1) - P.x(0)) / 2;
      if (!joined) for (const i of gone) shapes.push(rect(P.x(i) - half, 12, 2 * half, 126, 'fig-missing'));
      shapes.push(...axes(14, 12, 168, 138));
      for (const [vals, cls, dot, name] of [[A, 'stroke-seriesTarget', 'fill-seriesTarget', 'A'],
        [B, 'stroke-seriesOthers-0 line-dashed', 'fill-seriesOthers-0', 'B']]) {
        for (const piece of pieces(vals)) {
          shapes.push(piece.length === 1 ? circle(piece[0][0], piece[0][1], 2.5, dot) : path(pts(piece), cls + ' fig-series'));
        }
        shapes.push(text(174, P.y(vals[11]) + 4, name, 'fig-legend ta-start'));
      }
    } else if (mode === 'region') {
      const vals = m12.series6[m12.target], P = plot12(14, 190, 12, 138), [b0, b1] = m12.band, half = (P.x(1) - P.x(0)) / 2;
      if (s.region === 'frame') shapes.push(rect(P.x(b0) - half, 12, P.x(b1) - P.x(b0) + 2 * half, 126, 'fill-band'));
      shapes.push(...axes(14, 12, 190, 138), path(pts(vals.map((v, j) => [P.x(j), P.y(v)])), 'stroke-seriesTarget fig-series'));
    } else if (mode === 'aspect') {
      const vals = ds.libraryLoans24, [lo, hi] = Core.niceRange(vals), x0 = 40, x1 = 160, y0 = 15, y1 = 135;
      shapes.push(...axes(x0, y0, x1, y1),
        path(pts(vals.map((v, i) => [x0 + i / (vals.length - 1) * (x1 - x0), y1 - (v - lo) / (hi - lo) * (y1 - y0)])), 'stroke-seriesTarget fig-series'));
    } else if (mode === 'split') {
      const top = plot12(30, 190, 10, 66, 0, 30), bottom = plot12(30, 190, 86, 142, 0, 250);
      shapes.push(...axes(30, 10, 190, 66), ...axes(30, 86, 190, 142));
      shapes.push(path(pts(ds.townTemp.map((v, i) => [top.x(i), top.y(v)])), 'stroke-seriesTarget fig-series'));
      ds.townTemp.forEach((v, i) => shapes.push(circle(top.x(i), top.y(v), 2.5, 'fill-seriesTarget')));
      shapes.push(path(pts(ds.townRain.map((v, i) => [bottom.x(i), bottom.y(v)])), 'stroke-seriesOthers-0 fig-series line-dashed'));
      ds.townRain.forEach((v, i) => shapes.push(rect(bottom.x(i) - 2.5, bottom.y(v) - 2.5, 5, 5, 'fill-seriesOthers-0')));
      shapes.push(text(4, 20, '°C', 'fig-legend ta-start'), text(4, 96, 'mm', 'fig-legend ta-start'));
    } else if (mode === 'motion') {
      // 動きの項目：4本の折れ線（7〜12月）。終わりの点に印。強調する1本（探す系列）の印は、終わりの点から最後の区間を戻って往復する。
      // 「ばらばらに動く」では、ほかの線の印も、それぞれの位相で動く。コマ送りでは、前のコマの印の位置に、印と同じ大きさの破線の輪を重ねる
      const pose = s.pose || REST, a = motionStep(s.motionAmount), random = s.motionOthers === 'random', rng = Core.xorshift32(s.seed || 1);
      const X = (i) => 16 + i * 34, Y = (v) => 138 - v * 1.26, trails = [], marks = [];
      shapes.push(...axes(14, 12, 190, 138));
      MOTION_LINES.forEach((si, k) => {
        const vals = m12.series6[si].slice(6), color = k === 0 ? 'seriesTarget' : `seriesOthers-${k - 1}`, phase = Core.unit(rng);
        const item = k === 0 ? { amp: MOTION.line[a], phase: 0 } : { amp: random ? MOTION.line[MOTION.others] : 0, phase };
        const at = (u, env) => {
          const f = env * item.amp * (1 - Math.cos(2 * Math.PI * (u + item.phase))) / 2;
          return [X(5) + f * (X(4) - X(5)), Y(vals[5]) + f * (Y(vals[4]) - Y(vals[5]))];
        };
        shapes.push(path(pts(vals.map((v, i) => [X(i), Y(v)])), `stroke-${color} fig-series`));
        if (pose.prev !== null && item.amp > 0) {
          const [px, py] = at(pose.prev, 1);
          trails.push(circle(px, py, 4, 'fig-trail'));
        }
        const [mx, my] = at(pose.u, pose.env);
        marks.push(circle(mx, my, 4, `fill-${color}`));
      });
      shapes.push(...marks, ...trails);
    } else throw new Error('unknown lineChart mode ' + mode);
    return { width: SW, height: SH, shapes };
  });

  // 散布図。mode＝region（2-2：点を線でつなぐ）・markers（3-2：印の形）
  const OPEN_MARK = [[-5, -3], [-2, 4], [3, 1], [5, 5]];                      // いびつで開いた印
  const CONVEX_MARK = [[-5, -1], [-2, -5], [4, -4], [6, 1], [2, 5], [-4, 4]]; // ふくらんだ閉じた印（左右対称ではない）
  register('scatter', (s, ctx) => {
    const ds = ctx.data.datasets, mode = s.mode || 'markers', shapes = [];
    const X = (v) => 14 + v / 100 * 172, Y = (v) => 138 - v / 100 * 126;
    shapes.push(line(14, 12, 14, 138, 'fig-axis'), line(14, 138, 186, 138, 'fig-axis'));
    if (mode === 'region') {
      const p = ds.scatter8.map(([x, y]) => [X(x), Y(y)]);
      if (s.region === 'line') shapes.push(path(pts(p), 'stroke-seriesTarget fig-series'));
      for (const [x, y] of p) shapes.push(circle(x, y, 4, 'fill-seriesTarget'));
    } else if (mode === 'markers') {
      const marker = s.marker || 'none';
      ds.scatter12.forEach(([vx, vy], i) => {
        const x = X(vx), y = Y(vy);
        if (marker === 'symmetric') {
          const k = i % 3;
          if (k === 0) shapes.push(circle(x, y, 5, 'fill-seriesTarget'));
          else if (k === 1) shapes.push(path(Core.polygonPath([[x, y - 6], [x + 5.5, y + 4], [x - 5.5, y + 4]]), 'fill-seriesTarget'));
          else shapes.push(rect(x - 4.5, y - 4.5, 9, 9, 'fill-seriesTarget'));
        } else if (marker === 'convex') shapes.push(path(Core.polygonPath(CONVEX_MARK.map(([a, b]) => [x + a, y + b])), 'fill-seriesTarget'));
        else shapes.push(path(pts(OPEN_MARK.map(([a, b]) => [x + a, y + b])), 'stroke-seriesTarget fig-nofill fig-series'));
      });
    } else throw new Error('unknown scatter mode ' + mode);
    return { width: SW, height: SH, shapes };
  });

  // 1-2：5行の表。例外（3行目）の示し方＝印を足す（add）／ほかの行に印を付けて例外だけ外す（omit）
  register('markTable', (s) => {
    const omit = s.exception === 'omit', shapes = [], exception = 2;
    for (let i = 0; i < 5; i += 1) {
      const y = 15 + i * 26;
      if (i > 0) shapes.push(line(10, y - 6, 190, y - 6, 'fig-rule'));
      shapes.push(rect(40, y + 4, 130 - (i % 2) * 24, 8, 'fig-textbar'));
      if (omit ? i !== exception : i === exception) shapes.push(circle(24, y + 8, 5, 'fig-mark'));
    }
    return { width: SW, height: SH, shapes };
  });

  // 明るさの対比の項目：5×5 のヒートマップ（1色の濃淡。値0〜100を10刻みの段 heat-0〜heat-10 で塗る）。値は datasets.heat5 から（A・B＝同じ値のマス、
  // L・H＝その周り）。A・B のマスには数を書き添える。pair＝A・B のマスの値［A, B］（渡さなければ両方とも heatSame。周りのマスは heatSame から決めたまま）
  function heatValues(ds, spread, pair = null) {
    const d = Math.round(ds.heatStep * spread);
    return ds.heat5.map((row) => row.map((c) => {
      if (c === 'A' || c === 'B') return pair ? pair[c === 'A' ? 0 : 1] : ds.heatSame;
      if (c === 'L') return ds.heatSame - d;
      return c === 'H' ? ds.heatSame + d : c;
    }));
  }
  register('heatmap', (s, ctx) => {
    const ds = ctx.data.datasets, v = heatValues(ds, s.spread ?? 0, s.pair || null), size = 26, x0 = (SW - 5 * size) / 2, y0 = (SH - 5 * size) / 2;
    const shapes = [];
    ds.heat5.forEach((row, r) => row.forEach((c, k) => {
      const x = x0 + k * size, y = y0 + r * size;
      shapes.push(rect(x + 1, y + 1, size - 2, size - 2, `fill-heat-${Math.round(v[r][k] / 10)}`));
      if (c === 'A' || c === 'B') shapes.push(text(x + size / 2, y + size / 2 + 4, v[r][k], 'fig-cellnum fill-heatText ta-middle'));
    }));
    return { width: SW, height: SH, shapes };
  });

  // 迷彩の絵：背景は丸い斑点、物は角の丸い楕円で自分の斑点を持つ。目立ちやすさの数は出さない
  function blobPoints(cx, cy, rx, ry, n = 36) {
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const a = i / n * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
      out.push([cx + rx * Math.sign(c) * Math.abs(c) ** (2 / 3), cy + ry * Math.sign(s) * Math.abs(s) ** (2 / 3)]);
    }
    return out;
  }
  // 2-1・3-2 の大きな物（big）：場面の幅の58%（高さの51%）の物に、半径7以上の斑点を置く。小さな図の大きさでも、模様の違いが一目で
  // わかるようにする。halves（3-2）は左右に4つずつ置き、symmetric なら右を左の鏡写し（同じ色・大きさ・高さ）にし、そうでなければ
  // 右の4つを別の並びに置く（左は同じ。数・大きさ・色の組も同じ）。halves でない物（2-1）は、物全体に8つを置き、色の組だけを変える
  // （背景の斑点と同じ組か、別の組か）
  const BIG = { rx: 58, ry: 38, radii: [9, 8, 8, 7], colors: [0, 1, 2, 0], gap: 3 };
  function placeSpots(rng, cx, cy, rx, ry, radii, ok = () => true) {
    const out = [];
    radii.forEach((r, i) => {
      for (let k = 0; k < 2000; k += 1) {
        const x = cx - rx + Core.unit(rng) * 2 * rx, y = cy - ry + Core.unit(rng) * 2 * ry;
        // 物の中（縁から2以上内側）で、ほかの斑点と重ならない所
        if (((x - cx) / (rx - r - 2)) ** 2 + ((y - cy) / (ry - r - 2)) ** 2 > 1) continue;
        if (out.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + BIG.gap) || !ok(x, y, r, i)) continue;
        out.push({ x, y, r });
        return;
      }
      throw new Error('no room for a spot');
    });
    return out;
  }
  function bigSpots(s, rng, cx, cy, spotCls) {
    const { rx, ry } = BIG;
    if (!s.halves) {
      const radii = [...BIG.radii, ...BIG.radii], colors = [...BIG.colors, 1, 2, 0, 1];
      const match = s.matchSpots !== false;
      return placeSpots(rng, cx, cy, rx, ry, radii).map((o, i) => circle(o.x, o.y, o.r,
        match ? spotCls(colors[i]) : `fill-camoObjSpots-${colors[i]}`));
    }
    const left = placeSpots(rng, cx, cy, rx, ry, BIG.radii, (x, y, r) => x + r <= cx - BIG.gap);
    const mirror = left.map((o) => ({ x: 2 * cx - o.x, y: o.y, r: o.r }));
    // そうでないとき：右の斑点 i は、左の斑点 i の鏡写しの位置から離して置く（並びが変わったことが見えるように）
    const right = s.symmetric ? mirror : placeSpots(rng, cx, cy, rx, ry, BIG.radii,
      (x, y, r, i) => x - r >= cx + BIG.gap && Math.hypot(x - mirror[i].x, y - mirror[i].y) >= 2 * r);
    return [...left, ...right].map((o, i) => circle(o.x, o.y, o.r, `fill-camoMarks-${BIG.colors[i % BIG.radii.length]}`));
  }
  // 動きの項目：背景に合わせた模様の物（地の色は背景と同じ、斑点は背景の色）が5つ。1つ（種で決める）が左右に往復する。「ばらばらに動く」では、
  // ほかの4つもそれぞれの方向と位相で動く。物は g の translate で動かし、背景の斑点は動かさない。コマ送りでは、前のコマの位置に、物と同じ形の
  // 破線の輪郭（動きの跡）を物の上に重ねる
  const CAMO_PLACES = [[50, 40], [150, 40], [100, 75], [50, 110], [150, 110]];
  function camoMotion(s, rng, spotCls) {
    const pose = s.pose || REST, a = motionStep(s.motionAmount), random = s.motionOthers === 'random', target = Core.randInt(rng, CAMO_PLACES.length);
    const trails = [];
    const bodies = CAMO_PLACES.map(([cx, cy], i) => {
      const dir = Core.unit(rng) * 2 * Math.PI, phase = Core.unit(rng);
      const item = i === target ? { dir: 0, phase: 0, amp: MOTION.camo[a] } : { dir, phase, amp: random ? MOTION.camo[MOTION.others] : 0 };
      const body = [path(Core.polygonPath(blobPoints(cx, cy, 20, 13)), 'fill-camoObj-0')];
      for (let k = 0; k < 6; k += 1) {
        const ang = Core.unit(rng) * 2 * Math.PI, rho = Math.sqrt(Core.unit(rng)) * 0.6;
        body.push(circle(cx + Math.cos(ang) * rho * 20, cy + Math.sin(ang) * rho * 13, 3.5, spotCls(Core.randInt(rng, 3))));
      }
      if (pose.prev !== null && item.amp > 0) {
        const [px, py] = swing(item, pose.prev, 1);
        trails.push(path(Core.polygonPath(blobPoints(cx + px, cy + py, 20, 13)), 'fig-trail'));
      }
      const [dx, dy] = swing(item, pose.u, pose.env);
      return group(body, { transform: `translate(${r2(dx)} ${r2(dy)})` });
    });
    return [...bodies, ...trails];
  }
  // 明るさの対比の項目：右半分の背景に薄い白を重ねて明るくする（不透明度＝SPLIT_VEIL×差）。物（地の色は背景と同じ、斑点は背景の色）は左右の境に
  // またがり、明るさは変えない（左の背景に合ったまま）
  const SPLIT_VEIL = 0.55;
  function camoSplit(s, rng, spotCls) {
    const cx = SW / 2, cy = SH / 2, rx = 44, ry = 26;
    const out = [rect(SW / 2, 0, SW / 2, SH, 'fill-veil', { 'fill-opacity': SPLIT_VEIL * s.splitDiff }),
      path(Core.polygonPath(blobPoints(cx, cy, rx, ry)), 'fill-camoObj-0')];
    for (let k = 0; k < 10; k += 1) {
      const ang = Core.unit(rng) * 2 * Math.PI, rho = Math.sqrt(Core.unit(rng)) * 0.62;
      out.push(circle(cx + Math.cos(ang) * rho * rx, cy + Math.sin(ang) * rho * ry, 5, spotCls(Core.randInt(rng, 3))));
    }
    return out;
  }
  register('camoScene', (s) => {
    const rng = Core.xorshift32(s.seed || 1);
    let mode = 'color', level = s.objLevel ?? 0, colors = 3, scale = 1, jitter = 0.2;
    if (s.popKind) {
      const d = DIFF.indexOf(s.popDiff || 'large'), v = VARIETY.indexOf(s.popVariety || 'uniform');
      if (s.popKind === 'color') { level = d; colors = v + 1; jitter = 0; }
      if (s.popKind === 'lightness') { mode = 'light'; level = d; colors = v + 1; jitter = 0; }
      if (s.popKind === 'size') { level = 1; colors = 1; scale = SCALES[d]; jitter = JIT_SCALE[v]; }
    }
    const spotCls = (k) => `fill-${mode === 'light' ? 'camoSpotsLight' : 'camoSpots'}-${k}`;
    const shapes = [rect(0, 0, SW, SH, 'fill-camoBase')];
    for (let i = 0; i < 70; i += 1) {
      const r = 9 * (1 + (Core.unit(rng) * 2 - 1) * jitter);
      shapes.push(circle(r + Core.unit(rng) * (SW - 2 * r), r + Core.unit(rng) * (SH - 2 * r), r, spotCls(Core.randInt(rng, colors))));
    }
    if (s.motionAmount !== undefined) return { width: SW, height: SH, shapes: [...shapes, ...camoMotion(s, rng, spotCls), FRAME()] };
    if (s.splitDiff !== undefined) return { width: SW, height: SH, shapes: [...shapes, ...camoSplit(s, rng, spotCls), FRAME()] };
    const cx = SW / 2, cy = SH / 2;
    const rx = s.big ? BIG.rx : s.objectShare !== undefined ? SW / 2 * s.objectShare : 32 * scale;
    const ry = s.big ? BIG.ry : s.objectShare !== undefined ? 24 : 20 * scale;
    const outline = blobPoints(cx, cy, rx, ry);
    shapes.push(path(Core.polygonPath(outline), `fill-${mode === 'light' ? 'camoObjLight' : 'camoObj'}-${level}`));
    // 物の斑点：背景と同じ色の組（似ている）か、別の色の組
    const match = s.matchSpots !== false, sr = Math.max(3, Math.min(7, Math.min(rx, ry) * 0.25));
    const objCls = () => (match ? spotCls(Core.randInt(rng, colors)) : `fill-camoObjSpots-${Core.randInt(rng, 3)}`);
    const inner = () => { const a = Core.unit(rng) * 2 * Math.PI, rho = Math.sqrt(Core.unit(rng)) * 0.55; return [Math.cos(a) * rho, Math.sin(a) * rho]; };
    if (s.big) shapes.push(...bigSpots(s, rng, cx, cy, spotCls));
    else if (s.symmetric) {
      for (let i = 0; i < 5; i += 1) {
        const [u, v] = inner(), cls = objCls();
        shapes.push(circle(cx + Math.abs(u) * rx, cy + v * ry, sr, cls), circle(cx - Math.abs(u) * rx, cy + v * ry, sr, cls));
      }
    } else for (let i = 0; i < 10; i += 1) { const [u, v] = inner(); shapes.push(circle(cx + u * rx, cy + v * ry, sr, objCls())); }
    // 縁にかかる斑点（輪郭の項目。輪郭を途切れさせる）：10%ごとに背景の色の斑点を4つずつ、半径10〜12で物の縁の上に置く。場所は黄金比で縁を
    // 順に回って散らし、段を上げても前の斑点は残す（どの段でも増えたことがわかり、60%では輪郭がほとんど追えない）
    const edges = Math.round((s.edgePatches || 0) * 40);
    for (let i = 0; i < edges; i += 1) {
      const [x, y] = outline[Math.floor(((i * 0.6180339887) % 1) * outline.length)];
      shapes.push(circle(x, y, 10 + (i % 3), spotCls(i % colors)));
    }
    if (s.outline) shapes.push(path(Core.polygonPath(outline), 'camo-outline fig-nofill'));
    if (s.addedLine) shapes.push(line(cx - rx * 0.15, cy - ry * 1.25, cx + rx * 0.25, cy + ry * 1.25, 'camo-line'));
    shapes.push(FRAME());
    return { width: SW, height: SH, shapes };
  });

  // 迷彩の探す実験の場面（カードの小さな図と、実験の枠の中の図は、この同じ部品で描く）：樹皮の地・背景の斑点・蛾の形（地の色）・物の斑点。
  // mark で蛾の形の外側に破線の印。どの図形も正方形の中に収まる（背景の斑点ははみ出さない所に置き、物の斑点は三角形で切り抜いてある）
  register('camoSearchScene', (s) => {
    const lay = Core.camoSearchLayout({ seed: s.seed || 1, pattern: s.pattern || 'match', cell: s.cell ?? null });
    const n = lay.size, shapes = [rect(0, 0, n, n, `fill-bark-${lay.base}`)];
    for (const g of lay.ground) shapes.push(el('ellipse', { cx: g.cx, cy: g.cy, rx: g.rx, ry: g.ry }, `fill-bark-${g.color}`));
    shapes.push(path(Core.polygonPath(lay.moth), `fill-bark-${lay.base}`));
    for (const p of lay.patches) shapes.push(path(Core.polygonPath(p.points), `fill-bark-${p.color}`));
    if (s.mark) shapes.push(path(Core.polygonPath(lay.mark), 'stroke-barkMark camo-mark'));
    return { width: n, height: n, shapes };
  });
  // 実験の枠の「探す形」の見本（蛾の形と同じ縦横の比の三角形）
  function mothSample() {
    return { width: 40, height: 40, shapes: [path(Core.polygonPath([[6, 13], [34, 13], [20, 27]]), 'stim-solid')] };
  }

  const partNames = () => Object.keys(PARTS);
  function renderPart(name, settings, ctx) {
    if (!PARTS[name]) throw new Error('unknown part ' + name);
    return PARTS[name](settings, ctx);
  }
  // 2つの部品を横（row）か縦（column）に並べる
  function compose(results, layout) {
    if (results.length === 1) return results[0];
    const shapes = [];
    let offset = 0;
    for (const r of results) {
      shapes.push(group(r.shapes, { transform: layout === 'column' ? `translate(0 ${offset})` : `translate(${offset} 0)` }));
      offset += layout === 'column' ? r.height : r.width;
    }
    return layout === 'column'
      ? { width: Math.max(...results.map((r) => r.width)), height: offset, shapes }
      : { width: offset, height: Math.max(...results.map((r) => r.height)), shapes };
  }

  // ===== 項目の状態と小さな図のつなぎ =====
  function controlValues(entry, overrides = {}) {
    const v = {};
    for (const c of entry.controls) v[c.id] = Object.hasOwn(overrides, c.id) ? overrides[c.id] : c.default;
    return v;
  }
  // つまみのすべての値（range は values、choice は options、toggle は false・true）
  const controlOptions = (c) => (c.type === 'range' ? c.values : c.type === 'choice' ? c.options : [false, true]);
  // 有効か：enabledWhen が当たらない、または disabledWhen が当たると無効
  function controlEnabled(control, values) {
    const hit = (cond) => Object.entries(cond).every(([k, list]) => list.includes(values[k]));
    if (control.enabledWhen && !hit(control.enabledWhen)) return false;
    if (control.disabledWhen && hit(control.disabledWhen)) return false;
    return true;
  }
  // 切り替えのボタンが押された形で見せる値：押せる間は選んだ値、押せない間は図が使っている値（offValue があれば）。
  // 選んだ値は values に残るので、押せるようになると前の選択に戻る
  function shownValue(control, values) {
    return controlEnabled(control, values) || control.offValue === undefined ? values[control.id] : control.offValue;
  }
  const bindActive = (use, values) => !use.bindWhen || Object.entries(use.bindWhen).every(([k, list]) => list.includes(values[k]));
  // 小さな図の設定（params に、いまつながるつまみの値を重ねる）と、つながったつまみ
  function useSettings(use, values) {
    const settings = { ...(use.params || {}) }, linked = [];
    if (bindActive(use, values)) {
      for (const [cid, spec] of Object.entries(use.bind || {})) {
        if (typeof spec === 'string') settings[spec] = values[cid];
        else settings[spec.to] = spec.map[String(values[cid])];
        linked.push(cid);
      }
    }
    return { settings, linked };
  }
  // つまみの値の名前（画面の目盛り・ボタンと同じ）：段の名前のある操作は辞書の名前、割合は「30%」、切り替えはオン・オフ、ほかは数そのまま
  function stepLabel(D, entry, control, value) {
    if (control.type === 'toggle') return D[value ? 'toggleOn' : 'toggleOff'];
    if (control.type === 'choice' || control.named) {
      const index = controlOptions(control).indexOf(value);
      return D[`ctl.${entry.id}.${control.id}.${control.steps ? control.steps[index] : String(value)}`];
    }
    if (control.unit === 'percent') return Math.round(value * 100) + '%';
    return String(value);
  }
  // 小さな図の下の行：linkedTo（つながる操作の名前を controls の順に）か linkedNone（いまの設定ではつながらない。理由を書く項目は
  // use.linkedNoneKey の文）。つながる操作が1つもない図（bind が空）は linkedNever（操作しても変わらない）
  function linkedLine(entry, use, values) {
    if (!Object.keys(use.bind || {}).length) return { key: 'linkedNever', controls: [] };
    const { linked } = useSettings(use, values);
    const ids = entry.controls.map((c) => c.id).filter((id) => linked.includes(id));
    return ids.length ? { key: 'linkedTo', controls: ids } : { key: use.linkedNoneKey || 'linkedNone', controls: [] };
  }
  // 小さな図の下の文：textKeyWhen の場合（{ when: { つまみの id: [値…] }, key }）のうち、いまの値に最初に当たるものの文。当たらなければ textKey
  function useTextKey(use, values) {
    const hit = (use.textKeyWhen || []).find((c) => Object.entries(c.when).every(([k, list]) => list.includes(values[k])));
    return hit ? hit.key : use.textKey || null;
  }
  // 小さな図の下に出しうる文のキーすべて（重ねて置き、高さはいちばん長い文で決める）
  const useTextKeys = (use) => [...new Set([...(use.textKeyWhen || []).map((c) => c.key), ...(use.textKey ? [use.textKey] : [])])];
  function linkedText(M, lang, entry, use, values) {
    const D = dictionary(M, lang), l = linkedLine(entry, use, values);
    if (l.key !== 'linkedTo') return D[l.key];
    return fill(D.linkedTo, { names: l.controls.map((id) => D[`ctl.${entry.id}.${id}`]).join(lang === 'ja' ? '・' : ', ') });
  }
  // extra：つまみの値でない設定（動きの項目の pose）
  function renderMain(entry, values, ctx, seed, extra = {}) {
    if (!entry.figure) return null;
    return renderPart(entry.figure.part, { ...entry.figure.params, ...values, seed: seed ?? entry.figure.seed, ...extra }, ctx);
  }
  function renderUse(use, values, ctx, extra = {}) {
    const { settings } = useSettings(use, values);
    const parts = [renderPart(use.part, { ...settings, ...extra }, ctx)];
    for (const w of use.with || []) parts.push(renderPart(w.part, { ...settings, ...(w.params || {}), ...extra }, ctx));
    return compose(parts, use.layout || 'row');
  }

  // ===== タブと項目の見せ方のモデル =====
  const SIDE_LABEL = { show: 'showLabel', hide: 'hideLabel', readable: 'readableLabel', read: 'readLabel' };
  // 「動かす前に予想する」：問い・選択肢・正しい選択肢・説明のキー。選んだあとの文は、実験の項目は「実験をしてから確かめてください」、
  // 動く項目は「切り替えて「動かす」を押し」（動きを減らす設定では chosenReducedKey の「次のコマ」）、ほかは「問いのとおりに操作して」
  function predictModel(e) {
    if (!e.predict) return null;
    const moving = e.safety.motion === 'onPlay';
    return { questionKey: `predict.${e.id}.question`, explainKey: `predict.${e.id}.explain`, answer: e.predict.answer,
      chosenKey: e.experiment ? 'predictChosenTest' : moving ? 'predictChosenPlay' : 'predictChosen',
      chosenReducedKey: moving ? 'predictChosenFrame' : null,
      choices: e.predict.choices.map((c) => ({ id: c, key: `predict.${e.id}.choice.${c}`, label: null })) };
  }
  // 確かめの問い：図・図の名前と説明・問い・選択肢・正しい選択肢・説明。図の label（A・B）と同じ選択肢は、その名前をそのまま出す（訳さない）
  function checkModel(q) {
    const labels = q.figures.map((f) => f.label).filter(Boolean);
    return { id: q.id, figures: q.figures, noteKey: q.noteKey || null, answer: q.answer, titleKey: `check.${q.id}.title`, descKey: `check.${q.id}.desc`,
      questionKey: `check.${q.id}.question`, explainKey: `check.${q.id}.explain`,
      choices: q.choices.map((c) => (labels.includes(c) ? { id: c, key: null, label: c } : { id: c, key: `check.${q.id}.choice.${c}`, label: null })) };
  }
  // 確かめの問いの図：部品を設定のとおりに描く。camoResultChart は迷彩の実験の結果のグラフを、決まった真ん中の値（ミリ秒）で描く（各回の点はない）
  const RESULT_CHART = 'camoResultChart';
  function renderCheckFigure(fig, ctx) {
    if (fig.part !== RESULT_CHART) return renderPart(fig.part, fig.params || {}, ctx);
    const rows = Object.fromEntries(Core.CAMO_PATTERNS.map((p) => [p, { median: fig.params.medians[p], times: [] }]));
    return camoResultChart({ rows }, ctx);
  }
  function entryModel(e) {
    const readable = e.uses.length > 0 && e.uses.every((u) => u.side === 'readable');
    // 見せる側の小さな図しかない項目（図形の数と探す時間）は、見出しに隠す側を書かない。隠す側だけの項目（迷彩の物を探す時間）はその逆
    const showOnly = e.uses.length > 0 && e.uses.every((u) => u.side === 'show');
    const hideOnly = e.uses.length > 0 && e.uses.every((u) => u.side === 'hide');
    const sf = e.safety;
    const safetyActions = [];
    // 動く項目：「動かす」（動きを減らす設定では、代わりに「次のコマ」）と「止める」
    if (sf.motion === 'onPlay') {
      safetyActions.push({ id: 'play', labelKey: 'motionPlay' }, { id: 'frame', labelKey: 'motionFrame' }, { id: 'stop', labelKey: 'motionStop' });
    }
    if (sf.stripes) safetyActions.push({ id: 'show', labelKey: 'stripesShow' });
    return {
      id: e.id, group: e.group,
      titleKey: `item.${e.id}.title`, oneLineKey: `item.${e.id}.oneLine`, howToKey: `item.${e.id}.howTo`, titleTerms: e.titleTerms,
      howToReducedKey: sf.motion === 'onPlay' ? `item.${e.id}.howToReduced` : null, whyKey: `item.${e.id}.why`, predict: predictModel(e),
      figure: e.figure, experiment: !!e.experiment,
      controls: e.controls.map((c) => ({
        ...c, labelKey: `ctl.${e.id}.${c.id}`,
        optionKeys: c.type === 'toggle' ? [] : (c.type === 'choice' || c.named)
          ? controlOptions(c).map((v, i) => `ctl.${e.id}.${c.id}.${c.steps ? c.steps[i] : String(v)}`) : [],
      })),
      actions: e.actions || [],
      usesHeadingKey: readable ? 'usesHeadingReadable' : showOnly ? 'usesHeadingShow' : hideOnly ? 'usesHeadingHide' : 'usesHeading',
      uses: e.uses.map((u) => ({ side: u.side, labelKey: SIDE_LABEL[u.side], titleKey: `fig.${e.id}.${u.side}.title`, part: u.part,
        textKey: u.textKey || null, textKeys: useTextKeys(u), noteKey: u.noteKey || null, link: u.link || null })),
      mainTitleKey: e.figure ? `fig.${e.id}.main.title` : null,
      gapKey: e.gapKey, gapHeadingKey: e.gapHeadingKey || 'gapHeading', numbers: e.numbers || null, checkKey: e.checkKey || null,
      sources: e.sources, related: e.related,
      safety: { noticeKey: sf.stripes ? sf.noticeKey : null, actions: safetyActions, maxSeconds: sf.maxSeconds,
        colorHintKey: sf.colorOnly ? sf.colorHintKey || null : null },
    };
  }
  function buildViewModel(data) {
    const groups = data.groups.slice().sort((a, b) => a.order - b.order);
    return {
      tabs: groups.map((g, i) => ({
        id: g.id, labelKey: g.labelKey, termKey: g.termKey, termTip: g.termTip || null, leadKeys: g.leadKeys || [], endBoxes: g.endBoxes || [],
        checks: (g.checks || []).map(checkModel),
        next: groups[i + 1] ? { id: groups[i + 1].id, labelKey: groups[i + 1].labelKey } : null,
        entries: data.entries.filter((e) => e.group === g.id).sort((a, b) => a.order - b.order).map(entryModel),
      })),
    };
  }

  // ===== 見方の文の選び方 =====
  // 縦軸の始まり：下端からの高さの比と値の比（どちらも図の下の数の行の小数2桁）の差がこれより小さければ、差はまだ小さいという文にする
  const BASE_SMALL = 0.05;
  // extra.times＝1-2 の「探して押す」の時間（秒。{ withLine, noLine }、ないものは null）
  function readCases(data, entryId, values, extra = {}) {
    const entry = data.entries.find((e) => e.id === entryId);
    if (!entry || !entry.read) return [];
    const ds = data.datasets;
    switch (entry.read.cases) {
      case 'popout': {
        if (values.kind === 'shape') return [{ key: values.shape === 'tl' ? 'popRead.shapeTL' : 'popRead.shapeCurve', values: {} }];
        if (values.diff === 'same') return [{ key: 'popRead.same', values: {} }];
        return [{ key: `popRead.${{ small: 'S', medium: 'M', large: 'L' }[values.diff]}.${values.variety}`, values: {} }];
      }
      case 'asymmetry': {
        const times = extra.times || {}, a = times.withLine ?? null, b = times.noLine ?? null;
        const second = a !== null && b !== null ? { key: 'asymRead.both', values: { t1: f1(a), t2: f1(b) } }
          : a !== null || b !== null ? { key: 'asymRead.one', values: {} } : { key: 'asymRead.none', values: {} };
        return [{ key: values.target === 'noLine' ? 'asymRead.noLine' : 'asymRead.withLine', values: {} }, second];
      }
      case 'proximity': {
        const side = values.prox < 0 ? 'rows' : values.prox > 0 ? 'cols' : 'even';
        return [{ key: `proxRead.${side}.${values.sim}`, values: {} }];
      }
      case 'region': return [{ key: `regionRead.${values.link}`, values: {} }];
      case 'contour': {
        const p = Math.round(values.gap * 100);
        const gap = p === 0 ? { key: 'contourRead.gap0', values: {} }
          : { key: p <= 30 ? 'contourRead.gapLow' : 'contourRead.gapHigh', values: { p: String(p) } };
        return [gap, { key: `contourRead.${values.crossing}`, values: {} }];
      }
      case 'area': {
        const p = Math.round(values.share * 100);
        return [{ key: p < 50 ? 'areaRead.darkNarrow' : p === 50 ? 'areaRead.equal' : 'areaRead.lightNarrow', values: {} }];
      }
      case 'symmetry': {
        if (values.cue === 'none') return [{ key: 'symRead.none', values: {} }];
        // The bands with the cue: those in the dark color (regionA), or once swapped those in the light color (regionB)
        const band = values.swap ? 'light' : 'dark';
        if (values.cue === 'convex') return [{ key: `symRead.convex${values.regions === 2 ? 2 : 8}.${band}`, values: {} }];
        return [{ key: `symRead.symmetric.${band}`, values: {} }];
      }
      case 'motion': {
        const random = values.others === 'random';
        if (values.amount === 'none') return [{ key: random ? 'motionRead.oneStill' : 'motionRead.none', values: {} }];
        if (random) return [{ key: 'motionRead.allMove', values: {} }];
        return [{ key: `motionRead.${values.amount}`, values: {} }];
      }
      case 'lightness': {
        if (!values.diff) return [{ key: 'lightRead.same', values: {} }];
        return [{ key: values.compare === 'band' ? 'lightRead.band' : 'lightRead.apart', values: {} }];
      }
      // 迷彩の探す実験：小さな図の下の文は模様ごとに1文（印の有無では変わらない）
      case 'camo': return [{ key: `camoRead.${values.pattern}`, values: {} }];
      case 'baseline': {
        if (!values.bottom) return [{ key: 'baseRead.zero', values: {} }];
        // The two ratios of the line of numbers (as shown, two decimals): while they differ by less than BASE_SMALL (the bottom at 5, 10
        // and 15), the sentence says that the difference is still small instead of that it looks larger
        const loans = ds.libraryLoans3, ratio = Core.round2(Core.baselineRatio(loans, values.bottom));
        const gap = Core.round2(ratio - Core.round2(Math.max(...loans) / Math.min(...loans))), b = String(values.bottom), r = ratio.toFixed(2);
        const out = [gap < BASE_SMALL ? { key: 'baseRead.raisedSmall', values: { b, r, d: gap.toFixed(2) } }
          : { key: 'baseRead.raised', values: { b, r } }];
        if (values.mark === 'shown') out.push({ key: 'baseRead.mark', values: {} });
        if (values.chart === 'line') out.push({ key: 'baseRead.line', values: {} });
        return out;
      }
      case 'areaMis': {
        if (values.ratio === 1) return [{ key: 'areaMisRead.one', values: {} }];
        const sc = Core.areaScales(values.ratio, values.stretch);
        return [{ key: `areaMisRead.${values.stretch}`, values: { v: f2(values.ratio), h: f2(sc.h), a: f2(sc.a) } }];
      }
      case 'dual': {
        const n = Core.dualAxisCrossings(ds.townTemp, ds.townRain, [0, 30], [0, values.rightTop]);
        if (n === 0) return [{ key: 'dualRead.none', values: { m: String(values.rightTop) } }];
        if (n === 1) return [{ key: 'dualRead.crossOnce', values: { m: String(values.rightTop) } }];
        return [{ key: 'dualRead.cross', values: { m: String(values.rightTop), n: String(n) } }];
      }
      case 'aspect': {
        const all = ds.libraryLoans24, shown = values.range === 'last6' ? all.slice(-6) : all;
        const deg = Core.round1(Core.meanAbsAngle(shown, values.aspect));
        const key = deg > 60 ? 'aspectRead.steep' : deg >= 30 ? 'aspectRead.mid' : 'aspectRead.flat';
        const ends = { start: books(all[0]), end: books(all[all.length - 1]), start6: books(all[all.length - 6]) };
        return [{ key, values: { deg: deg.toFixed(1) } },
          values.range === 'last6' ? { key: 'aspectRead.last6', values: ends } : { key: 'aspectRead.all', values: { start: ends.start, end: ends.end } }];
      }
      default: throw new Error('unknown read cases ' + entry.read.cases);
    }
  }
  // 図の下の数の行（誤読の4項目）
  function numbersCase(data, entryId, values) {
    const ds = data.datasets;
    switch (entryId) {
      case 'misread-baseline': return { key: 'baseNumbers', values: { r: f2(values.bottom ? Core.baselineRatio(ds.libraryLoans3, values.bottom) : 58 / 52) } };
      case 'misread-area': {
        const sc = Core.areaScales(values.ratio, values.stretch);
        return { key: 'areaNumbers', values: { v: f2(values.ratio), h: f2(sc.h), a: f2(sc.a) } };
      }
      case 'misread-dual-axis':
        return { key: 'dualNumbers', values: { n: String(Core.dualAxisCrossings(ds.townTemp, ds.townRain, [0, 30], [0, values.rightTop])) } };
      case 'misread-aspect-range': {
        const shown = values.range === 'last6' ? ds.libraryLoans24.slice(-6) : ds.libraryLoans24;
        return { key: 'aspectNumbers', values: { deg: f1(Core.meanAbsAngle(shown, values.aspect)) } };
      }
      default: return null;
    }
  }
  // 見方の文の場合を、選ばれうるキーごとにすべて（重ねて置く文の一覧。高さはいちばん長い文で決まる）
  function readKeysAll(data, entryId, extraList = [{}]) {
    const entry = data.entries.find((e) => e.id === entryId);
    const keys = new Set();
    const walk = (i, values) => {
      if (i === entry.controls.length) { for (const extra of extraList) for (const c of readCases(data, entryId, values, extra)) keys.add(c.key); return; }
      const c = entry.controls[i];
      for (const v of controlOptions(c)) walk(i + 1, { ...values, [c.id]: v });
    };
    walk(0, {});
    return [...keys];
  }
  const texts = (M, lang, cases) => { const D = dictionary(M, lang); return cases.map((c) => fill(D[c.key], c.values)); };

  // ===== 結果の文 =====
  const ROW_KEYS = { 'feature.present': 'resRowFeatureYes', 'feature.absent': 'resRowFeatureNo', 'conjunction.present': 'resRowConjYes',
    'conjunction.absent': 'resRowConjNo' };
  // 探し方の名前：文の頭（実験の枠の題）は termFeature・termConjunction、文の中は *Inline（英語は小文字で始める）
  const searchName = (D, id, inline) => (inline ? D[id === 'feature' ? 'searchFeatureInline' : 'searchConjInline']
    : D[id === 'feature' ? 'termFeature' : 'termConjunction']);
  // 語を並べる：日本語は sep でつなぎ、英語は「A, B and C」
  const listText = (lang, items, sep = '') => (lang === 'ja' || items.length < 2 ? items.join(sep)
    : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]);
  // 結果の文。同じ文が続くときは1文にまとめる：傾きを出せない行が2つ以上なら行の名前を並べ、押し間違いが両方の探し方にあれば
  // 両方の回数を1文に書く
  function resultTexts(M, lang, cases) {
    const D = dictionary(M, lang);
    const one = ({ key, values }) => {
      const v = {};
      for (const [k, x] of Object.entries(values)) {
        if (k === 'search') v[k] = searchName(D, x, true);
        else if (k === 'row') v[k] = D[ROW_KEYS[x]];
        else if (k === 'n' || k === 'p') v[k] = String(x);
        else v[k] = numberText(x.toFixed(1));
      }
      return fill(D[key], v);
    };
    const out = [];
    for (let i = 0; i < cases.length; i += 1) {
      const c = cases[i], next = cases[i + 1];
      if (c.key === 'resNoSlope' && next && next.key === 'resNoSlope') {
        const rows = [];
        for (; i < cases.length && cases[i].key === 'resNoSlope'; i += 1) rows.push(fill(D.resRowQuoted, { row: D[ROW_KEYS[cases[i].values.row]] }));
        i -= 1;
        out.push(fill(D.resNoSlopeMany, { rows: listText(lang, rows) }));
      } else if (c.key === 'resErrors' && next && next.key === 'resErrors') {
        const by = Object.fromEntries([c, next].map((e) => [e.values.search, e.values]));
        out.push(fill(D.resErrorsBoth, { fn: String(by.feature.n), fp: String(by.feature.p), cn: String(by.conjunction.n),
          cp: String(by.conjunction.p) }));
        i += 1;
      } else {
        out.push(one(c));
      }
    }
    return out;
  }
  // 測った特徴の組（測った探し方だけ。結果のグラフの上の1行）と、2つの探し方で組が違うときの文
  function resultSetTexts(M, lang, results) {
    const D = dictionary(M, lang);
    const measured = ['feature', 'conjunction'].filter((id) => results[id] && results[id].set);
    if (!measured.length) return [];
    const items = measured.map((id) => fill(D.resSetItem, { search: searchName(D, id, true),
      set: D[results[id].set === 'fill' ? 'setFillShort' : 'setColorShort'] }));
    const out = [fill(D.resSets, { list: listText(lang, items, '、') })];
    if (measured.length === 2 && results.feature.set !== results.conjunction.set) out.push(D.resSetsDiffer);
    return out;
  }
  // 実験の枠の題（例「結合探索（色×方向）」）と進み
  function experimentTitle(M, lang, search, set) {
    const D = dictionary(M, lang);
    return fill(D.expTitle, { search: searchName(D, search, false), set: D[set === 'fill' ? 'setFillShort' : 'setColorShort'] });
  }
  const messageText = (M, lang, msg) => fill(dictionary(M, lang)[msg.key], msg.values || {});

  // ===== 探す実験の結果の表とグラフ =====
  // 4本の行（特徴・結合×ある・ない）。ある＝実線と塗った印、ない＝破線と白抜きの印。特徴＝丸、結合＝三角
  const RESULT_SERIES = Object.freeze([
    { id: 'feature.present', search: 'feature', side: 'present', color: 'seriesTarget', marker: 'circle', open: false },
    { id: 'feature.absent', search: 'feature', side: 'absent', color: 'seriesTarget', marker: 'circle', open: true },
    { id: 'conjunction.present', search: 'conjunction', side: 'present', color: 'seriesOthers-0', marker: 'triangle', open: false },
    { id: 'conjunction.absent', search: 'conjunction', side: 'absent', color: 'seriesOthers-0', marker: 'triangle', open: true },
  ]);
  // 表の値（表示と同じ丸め）：図形の数ごとの真ん中の値は整数のミリ秒、傾きは小数1桁の文字、正答率は整数の%、除いた回数。出せない値は null。
  // results＝{ feature: summarizeBlock の結果か null, conjunction: 同じ }
  function resultRows(results) {
    return RESULT_SERIES.map((sr) => {
      const block = results[sr.search] || null, row = block ? block.rows[sr.side] : null;
      return {
        ...sr, labelKey: ROW_KEYS[sr.id], measured: !!row,
        medians: Core.SET_SIZES.map((n) => (row && row.cells[n].median !== null ? Math.round(row.cells[n].median) : null)),
        slope: row && row.slope !== null ? f1(row.slope) : null,
        accuracy: row && row.accuracy !== null ? Math.round(row.accuracy * 100) : null,
        excluded: row ? row.excluded : null,
      };
    });
  }
  // 縦軸の上端：1,000ミリ秒までは1,000、2,000までは500刻み、その先は1,000刻みで切り上げる（縦軸は0から）
  function resultTop(max) {
    if (max <= 1000) return { top: 1000, step: 250 };
    if (max <= 2000) return { top: Math.ceil(max / 500) * 500, step: 500 };
    return { top: Math.ceil(max / 1000) * 1000, step: 1000 };
  }
  function resultMarker(sr, x, y) {
    const cls = sr.open ? `stroke-${sr.color} res-open` : `fill-${sr.color}`;
    if (sr.marker === 'circle') return circle(x, y, 4.5, cls);
    return path(Core.polygonPath([[x, y - 5.5], [x + 5.5, y + 4], [x - 5.5, y + 4]]), cls);
  }
  // 凡例の見本（線の種類と印）
  function resultKey(id) {
    const sr = RESULT_SERIES.find((s) => s.id === id);
    return { width: 32, height: 14, shapes: [line(2, 7, 30, 7, `stroke-${sr.color} fig-series${sr.open ? ' line-dashed' : ''}`), resultMarker(sr, 16, 7)] };
  }
  // 結果のグラフ：横軸＝図形の数（0〜18）、縦軸＝見つけるまでの時間（0から）。点は真ん中の値で、線はその点を図形の数の順に結ぶ。
  // wide のときは線の右端の高さに名前を書き、重なるときは13ずつずらして、端の点から名前へ短い線を引く（印は重ねない）。
  // 狭い画面では名前を書かず、凡例を文字で置く
  function resultChart(results, { wide = false, t }) {
    const width = wide ? 480 : 280, height = 236, x0 = 46, x1 = wide ? 330 : 266, y0 = 30, y1 = 196;
    const rows = resultRows(results);
    const { top, step } = resultTop(Math.max(0, ...rows.flatMap((r) => r.medians.filter((v) => v !== null))));
    const X = (n) => x0 + n / 18 * (x1 - x0), Y = (v) => y1 - v / top * (y1 - y0);
    const shapes = [text(4, 14, t('resAxisY'), 'fig-axisname ta-start'), text(x1, height - 4, t('itemCount'), 'fig-axisname ta-end')];
    for (let v = 0; v <= top; v += step) {
      shapes.push(line(x0 - 4, Y(v), x0, Y(v), 'fig-axis'), text(x0 - 7, Y(v) + 4, numberText(v), 'fig-tick ta-end'));
    }
    for (const n of Core.SET_SIZES) shapes.push(line(X(n), y1, X(n), y1 + 4, 'fig-axis'), text(X(n), y1 + 16, numberText(n), 'fig-tick ta-middle'));
    shapes.push(line(x0, y0, x0, y1, 'fig-axis'), line(x0, y1, x1, y1, 'fig-axis'));
    const ends = [];
    for (const r of rows) {
      const points = Core.SET_SIZES.map((n, i) => (r.medians[i] === null ? null : [X(n), Y(r.medians[i])])).filter(Boolean);
      if (!points.length) continue;
      if (points.length >= 2) shapes.push(path(pts(points), `stroke-${r.color} fig-series${r.open ? ' line-dashed' : ''}`));
      for (const [x, y] of points) shapes.push(resultMarker(r, x, y));
      ends.push({ r, y: points[points.length - 1][1], from: points[points.length - 1][1] });
    }
    if (wide && ends.length) {
      ends.sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i += 1) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);
      const over = ends[ends.length - 1].y - (y1 + 4);
      if (over > 0) for (const e of ends) e.y -= over;
      for (const e of ends) {
        shapes.push(line(x1 + 7, e.from, x1 + 15, e.y, `stroke-${e.r.color} res-leader`), text(x1 + 19, e.y + 4, t(e.r.labelKey), 'fig-legend ta-start'));
      }
    }
    return { width, height, shapes, top, step };
  }
  // 結果のグラフの説明（SVG の <desc>）：描いた行の名前を並べる。行の名前の中に「・」や「,」があるので、日本語は「、」、英語は「; 」で
  // 区切る。描いた行がなければ null
  function resultChartDesc(M, lang, results) {
    const D = dictionary(M, lang);
    const names = resultRows(results).filter((r) => r.medians.some((v) => v !== null)).map((r) => D[r.labelKey]);
    return names.length ? fill(D.resChartDesc, { rows: names.join(lang === 'ja' ? '、' : '; ') }) : null;
  }

  // ===== 迷彩の探す実験の結果の表とグラフと文 =====
  // 秒の小数1桁（表示の丸めは文を選ぶ比べと同じ Core.tenths）
  const seconds1 = (ms) => numberText((Core.tenths(ms) / 10).toFixed(1));
  // 表の値：模様ごとに、中央値（秒の小数1桁の文字。出せなければ null）・有効な回・見つからなかった回・違う場所を押した回。summary＝summarizeCamo
  function camoResultRows(summary) {
    return Core.CAMO_PATTERNS.map((pattern) => {
      const row = summary ? summary.rows[pattern] : null;
      return { pattern, labelKey: `ctl.search-camo.pattern.${pattern}`, measured: !!row, median: row && row.median !== null ? seconds1(row.median) : null,
        valid: row ? row.valid : null, notFound: row ? row.timeout : null, wrong: row ? row.wrong : null };
    });
  }
  // 結果のグラフ：模様ごとの横の棒（中央値）に、有効な回の時間の点を重ねる。横軸は0〜10秒で決まっていて、値によって枠も目盛りも変わらない。
  // 棒の上に模様の名前を書く（棒はどれも同じ色。色だけで区別させない）。中央値のない模様は点だけ
  const CAMO_CHART = Object.freeze({ width: 280, height: 176, x0: 14, x1: 262, top: 24, row: 44 });
  function camoResultChart(summary, { t }) {
    const { width, height, x0, x1, top, row } = CAMO_CHART, limit = Core.CAMO_TIMEOUT_MS;
    const X = (ms) => x0 + Math.min(Math.max(ms, 0), limit) / limit * (x1 - x0), axisY = top + 3 * row - 6;
    const shapes = [text(4, 14, t('camoResAxis'), 'fig-axisname ta-start')];
    Core.CAMO_PATTERNS.forEach((pattern, i) => {
      const y = top + i * row, r = summary ? summary.rows[pattern] : null;
      shapes.push(text(x0, y + 10, t(`ctl.search-camo.pattern.${pattern}`), 'fig-legend ta-start'));
      if (r && r.median !== null) shapes.push(rect(x0, y + 16, X(r.median) - x0, 16, 'fill-seriesTarget'));
      if (r) r.times.forEach((ms, k) => shapes.push(circle(X(ms), y + 24 + ((k % 3) - 1) * 4, 3, 'res-dot')));
    });
    shapes.push(line(x0, axisY, x1, axisY, 'fig-axis'));
    for (let sec = 0; sec <= limit / 1000; sec += 2) {
      const x = X(sec * 1000);
      shapes.push(line(x, axisY, x, axisY + 4, 'fig-axis'), text(x, axisY + 16, numberText(sec), 'fig-tick ta-middle'));
    }
    return { width, height, shapes };
  }
  // 結果の文（camoResultCases の順）。{pattern} は文の中の模様の名前（英語は小文字で始める）、{d} は秒の小数1桁
  function camoResultTexts(M, lang, cases) {
    const D = dictionary(M, lang);
    return cases.map(({ key, values }) => {
      const v = {};
      if (values.pattern) v.pattern = D[`camoPatternInline.${values.pattern}`];
      if (values.d !== undefined) v.d = numberText(values.d.toFixed(1));
      if (values.n !== undefined) v.n = String(values.n);
      return fill(D[key], v);
    });
  }
  // 見せる側との対比：グラフでは短いほど、迷彩では長いほど目的に合う、という1文。同じ画面で特徴探索を測っていれば、その「ある」の回の
  // 中央値を並べる。feature＝特徴探索の summarizeBlock の結果か null
  function camoContrastTexts(M, lang, feature) {
    const D = dictionary(M, lang), out = [D.camoContrast];
    const m = feature && feature.rows && feature.rows.present ? feature.rows.present.median : null;
    if (typeof m === 'number') out.push(fill(D.camoContrastFeature, { t: seconds1(m) }));
    return out;
  }

  // ===== 図の説明（SVG の <desc>。いまの設定を文で表す） =====
  // side＝main（上の図）・show・hide。戻り値＝{ key, values, refs }。refs は「辞書のキーを引いて差し込む値」。
  // 説明の文がまだない項目は null（画面は <title> だけを付ける）
  function descCase(entry, values, side) {
    const id = entry.id;
    if (id === 'popout-feature') {
      const steps = { diff: `ctl.${id}.diff.${values.diff}`, variety: `ctl.${id}.variety.${values.variety}`, kind: `kindInline.${values.kind}` };
      if (side === 'main') {
        const n = { n: String(values.count) };
        if (values.kind === 'shape') return { key: `desc.${id}.main.shape`, values: n, refs: { shape: `ctl.${id}.shape.${values.shape}` } };
        if (values.diff === 'same') return { key: `desc.${id}.main.same`, values: n, refs: { kind: steps.kind, variety: steps.variety } };
        return { key: `desc.${id}.main`, values: n, refs: steps };
      }
      const use = entry.uses.find((u) => u.side === side);
      if (!use) return null;
      if (!useSettings(use, values).linked.length) return { key: `desc.${id}.${side}.fixed`, values: {}, refs: {} };
      return { key: `desc.${id}.${side}`, values: {}, refs: steps };
    }
    if (id === 'popout-asymmetry') {
      const withLine = values.target !== 'noLine';
      if (side === 'main') return { key: `desc.${id}.main`, values: { n: String(values.count) }, refs: { target: `ctl.${id}.target.${values.target}` } };
      if (side === 'show') return { key: `desc.${id}.show.${withLine ? 'add' : 'omit'}`, values: {}, refs: {} };
      if (side === 'hide') return { key: `desc.${id}.hide.${withLine ? 'line' : 'plain'}`, values: {}, refs: {} };
    }
    if (id === 'search-time' && side === 'show') return { key: `desc.${id}.show.${values.view}`, values: {}, refs: {} };
    if (id === 'search-time') return null;
    // ほかの項目：図の題に、いまの設定（操作の名前と値）を添える。上の図は使える操作すべて、小さな図はつながる操作だけ。
    // つながる操作がない小さな図は null（画面は題だけを付ける）
    let settings;
    if (side === 'main') {
      if (!entry.figure) return null;
      settings = entry.controls.filter((c) => controlEnabled(c, values)).map((c) => c.id);
    } else {
      const use = entry.uses.find((u) => u.side === side);
      if (!use) return null;
      settings = linkedLine(entry, use, values).controls;
      if (!settings.length) return null;
    }
    return { key: 'descSettings', values: {}, refs: { title: `fig.${id}.${side}.title` }, settings };
  }
  function descText(M, lang, entry, values, side) {
    const c = descCase(entry, values, side);
    if (!c) return null;
    const D = dictionary(M, lang), v = { ...c.values };
    for (const [name, key] of Object.entries(c.refs)) v[name] = D[key];
    if (c.settings) {
      v.settings = c.settings.map((cid) => fill(D.descPair, { name: D[`ctl.${entry.id}.${cid}`],
        value: stepLabel(D, entry, entry.controls.find((x) => x.id === cid), values[cid]) })).join(lang === 'ja' ? '、' : '; ');
    }
    return fill(D[c.key], v);
  }

  return Object.freeze({
    fill, dictionary, partNames, renderPart, renderMain, renderUse, compose, popoutLayout, asymLayout, findLayout, markShapes, fixationShapes,
    sampleShapes, cellCenter, controlValues, controlOptions, controlEnabled, shownValue, useSettings, linkedLine, linkedText, useTextKey, useTextKeys,
    buildViewModel, readCases, BASE_SMALL,
    numbersCase, readKeysAll, texts, resultTexts, resultSetTexts, experimentTitle, messageText, descCase, descText, RESULT_SERIES, resultRows,
    resultTop, resultChart, resultChartDesc, resultKey, numberText, stepLabel, motionPose, MOTION, mothSample, camoResultRows, camoResultChart,
    camoResultTexts, camoContrastTexts, CAMO_CHART, renderCheckFigure, RESULT_CHART,
    SIZES: Object.freeze({ square: SQ, cell: CELL, card: [W, H], small: [SW, SH], aspect: [AW, AH], aspectPlot: [AMAXW, AMAXH] }),
    ASPECT_EDGE,
    DIFF, VARIETY, ANGLES, SCALES, JIT_ANGLE, JIT_SCALE,
  });
}));
