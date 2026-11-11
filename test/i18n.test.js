'use strict';
// F: the Japanese and English dictionaries in messages.js: the same keys and placeholders, no Japanese in English, no space between
// Japanese and Latin letters or digits, the avoided words, and the terms (word, specialist word and meaning).
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../messages.js');

// Hiragana, katakana, CJK ideographs, CJK punctuation and full-width forms
const JAPANESE = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿！-｠]/;
const placeholders = (s) => [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();
// The 19 terms that have a screen word and a specialist word, then the 16 terms named by their specialist word
const TERMS19 = ['termTarget', 'termDistractor', 'termSetSize', 'termRt', 'termMedian', 'termSlope', 'termIntercept', 'termFeature', 'termConjunction',
  'termPopout', 'termPreattentive', 'termGrouping', 'termFigureGround', 'termBackground', 'termDisruptive', 'termMasquerade', 'termDirection',
  'termShowSide', 'termHideSide'];
const TERMS16 = ['termVisualSearch', 'termFit', 'termGuided', 'termAsymmetry', 'termProximity', 'termSimilarity', 'termCommonRegion',
  'termConnectedness', 'termClosure', 'termContinuation', 'termRubin', 'termTruncation', 'termAccuracyRank', 'termDualAxis', 'termAspect',
  'termFixation'];
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

test('F: no half-width space between Japanese and Latin letters or digits in Japanese values', () => {
  const ja = '[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff]';
  const pattern = new RegExp(`${ja} [A-Za-z0-9]|[A-Za-z0-9] ${ja}`);
  for (const [key, value] of Object.entries(M.ja)) assert.doesNotMatch(value.replace(/\{[a-zA-Z0-9_]+\}/g, '\u0000'), pattern, key);
});

test('F: Japanese values are not made of Latin letters alone, and avoid the listed words', () => {
  for (const [key, value] of Object.entries(M.ja)) {
    assert.doesNotMatch(value, /^[A-Za-z][A-Za-z ,.'-]*$/, `${key}: ${value}`);
    for (const word of AVOIDED) assert.ok(!value.includes(word), `${key} uses ${word}`);
  }
  for (const [key, value] of Object.entries(M.en)) assert.doesNotMatch(value, /\brecommend|\bmust be optimal|\balways start at (?:0|zero)/i, key);
});

test('F: the 35 terms have a word and a meaning in both languages; the first 19 also name the specialist word', () => {
  assert.equal(TERMS19.length + TERMS16.length, 35);
  for (const key of [...TERMS19, ...TERMS16]) {
    for (const lang of ['ja', 'en']) {
      assert.equal(typeof M[lang][key], 'string', `${lang} ${key}`);
      assert.equal(typeof M[lang][key + 'Meaning'], 'string', `${lang} ${key}Meaning`);
    }
  }
  for (const key of TERMS19) for (const lang of ['ja', 'en']) assert.equal(typeof M[lang][key + 'Expert'], 'string', `${lang} ${key}Expert`);
  for (const key of TERMS16) assert.equal(M.ja[key + 'Expert'], undefined, key);
  const termKeys = Object.keys(M.ja).filter((k) => /^term[A-Z]/.test(k) && !/(Meaning|Expert)$/.test(k) && k !== 'termHelpLabel');
  assert.deepEqual(termKeys.sort(), [...TERMS19, ...TERMS16].sort());
  // The meanings named in the spec
  assert.equal(M.ja.termGroupingMeaning,
    '近いもの・似たものなどが、1つのまとまりとして見えること。まとまって見える条件（近接・類同など）を、ゲシュタルトの法則と呼ぶ。数え方は資料によって違う');
  assert.equal(M.en.termPreattentiveMeaning, 'Features such as color, direction and size that guide search. "Preattentive" names the sense of speed and '
    + 'ease; it does not mean attention plays no part');
});

test('F: the tab names and their specialist words', () => {
  const tabs = ['tabPopout', 'tabSearch', 'tabGestalt', 'tabFigureGround', 'tabMisread'];
  assert.deepEqual(tabs.map((k) => M.ja[k]), ['浮く', '探す時間', 'まとまる', '図と地', '誤読']);
  assert.deepEqual(tabs.map((k) => M.ja[k + 'Term']), ['前注意の特徴', '視覚探索', 'ゲシュタルトの法則', '図と地の分化', 'グラフ']);
  assert.deepEqual(tabs.map((k) => M.en[k]), ['Pop out', 'Search time', 'Grouping', 'Figure and ground', 'Misreading']);
  assert.deepEqual(tabs.map((k) => M.en[k + 'Term']), ['Preattentive features', 'Visual search', 'Gestalt principles', 'Figure–ground', 'Charts']);
});
