/* Vision Trap Atlas - MIT (c) 2026 ipusiron. */
// データだけ（UMD・DOM非依存）：群（タブ）・項目・つまみ・小さな図のつなぎ・架空のデータ・出典・関連ツール・研究の値・図の色。
// 画面の文は messages.js に置き、ここではキーで指す。項目の id は変えない（URL の #<id> とほかのツールからのリンクに使う）。
// 錯視などの群を足すときは groups に1行、entries に項目を足す（uses の side に read を使える）。
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AtlasData = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 安全の印の既定（動かない・縞なし・点滅なし・色だけに頼らない）
  const still = (extra = {}) => ({ motion: 'none', maxSeconds: 0, stripes: false, flashes: false, colorOnly: false, ...extra });
  const COUNTS = [6, 12, 18];

  const groups = [
    { id: 'popout', order: 10, labelKey: 'tabPopout', termKey: 'tabPopoutTerm', termTip: 'termPreattentive' },
    { id: 'search', order: 20, labelKey: 'tabSearch', termKey: 'tabSearchTerm', termTip: 'termVisualSearch' },
    { id: 'gestalt', order: 30, labelKey: 'tabGestalt', termKey: 'tabGestaltTerm', termTip: 'termGrouping' },
    // 項目の後ろに、迷彩を見破る手がかりの箱を置く（2つ目の行は「目立つ」タブの動きの項目へ移る）
    { id: 'figure-ground', order: 40, labelKey: 'tabFigureGround', termKey: 'tabFigureGroundTerm', termTip: 'termFigureGround',
      endBoxes: [{ id: 'camo-clues', headingKey: 'camoCluesHeading', leadKey: 'camoCluesLead', items: [
        { textKey: 'camoClue1', entry: 'figure-ground-symmetry' }, { textKey: 'camoClue2', entry: 'popout-motion' }] }] },
    // 誤読の「グラフ」は専門の言葉ではないので、解説を付けない。項目の後ろに、グラフを読むときの確かめ方の箱を置く
    { id: 'misread', order: 50, labelKey: 'tabMisread', termKey: 'tabMisreadTerm', termTip: null, leadKeys: ['misreadLead', 'misreadFictional'],
      endBoxes: [{ id: 'chart-checks', headingKey: 'chartChecksHeading', leadKey: 'chartChecksLead', items: [
        { textKey: 'chartCheck1', entry: 'misread-baseline' }, { textKey: 'chartCheck2', entry: 'misread-area' },
        { textKey: 'chartCheck3', entry: 'misread-dual-axis' }, { textKey: 'chartCheck4', entry: 'misread-aspect-range' }] }] },
    { id: 'illusion', order: 60, labelKey: 'tabIllusion', termKey: 'tabIllusionTerm', termTip: 'termIllusion' },
  ];

  // endBoxes：タブの項目の後ろ（「次のタブへ」の上）に置く箱。見出し・1文・箇条（各行の末尾に、その項目へ移るボタン）。
  // ボタンの名前は item.<項目の id>.short を toEntry に差し込む。別のタブの項目も指せる（その場合は履歴に積んで移る）
  // uses の bind：{ つまみの id: 小さな図の設定の名前 } か { つまみの id: { to: 設定の名前, map: { つまみの値: 設定の値 } } }。
  // bindWhen：{ つまみの id: [値…] }。いまの値がどれにも当たらないとき、その図はつながらない（既定の絵のまま）
  const entries = [
    {
      id: 'popout-feature', group: 'popout', order: 10,
      titleTerms: [{ term: 'termPopout', ja: 'ポップアウト', en: 'pop-out' }],
      figure: { part: 'popoutGrid', seed: 1101, params: {} },
      controls: [
        { id: 'kind', type: 'choice', options: ['color', 'direction', 'size', 'shape', 'lightness'], default: 'color' },
        { id: 'shape', type: 'choice', options: ['circleSquare', 'tl'], default: 'circleSquare', enabledWhen: { kind: ['shape'] } },
        { id: 'diff', type: 'range', values: ['same', 'small', 'medium', 'large'], named: true, default: 'large',
          disabledWhen: { kind: ['shape'] }, disabledNoteKey: 'shapeNotUsed' },
        { id: 'variety', type: 'range', values: ['uniform', 'some', 'mixed'], named: true, default: 'uniform',
          disabledWhen: { kind: ['shape'] }, disabledNoteKey: 'shapeNotUsed' },
        { id: 'count', type: 'choice', options: COUNTS, default: 18 },
      ],
      actions: ['reshuffle', 'find'],
      read: { cases: 'popout' },
      uses: [
        { side: 'show', part: 'barChart', params: { mode: 'popout', seed: 1191 }, bind: { kind: 'popKind', diff: 'popDiff', variety: 'popVariety' },
          bindWhen: { kind: ['color', 'lightness', 'size'] }, textKey: 'popShow' },
        { side: 'hide', part: 'camoScene', params: { seed: 1192 }, bind: { kind: 'popKind', diff: 'popDiff', variety: 'popVariety' },
          bindWhen: { kind: ['color', 'lightness', 'size'] }, textKey: 'popHide', noteKey: 'hideNote', link: 'day085' },
      ],
      gapKey: null,
      safety: still({ colorOnly: true, colorOnlyWhen: { kind: ['color'] }, colorAlt: { control: 'kind', values: ['direction', 'size'] },
        colorHintKey: 'colorHint' }),
      sources: ['healeyEnns2012', 'wolfeHorowitz2004', 'wolfe2021', 'cuthill2005'],
      related: ['day101', 'day085'],
    },
    {
      id: 'popout-asymmetry', group: 'popout', order: 20,
      titleTerms: [{ term: 'termAsymmetry', ja: '探索非対称性', en: 'search asymmetry' }],
      figure: { part: 'asymGrid', seed: 1202, params: {} },
      controls: [
        { id: 'target', type: 'choice', options: ['withLine', 'noLine'], default: 'withLine' },
        { id: 'count', type: 'choice', options: COUNTS, default: 18 },
      ],
      actions: ['reshuffle', 'find'],
      read: { cases: 'asymmetry' },
      uses: [
        { side: 'show', part: 'markTable', params: {}, bind: { target: { to: 'exception', map: { withLine: 'add', noLine: 'omit' } } },
          textKey: 'asymShow' },
        { side: 'hide', part: 'camoScene', params: { seed: 1292, objLevel: 1 }, bind: { target: { to: 'addedLine', map: { withLine: true, noLine: false } } },
          textKey: 'asymHide', noteKey: 'hideNote', link: 'day085' },
      ],
      gapKey: 'asymGap',
      safety: still(),
      sources: ['treismanSouther1985', 'healeyEnns2012'],
      related: ['day085'],
    },
    {
      // 押したときだけ動く（3秒で止まる）。3つの図を同じ時計で動かす。動きを減らす設定では「次のコマ」で4コマを順に見せる。
      // 止まっている間の絵は、つまみを動かしても変わらない（動きの大きさは、動かしたときに見える）
      id: 'popout-motion', group: 'popout', order: 30,
      titleTerms: [{ term: 'termMotion', ja: '運動', en: 'motion' }],
      figure: { part: 'motionGrid', seed: 1303, params: {} },
      controls: [
        { id: 'amount', type: 'range', values: ['none', 'small', 'medium', 'large'], named: true, default: 'medium' },
        { id: 'others', type: 'choice', options: ['still', 'random'], default: 'still' },
      ],
      actions: [],
      read: { cases: 'motion' },
      uses: [
        { side: 'show', part: 'lineChart', params: { mode: 'motion', seed: 1391 }, bind: { amount: 'motionAmount', others: 'motionOthers' },
          textKey: 'motionShow' },
        // 物と似た模様の物が4つあり、「ばらばらに動く」ではそれらも動く（背景の斑点は動かさない）
        { side: 'hide', part: 'camoScene', params: { seed: 1392 }, bind: { amount: 'motionAmount', others: 'motionOthers' }, textKey: 'motionHide',
          noteKey: 'hideNote', link: 'day085' },
      ],
      gapKey: null,
      safety: still({ motion: 'onPlay', maxSeconds: 3 }),
      sources: ['wolfeHorowitz2004', 'wolfeHorowitz2017', 'hall2013'],
      related: ['day085'],
    },
    {
      id: 'search-time', group: 'search', order: 10, experiment: true,
      titleTerms: [{ term: 'termVisualSearch', ja: '視覚探索', en: 'visual search' }],
      // 上の図はない（探す実験は枠の中で行う）。実験の特徴の組は状態の experiment.set に持つ
      figure: null,
      controls: [
        { id: 'view', type: 'choice', options: ['feature', 'conjunction'], default: 'conjunction' },
      ],
      actions: ['startFeature', 'startConj'],
      read: null,
      uses: [
        { side: 'show', part: 'lineChart', params: { mode: 'search' }, bind: { view: 'search' }, textKey: 'searchShow' },
      ],
      gapKey: 'searchGap',
      safety: still({ colorOnly: true, colorAlt: { experimentSet: 'fill' }, colorHintKey: 'setHint' }),
      sources: ['treismanGelade1980', 'wolfe1994', 'wolfe1998', 'wolfe2021', 'wolfePalmerHorowitz2010', 'ratcliff1993', 'anwylIrvine2021'],
      related: [],
    },
    {
      // 迷彩の物を探す実験（探す実験と同じ枠で行う）。上の図はなく、隠す側の小さな図だけ：つまみの模様で、決まった種の1場面
      // （「印」で蛾の形の場所に破線の印）。図の下の文は模様ごとに1文（見方の文の場合分けで選ぶ）。目立ちやすさの数は出さない
      id: 'search-camo', group: 'search', order: 20, experiment: true,
      titleTerms: [{ term: 'termBackground', ja: '背景合わせ', en: 'background matching' },
        { term: 'termDisruptive', ja: '分断色', en: 'disruptive coloration' }],
      figure: null,
      controls: [
        { id: 'pattern', type: 'choice', options: ['match', 'disrupt', 'symmetric'], default: 'match' },
        { id: 'mark', type: 'choice', options: ['off', 'on'], default: 'off' },
      ],
      actions: ['startCamo'],
      read: { cases: 'camo' },
      uses: [
        { side: 'hide', part: 'camoSearchScene', params: { seed: 2612 }, bind: { pattern: 'pattern', mark: { to: 'mark', map: { off: false, on: true } } },
          textKey: null, noteKey: 'hideNote', link: 'day085' },
      ],
      // 研究と画面の違いの注（探す実験の searchGap と同じ箱。見出しはこの項目のもの）
      gapKey: 'camoGap', gapHeadingKey: 'camoGapHeading',
      safety: still(),
      sources: ['fraser2007', 'webster2013', 'cuthill2006', 'merilaita2017'],
      related: ['day085'],
    },
    {
      id: 'gestalt-proximity-similarity', group: 'gestalt', order: 10,
      titleTerms: [{ term: 'termProximity', ja: '近接', en: 'Proximity' }, { term: 'termSimilarity', ja: '類同', en: 'similarity' }],
      figure: { part: 'proximityGrid', seed: 2101, params: {} },
      controls: [
        { id: 'prox', type: 'range', values: [-2, -1, 0, 1, 2], steps: ['rowsMuch', 'rows', 'even', 'cols', 'colsMuch'], named: true, default: 0 },
        { id: 'sim', type: 'choice', options: ['none', 'rows', 'cols'], default: 'none' },
      ],
      actions: [],
      read: { cases: 'proximity' },
      uses: [
        { side: 'show', part: 'groupedBars', params: {}, bind: { prox: 'groupGap', sim: 'similarity' }, textKey: 'proxShow' },
        // 大きな物と大きな斑点で、背景と同じ色の組か別の組かを、小さな図の大きさでも見分けられるようにする
        { side: 'hide', part: 'camoScene', params: { seed: 2192, objLevel: 1, big: true },
          bind: { sim: { to: 'matchSpots', map: { none: false, rows: true, cols: true } } }, textKey: 'proxHide', noteKey: 'hideNote', link: 'day085' },
      ],
      gapKey: 'proxGap',
      safety: still(),
      sources: ['wertheimer1923', 'wagemans2012'],
      related: ['day085'],
    },
    {
      id: 'gestalt-region-connection', group: 'gestalt', order: 20,
      titleTerms: [{ term: 'termCommonRegion', ja: '共通領域', en: 'common region' },
        { term: 'termConnectedness', ja: '連結性', en: 'element connectedness' }],
      figure: { part: 'regionDots', seed: 2202, params: {} },
      controls: [
        { id: 'link', type: 'choice', options: ['none', 'frame', 'line'], default: 'none' },
      ],
      actions: [],
      read: { cases: 'region' },
      uses: [
        // 見せる側は折れ線グラフと散布図を横に並べる（枠→折れ線に帯、線→散布図の点を線でつなぐ）
        { side: 'show', part: 'lineChart', params: { mode: 'region' }, with: [{ part: 'scatter', params: { mode: 'region' } }], layout: 'row',
          bind: { link: 'region' }, textKey: 'regionShow' },
        { side: 'hide', part: 'camoScene', params: { seed: 2292, objLevel: 1 },
          bind: { link: { to: 'outline', map: { none: false, frame: true, line: true } } }, textKey: 'regionHide', noteKey: 'hideNote', link: 'day085' },
      ],
      gapKey: 'regionGap',
      safety: still(),
      sources: ['palmer1992', 'palmerRock1994', 'wagemans2012', 'stevensMerilaita2009'],
      related: [],
    },
    {
      id: 'gestalt-contour', group: 'gestalt', order: 30,
      titleTerms: [{ term: 'termClosure', ja: '閉合', en: 'closure' }, { term: 'termContinuation', ja: 'よい連続', en: 'good continuation' }],
      figure: { part: 'contour', seed: 2303, params: {} },
      controls: [
        { id: 'gap', type: 'range', values: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6], default: 0, unit: 'percent' },
        { id: 'crossing', type: 'choice', options: ['smooth', 'corner'], default: 'smooth' },
      ],
      actions: [],
      read: { cases: 'contour' },
      uses: [
        { side: 'show', part: 'lineChart', params: { mode: 'contour' }, bind: { gap: 'gap', crossing: 'crossing' }, textKey: 'contourShow' },
        { side: 'hide', part: 'camoScene', params: { seed: 2392, objLevel: 2 }, bind: { gap: 'edgePatches' }, textKey: 'contourHide',
          noteKey: 'hideNote', link: 'day085' },
      ],
      gapKey: null,
      safety: still(),
      sources: ['wertheimer1923', 'cuthill2005', 'stevensMerilaita2009'],
      related: ['day085', 'day075'],
    },
    {
      id: 'figure-ground-area', group: 'figure-ground', order: 10,
      titleTerms: [{ term: 'termFigureGround', ja: '図と地', en: 'figure and ground' }],
      figure: { part: 'sectors', seed: 3101, params: {} },
      controls: [
        // share＝色の濃い扇形の割合。20〜80%を通るので、濃い側が狭いときも薄い側が狭いときも同じつまみで見られる
        { id: 'share', type: 'range', values: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], default: 0.5, unit: 'percent' },
      ],
      actions: [],
      read: { cases: 'area' },
      uses: [
        { side: 'show', part: 'barChart', params: { mode: 'share' }, bind: { share: 'share' }, textKey: 'areaShow', noteKey: 'showNote' },
        { side: 'hide', part: 'camoScene', params: { seed: 3192, objLevel: 2 }, bind: { share: 'objectShare' }, textKey: 'areaHide',
          noteKey: 'hideNote', link: 'day085' },
      ],
      gapKey: 'areaGap',
      safety: still(),
      sources: ['wagemans2012', 'rubin1915'],
      related: ['day070'],
    },
    {
      id: 'figure-ground-symmetry', group: 'figure-ground', order: 20,
      titleTerms: [{ term: 'termFigureGround', ja: '図と地', en: 'figure and ground' }],
      figure: { part: 'symmetryBands', seed: 3202, params: {} },
      controls: [
        { id: 'cue', type: 'choice', options: ['none', 'symmetric', 'convex'], default: 'none' },
        { id: 'regions', type: 'choice', options: [2, 8], default: 8 },
        // 手がかりが「なし」の間は、入れ替える手がかりがないので押せない（押せない理由を下に書く）
        // 押せない間は、図が使っている値（オフ）を押された形で見せる。押せるようになったら前の選択に戻る
        { id: 'swap', type: 'toggle', default: false, disabledWhen: { cue: ['none'] }, disabledNoteKey: 'cueNeeded', offValue: false },
      ],
      actions: [],
      read: { cases: 'symmetry' },
      uses: [
        { side: 'show', part: 'scatter', params: { mode: 'markers' }, bind: { cue: 'marker' }, textKey: 'symShow', noteKey: 'showNote' },
        // 大きな物の左右に4つずつの斑点。「左右対称」のときだけ、右が左の鏡写しになる
        { side: 'hide', part: 'camoScene', params: { seed: 3292, objLevel: 1, big: true, halves: true },
          bind: { cue: { to: 'symmetric', map: { none: false, symmetric: true, convex: false } } }, textKey: 'symHide', noteKey: 'hideNote',
          link: 'day085' },
      ],
      gapKey: 'symGap',
      safety: still(),
      sources: ['wagemans2012', 'cuthill2006'],
      related: ['day085'],
    },
    {
      id: 'misread-baseline', group: 'misread', order: 10,
      titleTerms: [{ term: 'termTruncation', ja: '縦軸の途中の省略', en: 'truncated axis' }],
      figure: { part: 'baselineChart', seed: 4101, params: {} },
      controls: [
        // 既定は誤読しやすい設定（下端40＝高さの比1.50倍）。開いた直後に、上の図と読みやすい形の違いが見える
        { id: 'bottom', type: 'range', values: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50], default: 40 },
        { id: 'chart', type: 'choice', options: ['bar', 'line'], default: 'bar' },
        // 縦軸が0から始まるときは切れていないので、印を押せない（押せない理由を下に書く）。押せない間は、図が使っている値（なし）を
        // 押された形で見せ、押せるようになったら前の選択に戻る
        { id: 'mark', type: 'choice', options: ['none', 'shown'], default: 'none', disabledWhen: { bottom: [0] }, disabledNoteKey: 'bottomNeeded',
          offValue: 'none' },
      ],
      actions: [],
      read: { cases: 'baseline' },
      numbers: 'baseline',
      checkKey: 'baseCheck',
      uses: [
        { side: 'readable', part: 'barChart', params: { mode: 'baseline' }, bind: {}, textKey: 'baseReadable' },
      ],
      gapKey: null,
      safety: still(),
      sources: ['correll2020', 'clevelandMcGill1984', 'lo2022'],
      related: [],
    },
    {
      id: 'misread-area', group: 'misread', order: 20,
      titleTerms: [{ term: 'termAccuracyRank', ja: '読み取りの正確さの順位', en: 'ordering of elementary perceptual tasks' }],
      figure: { part: 'areaPictures', seed: 4202, params: {} },
      controls: [
        { id: 'ratio', type: 'range', values: [1, 1.5, 2, 2.5, 3, 3.5, 4], default: 2 },
        { id: 'stretch', type: 'choice', options: ['height', 'both', 'area'], default: 'both' },
      ],
      actions: [],
      read: { cases: 'areaMis' },
      numbers: 'area',
      checkKey: 'areaCheck',
      uses: [
        { side: 'readable', part: 'barChart', params: { mode: 'pair' }, bind: { ratio: 'ratio' }, textKey: 'areaReadable' },
      ],
      gapKey: null,
      safety: still(),
      sources: ['clevelandMcGill1984', 'heerBostock2010', 'pandey2015'],
      related: [],
    },
    {
      id: 'misread-dual-axis', group: 'misread', order: 30,
      titleTerms: [{ term: 'termDualAxis', ja: '二重軸', en: 'dual axis' }],
      figure: { part: 'dualAxisChart', seed: 4303, params: {} },
      controls: [
        { id: 'rightTop', type: 'range', values: [200, 300, 400, 600], default: 200 },
      ],
      actions: [],
      read: { cases: 'dual' },
      numbers: 'dual',
      checkKey: 'dualCheck',
      uses: [
        { side: 'readable', part: 'lineChart', params: { mode: 'split' }, bind: {}, textKey: 'dualReadable' },
      ],
      gapKey: null,
      safety: still(),
      sources: ['lo2022', 'datawrapperDualAxis'],
      related: [],
    },
    {
      id: 'misread-aspect-range', group: 'misread', order: 40,
      titleTerms: [{ term: 'termAspect', ja: '縦横比', en: 'Aspect ratio' }],
      figure: { part: 'aspectChart', seed: 4404, params: {} },
      controls: [
        { id: 'aspect', type: 'range', values: [0.5, 1, 2, 4], default: 1 },
        // 既定は誤読しやすい設定（最後の6か月）。読みやすい形（24か月・比1）と、開いた直後から違って見える
        { id: 'range', type: 'choice', options: ['all', 'last6'], default: 'last6' },
      ],
      actions: [],
      read: { cases: 'aspect' },
      numbers: 'aspect',
      checkKey: 'aspectCheck',
      uses: [
        { side: 'readable', part: 'lineChart', params: { mode: 'aspect' }, bind: {}, textKey: 'aspectReadable' },
      ],
      gapKey: null,
      safety: still(),
      sources: ['cleveland1988', 'cleveland1993', 'heerAgrawala2006', 'talbot2012', 'lo2022'],
      related: [],
    },
    {
      // 四角の灰色はどの段でも変えない。変わるのは周りだけ（0%では左右の周りが同じ）
      id: 'illusion-lightness-contrast', group: 'illusion', order: 10,
      titleTerms: [{ term: 'termLightnessContrast', ja: '明るさの対比', en: 'lightness contrast' }],
      figure: { part: 'lightnessSquares', seed: 6101, params: {} },
      controls: [
        { id: 'diff', type: 'range', values: [0, 0.25, 0.5, 0.75, 1], default: 0.75, unit: 'percent' },
        { id: 'compare', type: 'choice', options: ['apart', 'band'], default: 'apart' },
      ],
      actions: [],
      read: { cases: 'lightness' },
      uses: [
        { side: 'show', part: 'heatmap', params: {}, bind: { diff: 'spread' }, textKey: 'lightShow' },
        // 物の明るさは左の背景に合わせたまま、右の背景だけが明るくなる
        { side: 'hide', part: 'camoScene', params: { seed: 6192 }, bind: { diff: 'splitDiff' }, textKey: 'lightHide', noteKey: 'hideNote',
          link: 'day085' },
      ],
      gapKey: null,
      safety: still(),
      sources: ['adelson2000', 'mittelstadt2014', 'merilaita2017'],
      related: ['day101', 'day085'],
    },
  ];

  // 出典（level は確かめの度合い A・B・C。画面とREADMEには出さない）
  const sources = {
    treismanGelade1980: { cite: 'Treisman, A. M., & Gelade, G. (1980). A feature-integration theory of attention. Cognitive Psychology, 12(1), 97–136.',
      doi: '10.1016/0010-0285(80)90005-5', level: 'A' },
    treismanSouther1985: { cite: 'Treisman, A., & Souther, J. (1985). Search asymmetry: A diagnostic for preattentive processing of separable '
      + 'features. Journal of Experimental Psychology: General, 114(3), 285–310.', doi: '10.1037/0096-3445.114.3.285', level: 'B' },
    wolfe1994: { cite: 'Wolfe, J. M. (1994). Guided Search 2.0: A revised model of visual search. Psychonomic Bulletin & Review, 1(2), 202–238.',
      doi: '10.3758/BF03200774', level: 'B' },
    wolfe1998: { cite: 'Wolfe, J. M. (1998). What can 1 million trials tell us about visual search? Psychological Science, 9(1), 33–39.',
      doi: '10.1111/1467-9280.00006', level: 'A' },
    wolfe2021: { cite: 'Wolfe, J. M. (2021). Guided Search 6.0: An updated model of visual search. Psychonomic Bulletin & Review, 28(4), 1060–1092.',
      doi: '10.3758/s13423-020-01859-9', level: 'A' },
    wolfePalmerHorowitz2010: { cite: 'Wolfe, J. M., Palmer, E. M., & Horowitz, T. S. (2010). Reaction time distributions constrain models of visual '
      + 'search. Vision Research, 50(14), 1304–1311.', doi: '10.1016/j.visres.2009.11.002', level: 'B' },
    wolfeHorowitz2004: { cite: 'Wolfe, J. M., & Horowitz, T. S. (2004). What attributes guide the deployment of visual attention and how do they do '
      + 'it? Nature Reviews Neuroscience, 5(6), 495–501.', doi: '10.1038/nrn1411', level: 'A' },
    wolfeHorowitz2017: { cite: 'Wolfe, J. M., & Horowitz, T. S. (2017). Five factors that guide attention in visual search. Nature Human Behaviour, '
      + '1(3), 0058.', doi: '10.1038/s41562-017-0058', level: 'A' },
    hall2013: { cite: 'Hall, J. R., Cuthill, I. C., Baddeley, R., Shohet, A. J., & Scott-Samuel, N. E. (2013). Camouflage, detection and '
      + 'identification of moving targets. Proceedings of the Royal Society B, 280(1758), 20130064.', doi: '10.1098/rspb.2013.0064', level: 'A' },
    healeyEnns2012: { cite: 'Healey, C. G., & Enns, J. T. (2012). Attention and visual memory in visualization and computer graphics. IEEE '
      + 'Transactions on Visualization and Computer Graphics, 18(7), 1170–1188.', doi: '10.1109/TVCG.2011.127', level: 'A' },
    ratcliff1993: { cite: 'Ratcliff, R. (1993). Methods for dealing with reaction time outliers. Psychological Bulletin, 114(3), 510–532.',
      doi: '10.1037/0033-2909.114.3.510', level: 'B' },
    anwylIrvine2021: { cite: 'Anwyl-Irvine, A., et al. (2021). Realistic precision and accuracy of online experiment platforms, web browsers, and '
      + 'devices. Behavior Research Methods, 53(4), 1407–1425.', doi: '10.3758/s13428-020-01501-5', level: 'A' },
    wertheimer1923: { cite: 'Wertheimer, M. (1923). Untersuchungen zur Lehre von der Gestalt. II. Psychologische Forschung, 4(1), 301–350. English '
      + 'translation: Laws of organization in perceptual forms. In W. D. Ellis (Ed.), A source book of Gestalt psychology (pp. 71–88). Routledge & '
      + 'Kegan Paul, 1938.', doi: '10.1007/BF00410640', level: 'A' },
    palmer1992: { cite: 'Palmer, S. E. (1992). Common region: A new principle of perceptual grouping. Cognitive Psychology, 24(3), 436–447.',
      doi: '10.1016/0010-0285(92)90014-S', level: 'B' },
    palmerRock1994: { cite: 'Palmer, S., & Rock, I. (1994). Rethinking perceptual organization: The role of uniform connectedness. Psychonomic '
      + 'Bulletin & Review, 1(1), 29–55.', doi: '10.3758/BF03200760', level: 'B' },
    wagemans2012: { cite: 'Wagemans, J., Elder, J. H., Kubovy, M., Palmer, S. E., Peterson, M. A., Singh, M., & von der Heydt, R. (2012). A century '
      + 'of Gestalt psychology in visual perception: I. Perceptual grouping and figure–ground organization. Psychological Bulletin, 138(6), '
      + '1172–1217.', doi: '10.1037/a0029333', level: 'A' },
    rubin1915: { cite: 'Rubin, E. (1915). Synsoplevede Figurer: Studier i psykologisk Analyse. Gyldendalske Boghandel, Nordisk Forlag.', doi: null,
      level: 'C' },
    stevensMerilaita2009: { cite: 'Stevens, M., & Merilaita, S. (2009). Defining disruptive coloration and distinguishing its functions. '
      + 'Philosophical Transactions of the Royal Society B, 364(1516), 481–488.', doi: '10.1098/rstb.2008.0216', level: 'A' },
    cuthill2005: { cite: 'Cuthill, I. C., Stevens, M., Sheppard, J., Maddocks, T., Párraga, C. A., & Troscianko, T. S. (2005). Disruptive '
      + 'coloration and background pattern matching. Nature, 434(7029), 72–74.', doi: '10.1038/nature03312', level: 'B' },
    cuthill2006: { cite: 'Cuthill, I. C., Hiby, E., & Lloyd, E. (2006). The predation costs of symmetrical cryptic coloration. Proceedings of the '
      + 'Royal Society B, 273, 1267–1271.', doi: '10.1098/rspb.2005.3438', level: 'B' },
    clevelandMcGill1984: { cite: 'Cleveland, W. S., & McGill, R. (1984). Graphical perception: Theory, experimentation, and application to the '
      + 'development of graphical methods. Journal of the American Statistical Association, 79(387), 531–554.',
    doi: '10.1080/01621459.1984.10478080', level: 'A' },
    heerBostock2010: { cite: 'Heer, J., & Bostock, M. (2010). Crowdsourcing graphical perception: Using Mechanical Turk to assess visualization '
      + 'design. Proceedings of CHI 2010, 203–212.', doi: '10.1145/1753326.1753357', level: 'A' },
    pandey2015: { cite: 'Pandey, A. V., Rall, K., Satterthwaite, M. L., Nov, O., & Bertini, E. (2015). How deceptive are deceptive visualizations?: An '
      + 'empirical analysis of common distortion techniques. Proceedings of CHI 2015, 1469–1478.', doi: '10.1145/2702123.2702608', level: 'B' },
    correll2020: { cite: 'Correll, M., Bertini, E., & Franconeri, S. (2020). Truncating the y-axis: Threat or menace? Proceedings of CHI 2020, 1–12.',
      doi: '10.1145/3313831.3376222', level: 'A' },
    lo2022: { cite: 'Lo, L. Y.-H., Gupta, A., Shigyo, K., Wu, A., Bertini, E., & Qu, H. (2022). Misinformed by visualization: What do we learn from '
      + 'misinformative visualizations? Computer Graphics Forum, 41(3), 515–525.', doi: '10.1111/cgf.14559', level: 'A' },
    datawrapperDualAxis: { cite: 'Muth, L. C. (2018). Why not to use two axes, and what to use instead. Datawrapper Blog.', doi: null,
      url: 'https://www.datawrapper.de/blog/dualaxis', level: 'A' },
    cleveland1988: { cite: 'Cleveland, W. S., McGill, M. E., & McGill, R. (1988). The shape parameter of a two-variable graph. Journal of the '
      + 'American Statistical Association, 83(402), 289–300.', doi: '10.1080/01621459.1988.10478598', level: 'B' },
    cleveland1993: { cite: 'Cleveland, W. S. (1993). Visualizing Data. Hobart Press.', doi: null, level: 'C' },
    heerAgrawala2006: { cite: 'Heer, J., & Agrawala, M. (2006). Multi-scale banking to 45 degrees. IEEE Transactions on Visualization and Computer '
      + 'Graphics, 12(5), 701–708.', doi: '10.1109/TVCG.2006.163', level: 'A' },
    talbot2012: { cite: 'Talbot, J., Gerth, J., & Hanrahan, P. (2012). An empirical model of slope ratio comparisons. IEEE Transactions on '
      + 'Visualization and Computer Graphics, 18(12), 2613–2620.', doi: '10.1109/TVCG.2012.196', level: 'B' },
    adelson2000: { cite: 'Adelson, E. H. (2000). Lightness perception and lightness illusions. In M. Gazzaniga (Ed.), The New Cognitive '
      + 'Neurosciences (2nd ed., pp. 339–351). MIT Press.', doi: null, level: 'A' },
    mittelstadt2014: { cite: 'Mittelstädt, S., Stoffel, A., & Keim, D. A. (2014). Methods for compensating contrast effects in information '
      + 'visualization. Computer Graphics Forum, 33(3), 231–240.', doi: '10.1111/cgf.12379', level: 'A' },
    merilaita2017: { cite: 'Merilaita, S., Scott-Samuel, N. E., & Cuthill, I. C. (2017). How camouflage works. Philosophical Transactions of the '
      + 'Royal Society B, 372(1724), 20160341.', doi: '10.1098/rstb.2016.0341', level: 'A' },
    fraser2007: { cite: 'Fraser, S., Callahan, A., Klassen, D., & Sherratt, T. N. (2007). Empirical tests of the role of disruptive coloration in '
      + 'reducing detectability. Proceedings of the Royal Society B, 274(1615), 1325–1331.', doi: '10.1098/rspb.2007.0153', level: 'A' },
    webster2013: { cite: 'Webster, R. J., Hassall, C., Herdman, C. M., Godin, J.-G. J., & Sherratt, T. N. (2013). Disruptive camouflage impairs '
      + 'object recognition. Biology Letters, 9(6), 20130501.', doi: '10.1098/rsbl.2013.0501', level: 'A' },
  };

  // 関連ツール（目の性質を扱うものだけ）。リンクは別タブ
  const relatedTools = {
    day101: { name: 'Color Hack Box', url: 'https://ipusiron.github.io/color-hack-box/', textKey: 'relDay101' },
    day085: { name: 'CamoForge', url: 'https://ipusiron.github.io/camoforge/', textKey: 'relDay085' },
    day070: { name: 'VisualCryptography CipherLab', url: 'https://ipusiron.github.io/visual-cryptography-cipherlab/', textKey: 'relDay070' },
    day075: { name: 'CAPTCHA Art Generator', url: 'https://ipusiron.github.io/captcha-art-generator/', textKey: 'relDay075' },
    day125: { name: 'Overlay QR Shares', url: 'https://ipusiron.github.io/overlay-qr-shares/', textKey: 'relDay125' },
  };

  // 架空のデータ（すべて架空）
  const datasets = {
    libraryLoans3: [52, 55, 58], // 百冊。4月・5月・6月
    townTemp: [4, 5, 9, 14, 19, 22, 26, 27, 23, 17, 11, 6], // ℃。1〜12月
    townRain: [50, 60, 110, 130, 140, 170, 160, 120, 210, 190, 90, 50], // mm
    libraryLoans24: [40, 42, 41, 44, 46, 45, 48, 50, 49, 52, 54, 53, 56, 58, 57, 60, 62, 61, 60, 58, 57, 55, 54, 52], // 百冊
    monthly12: {
      series6: [
        [30, 33, 39, 44, 50, 55, 60, 64, 70, 75, 80, 85],
        [56, 55, 58, 57, 60, 62, 76, 80, 74, 66, 68, 71],
        [15, 19, 22, 27, 31, 35, 40, 43, 47, 51, 54, 57],
        [66, 64, 63, 60, 58, 56, 53, 50, 48, 46, 45, 43],
        [44, 46, 45, 42, 40, 38, 37, 35, 33, 32, 30, 29],
        [88, 82, 77, 70, 64, 57, 50, 44, 36, 29, 22, 15],
      ],
      target: 1,         // 探す系列（結合探索の形では「青の破線」）
      band: [6, 8],      // 2-2 の帯（7〜9月）
      cross: {
        p: [20, 26, 31, 37, 44, 50, 56, 63, 68, 74, 79, 85],
        q: [82, 77, 71, 64, 57, 50, 43, 37, 30, 24, 19, 15],
        meet: 5,         // 6月（p と q が同じ 50）
        missing: [8, 9], // 9・10月
        // 輪郭の途切れを上げると、10%ごとにこの順で欠けた月を足す（3・8・11・4・2月。交わる6月とその前後、両端の1月・12月は残す）
        missingMore: [2, 7, 10, 3, 1],
      },
    },
    // 小さな図の値（すべて架空。縦軸0〜100）
    popBars: [62, 80, 54, 92, 70, 48, 76, 58],        // 1-1 の見せる側。強調するのは添字3
    popHighlight: 3,
    shareBars: [55, 78, 64, 90, 47, 70],              // 3-1 の見せる側
    groupBars: [[60, 72, 50, 84], [66, 58, 78, 70], [52, 80, 64, 74]], // 2-1 の見せる側（3つの組×4本）
    scatter8: [[10, 30], [22, 42], [34, 38], [46, 56], [58, 52], [70, 70], [82, 66], [94, 84]], // 2-2 の散布図（順に並んだ8点）
    scatter12: [[12, 20], [20, 46], [28, 30], [36, 64], [44, 40], [52, 76], [60, 52], [68, 28], [76, 62], [84, 44], [88, 80], [94, 58]], // 3-2
    // 明るさの対比の見せる側（5×5。'A'・'B'＝同じ値のマス、'L'＝Aを囲むマス、'H'＝Bを囲むマス、数＝決まった値）。
    // A・Bは heatSame、Lは heatSame−heatStep×差、Hは heatSame＋heatStep×差（差＝周りの明るさの差 0〜1）。決まった値に heatSame はない
    heat5: [['L', 'L', 'L', 40, 60], ['L', 'A', 'L', 60, 70], ['L', 'L', 'L', 'H', 'H'], [40, 30, 'H', 'B', 'H'], [30, 40, 'H', 'H', 'H']],
    heatSame: 50,
    heatStep: 40,
  };

  // 研究の値（参考の表。図形1つあたりのミリ秒）
  const references = {
    treisman1980: { featurePresent: 3.1, featureAbsent: 25.1, conjPresent: 28.7, conjAbsent: 67.1 },
    wolfe1998: { featurePresent: 3, featureAbsent: 6, conjPresent: 10, conjAbsent: 27, approx: true },
  };

  // 図の色（明暗のテーマごと）。図の部品は色を書かず、クラス fill-<名前>[-<添字>]・stroke-<名前>[-<添字>] を付ける。
  // style.css はこの値を CSS の変数に写す（テストで値が一致することを確かめる）。
  // popColor：1-1 の色の4段（ほかの図形の色から探すものの色へ 0・30・60・100% 混ぜる）。popLight：明るさの4段。
  // camoMarks：3-2 の物の斑点の3色（物の地の色 camoObj-1 と3:1以上離す）。
  // camoSpots：迷彩の絵の背景の斑点の3色（岡部・伊藤の配色から選ばない）。camoObj：物と背景の色の差の4段（camoBase から camoFar へ 0・30・60・100%）
  // regionA・regionB：3-2 の1つおきの帯。areaDark・areaLight：3-1 の色の濃い扇形と薄い扇形（見せる側の棒と背景も同じ2色）。
  // 文が「色の濃い扇形」と呼ぶので、どちらのテーマでも areaDark のほうを暗くする。暗いテーマの areaDark は中間の明るさにして、
  // 図の背景（paper）と2:1以上離す（背景と同じような色だと、扇形が穴のように見える）。
  // 明るさの対比（どちらのテーマでも同じ値）：lightGray＝四角と帯の灰色（どの段でも同じ）。lightLeft・lightRight＝周りの明るさの差の5段の
  // 左（暗くなる）と右（明るくなる）の周り。0%は左右とも同じ #9e9e9e で、四角の灰色と分けて置くので、0%でも四角が見える。
  // heat＝ヒートマップの値0〜100の10刻みの段（岡部・伊藤の配色の青 #0072b2 を白で薄める。値0で白90%、値100で0%）。heatText＝マスに書く数。
  // veil＝迷彩の右の背景を明るくする薄い白（不透明度は図が付ける）。
  // 迷彩の探す実験（どちらのテーマでも同じ値）：bark＝樹皮の4色（茶と灰。0が最も濃く3が最も明るい。1が地の色。岡部・伊藤の配色から選ばない）。
  // barkMark＝蛾の形に付ける破線の印（どの樹皮の色とも3:1以上）
  const palette = {
    light: {
      paper: '#fffdf7', ink: '#152b45',
      stimCool: '#0072b2', stimHot: '#d55e00',
      popColor: ['#0072b2', '#406c7d', '#806647', '#d55e00'],
      popOthers: ['#0072b2', '#009e73', '#cc79a7'],
      popLight: ['#0072b2', '#00639b', '#005484', '#00466d'],
      popLightOthers: ['#0072b2', '#2184bc', '#4095c5'],
      seriesTarget: '#0072b2',
      seriesOthers: ['#d55e00', '#009e73', '#cc79a7'],
      groups: ['#0072b2', '#d55e00', '#009e73', '#cc79a7'],
      regionA: '#34495e', regionB: '#e3dccb',
      areaDark: '#34495e', areaLight: '#e3dccb',
      band: '#e9e2d0',
      camoBase: '#c9c1a5', camoFar: '#a8432a',
      camoSpots: ['#8a9a5b', '#a39069', '#6b705c'],
      camoObj: ['#c9c1a5', '#bf9b80', '#b5755b', '#a8432a'],
      camoObjLight: ['#c9c1a5', '#afa890', '#958f7a', '#7b7665'],
      camoSpotsLight: ['#8a9a5b', '#9ca974', '#adb88c'],
      camoObjSpots: ['#7b6a96', '#4f7a8f', '#9a6d55'],
      camoMarks: ['#33452f', '#4d3b5e', '#4a3424'],
      lightGray: '#8c8c8c',
      lightLeft: ['#9e9e9e', '#7b7b7b', '#575757', '#343434', '#101010'],
      lightRight: ['#9e9e9e', '#b3b3b3', '#c7c7c7', '#dcdcdc', '#f0f0f0'],
      heat: ['#e6f1f7', '#cfe4f0', '#b8d8e9', '#a1cbe3', '#8abedc', '#73b1d5', '#5ca5ce', '#4598c7', '#2e8bc0', '#177fb9', '#0072b2'],
      heatText: '#152b45',
      veil: '#ffffff',
      bark: ['#2e2822', '#4f4438', '#6e6a62', '#8f877b'],
      barkMark: '#ffffff',
    },
    dark: {
      paper: '#172940', ink: '#eaf1f6',
      stimCool: '#56b4e9', stimHot: '#e69f00',
      popColor: ['#56b4e9', '#81aea3', '#aca75d', '#e69f00'],
      popOthers: ['#56b4e9', '#009e73', '#cc79a7'],
      popLight: ['#56b4e9', '#80c7ef', '#aedbf4', '#dceffa'],
      popLightOthers: ['#56b4e9', '#4da0cf', '#448eb8'],
      seriesTarget: '#56b4e9',
      seriesOthers: ['#e69f00', '#009e73', '#cc79a7'],
      groups: ['#56b4e9', '#e69f00', '#009e73', '#cc79a7'],
      regionA: '#c9d6e2', regionB: '#2c405a',
      areaDark: '#4f6782', areaLight: '#c9d6e2',
      band: '#24384f',
      camoBase: '#4a5240', camoFar: '#d08a5c',
      camoSpots: ['#6e7d4f', '#7a6c52', '#3a4535'],
      camoObj: ['#4a5240', '#726348', '#9a7451', '#d08a5c'],
      camoObjLight: ['#4a5240', '#777d70', '#a8aca3', '#d9dbd7'],
      camoSpotsLight: ['#6e7d4f', '#5e6a43', '#4d5837'],
      camoObjSpots: ['#9a88b5', '#6f9ab0', '#b88b70'],
      camoMarks: ['#cfe0b4', '#d9e4f0', '#f2e2c4'],
      lightGray: '#8c8c8c',
      lightLeft: ['#9e9e9e', '#7b7b7b', '#575757', '#343434', '#101010'],
      lightRight: ['#9e9e9e', '#b3b3b3', '#c7c7c7', '#dcdcdc', '#f0f0f0'],
      heat: ['#e6f1f7', '#cfe4f0', '#b8d8e9', '#a1cbe3', '#8abedc', '#73b1d5', '#5ca5ce', '#4598c7', '#2e8bc0', '#177fb9', '#0072b2'],
      heatText: '#152b45',
      veil: '#ffffff',
      bark: ['#2e2822', '#4f4438', '#6e6a62', '#8f877b'],
      barkMark: '#ffffff',
    },
  };

  return { schema: 'vision-trap-atlas/data@1', groups, entries, sources, relatedTools, datasets, references, palette };
}));
