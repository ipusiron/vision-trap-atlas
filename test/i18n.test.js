'use strict';
// F: the Japanese and English dictionaries in messages.js: the same keys and placeholders, no Japanese in English, no space between
// Japanese and Latin letters or digits, the avoided words, and the terms (word, specialist word and meaning).
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../messages.js');

// Hiragana, katakana, CJK ideographs, CJK punctuation and full-width forms
const JAPANESE = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿！-｠]/;
const placeholders = (s) => [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();
// The 17 terms that have a screen word and a specialist word, the 19 terms named by their specialist word, and the 2 sides (showing and
// hiding), whose meaning names the typical example instead of a specialist word
const TERMS17 = ['termTarget', 'termDistractor', 'termSetSize', 'termRt', 'termMedian', 'termSlope', 'termIntercept', 'termFeature', 'termConjunction',
  'termPopout', 'termPreattentive', 'termGrouping', 'termFigureGround', 'termBackground', 'termDisruptive', 'termMasquerade', 'termDirection'];
const SIDES = ['termShowSide', 'termHideSide'];
const TERMS19 = ['termVisualSearch', 'termFit', 'termGuided', 'termAsymmetry', 'termMotion', 'termProximity', 'termSimilarity', 'termCommonRegion',
  'termConnectedness', 'termClosure', 'termContinuation', 'termRubin', 'termTruncation', 'termAccuracyRank', 'termDualAxis', 'termAspect',
  'termIllusion', 'termLightnessContrast', 'termFixation'];
// Words this atlas does not use in Japanese (the misleading phrasings of the research notes and the words to avoid)
const AVOIDED = ['分かる', 'おすすめ', 'オススメ', '全て', '既に', '傾き0', '必ず0から', '最適', '閾値', '効く', '走る', '照合', '突き合わせ', '断定', '構図',
  '落とし穴', '潰す', '踏み込', '持ち帰れる'];

test('F: Japanese and English have the same keys, non-empty strings and the same placeholders per key', () => {
  assert.deepEqual(Object.keys(M.ja).sort(), Object.keys(M.en).sort());
  for (const key of Object.keys(M.ja)) {
    assert.equal(typeof M.ja[key], 'string', key);
    assert.equal(typeof M.en[key], 'string', key);
    assert.ok(M.ja[key].trim() && M.en[key].trim(), key);
    assert.deepEqual(placeholders(M.ja[key]), placeholders(M.en[key]), key);
  }
});

test('F: English values contain no Japanese characters or full-width marks', () => {
  for (const [key, value] of Object.entries(M.en)) assert.doesNotMatch(value, JAPANESE, `${key}: ${value}`);
  assert.ok(M.ja.languageToggle.startsWith('EN：'));
  assert.ok(M.en.languageToggle.startsWith('JA: '));
});

test('F: no half-width space between Japanese and Latin letters or digits in Japanese values (also around a number put in)', () => {
  const ja = '[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff]';
  const pattern = new RegExp(`${ja} [A-Za-z0-9]|[A-Za-z0-9] ${ja}`);
  for (const [key, value] of Object.entries(M.ja)) {
    assert.doesNotMatch(value.replace(/\{[a-zA-Z0-9_]+\}/g, '\u0000'), pattern, key);
    // A placeholder is filled with a number or a word; the filled text keeps the rule too
    assert.doesNotMatch(value.replace(/\{[a-zA-Z0-9_]+\}/g, '0'), pattern, key);
  }
});

test('F: Japanese values are not made of Latin letters alone, and avoid the listed words', () => {
  for (const [key, value] of Object.entries(M.ja)) {
    assert.doesNotMatch(value, /^[A-Za-z][A-Za-z ,.'-]*$/, `${key}: ${value}`);
    for (const word of AVOIDED) assert.ok(!value.includes(word), `${key} uses ${word}`);
  }
  for (const [key, value] of Object.entries(M.en)) assert.doesNotMatch(value, /\brecommend|\bmust be optimal|\balways start at (?:0|zero)/i, key);
});

test('F: the 38 terms have a word and a meaning in both languages; the 17 screen words also name the specialist word', () => {
  assert.equal(TERMS17.length + TERMS19.length + SIDES.length, 38);
  for (const key of [...TERMS17, ...TERMS19, ...SIDES]) {
    for (const lang of ['ja', 'en']) {
      assert.equal(typeof M[lang][key], 'string', `${lang} ${key}`);
      assert.equal(typeof M[lang][key + 'Meaning'], 'string', `${lang} ${key}Meaning`);
    }
  }
  for (const key of TERMS17) for (const lang of ['ja', 'en']) assert.equal(typeof M[lang][key + 'Expert'], 'string', `${lang} ${key}Expert`);
  for (const key of [...TERMS19, ...SIDES]) for (const lang of ['ja', 'en']) assert.equal(M[lang][key + 'Expert'], undefined, key);
  // The two sides name their typical example in the meaning (charts, camouflage), so a specialist word beside them would repeat it
  assert.match(M.ja.termShowSideMeaning, /代表例はグラフ$/);
  assert.match(M.ja.termHideSideMeaning, /代表例は迷彩$/);
  const termKeys = Object.keys(M.ja).filter((k) => /^term[A-Z]/.test(k) && !/(Meaning|Expert)$/.test(k) && k !== 'termHelpLabel');
  assert.deepEqual(termKeys.sort(), [...TERMS17, ...TERMS19, ...SIDES].sort());
  // The label of a specialist word, and the term of disruptive coloration in the plain words of the short table (no 崩す)
  assert.deepEqual([M.ja.glossExpertLabel, M.en.glossExpertLabel], ['専門用語', 'Technical term']);
  assert.deepEqual([M.ja.termDisruptive, M.en.termDisruptive], ['輪郭を途切れさせる模様', 'Pattern that breaks up the outline']);
  for (const [key, text] of Object.entries(M.ja)) assert.doesNotMatch(text, /崩/, key);
  // The meanings named in the spec
  assert.equal(M.ja.termGroupingMeaning,
    '近いもの・似たものなどが、1つのまとまりとして見えること。まとまって見える条件（近接・類同など）を、ゲシュタルトの法則と呼ぶ。数え方は資料によって違う');
  assert.equal(M.en.termPreattentiveMeaning, 'Features such as color, direction and size that guide search. "Preattentive" names the sense of speed and '
    + 'ease; it does not mean attention plays no part');
});

test('F: the tab names and their specialist words', () => {
  const tabs = ['tabPopout', 'tabSearch', 'tabGestalt', 'tabFigureGround', 'tabMisread'];
  assert.deepEqual(tabs.map((k) => M.ja[k]), ['目立つ', '探す時間', 'まとまる', '図と地', '誤読']);
  assert.deepEqual(tabs.map((k) => M.ja[k + 'Term']), ['前注意の特徴', '視覚探索', 'ゲシュタルトの法則', '図と地の分化', 'グラフ']);
  assert.deepEqual(tabs.map((k) => M.en[k]), ['Pop out', 'Search time', 'Grouping', 'Figure and ground', 'Misreading']);
  assert.deepEqual(tabs.map((k) => M.en[k + 'Term']), ['Preattentive features', 'Visual search', 'Gestalt principles', 'Figure–ground', 'Charts']);
});

// ===== index.html and the screen =====
const fs = require('node:fs');
const path = require('node:path');
const D = require('../atlas-data.js');
const readFile = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = readFile('index.html');
const app = readFile('app.js');
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

test('F: index.html uses existing keys, and its first text equals the Japanese dictionary', () => {
  const keys = [...html.matchAll(/\bdata-i18n(?:-aria)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 50);
  for (const key of keys) assert.ok(Object.hasOwn(M.ja, key), key);
  // A static text may carry <wbr> (where a tab term may break between its words); it adds no character
  const tags = [...html.matchAll(/<(?<tag>[a-z][a-z0-9]*)\b[^>]*\bdata-i18n="(?<key>[^"]+)"[^>]*>(?<text>(?:[^<]|<wbr>)*)<\/\k<tag>>/g)];
  assert.equal(tags.length, [...html.matchAll(/\bdata-i18n="/g)].length, 'every translated element has static text');
  for (const { groups } of tags) assert.equal(decode(groups.text.replaceAll('<wbr>', '')), M.ja[groups.key], 'first Japanese text: ' + groups.key);
  // aria-labels start in Japanese; the two startup groups carry both languages until the page is ready
  const labelled = [...html.matchAll(/<[a-z]+\b[^>]*\bdata-i18n-aria="([^"]+)"[^>]*>/g)];
  assert.ok(labelled.length >= 4);
  for (const m of labelled) {
    const label = decode((m[0].match(/\baria-label="([^"]*)"/) || [])[1] ?? '');
    assert.ok(label === M.ja[m[1]] || label === M.ja[m[1]] + ' / ' + M.en[m[1]], m[1] + ': ' + label);
  }
  for (const m of html.matchAll(/<[a-z]+\b[^>]*\baria-label="[^"]*"[^>]*>/g)) assert.match(m[0], /\bdata-i18n-aria="/, m[0]);
  assert.match(app, /setAttribute\('aria-label', t\(el\.dataset\.i18nAria\)\)/);
  // The static panel headings are "{tab}（{term}）" in Japanese, the same as app.js draws them
  for (const g of D.groups) {
    const m = html.match(new RegExp(`<h2 id="heading-${g.id}" class="panel-heading">([^<]+)</h2>`));
    assert.equal(m[1], M.ja[g.labelKey] + '（' + M.ja[g.termKey] + '）', g.id);
  }
});

test('F: the purpose and the four things this atlas lets you do are shown from the start; the line over the short table is a title', () => {
  const start = html.indexOf('data-i18n-lines="introShort"'), more = html.indexOf('<details id="intro-more"');
  assert.ok(start > 0 && more > start);
  const block = html.slice(start, more);
  assert.match(block, /<section id="intro-features" class="intro-features" aria-labelledby="intro-features-heading">/);
  assert.match(block, /<h2 id="intro-features-heading" class="intro-features-heading" data-i18n="introFeaturesHeading">/);
  const list = block.match(/<ul class="intro-features-list">([\s\S]*?)<\/ul>/)[1];
  assert.deepEqual([...list.matchAll(/<li data-i18n="(\w+)">/g)].map((m) => m[1]), ['introFeature1', 'introFeature2', 'introFeature3', 'introFeature4']);
  // The order of the tabs and the two uses stay behind "Read more"
  const details = html.slice(more, html.indexOf('</details>', more));
  assert.deepEqual([...details.matchAll(/data-i18n="(\w+)"/g)].map((m) => m[1]), ['introMore', 'intro1', 'intro2']);
  // A title, not a sentence
  assert.doesNotMatch(M.ja.contrastLine, /。$/);
  assert.doesNotMatch(M.en.contrastLine, /\.$/);
});

test('F: the language button shows EN on the Japanese page and JA on the English page, and its name starts with the same letters', () => {
  assert.match(app, /\$\('language'\)\.textContent = state\.language === 'ja' \? 'EN' : 'JA';/);
  assert.ok(M.ja.languageToggle.startsWith('EN：'));
  assert.ok(M.en.languageToggle.startsWith('JA: '));
  assert.match(html, /<button id="language" class="tool-button" type="button" data-i18n-aria="languageToggle" aria-label="EN：英語の表示にする">EN<\/button>/);
});

test('F: the glossary groups the 38 terms by the tab where they mainly appear: each term once, followed by its meaning, with the '
  + 'specialist word (and its label) where it differs', () => {
  const panel = html.match(/<div id="help-panel-glossary"[^>]*>([\s\S]*?)\n    <\/div>\n  <\/dialog>/)[1];
  const group = new RegExp('<section class="gloss-group" aria-labelledby="gloss-([\\w-]+)">\\s*<h3 id="gloss-\\1" '
    + 'data-i18n="glossGroup\\.\\1">[^<]*</h3>\\s*<dl class="glossary">([\\s\\S]*?)</dl>', 'g');
  const groups = [...panel.matchAll(group)];
  assert.deepEqual(groups.map((g) => g[1]), ['all', 'popout', 'search', 'gestalt', 'figure-ground', 'misread', 'illusion']);
  const seen = [];
  for (const g of groups) {
    const items = [...g[2].matchAll(/<(dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/g)];
    assert.ok(items.length >= 4 && items.length % 2 === 0, g[1]);
    for (let i = 0; i < items.length; i += 2) {
      const [dt, dd] = [items[i], items[i + 1]];
      const key = dt[2].match(/^<span data-i18n="(\w+)">/)[1];
      seen.push(key);
      assert.equal(dt[1], 'dt', key);
      const expert = TERMS17.includes(key) && (M.ja[key] !== M.ja[key + 'Expert'] || M.en[key].toLowerCase() !== M.en[key + 'Expert'].toLowerCase());
      assert.equal(dt[2].includes(`data-i18n="${key}Expert"`), expert, key + ' specialist word');
      // The specialist word comes with its label, so that the word, the specialist word and the meaning can be told apart
      assert.equal(dt[2].includes('<span class="term-expert-label" data-i18n="glossExpertLabel">'), expert, key + ' label');
      assert.equal(dd[1], 'dd', key);
      assert.match(dd[0], new RegExp(`^<dd data-i18n="${key}Meaning">`), key);
    }
  }
  // Each of the 38 terms exactly once
  assert.equal(seen.length, 38);
  assert.deepEqual([...seen].sort(), [...TERMS17, ...TERMS19, ...SIDES].sort());
});

test('F: the short introduction is one sentence per line in index.html, the same sentences as the dictionary', () => {
  const m = html.match(/<p class="intro intro-short" data-i18n-lines="introShort">([\s\S]*?)<\/p>/);
  assert.ok(m);
  const sentences = (text) => text.split(/(?<=。)|(?<=\.)\s+/).filter(Boolean);
  assert.deepEqual(m[1].split('<br>').map(decode), sentences(M.ja.introShort));
  assert.equal(sentences(M.ja.introShort).length, 3);
  assert.equal(sentences(M.en.introShort).length, 3);
  // Every element with lines names an existing key; app.js draws them with the same split
  for (const k of html.matchAll(/data-i18n-lines="([^"]+)"/g)) assert.ok(Object.hasOwn(M.ja, k[1]), k[1]);
  assert.match(app, /querySelectorAll\('\[data-i18n-lines\]'\)/);
});

test('F: every term with a dashed underline or a "?" is in the terms table, and its word appears in the sentence in both languages', () => {
  const termKeys = new Set([...TERMS17, ...TERMS19, ...SIDES]);
  for (const m of html.matchAll(/data-term-help="(\w+)"/g)) assert.ok(termKeys.has(m[1]), m[1]);
  for (const g of D.groups) if (g.termTip) assert.ok(termKeys.has(g.termTip), g.id);
  for (const e of D.entries) for (const t of e.titleTerms) assert.ok(termKeys.has(t.term), e.id);
  // The terms inside sentences (TEXT_TERMS of app.js): the word is found in the sentence of each language
  // (one row per sentence key, a plain or quoted key, with one or more terms)
  const block = app.match(/const TEXT_TERMS = \{([\s\S]*?)\n {2}\};/)[1];
  const rows = [...block.matchAll(/^ {4}'?([\w.-]+)'?: \[(.+)\],$/gm)];
  assert.equal(rows.length, block.trim().split('\n').length, 'every line of TEXT_TERMS is read');
  let count = 0;
  for (const [, key, list] of rows) {
    const terms = [...list.matchAll(/\{ term: '(\w+)', ja: '([^']+)', en: '([^']+)' \}/g)];
    assert.ok(terms.length >= 1, key);
    for (const [, term, ja, en] of terms) {
      assert.ok(termKeys.has(term), term);
      assert.ok(M.ja[key].includes(ja), `${key} ja: ${ja}`);
      assert.ok(M.en[key].includes(en), `${key} en: ${en}`);
      count += 1;
    }
    // No more than two underlined words in one sentence
    assert.ok(terms.length <= 2, key);
  }
  assert.ok(count >= 10, count);
});
