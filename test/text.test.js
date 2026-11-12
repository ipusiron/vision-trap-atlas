'use strict';
// E: the sentences that change with values: every case is built in both languages with nothing left to fill in,
// and the known sentences of the spec come out exactly.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../atlas-core.js');
const D = require('../atlas-data.js');
const V = require('../atlas-view.js');
const S = require('../atlas-search.js');
const M = require('../messages.js');

const LEFTOVER = /\{[a-zA-Z0-9_]+\}/;
const entry = (id) => D.entries.find((e) => e.id === id);
function combos(e) {
  let list = [{}];
  for (const c of e.controls) list = list.flatMap((v) => V.controlOptions(c).map((x) => ({ ...v, [c.id]: x })));
  return list;
}
const TIMES = [{}, { times: { withLine: 0.66, noLine: null } }, { times: { withLine: null, noLine: 2.14 } }, { times: { withLine: 0.66, noLine: 2.14 } }];
const read = (lang, id, values, extra) => V.texts(M, lang, V.readCases(D, id, values, extra));
const numbers = (lang, id, values) => V.messageText(M, lang, V.numbersCase(D, id, values));

test('E: every reading sentence, number line and linked line is filled in, in both languages', () => {
  let n = 0;
  for (const e of D.entries) {
    for (const values of combos(e)) {
      for (const lang of ['ja', 'en']) {
        for (const extra of e.id === 'popout-asymmetry' ? TIMES : [{}]) {
          for (const s of read(lang, e.id, values, extra)) { assert.doesNotMatch(s, LEFTOVER, `${e.id} ${lang} ${s}`); n += 1; }
        }
        if (V.numbersCase(D, e.id, values)) assert.doesNotMatch(numbers(lang, e.id, values), LEFTOVER);
        for (const u of e.uses) assert.doesNotMatch(V.linkedText(M, lang, e, u, values), LEFTOVER);
      }
    }
  }
  assert.ok(n > 1000);
});

test('E: the same key has the same placeholders in Japanese and English', () => {
  const ph = (s) => [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(M.ja)) assert.deepEqual(ph(M.ja[key]), ph(M.en[key]), key);
});

test('E: the known sentences of the spec', () => {
  const [raised] = read('ja', 'misread-baseline', { bottom: 50, chart: 'bar', mark: 'none' });
  assert.equal(raised, '縦軸を50から始めたので、下端からの高さの比は4.00倍になり、値の比の1.12倍より大きく見えます。');
  const [cross] = read('ja', 'misread-dual-axis', { rightTop: 300 });
  assert.equal(cross, '右の縦軸の上端を300mmにすると、2本の線は3回交わります。交わる所に意味はありません。軸の範囲を変えるだけで変わる見え方です。');
  const [steep] = read('ja', 'misread-aspect-range', { aspect: 0.5, range: 'all' });
  assert.equal(steep, '線の傾きの平均は67.3度で、線は急に見えます。');
  assert.equal(V.messageText(M, 'ja', { key: 'findTime', values: { t: '0.7' } }), '0.7秒で見つかりました。1回だけの時間は目安です。');
  assert.equal(V.messageText(M, 'en', { key: 'findTime', values: { t: '0.7' } }), 'Found in 0.7 s. A single time is only a rough guide.');
  assert.equal(read('en', 'misread-baseline', { bottom: 50, chart: 'bar', mark: 'none' })[0],
    'The vertical axis now starts at 50, so the height ratio above the bottom is 4.00×, which looks larger than the value ratio of 1.12×.');
  assert.deepEqual(read('ja', 'misread-baseline', { bottom: 0, chart: 'line', mark: 'shown' }),
    ['縦軸は0から始まっています。下端からの高さの比は、値の比と同じ1.12倍です。']);
  assert.equal(numbers('ja', 'misread-baseline', { bottom: 25, chart: 'bar', mark: 'none' }), '値の比：58÷52＝1.12倍／下端からの高さの比：1.22倍');
  assert.equal(numbers('ja', 'misread-area', { ratio: 2, stretch: 'both' }), '値の比：2.00倍／高さの比：2.00倍／面積の比：4.00倍');
  assert.equal(read('ja', 'misread-area', { ratio: 2, stretch: 'area' })[0],
    '面積を値の比と同じ2.00倍にしました（高さは1.41倍）。それでも、面積は長さより読み取りにくいことが知られています。');
  assert.equal(read('ja', 'misread-area', { ratio: 1, stretch: 'both' })[0], '値の比が1倍なので、2つの絵は同じ大きさです。');
  assert.equal(numbers('ja', 'misread-dual-axis', { rightTop: 400 }), '2本の線が交わる回数：0回');
  assert.equal(read('ja', 'misread-dual-axis', { rightTop: 600 })[0],
    '右の縦軸の上端を600mmにすると、2本の線は交わりません。気温の線が雨の線よりいつも上にあるように見えます。軸の範囲を変えるだけで変わる見え方です。');
  assert.equal(numbers('en', 'misread-aspect-range', { aspect: 4, range: 'last6' }), 'Average slope of the line: 11.3°');
});

test('E: the start and end values of the time-range sentences come from the data', () => {
  assert.deepEqual(read('ja', 'misread-aspect-range', { aspect: 1, range: 'last6' }), [
    '線の傾きの平均は37.6度です。傾きの平均を45度前後にそろえる方法が提案されています（45度が最もよいとは限らない、という報告もあります）。',
    '最後の6か月だけを見ると、60から52へ減っているように見えます。24か月では40から52へ増えています。']);
  assert.equal(read('ja', 'misread-aspect-range', { aspect: 4, range: 'all' })[1], '24か月では、貸出冊数は40から52へ増えています。');
  assert.equal(read('en', 'misread-aspect-range', { aspect: 4, range: 'all' })[1], 'Over 24 months, loans rose from 40 to 52.');
});

test('E: one crossing gets its own sentence ("cross once"), which the data never needs but the function is ready for', () => {
  const data = JSON.parse(JSON.stringify(D));
  data.datasets.townTemp = [0, 15, 30];
  data.datasets.townRain = [30, 15, 0];
  assert.deepEqual(V.readCases(data, 'misread-dual-axis', { rightTop: 30 }), [{ key: 'dualRead.crossOnce', values: { m: '30' } }]);
  assert.equal(V.texts(M, 'en', V.readCases(data, 'misread-dual-axis', { rightTop: 30 }))[0],
    'With the top of the right axis at 30 mm, the two lines cross once. The crossing means nothing; it changes with the axis range alone.');
});

test('E: the reading sentences of 1-2 put the two times side by side', () => {
  assert.deepEqual(read('ja', 'popout-asymmetry', { target: 'noLine', count: 18 }, { times: { withLine: 0.66, noLine: 2.14 } }), [
    'いまは、線のある丸の中から、線のない丸を探します。「線がない」ことは手がかりになりにくく、1つずつ確かめることが多くなります。',
    '線のある丸は0.7秒、線のない丸は2.1秒でした。']);
  assert.equal(read('en', 'popout-asymmetry', { target: 'withLine', count: 6 }, { times: { withLine: 0.66, noLine: null } })[1],
    'Find and tap the other one too to compare the times side by side.');
  assert.equal(read('ja', 'popout-asymmetry', { target: 'withLine', count: 6 })[1], '「探して押す」で時間を測ると、ここに並べて出します。');
});

test('E: the contour sentences put the gap in percent', () => {
  assert.deepEqual(read('ja', 'gestalt-contour', { gap: 0.3, crossing: 'corner' }), [
    '輪郭が30%途切れていても、丸と四角の形に見えやすい状態です（閉合）。',
    '交わる所で2本とも折れています。目はなめらかに続くほうへ線をたどりやすいので、折れた線を別の組み合わせでたどってしまうことがあります（よい連続）。']);
  assert.equal(read('en', 'gestalt-contour', { gap: 0.6, crossing: 'smooth' })[0],
    '60% of the outline is now missing. Compare whether you still see a circle and a square, or just pieces of line.');
});

test('E: every result sentence is filled in, with the search names and the row names in each language', () => {
  const block = (a, b, extra = {}) => ({ rows: { present: { slope: a }, absent: { slope: b } },
    ratioState: a === null || b === null ? null : C.round1(a) < 1 ? 'below1' : 'ok',
    ratio: a !== null && b !== null && C.round1(a) >= 1 ? C.round1(C.round1(b) / C.round1(a)) : null,
    errors: 0, answered: 64, aborted: false, mixedInput: false, granularity: 0.1, ...extra });
  const scenarios = [
    {},
    { feature: block(3.1, 25.1) },
    { conjunction: block(28.7, 67.1, { errors: 8, answered: 60 }) },
    { feature: block(-1.24, 5, { aborted: true, mixedInput: true, granularity: 16.667 }), conjunction: block(10, null) },
    { feature: block(3, 20), conjunction: block(4, 25) },
    { feature: block(3, 20), conjunction: block(28.7, 67.1) },
    { feature: block(3, 20), conjunction: block(4, 5) },
    { feature: block(0.5, 8), conjunction: block(10, 8) },
  ];
  const seen = new Set();
  for (const sc of scenarios) {
    const cases = C.resultCases(sc);
    for (const lang of ['ja', 'en']) {
      for (const s of V.resultTexts(M, lang, cases)) assert.doesNotMatch(s, LEFTOVER, s);
    }
    cases.forEach((c) => seen.add(c.key));
  }
  assert.equal(seen.size, 20, [...seen].join(', '));
  const t = (lang, sc) => V.resultTexts(M, lang, C.resultCases(sc));
  assert.equal(t('ja', { feature: block(3.1, 25.1) })[0], '特徴探索の傾きは、「ある」で1項目あたり3.1ミリ秒、「ない」で25.1ミリ秒でした。結合探索も測ると、傾きを比べられます。');
  assert.equal(t('ja', { feature: block(3.1, 25.1) })[1], '特徴探索では、「ない」の傾きが「ある」の8.1倍で、研究でよく見られる2〜3倍より大きくなりました。');
  assert.equal(t('en', { feature: block(3.1, 25.1) })[1],
    'For feature search, the slope with the bar absent was 8.1× the slope with it present, larger than the 2× to 3× often seen in research.');
  const errors = t('en', { conjunction: block(28.7, 67.1, { errors: 8, answered: 60 }) });
  assert.ok(errors.includes('Conjunction search had 8 wrong answers (13%). Rushing adds mistakes; answer at a pace that keeps you accurate.'));
  const both = t('ja', { feature: block(3, 20), conjunction: block(4, 25) });
  assert.equal(both[0], '1項目あたりの傾きは、特徴探索が「ある」3.0ミリ秒・「ない」20.0ミリ秒、結合探索が「ある」4.0ミリ秒・「ない」25.0ミリ秒でした。');
  assert.equal(both[1], '「ない」の傾きは、2つの探し方で同じくらいでした。回数が少ないと結果はぶれます。もう一度測ると変わることがあります。');
  const odd = t('ja', { feature: block(-1.24, 5, { aborted: true, mixedInput: true, granularity: 16.667 }), conjunction: block(10, null) });
  assert.ok(odd.includes('「結合・ない」は、測れた段が3つ未満なので、傾きを出しません。'));
  assert.ok(odd.includes('このブラウザーは、時刻を約16.7ミリ秒単位で丸めています。傾きは出せますが、ぶれが大きくなります。'));
  assert.ok(t('en', { feature: block(-1.24, 5), conjunction: block(10, null) }).includes(
    '"Conjunction, not there" has fewer than three measured numbers of items, so no slope is given.'));
});

test('E: the experiment texts: the title, the feedback and the progress', () => {
  assert.equal(V.experimentTitle(M, 'ja', 'conjunction', 'color'), '結合探索（色×方向）');
  assert.equal(V.experimentTitle(M, 'en', 'feature', 'fill'), 'Feature search (fill × direction)');
  assert.equal(V.messageText(M, 'ja', { key: 'fbCorrect', values: { t: '0.62' } }), '○ 0.62秒');
  assert.equal(V.messageText(M, 'en', { key: 'expMain', values: { i: 12 } }), 'Recorded 12 / 64');
  // No space between Japanese and the number put in (the rule of the Japanese texts)
  assert.equal(V.messageText(M, 'ja', { key: 'expPractice', values: { i: 3 } }), '練習3／8');
  assert.equal(V.messageText(M, 'ja', { key: 'expMain', values: { i: 12 } }), '本番12／64');
  // The feedback keys of the experiment all exist
  for (const key of ['fbCorrect', 'fbMiss', 'fbFalse', 'fbEarly', 'fbTimeout', 'expHidden', 'expAborted']) {
    assert.ok(typeof M.ja[key] === 'string' && typeof M.en[key] === 'string', key);
  }
  assert.equal(S.TIMING.timeout, 4000);
  assert.equal(M.ja.fbTimeout, '時間切れ（4秒）');
});

test('E: the named steps, the next-tab line and the help label are filled in', () => {
  assert.equal(V.fill(M.ja.nextTab, { tab: M.ja.tabSearch }), '次のタブへ：「探す時間」');
  assert.equal(V.fill(M.en.nextTab, { tab: M.en.tabSearch }), 'Next tab: Search time');
  assert.equal(V.fill(M.ja.termHelpLabel, { term: '傾き' }), '傾きの解説');
  assert.equal(V.fill(M.en.termHelpLabel, { term: 'slope' }), 'About slope');
  assert.throws(() => V.dictionary(M, 'ja').noSuchKey, /missing message/);
});

test('E: the descriptions of the figures of 1-1 and 1-2 (the <desc> of each SVG) are filled in for every setting, in both languages', () => {
  let n = 0;
  for (const id of ['popout-feature', 'popout-asymmetry']) {
    const e = entry(id);
    for (const values of combos(e)) {
      for (const lang of ['ja', 'en']) {
        for (const side of ['main', 'show', 'hide']) {
          const s = V.descText(M, lang, e, values, side);
          assert.equal(typeof s, 'string', `${id} ${side}`);
          assert.doesNotMatch(s, LEFTOVER, `${id} ${lang} ${s}`);
          n += 1;
        }
      }
    }
  }
  assert.ok(n > 500);
  const pf = entry('popout-feature'), d1 = V.controlValues(pf);
  assert.equal(V.descText(M, 'ja', pf, d1, 'main'), '18本の棒のうち1本だけ色が違う。違いの大きさ：大、周りのばらつき：そろっている');
  assert.equal(V.descText(M, 'en', pf, d1, 'main'), '18 bars; only one differs in color. Size of the difference: Large; variety around it: Uniform');
  assert.equal(V.descText(M, 'ja', pf, { ...d1, kind: 'shape', shape: 'tl', count: 6 }, 'main'), '6個の図形のうち1つだけ形が違う（Lの中のT）');
  // Direction and shape do not change the small figures: their descriptions say what is drawn
  assert.equal(V.descText(M, 'ja', pf, { ...d1, kind: 'direction' }, 'show'), '8本の棒のうち1本を色で強調した棒グラフ');
  assert.equal(V.descText(M, 'ja', pf, { ...d1, kind: 'size', diff: 'small' }, 'hide'),
    '斑点の背景に物を置いた迷彩の絵。物と背景の違い（大きさ）：小、背景のばらつき：そろっている');
  const pa = entry('popout-asymmetry');
  assert.equal(V.descText(M, 'ja', pa, { target: 'noLine', count: 12 }, 'main'), '12個の丸。探すもの：線のない丸');
  assert.equal(V.descText(M, 'en', pa, { target: 'withLine', count: 18 }, 'hide'),
    'Camouflage scene: an object on a spotted background, with one straight line added');
  // An entry without its own descriptions yet gives null (the figure then has its title only)
  assert.equal(V.descText(M, 'ja', entry('gestalt-contour'), V.controlValues(entry('gestalt-contour')), 'main'), null);
});

test('E: the texts of the results area: the column of each number of bars, the approximate research values and the chart description', () => {
  assert.deepEqual(C.SET_SIZES.map((n) => V.fill(M.ja.resColItems, { n })), ['3本', '6本', '12本', '18本']);
  assert.deepEqual(C.SET_SIZES.map((n) => V.fill(M.en.resColItems, { n })), ['3 items', '6 items', '12 items', '18 items']);
  assert.equal(V.fill(M.ja.resApprox, { v: 27 }), '約27');
  assert.equal(V.fill(M.en.resApprox, { v: 27 }), 'about 27');
  assert.equal(V.fill(M.ja.termHelpLabel, { term: M.ja.slopeWord }), '傾きの解説');
  assert.equal(V.fill(M.en.termHelpLabel, { term: M.en.slopeWord }), 'About slope');
  for (const lang of ['ja', 'en']) {
    const rows = ['resRowFeatureYes', 'resRowConjNo'].map((k) => M[lang][k]).join(lang === 'ja' ? '・' : ', ');
    assert.doesNotMatch(V.fill(M[lang].resChartDesc, { rows }), /\{|\}/);
    // The research values named in the table come with their note (stimuli and how the values were read)
    assert.ok(M[lang].resRefNote.includes(M[lang].resRefTreisman) && M[lang].resRefNote.includes(M[lang].resRefWolfe), lang);
  }
});
