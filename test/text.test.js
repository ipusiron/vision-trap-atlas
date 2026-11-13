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
  assert.equal(cross, '右の縦軸の上端を300mmにすると、2本の線は3回交わります。交わる所に意味はありません。軸の範囲を変えただけで、見え方が変わります。');
  const [steep] = read('ja', 'misread-aspect-range', { aspect: 0.5, range: 'all' });
  assert.equal(steep, '線の傾きの平均は67.3度で、線は急に見えます。');
  assert.equal(V.messageText(M, 'ja', { key: 'findTime', values: { t: '0.7' } }), '0.7秒で見つかりました。1回だけの時間なので、目安として見てください。');
  assert.equal(V.messageText(M, 'en', { key: 'findTime', values: { t: '0.7' } }), 'Found in 0.7 s. A single time is only a rough guide.');
  assert.equal(read('en', 'misread-baseline', { bottom: 50, chart: 'bar', mark: 'none' })[0],
    'The vertical axis now starts at 50, so the height ratio above the bottom is 4.00×, which looks larger than the value ratio of 1.12×.');
  assert.deepEqual(read('ja', 'misread-baseline', { bottom: 0, chart: 'line', mark: 'shown' }),
    ['縦軸は0から始まっています。下端からの高さの比は、値の比と同じ1.12倍です。']);
  assert.equal(numbers('ja', 'misread-baseline', { bottom: 25, chart: 'bar', mark: 'none' }), '値の比：58÷52＝1.12倍／下端からの高さの比：1.22倍');
  assert.equal(numbers('ja', 'misread-area', { ratio: 2, stretch: 'both' }), '値の比：2.00倍／高さの比：2.00倍／面積の比：4.00倍');
  assert.equal(read('ja', 'misread-area', { ratio: 2, stretch: 'area' })[0],
    '面積を値の比と同じ2.00倍にしました（高さは1.41倍）。それでも、面積は長さより比べにくい、という報告があります。');
  assert.equal(read('en', 'misread-area', { ratio: 2, stretch: 'area' })[0],
    'The area now matches the value ratio of 2.00× (the height is 1.41×). Even so, studies report that areas are harder to compare than lengths.');
  // The line chart sentence reads on its own (it follows the sentence of the raised axis, with or without the one of the mark)
  assert.deepEqual(read('ja', 'misread-baseline', { bottom: 40, chart: 'line', mark: 'none' }), [
    '縦軸を40から始めたので、下端からの高さの比は1.50倍になり、値の比の1.12倍より大きく見えます。',
    '折れ線グラフでも、縦軸の下端を上げるほど差が大きく感じられた、と報告されています。']);
  assert.equal(read('ja', 'misread-area', { ratio: 1, stretch: 'both' })[0], '値の比が1倍なので、2つの絵は同じ大きさです。');
  assert.equal(numbers('ja', 'misread-dual-axis', { rightTop: 400 }), '2本の線が交わる回数：0回');
  assert.equal(read('ja', 'misread-dual-axis', { rightTop: 600 })[0],
    '右の縦軸の上端を600mmにすると、2本の線は交わりません。気温の線が、雨の線よりいつも上にあるように見えます。軸の範囲を変えただけで、見え方が変わります。');
  assert.equal(numbers('en', 'misread-aspect-range', { aspect: 4, range: 'last6' }), 'Average slope of the line: 11.3°');
});

test('E: the start and end values of the time-range sentences come from the data', () => {
  assert.deepEqual(read('ja', 'misread-aspect-range', { aspect: 1, range: 'last6' }), [
    '線の傾きの平均は37.6度です。傾きの平均を45度前後にそろえる方法が提案されています（45度が最もよいとは限らない、という報告もあります）。',
    '最後の6か月だけを見ると、6,000冊から5,200冊へ減っています。24か月で見ると、4,000冊から5,200冊へ増えています。'
      + 'どの期間を見せるかで、受ける印象が逆になります。']);
  // The values are in hundreds of books: the sentences give books with a thousands separator (the axis keeps hundreds)
  assert.equal(read('ja', 'misread-aspect-range', { aspect: 4, range: 'all' })[1], '24か月では、貸出冊数は4,000冊から5,200冊へ増えています。');
  assert.equal(read('en', 'misread-aspect-range', { aspect: 4, range: 'all' })[1], 'Over 24 months, the number of books lent rose from 4,000 to 5,200.');
  assert.equal(read('en', 'misread-aspect-range', { aspect: 1, range: 'last6' })[1], 'Looking only at the last 6 months, the number of books lent fell '
    + 'from 6,000 to 5,200. Over all 24 months, it rose from 4,000 to 5,200. The time range you show can reverse the impression.');
  // The scale of the figure: the first and last month in words
  assert.deepEqual([1, 19, 24].map((n) => V.fill(M.ja['fig.misread-aspect-range.main.month'], { n })), ['1か月目', '19か月目', '24か月目']);
  assert.deepEqual([1, 24].map((n) => V.fill(M.en['fig.misread-aspect-range.main.month'], { n })), ['Month 1', 'Month 24']);
});

test('E: the misreading cards: titles without a second "fictional", the easier-to-read forms each with a sentence, and the defaults', () => {
  for (const id of ['misread-baseline', 'misread-area', 'misread-dual-axis', 'misread-aspect-range']) {
    // The title says 架空 once (the tab says that every value is fictional)
    assert.equal((M.ja[`fig.${id}.main.title`].match(/架空/g) || []).length, 1, id);
    assert.doesNotMatch(M.en[`fig.${id}.main.title`], /fictional data/, id);
    const key = entry(id).uses[0].textKey;
    assert.ok(key && M.ja[key] && M.en[key], `${id} says what is easier to read`);
  }
  assert.deepEqual(entry('misread-area').uses[0].textKey, 'areaReadable');
  assert.deepEqual(entry('misread-dual-axis').uses[0].textKey, 'dualReadable');
  assert.deepEqual(entry('misread-aspect-range').uses[0].textKey, 'aspectReadable');
  // The defaults mislead, so that right after opening the figure and the easier-to-read form differ: the axis from 40 (1.50 times)
  // and the last 6 months (aspect ratio 1)
  assert.deepEqual(V.controlValues(entry('misread-baseline')), { bottom: 40, chart: 'bar', mark: 'none' });
  assert.deepEqual(V.controlValues(entry('misread-aspect-range')), { aspect: 1, range: 'last6' });
  assert.equal(numbers('ja', 'misread-baseline', V.controlValues(entry('misread-baseline'))), '値の比：58÷52＝1.12倍／下端からの高さの比：1.50倍');
  assert.equal(numbers('ja', 'misread-aspect-range', V.controlValues(entry('misread-aspect-range'))), '線の傾きの平均：37.6度');
  // The x-axis of 4-1 has no title (its scale says 4月・5月・6月); the one of 4-3 keeps 月 (its scale is numbers)
  assert.equal(M.ja['fig.misread-baseline.main.axisX'], undefined);
  assert.equal(M.ja['fig.misread-dual-axis.main.axisX'], '月');
});

test('E: the line of numbers under each misreading figure gives the known values of the spec', () => {
  const num = (id, values) => V.numbersCase(D, id, values).values;
  // The height ratio above the bottom: 1.12, 1.22, 1.50 and 4.00 for the bottom at 0, 25, 40 and 50 (the value ratio 58 ÷ 52 is 1.12)
  assert.deepEqual([0, 25, 40, 50].map((bottom) => num('misread-baseline', { bottom, chart: 'bar', mark: 'none' }).r), ['1.12', '1.22', '1.50', '4.00']);
  assert.equal(numbers('ja', 'misread-baseline', { bottom: 50, chart: 'line', mark: 'shown' }), '値の比：58÷52＝1.12倍／下端からの高さの比：4.00倍');
  // The value ratio 2: both ways gives the area ratio 4.00; matching the area gives the height ratio 1.41
  assert.equal(num('misread-area', { ratio: 2, stretch: 'both' }).a, '4.00');
  assert.equal(num('misread-area', { ratio: 2, stretch: 'area' }).h, '1.41');
  assert.equal(numbers('en', 'misread-area', { ratio: 2, stretch: 'area' }), 'Value ratio: 2.00× / Height ratio: 1.41× / Area ratio: 2.00×');
  // The crossings: 2, 3, 0 and 0 for the top of the right axis at 200, 300, 400 and 600 mm
  assert.deepEqual([200, 300, 400, 600].map((rightTop) => num('misread-dual-axis', { rightTop }).n), ['2', '3', '0', '0']);
  // The average slope in degrees: 24 months and the last 6 months, at the aspect ratios 0.5, 1, 2 and 4
  assert.deepEqual([0.5, 1, 2, 4].map((aspect) => num('misread-aspect-range', { aspect, range: 'all' }).deg), ['67.3', '51.4', '33.5', '19.0']);
  assert.deepEqual([0.5, 1, 2, 4].map((aspect) => num('misread-aspect-range', { aspect, range: 'last6' }).deg), ['56.1', '37.6', '21.6', '11.3']);
  assert.equal(numbers('ja', 'misread-aspect-range', { aspect: 0.5, range: 'last6' }), '線の傾きの平均：56.1度');
  // What to check when reading: one line per card, in both languages
  for (const id of ['misread-baseline', 'misread-area', 'misread-dual-axis', 'misread-aspect-range']) {
    const key = entry(id).checkKey;
    assert.ok(M.ja[key].startsWith('読むときに確かめること：') && M.en[key].startsWith('When reading, check: '), id);
  }
});

test('E: a tab is written 「XXX」タブ, not 「XXX」のタブ (the dictionary and the static texts of index.html)', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  for (const [key, text] of Object.entries(M.ja)) assert.doesNotMatch(text, /」のタブ/, key);
  assert.doesNotMatch(html, /」のタブ/);
  assert.equal(M.ja.introFeature3, '「探す時間」タブで、自分が探すのにかかる時間を測り、研究の値と比べる。');
});

test('E: charts stand for showing and camouflage for hiding: the sentences beside the camouflage figures say 迷彩, not 隠す側', () => {
  // The headings of the short table, the names of the two terms and the labels of the small figures keep 見せる側・隠す側
  const kept = ['contrastLine', 'contrastHead.show', 'contrastHead.hide', 'termShowSide', 'termHideSide'];
  for (const [key, text] of Object.entries(M.ja)) if (!kept.includes(key)) assert.doesNotMatch(text, /隠す側|見せる側/, key);
  assert.match(M.ja.intro2, /^見せることを目的とする代表例がグラフ、隠すことを目的とする代表例が迷彩です。/);
  assert.equal(M.ja.termHideSideMeaning, '隠すことを目的とする使い方。代表例は迷彩');
  assert.doesNotMatch(M.en.helpFirstText, /showing and hiding/);
});

test('E: the first steps of the help measure the time that conjunction search takes', () => {
  assert.match(M.ja.helpFirstText, /次に「探す時間」タブで結合探索にかかる時間を測ります。/);
  assert.match(M.en.helpFirstText, /measure how long conjunction search takes you\./);
});

test('E: the short table, the chart beside the contours and the checks when reading a chart', () => {
  assert.equal(M.en['contrastRow2.hide'], 'Break up the outline and make the object\'s pattern part of the background');
  assert.match(M.ja.contourShow, /^0%の図のように、/);
  assert.equal(M.ja.contourShow.split('。').filter(Boolean).length, 3);
  assert.equal(V.fill(M.ja.toEntry, { name: M.ja['item.misread-baseline.short'] }), '「縦軸の始まり」へ');
  assert.equal(V.fill(M.en.toEntry, { name: M.en['item.misread-baseline.short'] }), 'Go to "Where the vertical axis starts"');
  // The short name of an entry is its title without the term in parentheses
  for (const id of ['misread-baseline', 'misread-area', 'misread-dual-axis', 'misread-aspect-range']) {
    for (const lang of ['ja', 'en']) assert.ok(M[lang][`item.${id}.title`].startsWith(M[lang][`item.${id}.short`]), `${lang} ${id}`);
  }
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
  assert.equal(read('ja', 'popout-asymmetry', { target: 'withLine', count: 6 })[1], '「探して押す」で測った時間を、ここに並べて出します。');
  assert.equal(read('ja', 'popout-asymmetry', { target: 'withLine', count: 6 }, { times: { withLine: 0.66, noLine: null } })[1],
    'もう一方も測ると、2つの時間を比べられます。');
});

test('E: the contour sentences put the gap in percent', () => {
  assert.deepEqual(read('ja', 'gestalt-contour', { gap: 0.3, crossing: 'corner' }), [
    '輪郭の30%が途切れていても、丸と四角に見えやすい状態です（閉合）。',
    '2本とも交わる所で折れています。目はなめらかに続くほうへ線をたどるので、実際とは別の組み合わせで線をつないで見てしまうことがあります（よい連続）。']);
  assert.equal(read('ja', 'gestalt-contour', { gap: 0.6, crossing: 'smooth' })[0],
    '輪郭の60%が途切れています。まだ丸と四角に見えるか、ばらばらの線に見えるかを比べてください。');
  assert.equal(read('en', 'gestalt-contour', { gap: 0.6, crossing: 'smooth' })[0],
    '60% of the outline is now missing. Compare whether you still see a circle and a square, or just pieces of line.');
});

test('E: every result sentence is filled in, with the search names and the row names in each language', () => {
  const block = (a, b, extra = {}) => ({ rows: { present: { slope: a }, absent: { slope: b } },
    ratioState: a === null || b === null ? null : C.round1(a) < 1 ? 'below1' : 'ok',
    ratio: a !== null && b !== null && C.round1(a) >= 1 ? C.round1(C.round1(b) / C.round1(a)) : null,
    errors: 0, answered: 32, aborted: false, mixedInput: false, granularity: 0.1, ...extra });
  const scenarios = [
    {},
    { feature: block(3.1, 25.1) },
    { conjunction: block(28.7, 67.1, { errors: 8, answered: 60 }) },
    { feature: block(-1.24, 5, { aborted: true, mixedInput: true, granularity: 16.667 }), conjunction: block(10, null) },
    { feature: block(3, 20), conjunction: block(4, 25) },
    { feature: block(3, 20), conjunction: block(28.7, 67.1) },
    { feature: block(3, 20), conjunction: block(4, 5) },
    { feature: block(0.5, 8), conjunction: block(10, 8) },
    { feature: block(10, -5) },
  ];
  const seen = new Set();
  for (const sc of scenarios) {
    const cases = C.resultCases(sc);
    for (const lang of ['ja', 'en']) {
      for (const s of V.resultTexts(M, lang, cases)) assert.doesNotMatch(s, LEFTOVER, s);
    }
    cases.forEach((c) => seen.add(c.key));
  }
  assert.equal(seen.size, 21, [...seen].join(', '));
  const t = (lang, sc) => V.resultTexts(M, lang, C.resultCases(sc));
  assert.equal(t('ja', { feature: block(3.1, 25.1) })[0],
    '特徴探索の傾き（図形1つあたりに増えた時間）は、「ある」で3.1ミリ秒、「ない」で25.1ミリ秒でした。結合探索も測ると、2つを比べられます。');
  assert.equal(t('ja', { feature: block(3.1, 25.1) })[1], '特徴探索では、「ない」の傾きが「ある」の8.1倍で、研究でよく見られる2〜3倍より大きくなりました。');
  assert.equal(t('en', { feature: block(3.1, 25.1) })[1],
    'For feature search, the slope with the bar absent was 8.1× the slope with it present, larger than the 2× to 3× often seen in research.');
  const errors = t('en', { conjunction: block(28.7, 67.1, { errors: 8, answered: 60 }) });
  assert.ok(errors.includes('Wrong answers in conjunction search: 8 (13%). Rushing adds mistakes; answer at a pace that keeps you accurate.'));
  const both = t('ja', { feature: block(3, 20), conjunction: block(4, 25) });
  assert.equal(both[0], '図形1つあたりの傾きは、特徴探索が「ある」3.0ミリ秒・「ない」20.0ミリ秒、結合探索が「ある」4.0ミリ秒・「ない」25.0ミリ秒でした。');
  assert.equal(both[1], '「ない」の傾きは、2つの探し方で同じくらいでした。回数が少ないと結果はぶれます。もう一度測ると変わることがあります。');
  const odd = t('ja', { feature: block(-1.24, 5, { aborted: true, mixedInput: true, granularity: 16.667 }), conjunction: block(10, null) });
  assert.ok(odd.includes('「結合・ない」は、真ん中の値を出せた図形の数が3つ未満なので、傾きを出しません。'));
  assert.ok(odd.includes('このブラウザーは、時刻を約16.7ミリ秒単位で丸めています。傾きは出せますが、ぶれが大きくなります。'));
  assert.ok(t('en', { feature: block(-1.24, 5), conjunction: block(10, null) }).includes(
    '"Conjunction, not there" has fewer than three measured numbers of items, so no slope is given.'));
});

test('E: repeated result sentences are joined into one, and a negative value has the minus sign', () => {
  const block = (a, b, extra = {}) => ({ rows: { present: { slope: a }, absent: { slope: b } },
    ratioState: a === null || b === null ? null : C.round1(a) < 1 ? 'below1' : 'ok',
    ratio: a !== null && b !== null && C.round1(a) >= 1 ? C.round1(C.round1(b) / C.round1(a)) : null,
    errors: 0, answered: 32, aborted: false, mixedInput: false, granularity: 0.1, ...extra });
  const t = (lang, sc) => V.resultTexts(M, lang, C.resultCases(sc));
  // Wrong answers in both searches: one sentence with both counts (4 of 31 and 4 of 30 answered tries in a block of 32)
  const errors = { feature: block(3, 20, { errors: 4, answered: 31 }), conjunction: block(20, 50, { errors: 4, answered: 30 }) };
  assert.deepEqual(t('ja', errors).filter((x) => x.includes('押し間違い')),
    ['押し間違いは、特徴探索が4回（13%）、結合探索が4回（13%）でした。急ぐと間違いが増えるので、間違えない程度の速さで答えてください。']);
  assert.deepEqual(t('en', errors).filter((x) => x.includes('wrong answers') || x.includes('Wrong answers')),
    ['Wrong answers: 4 (13%) in feature search and 4 (13%) in conjunction search. Rushing adds mistakes; answer at a pace that keeps you accurate.']);
  // In one search only: the sentence of that search, as before
  const oneError = { feature: block(3, 20, { errors: 4, answered: 31 }), conjunction: block(20, 50) };
  assert.deepEqual(t('ja', oneError).filter((x) => x.includes('押し間違い')),
    ['特徴探索の押し間違いは4回（13%）でした。急ぐと間違いが増えるので、間違えない程度の速さで答えてください。']);
  // One wrong answer in a short, stopped run: the English sentence does not depend on singular or plural
  assert.deepEqual(t('en', { feature: block(3, 20, { errors: 1, answered: 5, aborted: true }) }).filter((x) => x.includes('Wrong answers')),
    ['Wrong answers in feature search: 1 (20%). Rushing adds mistakes; answer at a pace that keeps you accurate.']);
  // Rows without a slope: one sentence naming them (two or more), the sentence of the row (one)
  const three = { feature: block(3, null), conjunction: block(null, null, { aborted: true }) };
  assert.ok(t('ja', three).includes('「特徴・ない」「結合・ある」「結合・ない」は、真ん中の値を出せた図形の数が3つ未満なので、傾きを出しません。'));
  assert.ok(t('en', three).includes('"Feature, not there", "Conjunction, there" and "Conjunction, not there" have fewer than three measured numbers of '
    + 'items, so no slopes are given.'));
  const two = { feature: block(3, 20), conjunction: block(null, null, { aborted: true }) };
  assert.ok(t('ja', two).includes('「結合・ある」「結合・ない」は、真ん中の値を出せた図形の数が3つ未満なので、傾きを出しません。'));
  assert.ok(t('en', two).includes('"Conjunction, there" and "Conjunction, not there" have fewer than three measured numbers of items, so no slopes '
    + 'are given.'));
  assert.equal(t('ja', two).filter((x) => x.includes('傾きを出しません')).length, 1);
  assert.ok(t('ja', { feature: block(3, null) }).includes('「特徴・ない」は、真ん中の値を出せた図形の数が3つ未満なので、傾きを出しません。'));
  // The one search with both slopes opens the sentences even when the other search was measured too
  assert.equal(t('ja', two)[0], '特徴探索の傾き（図形1つあたりに増えた時間）は、「ある」で3.0ミリ秒、「ない」で20.0ミリ秒でした。結合探索も測ると、2つを比べられます。');
  // Negative values: the minus sign (U+2212) in both languages, also in a ratio
  assert.equal(t('ja', { feature: block(-2.74, 7) })[0],
    '特徴探索の傾き（図形1つあたりに増えた時間）は、「ある」で\u22122.7ミリ秒、「ない」で7.0ミリ秒でした。結合探索も測ると、2つを比べられます。');
  assert.equal(t('en', { feature: block(-2.74, 7) })[0],
    'For feature search, the slope was \u22122.7 ms per item when the bar was there and 7.0 ms when it was not. Measure conjunction search too to '
    + 'compare the slopes.');
  // A ratio of 0 or less: the sentence without the ratio (a negative ratio cannot be read)
  for (const b of [-5, 0, 0.4]) {
    assert.ok(t('ja', { feature: block(10, b) }).includes('特徴探索では、「ない」の傾きが「ある」より小さくなりました。'), String(b));
    assert.ok(t('en', { feature: block(10, b) }).includes('For feature search, the slope with the bar absent was smaller than with it present.'), String(b));
    assert.ok(!t('ja', { feature: block(10, b) }).some((x) => x.includes('倍）')), String(b));
  }
  assert.ok(t('ja', { feature: block(10, 1) }).includes('特徴探索では、「ない」の傾きが「ある」より小さくなりました（0.1倍）。'));
  assert.equal(t('en', { feature: block(3, 20), conjunction: block(-4, -1.2) })[0],
    'Slopes per item: feature search 3.0 ms (there) and 20.0 ms (not there); conjunction search \u22124.0 ms (there) and \u22121.2 ms (not there).');
  for (const lang of ['ja', 'en']) {
    for (const sc of [{ feature: block(-2.74, -7) }, { feature: block(-3, 2), conjunction: block(-1.5, -20.25) }]) {
      for (const x of t(lang, sc)) assert.doesNotMatch(x, /-[0-9]/, x);
    }
  }
});

test('E: the line of the feature pairs over the chart, and the note under the table of excluded tries', () => {
  const sets = (lang, f, c) => V.resultSetTexts(M, lang, { feature: f ? { set: f } : null, conjunction: c ? { set: c } : null });
  assert.deepEqual(sets('ja', 'color', 'fill'), ['測った特徴の組：特徴探索＝色×方向、結合探索＝塗り×方向',
    '特徴の組が違うので、同じ組で測り直すと比べやすくなります。']);
  assert.deepEqual(sets('en', 'color', 'fill'), ['Measured with color × direction for feature search and fill × direction for conjunction search.',
    'The feature pairs differ, so measuring again with the same pair makes comparison easier.']);
  assert.deepEqual(sets('ja', 'fill', 'fill'), ['測った特徴の組：特徴探索＝塗り×方向、結合探索＝塗り×方向']);
  assert.deepEqual(sets('ja', null, 'color'), ['測った特徴の組：結合探索＝色×方向']);
  assert.deepEqual(sets('en', null, 'fill'), ['Measured with fill × direction for conjunction search.']);
  assert.deepEqual(sets('ja', null, null), []);
  assert.equal(M.ja.resExcludedNote, '除いた回数は、早すぎた回・時間切れの回・押し間違えた回の合計です。真ん中の値と傾きには使っていません。');
  // The note matches the calculation: the excluded count is early + time-outs + wrong answers; a hidden try is not counted at all
  const r = (setSize, present, outcome, rt) => ({ setSize, present, outcome, rt, input: 'key' });
  const rows = [3, 6, 12, 18].flatMap((n) => [600, 610, 620, 630].map((rt) => r(n, true, 'correct', rt)));
  const sum = C.summarizeBlock([...rows, r(3, true, 'early', 120), r(3, true, 'timeout', 4000), r(3, true, 'miss', 700), r(3, true, 'hidden', null)]);
  assert.equal(sum.rows.present.excluded, 3);
  assert.equal(sum.rows.present.cells[3].median, 615, 'the excluded tries are not in the middle value');
});

test('E: the experiment texts: the title, the feedback and the progress', () => {
  assert.equal(V.experimentTitle(M, 'ja', 'conjunction', 'color'), '結合探索（色×方向）');
  assert.equal(V.experimentTitle(M, 'en', 'feature', 'fill'), 'Feature search (fill × direction)');
  assert.equal(V.messageText(M, 'ja', { key: 'fbCorrect', values: { t: '0.62' } }), '○ 0.62秒');
  // The end of a run, without the word for a block of tries
  assert.equal(M.ja.expDone, '測定が終わりました。');
  assert.equal(V.messageText(M, 'en', { key: 'expMain', values: { i: 12 } }), 'Recorded 12 / 32');
  // No space between Japanese and the number put in (the rule of the Japanese texts)
  assert.equal(V.messageText(M, 'ja', { key: 'expPractice', values: { i: 3 } }), '練習3／8');
  assert.equal(V.messageText(M, 'ja', { key: 'expMain', values: { i: 12 } }), '本番12／32');
  // The length of a run said on the tab matches the numbers of tries made by the calculation (8 practice and 32 recorded)
  assert.equal(M.ja.expDuration, '1回は練習8回と本番32回で、約1分半かかります。');
  assert.equal(M.en.expDuration, 'Each run has 8 practice tries and 32 recorded tries and takes about a minute and a half.');
  assert.equal(C.SET_SIZES.length * 2 * C.MAIN_REPS, 32);
  assert.equal(C.SET_SIZES.length * 2 * C.PRACTICE_REPS, 8);
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
});

test('E: the descriptions of the figures of the Grouping and Figure and ground entries: the title with the current settings', () => {
  const ids = ['gestalt-proximity-similarity', 'gestalt-region-connection', 'gestalt-contour', 'figure-ground-area', 'figure-ground-symmetry'];
  let n = 0;
  for (const id of ids) {
    const e = entry(id);
    for (const values of combos(e)) {
      for (const lang of ['ja', 'en']) {
        for (const side of ['main', 'show', 'hide']) {
          const s = V.descText(M, lang, e, values, side);
          // Every small figure of these entries changes with at least one control, so every figure has its description
          assert.equal(typeof s, 'string', `${id} ${side}`);
          assert.doesNotMatch(s, LEFTOVER, `${id} ${lang} ${s}`);
          assert.ok(s.startsWith(M[lang][`fig.${id}.${side}.title`]), `${id} ${side} ${s}`);
          n += 1;
        }
      }
    }
  }
  assert.equal(n, (15 + 3 + 14 + 7 + 12) * 2 * 3);
  const d = (lang, id, values, side) => V.descText(M, lang, entry(id), { ...V.controlValues(entry(id)), ...values }, side);
  // The main figure: every control with its value, in the order of the data
  assert.equal(d('ja', 'gestalt-proximity-similarity', { prox: -2, sim: 'cols' }, 'main'),
    '6×6の点（点の間隔：横がとても狭い、形の変え方：列ごとに形を変える）');
  assert.equal(d('en', 'gestalt-proximity-similarity', { prox: -2, sim: 'cols' }, 'main'),
    'A 6 × 6 grid of dots (Dot spacing: Very tight across; Similarity: Shapes vary by column)');
  assert.equal(d('ja', 'gestalt-contour', { gap: 0.3, crossing: 'corner' }, 'main'),
    '丸と四角、交わる2本の線（輪郭の途切れ：30%、交わり方：交わる所で折れる）');
  assert.equal(d('ja', 'figure-ground-area', { share: 0.2 }, 'main'), '8つの扇形に分けた円（色の濃い扇形の割合：20%）');
  assert.equal(d('en', 'figure-ground-symmetry', { cue: 'convex', regions: 2, swap: false }, 'main'),
    'Bands divided by vertical borders (Cue: Bulging outward; Number of regions: 2; Swap the side with the cue: Off)');
  // While the cue is none, the switch that swaps the side with the cue cannot be pressed, and the description leaves it out
  assert.equal(d('ja', 'figure-ground-symmetry', { cue: 'none', regions: 8, swap: true }, 'main'), '縦の境目で区切った帯（手がかり：なし、領域の数：8）');
  // A small figure: only the controls that change it
  assert.equal(d('ja', 'gestalt-proximity-similarity', {}, 'hide'), '背景の上の物を描いた迷彩の絵（形の変え方：変えない）');
  assert.equal(d('ja', 'gestalt-region-connection', { link: 'line' }, 'show'), '折れ線グラフと散布図（囲む・つなぐ：隣り合う組の点を線でつなぐ）');
  assert.equal(d('ja', 'figure-ground-area', { share: 0.7 }, 'hide'), '背景の上の物を描いた迷彩の絵（色の濃い扇形の割合：70%）');
  assert.equal(d('en', 'gestalt-contour', { gap: 0.6 }, 'show'), 'Two lines with missing months (Gap in the outline: 60%; Crossing: Cross smoothly)');
  // The step names are those of the screen (the same function draws the names under the sliders)
  const prox = entry('gestalt-proximity-similarity').controls[0];
  assert.deepEqual(prox.values.map((v) => V.stepLabel(V.dictionary(M, 'ja'), entry('gestalt-proximity-similarity'), prox, v)),
    ['横がとても狭い', '横が狭い', '縦横で同じ', '縦が狭い', '縦がとても狭い']);
});

test('E: the texts of the results area: the column of each number of items, the approximate research values and the chart description', () => {
  assert.deepEqual(C.SET_SIZES.map((n) => V.fill(M.ja.resColItems, { n })), ['3個', '6個', '12個', '18個']);
  assert.deepEqual(C.SET_SIZES.map((n) => V.fill(M.en.resColItems, { n })), ['3 items', '6 items', '12 items', '18 items']);
  assert.equal(V.fill(M.ja.resApprox, { v: 27 }), '約27');
  assert.equal(V.fill(M.en.resApprox, { v: 27 }), 'about 27');
  assert.equal(V.fill(M.ja.termHelpLabel, { term: M.ja.slopeWord }), '傾きの解説');
  assert.equal(V.fill(M.en.termHelpLabel, { term: M.en.slopeWord }), 'About slope');
  for (const lang of ['ja', 'en']) {
    // The research values named in the table come with their note (stimuli and how the values were read)
    assert.ok(M[lang].resRefNote.includes(M[lang].resRefTreisman) && M[lang].resRefNote.includes(M[lang].resRefWolfe), lang);
  }
  // The chart description names the rows drawn. A row name has 「・」 (or a comma in English) inside, so the names are separated by 「、」
  // (Japanese) and by a semicolon (English)
  const row = (m) => ({ cells: Object.fromEntries(C.SET_SIZES.map((n) => [n, { median: m }])), slope: m === null ? null : 10, accuracy: 1, excluded: 0 });
  const feature = { rows: { present: row(500), absent: row(620) } };
  assert.equal(V.resultChartDesc(M, 'ja', { feature, conjunction: null }),
    '図形の数ごとの真ん中の値を結んだ線（特徴・ある、特徴・ない）。同じ値を下の表に載せています。');
  assert.equal(V.resultChartDesc(M, 'en', { feature, conjunction: null }),
    'Lines joining the middle value for each number of items (Feature, there; Feature, not there). The table below has the same values.');
  const conjunction = { rows: { present: row(700), absent: row(null) } };
  assert.equal(V.resultChartDesc(M, 'ja', { feature, conjunction }),
    '図形の数ごとの真ん中の値を結んだ線（特徴・ある、特徴・ない、結合・ある）。同じ値を下の表に載せています。');
  assert.equal(V.resultChartDesc(M, 'ja', { feature: null, conjunction: null }), null);
});
