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
  // 4-1：縦軸の始まり。縦軸の上端は60、下端はつまみ
  register('baselineChart', (s, ctx) => {
    const t = ctx.t, values = ctx.data.datasets.libraryLoans3, bottom = s.bottom || 0, top = 60;
    const x0 = 64, x1 = 304, y0 = 44, y1 = 196, slot = (x1 - x0) / values.length;
    const yv = (v) => y1 - (v - bottom) / (top - bottom) * (y1 - y0);
    const shapes = [
      text(W / 2, 18, t('fig.misread-baseline.main.title'), 'fig-title ta-middle'),
      text(8, 34, t('fig.misread-baseline.main.axisY'), 'fig-axisname ta-start'),
      text(x1, 234, t('fig.misread-baseline.main.axisX'), 'fig-axisname ta-end'),
    ];
    const ticks = [bottom, ...[10, 20, 30, 40, 50, 60].filter((v) => v > bottom)];
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

  // 4-4：縦横の比と期間。枠（viewBox 280×220）は変えず、中の描く面だけを変える
  function aspectPlot(aspect) {
    const pw = aspect >= 1.3 ? 260 : 200 * aspect, ph = aspect >= 1.3 ? 260 / aspect : 200;
    return { px: (AW - pw) / 2, py: (AH - ph) / 2, pw, ph };
  }
  register('aspectChart', (s, ctx) => {
    const all = ctx.data.datasets.libraryLoans24, values = (s.range || 'all') === 'last6' ? all.slice(-6) : all;
    const { px, py, pw, ph } = aspectPlot(s.aspect || 1), [lo, hi] = Core.niceRange(values);
    const p = values.map((v, i) => [px + i / (values.length - 1) * pw, py + ph - (v - lo) / (hi - lo) * ph]);
    return {
      width: AW, height: AH,
      shapes: [line(px, py, px, py + ph, 'fig-axis'), line(px, py + ph, px + pw, py + ph, 'fig-axis'), path(pts(p), 'stroke-seriesTarget fig-series')],
    };
  });

  // ===== 小さな図（見せる側・読みやすい形） =====
  const FRAME = () => rect(0.5, 0.5, SW - 1, SH - 1, 'fig-frame-small fig-nofill');

  // 棒グラフ。mode＝popout（1-1）・share（3-1）・baseline（4-1の読みやすい形）・pair（4-2の読みやすい形）
  register('barChart', (s, ctx) => {
    const ds = ctx.data.datasets, mode = s.mode || 'popout', base = 140, scaleY = 1.2, shapes = [];
    if (mode === 'popout') {
      const values = ds.popBars, hi = ds.popHighlight, slot = 180 / values.length;
      const kind = s.popKind || 'color', d = DIFF.indexOf(s.popDiff || 'large'), v = VARIETY.indexOf(s.popVariety || 'uniform');
      const rng = Core.xorshift32(s.seed || 1);
      values.forEach((val, i) => {
        let width = 10, cls = 'fill-popColor-0';
        if (kind === 'color') cls = i === hi ? `fill-popColor-${d}` : `fill-popOthers-${i % (v + 1)}`;
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

  // 折れ線グラフ。mode＝search（タブ2）・contour（2-3）・region（2-2）・aspect（4-4の読みやすい形）・split（4-3の読みやすい形）
  register('lineChart', (s, ctx) => {
    const ds = ctx.data.datasets, m12 = ds.monthly12, mode = s.mode || 'search', shapes = [];
    const axes = (x0, y0, x1, y1) => [line(x0, y0, x0, y1, 'fig-axis'), line(x0, y1, x1, y1, 'fig-axis')];
    const plot12 = (x0, x1, y0, y1, lo = 0, hi = 100) => ({ x: (i) => x0 + i / 11 * (x1 - x0), y: (v) => y1 - (v - lo) / (hi - lo) * (y1 - y0) });
    if (mode === 'search') {
      const conj = (s.search || 'conjunction') === 'conjunction', P = plot12(14, 158, 12, 138);
      const cls = (i) => {
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
      const { p, q, meet, missing } = m12.cross, P = plot12(14, 168, 12, 138);
      const corner = (s.crossing || 'smooth') === 'corner';
      const A = corner ? [...p.slice(0, meet + 1), ...q.slice(meet + 1)] : p, B = corner ? [...q.slice(0, meet + 1), ...p.slice(meet + 1)] : q;
      const joined = !(s.gap > 0);
      const pieces = (vals) => {
        const keep = vals.map((v, i) => (missing.includes(i) ? null : [P.x(i), P.y(v)]));
        if (joined) return [keep.filter(Boolean)];
        const out = []; let cur = [];
        for (const k of keep) { if (k) cur.push(k); else if (cur.length) { out.push(cur); cur = []; } }
        if (cur.length) out.push(cur);
        return out;
      };
      shapes.push(...axes(14, 12, 168, 138));
      for (const [vals, cls, name] of [[A, 'stroke-seriesTarget', 'A'], [B, 'stroke-seriesOthers-0 line-dashed', 'B']]) {
        for (const piece of pieces(vals)) shapes.push(path(pts(piece), cls + ' fig-series'));
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

  // 迷彩の絵：背景は丸い斑点、物は角の丸い楕円で自分の斑点を持つ。目立ちやすさの数は出さない
  function blobPoints(cx, cy, rx, ry, n = 36) {
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const a = i / n * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
      out.push([cx + rx * Math.sign(c) * Math.abs(c) ** (2 / 3), cy + ry * Math.sign(s) * Math.abs(s) ** (2 / 3)]);
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
    const cx = SW / 2, cy = SH / 2;
    const rx = s.objectShare !== undefined ? SW / 2 * s.objectShare : 32 * scale, ry = s.objectShare !== undefined ? 24 : 20 * scale;
    const outline = blobPoints(cx, cy, rx, ry);
    shapes.push(path(Core.polygonPath(outline), `fill-${mode === 'light' ? 'camoObjLight' : 'camoObj'}-${level}`));
    // 物の斑点：背景と同じ色の組（似ている）か、別の色の組
    const match = s.matchSpots !== false, sr = Math.max(3, Math.min(7, Math.min(rx, ry) * 0.25));
    const objCls = () => (match ? spotCls(Core.randInt(rng, colors)) : `fill-camoObjSpots-${Core.randInt(rng, 3)}`);
    const inner = () => { const a = Core.unit(rng) * 2 * Math.PI, rho = Math.sqrt(Core.unit(rng)) * 0.55; return [Math.cos(a) * rho, Math.sin(a) * rho]; };
    if (s.symmetric) {
      for (let i = 0; i < 5; i += 1) {
        const [u, v] = inner(), cls = objCls();
        shapes.push(circle(cx + Math.abs(u) * rx, cy + v * ry, sr, cls), circle(cx - Math.abs(u) * rx, cy + v * ry, sr, cls));
      }
    } else for (let i = 0; i < 10; i += 1) { const [u, v] = inner(); shapes.push(circle(cx + u * rx, cy + v * ry, sr, objCls())); }
    // 縁にかかる斑点（輪郭を途切れさせる）
    const edges = Math.round((s.edgePatches || 0) * 10);
    for (let i = 0; i < edges; i += 1) {
      const [x, y] = outline[Math.floor(i * outline.length / Math.max(edges, 1) + Core.randInt(rng, 3)) % outline.length];
      shapes.push(circle(x, y, 7, spotCls(Core.randInt(rng, colors))));
    }
    if (s.outline) shapes.push(path(Core.polygonPath(outline), 'camo-outline fig-nofill'));
    if (s.addedLine) shapes.push(line(cx - rx * 0.15, cy - ry * 1.25, cx + rx * 0.25, cy + ry * 1.25, 'camo-line'));
    shapes.push(FRAME());
    return { width: SW, height: SH, shapes };
  });

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
  // 小さな図の下の行：linkedTo（つながる操作の名前を controls の順に）か linkedNone
  function linkedLine(entry, use, values) {
    const { linked } = useSettings(use, values);
    const ids = entry.controls.map((c) => c.id).filter((id) => linked.includes(id));
    return ids.length ? { key: 'linkedTo', controls: ids } : { key: 'linkedNone', controls: [] };
  }
  function linkedText(M, lang, entry, use, values) {
    const D = dictionary(M, lang), l = linkedLine(entry, use, values);
    if (l.key === 'linkedNone') return D.linkedNone;
    return fill(D.linkedTo, { names: l.controls.map((id) => D[`ctl.${entry.id}.${id}`]).join(lang === 'ja' ? '・' : ', ') });
  }
  function renderMain(entry, values, ctx, seed) {
    if (!entry.figure) return null;
    return renderPart(entry.figure.part, { ...entry.figure.params, ...values, seed: seed ?? entry.figure.seed }, ctx);
  }
  function renderUse(use, values, ctx) {
    const { settings } = useSettings(use, values);
    const parts = [renderPart(use.part, settings, ctx)];
    for (const w of use.with || []) parts.push(renderPart(w.part, { ...settings, ...(w.params || {}) }, ctx));
    return compose(parts, use.layout || 'row');
  }

  // ===== タブと項目の見せ方のモデル =====
  const SIDE_LABEL = { show: 'showLabel', hide: 'hideLabel', readable: 'readableLabel', read: 'readLabel' };
  function entryModel(e) {
    const readable = e.uses.length > 0 && e.uses.every((u) => u.side === 'readable');
    // 見せる側の小さな図しかない項目（探す時間）は、見出しに隠す側を書かない
    const showOnly = e.uses.length > 0 && e.uses.every((u) => u.side === 'show');
    const sf = e.safety;
    const safetyActions = [];
    if (sf.motion === 'onPlay') safetyActions.push({ id: 'play', labelKey: 'motionPlay' }, { id: 'stop', labelKey: 'motionStop' });
    if (sf.stripes) safetyActions.push({ id: 'show', labelKey: 'stripesShow' });
    return {
      id: e.id, group: e.group,
      titleKey: `item.${e.id}.title`, oneLineKey: `item.${e.id}.oneLine`, howToKey: `item.${e.id}.howTo`, titleTerms: e.titleTerms,
      figure: e.figure, experiment: !!e.experiment,
      controls: e.controls.map((c) => ({
        ...c, labelKey: `ctl.${e.id}.${c.id}`,
        optionKeys: c.type === 'toggle' ? [] : (c.type === 'choice' || c.named)
          ? controlOptions(c).map((v, i) => `ctl.${e.id}.${c.id}.${c.steps ? c.steps[i] : String(v)}`) : [],
      })),
      actions: e.actions || [],
      usesHeadingKey: readable ? 'usesHeadingReadable' : showOnly ? 'usesHeadingShow' : 'usesHeading',
      uses: e.uses.map((u) => ({ side: u.side, labelKey: SIDE_LABEL[u.side], titleKey: `fig.${e.id}.${u.side}.title`, part: u.part,
        textKey: u.textKey || null, noteKey: u.noteKey || null, link: u.link || null })),
      mainTitleKey: e.figure ? `fig.${e.id}.main.title` : null,
      gapKey: e.gapKey, numbers: e.numbers || null, checkKey: e.checkKey || null, sources: e.sources, related: e.related,
      safety: { noticeKey: sf.stripes ? sf.noticeKey : null, actions: safetyActions, maxSeconds: sf.maxSeconds,
        colorHintKey: sf.colorOnly ? sf.colorHintKey || null : null },
    };
  }
  function buildViewModel(data) {
    const groups = data.groups.slice().sort((a, b) => a.order - b.order);
    return {
      tabs: groups.map((g, i) => ({
        id: g.id, labelKey: g.labelKey, termKey: g.termKey, termTip: g.termTip || null, leadKeys: g.leadKeys || [],
        next: groups[i + 1] ? { id: groups[i + 1].id, labelKey: groups[i + 1].labelKey } : null,
        entries: data.entries.filter((e) => e.group === g.id).sort((a, b) => a.order - b.order).map(entryModel),
      })),
    };
  }

  // ===== 見方の文の選び方 =====
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
        if (values.cue === 'convex') return [{ key: values.regions === 2 ? 'symRead.convex2' : 'symRead.convex8', values: {} }];
        return [{ key: values.cue === 'symmetric' ? 'symRead.symmetric' : 'symRead.none', values: {} }];
      }
      case 'baseline': {
        if (!values.bottom) return [{ key: 'baseRead.zero', values: {} }];
        const out = [{ key: 'baseRead.raised', values: { b: String(values.bottom), r: f2(Core.baselineRatio(ds.libraryLoans3, values.bottom)) } }];
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
        const ends = { start: String(all[0]), end: String(all[all.length - 1]), start6: String(all[all.length - 6]) };
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
    sampleShapes, cellCenter, controlValues, controlOptions, controlEnabled, useSettings, linkedLine, linkedText, buildViewModel, readCases,
    numbersCase, readKeysAll, texts, resultTexts, resultSetTexts, experimentTitle, messageText, descCase, descText, RESULT_SERIES, resultRows,
    resultTop, resultChart, resultChartDesc, resultKey, numberText, stepLabel,
    SIZES: Object.freeze({ square: SQ, cell: CELL, card: [W, H], small: [SW, SH], aspect: [AW, AH] }),
    DIFF, VARIETY, ANGLES, SCALES, JIT_ANGLE, JIT_SCALE,
  });
}));
