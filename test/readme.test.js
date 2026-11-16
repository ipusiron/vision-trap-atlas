'use strict';
// G: README.md and README.en.md against this tool: the front matter, the fixed opening, the headings of both languages, the numbers of
// the features, the technical notes, the use cases and the screenshot captions (computed again with the calculation and the data), the
// class sessions, the screenshots, the directory tree, the references, and the words a README avoids.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const C = require('../atlas-core.js');
const D = require('../atlas-data.js');
const V = require('../atlas-view.js');
const S = require('../atlas-search.js');
const M = require('../messages.js');
const root = path.join(__dirname, '..');
const SLUG = 'vision-trap-atlas';
const FILES = { ja: 'README.md', en: 'README.en.md' };
const LANGS = ['ja', 'en'];
const cache = {};
const doc = (lang) => (cache[lang] ??= fs.readFileSync(path.join(root, FILES[lang]), 'utf8').replace(/\r\n?/g, '\n'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// ===== Reading a README =====
// The lines of a README with fenced code blocks and HTML comments blanked out (line numbers stay the same)
function prose(lang) {
  const out = [];
  let fence = null;
  const text = doc(lang).replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ''));
  for (const line of text.split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = null;
      out.push('');
    } else if (marker) {
      fence = marker[1];
      out.push('');
    } else out.push(line);
  }
  return out;
}
const headings = (lang) => prose(lang).flatMap((line, i) => {
  const m = line.match(/^(#{1,6}) +(.+?)\s*$/);
  return m ? [{ level: m[1].length, title: m[2], line: i }] : [];
});
// The sections of one level: the title, and the lines of the body (from the line after the heading to the next heading of that level or
// above)
function sectionsOf(lang, level, from = 0, to = Infinity) {
  const list = headings(lang), total = prose(lang).length;
  return list.filter((h) => h.level === level && h.line >= from && h.line < to).map((h) => {
    const end = list.find((x) => x.line > h.line && x.level <= level);
    return { title: h.title, line: h.line, from: h.line + 1, to: Math.min(end ? end.line : total, to) };
  });
}
function section(lang, title, level = 2, within = null) {
  const found = sectionsOf(lang, level, within ? within.from : 0, within ? within.to : Infinity).filter((s) => s.title === title);
  assert.equal(found.length, 1, `${FILES[lang]}: one section "${title}"`);
  return found[0];
}
const bodyOf = (lang, s) => prose(lang).slice(s.from, s.to);
const firstH2 = (lang) => prose(lang).findIndex((line) => /^## /.test(line));
// Text as it reads: links and images keep their text, HTML tags, emphasis and code marks go, and the lines are joined (without a space
// in Japanese, with one in English)
function plain(lines, lang) {
  return lines.map((line) => line.trim()).filter(Boolean).join(lang === 'ja' ? '' : ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/\*\*|`/g, '').replace(/ {2,}/g, ' ');
}
const sectionText = (lang, title, level = 2, within = null) => plain(bodyOf(lang, section(lang, title, level, within)), lang);
// The markdown tables of some lines: the header cells and the rows of cells after the delimiter row
function tablesIn(lines) {
  const tables = [];
  let current = null;
  for (const line of [...lines, '']) {
    if (/^\s*\|/.test(line)) {
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
      if (!current) current = { header: cells, rows: [], delimiter: false };
      else if (!current.delimiter) current.delimiter = cells.every((cell) => /^:?-{3,}:?$/.test(cell));
      else current.rows.push(cells);
    } else if (current) {
      tables.push(current);
      current = null;
    }
  }
  return tables;
}
// The items of the lists in some lines (a number or a mark at the start), as they read
const listItems = (lines, lang) => lines.filter((line) => /^(?:\d+\.|[-*+]) /.test(line)).map((line) => plain([line.replace(/^(?:\d+\.|[-*+]) /, '')], lang));

// The H2 sections, in order: Japanese, English
const H2 = [['🌐 デモページ', '🌐 Demo'], ['📸 スクリーンショット', '📸 Screenshots'], ['✨ 機能', '✨ Features'],
  ['📖 使い方', '📖 How to use'], ['📐 画面構成', '📐 Screen layout'], ['🔬 技術的な説明', '🔬 Technical notes'],
  ['🎯 ユースケース', '🎯 Use cases'], ['🔒 セキュリティ', '🔒 Security'], ['⚠️ 注意と限界', '⚠️ Notes and limits'],
  ['🔗 参考', '🔗 References'], ['🧪 テスト', '🧪 Tests'], ['📁 ディレクトリー構造', '📁 Directory structure'],
  ['💻 動作環境', '💻 Requirements'], ['📄 ライセンス', '📄 License'], ['🛠️ このツールについて', '🛠️ About this tool']];
const h2 = (lang, icon) => H2.find((pair) => pair[0].startsWith(icon))[lang === 'ja' ? 0 : 1];
// The H3 sections under the technical notes and the use cases, in order
const H3 = {
  '🔬': [['探す実験', 'The search experiment'], ['結果の文を選ぶ幅', 'How the result sentences are chosen'], ['迷彩の実験', 'The camouflage test'],
    ['誤読の比の式', 'Formulas of the misreading entries'], ['データの形と項目の足し方', 'Data shape and adding entries'], ['乱数', 'Random numbers']],
  '🎯': [['授業で使うとき', 'Using it in class'], ['中学生の自由研究のテーマの例', 'Ideas for a junior high school research project'],
    ['CamoForgeと組み合わせる', 'Using it with CamoForge'], ['ほかの使い方', 'Other ways of using it'], ['限界', 'Limits']],
};
const h3 = (lang, icon, k) => H3[icon][k][lang === 'ja' ? 0 : 1];
const sub = (lang, icon, k) => section(lang, h3(lang, icon, k), 3, section(lang, h2(lang, icon)));
const subText = (lang, icon, k) => plain(bodyOf(lang, sub(lang, icon, k)), lang);

// ===== Numbers in the texts =====
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
// The numbers written in a text (Day numbers and the years in references aside); English counts digits only
const numbersIn = (text) => (text.replace(/\bDay\d+/g, '').match(/\d+/g) || []).map(Number);
const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const f1 = (x) => C.round1(x).toFixed(1);
const f2 = (x) => C.round2(x).toFixed(2);
// A list of values as each README writes it: Japanese joins with ・, English with commas and "and"
const joinList = (lang, items, sep = '・') => (lang === 'ja' ? items.join(sep) : items.slice(0, -1).join(', ') + ' and ' + items.at(-1));
const books = (v) => String(v * 100).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const ctx = { t: (key) => M.ja[key], data: D };
const flat = (shapes) => shapes.flatMap((s) => [s, ...flat(s.children || [])]);
const entry = (id) => D.entries.find((e) => e.id === id);
const control = (id, cid) => entry(id).controls.find((c) => c.id === cid);
// An entry title without its technical words in brackets (the READMEs name entries that way in running text)
const baseTitle = (lang, id) => M[lang][`item.${id}.title`].replace(/（[^（）]*）$|\s*\([^()]*\)$/, '');

// ===== Front matter =====
const DESCRIPTION_JA = '人が意識するより先に目がしてしまうこと（ポップアウト・視覚探索・ゲシュタルトの法則・図と地・グラフの誤読・目の錯覚）を、つまみで動かす図と、'
  + '自分の探す時間を測る2つの実験で確かめる図鑑。同じ目の性質が、グラフでは見せるために、迷彩では隠すために使われる様子を、小さな図で並べる。'
  + '記録は画面の中だけで、外部へは何も送らない。日英対応。';
const DESCRIPTION_EN = 'An atlas for checking what your eyes do before you think about it (pop-out, visual search, Gestalt principles of grouping, '
  + 'figure and ground, chart misreading and optical illusions), with figures you adjust and two experiments that time your own search. Small '
  + 'figures show how the same traits are used by charts to show and by camouflage to hide. Records stay on the page; nothing is sent anywhere. '
  + 'Japanese and English UI.';
const META = {
  id: 'day128', slug: SLUG, title: 'Vision Trap Atlas',
  subtitle_ja: '目の罠を見て、押して確かめる図鑑', subtitle_en: 'An atlas of visual traps to see and try',
  description_ja: DESCRIPTION_JA, description_en: DESCRIPTION_EN,
  category_ja: ['可視化', '学習支援'], category_en: ['Visualization', 'Learning Support'],
  difficulty: '2',
  tags: ['visual-perception', 'preattentive-features', 'visual-search', 'gestalt', 'gestalt-principles', 'figure-ground', 'misleading-charts',
    'data-visualization', 'camouflage', 'optical-illusions', 'education'],
  repo_url: 'https://github.com/ipusiron/' + SLUG, demo_url: 'https://ipusiron.github.io/' + SLUG + '/', hub: 'true',
};
// Free text is double-quoted (the English description has ": " in it); the number and the boolean are bare
const QUOTED = ['title', 'subtitle_ja', 'subtitle_en', 'description_ja', 'description_en', 'repo_url', 'demo_url'];
const BARE = ['difficulty', 'hub'];

function frontMatter() {
  const match = doc('ja').match(/^<!--[ \t]*\n---[ \t]*\n([\s\S]*?)\n---[ \t]*\n!?-->[ \t]*(?:\n|$)/);
  assert.ok(match, 'README.md starts with the front matter (between --- lines) inside an HTML comment');
  const keys = [], values = {}, quotes = {};
  const lines = match[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const item = lines[i].match(/^([a-z_]+):(?: +(.*?))?\s*$/);
    assert.ok(item, 'front matter line: ' + lines[i]);
    const [, key, scalar] = item;
    assert.ok(!keys.includes(key), 'no duplicate key: ' + key);
    keys.push(key);
    if (scalar) {
      assert.doesNotMatch(scalar, /^[[{]/, key + ': block style, not flow style');
      const quoted = scalar.match(/^(["'])(.*)\1$/);
      values[key] = quoted ? quoted[2] : scalar;
      quotes[key] = quoted ? quoted[1] : '';
    } else {
      values[key] = [];
      while (i + 1 < lines.length && /^ {2}- \S/.test(lines[i + 1])) {
        const value = lines[++i].slice(4).trim(), quoted = value.match(/^(["'])(.*)\1$/);
        values[key].push(quoted ? quoted[2] : value);
      }
      assert.ok(values[key].length > 0, key + ': a block list (lines "  - value")');
    }
  }
  return { keys, values, quotes };
}

test('G: README.md front matter: block style, the keys in order and the values of this tool; none in README.en.md', () => {
  const { keys, values, quotes } = frontMatter();
  assert.deepEqual(keys, Object.keys(META), 'the keys and their order');
  for (const [key, value] of Object.entries(META)) assert.deepEqual(values[key], value, key);
  for (const key of QUOTED) assert.equal(quotes[key], '"', key + ' is double-quoted');
  for (const key of BARE) assert.equal(quotes[key], '', key + ' is not quoted');
  assert.doesNotMatch(doc('en'), /^<!--[ \t]*\n---/, 'README.en.md has no front matter');
  assert.doesNotMatch(doc('en'), /^(?:id|slug|subtitle_ja|description_ja|category_ja|repo_url|demo_url|hub):/m);
});

test('G: the meta description and og:description of index.html are the description_ja of the front matter', () => {
  const content = (attr, key) => {
    const found = [...html.matchAll(new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`, 'g'))].map((m) => m[1]);
    assert.equal(found.length, 1, key);
    return found[0];
  };
  assert.equal(content('name', 'description'), frontMatter().values.description_ja);
  assert.equal(content('property', 'og:description'), frontMatter().values.description_ja);
  assert.equal(content('property', 'og:image'), META.demo_url + 'assets/screenshot.png');
  assert.equal(content('property', 'og:url'), META.demo_url);
});

// ===== The opening =====
const H1 = { ja: '# Vision Trap Atlas - 目の罠を見て、押して確かめる図鑑', en: '# Vision Trap Atlas - An atlas of visual traps to see and try' };
const SWITCH = { ja: '[English](README.en.md) · 日本語', en: 'English · [日本語](README.md)' };
const SERIES = { ja: '**Day128 - 生成AIで作るセキュリティツール200**', en: '**Day128 - 200 Security Tools with Generative AI**' };
const LEARNING = {
  ja: '学習用の図鑑です。実験の記録はこのページの中だけにあり、保存も送信もしません。',
  en: 'This is a learning atlas. Experiment records exist only on this page and are neither saved nor sent.',
};
const BADGES = ['img.shields.io/github/stars/ipusiron/' + SLUG, 'img.shields.io/github/forks/ipusiron/' + SLUG,
  'img.shields.io/github/last-commit/ipusiron/' + SLUG, 'img.shields.io/github/license/ipusiron/' + SLUG, 'img.shields.io/badge/demo-GitHub%20Pages'];
const TABS = D.groups.slice().sort((a, b) => a.order - b.order);
const tabNames = (lang) => TABS.map((g) => M[lang][g.labelKey]);

test('G: the opening of both READMEs: title, language switch, five badges in order, the series line, the purpose and the learning-only '
  + 'sentences', () => {
  for (const lang of LANGS) {
    const lines = prose(lang), end = firstH2(lang), file = FILES[lang];
    assert.ok(end > 0, file + ': H2 sections');
    const opening = lines.slice(0, end);
    const h1 = opening.findIndex((line) => /^# /.test(line));
    assert.equal(opening[h1], H1[lang], file + ': the H1');
    if (lang === 'ja') assert.equal(opening.filter((line) => line.trim() === SWITCH.ja).length, 1, 'README.md: the language switch line');
    else assert.equal(doc('en').split('\n')[0], SWITCH.en, 'README.en.md: line 1 is the language switch');
    const text = opening.join('\n');
    let at = text.indexOf(opening[h1]);
    for (const badge of BADGES) {
      const next = text.indexOf(badge, at + 1);
      assert.ok(next > at, `${file}: badge ${badge} (in the order stars, forks, last commit, license, GitHub Pages)`);
      at = next;
    }
    assert.ok(/^[^\n]*\]\(https:\/\/ipusiron\.github\.io\/vision-trap-atlas\/\)/.test(text.slice(at)), file + ': the GitHub Pages badge links to the demo');
    const series = opening.map((line, i) => [line.trimEnd(), i]).filter(([line]) => line === SERIES[lang]);
    assert.equal(series.length, 1, file + ': the series line ' + SERIES[lang]);
    assert.doesNotMatch(doc(lang), /^\s*>.*Day128 - /m, file + ': the series line is not a quotation');
    const after = plain(opening.slice(series[0][1] + 1), lang);
    assert.ok(after.includes(LEARNING[lang]), file + ': ' + LEARNING[lang]);
    // The purpose first; then the six tabs and the 15 entries (as the data has them), the order of use of every entry, and the small
    // figures of the showing and hiding sides
    if (lang === 'ja') {
      assert.match(after, /^Vision Trap Atlasは、[^。]+図鑑です。/, 'the first sentence: Vision Trap Atlasは、…図鑑です。');
      assert.ok(after.includes(`${tabNames('ja').map((n) => `「${n}」`).join('')}の${TABS.length}つのタブに、${D.entries.length}の項目があります。`));
      for (const key of ['predictSummary', 'whyHeading']) assert.ok(after.includes(`「${M.ja[key]}」`), key);
    } else {
      assert.match(after, /^Vision Trap Atlas is an atlas for [^.]+\./);
      assert.ok(after.includes(`It has ${D.entries.length} entries in ${TABS.length} tabs: ${joinList('en', tabNames('en'))}.`));
      for (const key of ['predictSummary', 'whyHeading']) assert.ok(after.includes(`"${M.en[key]}"`), key);
    }
    assert.equal(TABS.length, 6);
    assert.equal(D.entries.length, 15);
  }
});

test('G: the H2 sections follow the order of the series, and both languages have the same headings and levels', () => {
  for (const [k, lang] of LANGS.entries()) {
    const list = headings(lang), file = FILES[lang];
    assert.equal(list[0].level, 1, file + ': the first heading is the H1');
    assert.equal(list.filter((h) => h.level === 1).length, 1, file + ': one H1');
    for (let i = 1; i < list.length; i++) assert.ok(list[i].level <= list[i - 1].level + 1, file + ': no skipped level at ' + list[i].title);
    assert.deepEqual(list.filter((h) => h.level === 2).map((h) => h.title), H2.map((pair) => pair[k]), file + ': the 15 H2 sections');
    for (const icon of Object.keys(H3)) {
      const s = section(lang, h2(lang, icon));
      assert.deepEqual(sectionsOf(lang, 3, s.from, s.to).map((x) => x.title), H3[icon].map((pair) => pair[k]), `${file}: the H3 of ${icon}`);
    }
  }
  assert.deepEqual(headings('en').map((h) => h.level), headings('ja').map((h) => h.level), 'the same heading levels in the same order');
});

// ===== The use cases particular to this tool =====
// The first list of the 🎯 section, right after its first line (a lead in the text, not a heading). Returns the items as they read
function particularUses(lang) {
  const lines = bodyOf(lang, section(lang, h2(lang, '🎯'))), file = FILES[lang];
  let i = lines.findIndex((line) => line.trim());
  assert.match(lines[i], lang === 'ja' ? /^このツールならではの使い方$/ : /^Ways of using this tool in particular$/, file + ': the lead');
  const marker = /^(\d+\.) +(?=\S)/;
  for (i++; i < lines.length && !marker.test(lines[i]); i++) assert.doesNotMatch(lines[i], /^#/, file + ': a list follows the lead');
  const items = [];
  for (; i < lines.length; i++) {
    const line = lines[i], m = line.match(marker);
    if (m) items.push([line.slice(m[0].length)]);
    else if (!line.trim()) continue;
    else break;
  }
  return items.map((item) => plain(item, lang));
}

// The facts behind the six use cases, computed with the calculation and the data (not taken from the README)
function useCaseFacts() {
  // 1: the contour entry from 0% to 30%: the months the small chart cuts out (bands) and the spots on the edge in the camouflage scene
  const gap = control('gestalt-contour', 'gap').values.find((v) => Math.round(v * 100) === 30);
  const contour = entry('gestalt-contour'), hide = contour.uses.find((u) => u.side === 'hide');
  const bands = flat(V.renderPart('lineChart', { mode: 'contour', gap, crossing: 'smooth' }, ctx).shapes).filter((s) => /fig-missing/.test(s.cls)).length;
  const circles = (g) => flat(V.renderPart('camoScene', { ...hide.params, edgePatches: g }, ctx).shapes).filter((s) => s.type === 'circle').length;
  const uc1 = { from: 0, to: Math.round(gap * 100), bands, spots: circles(gap) - circles(0) };
  // 2: one run of each search, and the absent slopes of Treisman & Gelade 1980
  const uc2 = { practice: C.SET_SIZES.length * 2 * C.PRACTICE_REPS, main: C.SET_SIZES.length * 2 * C.MAIN_REPS,
    feature: D.references.treisman1980.featureAbsent.toFixed(1), conj: D.references.treisman1980.conjAbsent.toFixed(1) };
  // 3: the top of the right axis and the crossings of the two lines
  const tops = control('misread-dual-axis', 'rightTop').values;
  const uc3 = { tops, crossings: tops.map((t) => C.dualAxisCrossings(D.datasets.townTemp, D.datasets.townRain, [0, 30], [0, t])) };
  // 4: the value ratio and the height ratio with the bottom at 50
  const loans = D.datasets.libraryLoans3;
  const uc4 = { value: f2(Math.max(...loans) / Math.min(...loans)), bottom: 50, height: f2(C.baselineRatio(loans, 50)) };
  // 5: the 24 months at the aspect ratios 0.5 and 4, and the last six months
  const all = D.datasets.libraryLoans24, aspects = control('misread-aspect-range', 'aspect').values;
  const uc5 = { from: aspects[0], to: aspects.at(-1), steep: f1(C.meanAbsAngle(all, aspects[0])), flat: f1(C.meanAbsAngle(all, aspects.at(-1))),
    start: books(all[0]), end: books(all.at(-1)), start6: books(all.at(-6)) };
  // 6: the largest difference of direction and size
  const uc6 = { angle: V.ANGLES.at(-1), scale: V.SCALES.at(-1) };
  return { uc1, uc2, uc3, uc4, uc5, uc6 };
}

test('G: the six use cases particular to this tool carry the numbers of the calculation and the data (both languages, no other number)', () => {
  const { uc1, uc2, uc3, uc4, uc5, uc6 } = useCaseFacts();
  assert.deepEqual([uc1.to, uc1.bands, uc1.spots, uc3.crossings, uc4.value, uc4.height, uc5.steep, uc5.flat, uc6.angle, uc6.scale],
    [30, 4, 12, [2, 3, 0, 0], '1.12', '4.00', '67.3', '19.0', 90, 2], 'the values of the use cases');
  const want = {
    ja: [
      [`「${M.ja.tabGestalt}」タブの「${baseTitle('ja', 'gestalt-contour')}」`, `「${M.ja['ctl.gestalt-contour.gap']}」を${uc1.from}%から${uc1.to}%にする`,
        `欠けた${uc1.bands}か月で線が切れ`, `物の縁に${uc1.spots}個の斑点が重なる`],
      [`練習${uc2.practice}回と本番${uc2.main}回`, `特徴探索${uc2.feature}ミリ秒・結合探索${uc2.conj}ミリ秒`, 'Treisman & Gelade 1980', '線の高さは端末で変わるので比べない'],
      [`「${M.ja['ctl.misread-dual-axis.rightTop']}」を${uc3.tops.join('・')}mmと変える`, `交わる回数が${uc3.crossings.join('・')}回に変わる`],
      [`値の比が${uc4.value}倍`, `縦軸の下端を${uc4.bottom}にすると高さの比${uc4.height}倍`, 'Correllら（2020）'],
      [`「${M.ja['ctl.misread-aspect-range.range.all']}」`, `縦横の比を${uc5.from}から${uc5.to}にすると`, `${uc5.steep}度から${uc5.flat}度に変わる`,
        `「${M.ja['ctl.misread-aspect-range.range.last6']}」`, `${uc5.start}冊から${uc5.end}冊へ増えている`, `${uc5.start6}冊から${uc5.end}冊へ減っている`],
      [`「${M.ja['ctl.popout-feature.kind.color']}」から「${M.ja['ctl.popout-feature.kind.direction']}」や「${M.ja['ctl.popout-feature.kind.size']}」`,
        `方向は${uc6.angle}度、大きさは${uc6.scale}倍の違い`, 'Day101'],
    ],
    en: [
      [`"${baseTitle('en', 'gestalt-contour')}" in the ${M.en.tabGestalt} tab`, `"${M.en['ctl.gestalt-contour.gap']}" from ${uc1.from}% to ${uc1.to}%`,
        `breaks at the ${uc1.bands} missing months`, `${uc1.spots} spots sit on the edge of the object`],
      [`${uc2.practice} practice tries and ${uc2.main} recorded tries`, `${uc2.feature} ms for feature search and ${uc2.conj} ms for conjunction search`,
        'Treisman & Gelade 1980', 'Do not compare the heights of the lines'],
      [`"${M.en['ctl.misread-dual-axis.rightTop']}" to ${joinList('en', uc3.tops)} mm`, `to ${joinList('en', uc3.crossings.map(String))}`],
      [`a value ratio of ${uc4.value}`, `a height ratio of ${uc4.height} when the bottom of the vertical axis is ${uc4.bottom}`, 'Correll et al. (2020)'],
      [`"${M.en['ctl.misread-aspect-range.range.all']}"`, `from ${uc5.from} to ${uc5.to}`, `from ${uc5.steep} to ${uc5.flat} degrees`,
        `"${M.en['ctl.misread-aspect-range.range.last6']}"`, `a rise from ${uc5.start} to ${uc5.end} books`, `a fall from ${uc5.start6} to ${uc5.end} books`],
      [`from "${M.en['ctl.popout-feature.kind.color']}" to "${M.en['ctl.popout-feature.kind.direction']}" or "${M.en['ctl.popout-feature.kind.size']}"`,
        `${uc6.angle} degrees in direction and ${uc6.scale} times in size`, 'Day101'],
    ],
  };
  for (const lang of LANGS) {
    const items = particularUses(lang), file = FILES[lang];
    assert.equal(items.length, 6, file + ': six use cases particular to this tool');
    items.forEach((item, k) => {
      for (const fragment of want[lang][k]) assert.ok(item.includes(fragment), `${file}: use case ${k + 1} has "${fragment}": ${item}`);
      // Every number of the item comes from the fragments above (the numbers of the calculation and the data), or is 1 (one each, …)
      const allowed = new Set([1, ...numbersIn(want[lang][k].join(' '))]);
      const others = numbersIn(item).filter((n) => !allowed.has(n));
      assert.deepEqual(others, [], `${file}: use case ${k + 1} has a number not from the calculation: ${item}`);
    });
  }
});

// ===== The feature table, the technical notes and the screen layout =====
function featureFacts() {
  const per = TABS.map((g) => D.entries.filter((e) => e.group === g.id).length);
  const sides = (e) => new Set(e.uses.map((u) => u.side));
  const both = D.entries.filter((e) => sides(e).has('show') && sides(e).has('hide')).length;
  const search = D.entries.filter((e) => e.group === 'search' && (sides(e).size === 1 && (sides(e).has('show') || sides(e).has('hide')))).length;
  const misread = D.entries.filter((e) => e.uses.length && e.uses.every((u) => u.side === 'readable')).length;
  const choices = D.entries.map((e) => e.predict.choices.length);
  const checks = D.groups.map((g) => (g.checks || []).length);
  assert.ok(checks.every((n) => n === checks[0]), 'as many questions in every tab');
  const find = D.entries.filter((e) => (e.actions || []).includes('find'));
  const box = (id) => D.groups.flatMap((g) => g.endBoxes || []).find((b) => b.id === id).items.length;
  const terms = [...html.matchAll(/<dt><span data-i18n="(term[A-Z]\w*)">/g)].length;
  const camoRounds = (reps) => C.CAMO_PATTERNS.length * reps;
  return { per, both, search, misread, predictions: D.entries.filter((e) => e.predict).length, choices: [Math.min(...choices), Math.max(...choices)],
    perTab: checks[0], checks: checks.reduce((a, b) => a + b, 0), find: find.length, findGroup: find[0].group, reveal: S.TIMING.reveal / 1000,
    practice: C.SET_SIZES.length * 2 * C.PRACTICE_REPS, main: C.SET_SIZES.length * 2 * C.MAIN_REPS, camoPractice: camoRounds(C.CAMO_PRACTICE_REPS),
    camoMain: camoRounds(C.CAMO_MAIN_REPS), camoLimit: C.CAMO_TIMEOUT_MS / 1000, motion: entry('popout-motion').safety.maxSeconds, frames: V.MOTION.frames,
    chartChecks: box('chart-checks'), clues: box('camo-clues'), terms };
}

test('G: the feature table gives the numbers of the data and the calculation (both languages)', () => {
  const f = featureFacts();
  assert.deepEqual([f.per, f.both, f.search, f.misread, f.predictions, f.choices, f.perTab, f.checks, f.find, f.terms],
    [[3, 2, 3, 2, 4, 1], 9, 2, 4, 15, [2, 3], 2, 12, 2, 38], 'the counts of the data');
  const perTab = (lang) => TABS.map((g, k) => (lang === 'ja' ? `「${M.ja[g.labelKey]}」${f.per[k]}` : `${M.en[g.labelKey]} ${f.per[k]}`));
  const want = {
    ja: [`${perTab('ja').join('・')}の項目`, `${TABS.length}つのタブと${D.entries.length}の項目`, `${f.both}つの項目では`,
      `「${M.ja.tabSearch}」タブの${f.search}項目`, `「${M.ja.tabMisread}」タブの${f.misread}項目`, `${f.predictions}の項目すべて`,
      `選択肢${f.choices[0]}〜${f.choices[1]}つ`, `${TABS.length}つのタブの最後に${f.perTab}問ずつ、合わせて${f.checks}問`,
      `「${M.ja.tabPopout}」タブの${f.find}項目`, `${f.reveal}秒たつと「${M.ja.findReveal}」`, `${C.SET_SIZES.join('・')}個`,
      `練習${f.practice}回と本番${f.main}回`, `練習${f.camoPractice}回と本番${f.camoMain}回`, `1回の制限は${f.camoLimit}秒`, `${f.motion}秒動いて止まり`,
      `${f.frames}コマの静止画`, `「${M.ja.chartChecksHeading}」が${f.chartChecks}つ`, `「${M.ja.camoCluesHeading}」が${f.clues}つ`, `用語${f.terms}語`,
      '約1分半', '長くても4分ほど'],
    en: [`${perTab('en').join(', ')}.`, `${TABS.length} tabs and ${D.entries.length} entries`, `In ${f.both} entries`,
      `The ${f.search} entries of the ${M.en.tabSearch} tab`, `the ${f.misread} entries of the ${M.en.tabMisread} tab`, `In all ${f.predictions} entries`,
      `${f.choices[0]} to ${f.choices[1]} choices`, `${f.perTab} questions at the end of each of the ${TABS.length} tabs, ${f.checks} in all`,
      `In ${f.find} entries of the ${M.en.tabPopout} tab`, `After ${f.reveal} seconds, "${M.en.findReveal}"`, `${joinList('en', C.SET_SIZES)} items`,
      `${f.practice} practice tries and ${f.main} recorded tries`, `${f.camoPractice} practice rounds and ${f.camoMain} recorded rounds`,
      `a limit of ${f.camoLimit} seconds per round`, `moves for ${f.motion} seconds`, `${f.frames} still frames`,
      `"${M.en.chartChecksHeading}" (${f.chartChecks} of them)`, `"${M.en.camoCluesHeading}" (${f.clues} of them)`, `${f.terms} terms`,
      'about a minute and a half', 'about 4 minutes at most'],
  };
  // The length of the experiments as the screen says it
  assert.ok(M.ja.expDuration.includes('約1分半') && M.ja.camoDuration.includes('長くても4分ほど'));
  assert.ok(M.en.expDuration.includes('about a minute and a half') && M.en.camoDuration.includes('about 4 minutes at most'));
  for (const lang of LANGS) {
    const text = sectionText(lang, h2(lang, '✨')), file = FILES[lang];
    for (const fragment of want[lang]) assert.ok(text.includes(fragment), `${file} ✨: ${fragment}`);
    // The four items of "What you can do here", word for word
    const items = listItems(bodyOf(lang, section(lang, h2(lang, '✨'))), lang);
    assert.deepEqual(items, [1, 2, 3, 4].map((k) => M[lang]['introFeature' + k]), `${file}: the four items of the screen`);
  }
});

test('G: the technical notes give the values of the calculation, the experiments and the misreading entries (both languages)', () => {
  const T = S.TIMING, ref = D.references;
  // The spread of the difference of two slopes: SD 200 ms, the middle value of MAIN_REPS tries, the slope over the numbers of items
  const mean = C.SET_SIZES.reduce((a, b) => a + b, 0) / C.SET_SIZES.length;
  const sxx = C.SET_SIZES.reduce((s, n) => s + (n - mean) ** 2, 0);
  const median = 1.25 * 200 / Math.sqrt(C.MAIN_REPS), slope = median / Math.sqrt(sxx), diff = slope * Math.SQRT2;
  // The share of runs above the width with no real difference: the upper tail of the normal distribution (Simpson's rule)
  const z = C.CMP_STEP / diff, pdf = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  let area = 0;
  for (let i = 0, n = 2000, h = (8 - z) / n; i <= n; i += 1) area += pdf(z + i * h) * h * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) / 3;
  const oneIn = Math.round(1 / area);
  assert.deepEqual([sxx, median, f1(slope), f1(diff), oneIn, C.CMP_STEP, C.ERROR_PERCENT], [132.75, 125, '10.8', '15.3', 6, 15, 10]);
  const gaps = { treisman: f1(ref.treisman1980.conjAbsent - ref.treisman1980.featureAbsent), wolfe: ref.wolfe1998.conjAbsent - ref.wolfe1998.featureAbsent };
  const jitter = Number(fs.readFileSync(path.join(root, 'atlas-core.js'), 'utf8').match(/rows = 6, jitter = ([\d.]+) \}/)[1]);
  const loans = D.datasets.libraryLoans3, tops = control('misread-dual-axis', 'rightTop').values;
  const crossings = tops.map((t) => C.dualAxisCrossings(D.datasets.townTemp, D.datasets.townRain, [0, 30], [0, t]));
  const aspects = control('misread-aspect-range', 'aspect').values, angles = aspects.map((a) => f1(C.meanAbsAngle(D.datasets.libraryLoans24, a)));
  const sec = (ms) => String(ms / 1000);
  const want = {
    ja: {
      0: [`${C.SET_SIZES.join('・')}個`, `一辺${C.CAMO.size}の正方形を${C.CAMO.grid}×${C.CAMO.grid}のマス`, `±${Math.round(jitter * 100)}%`,
        `練習${C.PRACTICE_REPS}回と本番${C.MAIN_REPS}回`, `練習${C.SET_SIZES.length * 2 * C.PRACTICE_REPS}回と本番${C.SET_SIZES.length * 2 * C.MAIN_REPS}回`,
        `注視点${T.fixation}ミリ秒 → 図（4,000ミリ秒まで） → 結果の文${T.feedback}ミリ秒 → 間${T.gap}ミリ秒`, `${C.EARLY_MS}ミリ秒未満`,
        `有効な回が${C.MIN_VALID}回以上`, `図形の数が${C.MIN_POINTS}つ以上`, `${C.COARSE_MS}ミリ秒以上の単位`, 'requestAnimationFrame', 'event.timeStamp'],
      1: [`${C.CMP_STEP}ミリ秒以上なら`, `−${C.CMP_STEP}より大きく${C.CMP_STEP}未満`, `−${C.CMP_STEP}以下`, `${C.ERROR_PERCENT}%を超えたら`,
        `1.25×200÷√${C.MAIN_REPS}＝${median}ミリ秒`, `${median}÷√${sxx}≈${f1(slope)}ミリ秒`, `${f1(slope)}×√2≈${f1(diff)}ミリ秒`, `約${oneIn}回に1回`,
        `${ref.treisman1980.conjAbsent}−${ref.treisman1980.featureAbsent}＝${gaps.treisman}ミリ秒`,
        `約${ref.wolfe1998.conjAbsent}−約${ref.wolfe1998.featureAbsent}＝約${gaps.wolfe}ミリ秒`, '判定の境目ではありません'],
      2: [`一辺${C.CAMO.size}の正方形を${C.CAMO.grid}×${C.CAMO.grid}の場所`, `幅はマスの${Math.round(C.CAMO.mothW / (C.CAMO.size / C.CAMO.grid) * 10)}割`,
        `幅と高さの比は${C.CAMO.mothW / C.CAMO.mothH}：1`, `斑点${C.CAMO.ground.toLocaleString('en-US')}個`, `斑点${C.CAMO.patches}個`, `そのうち${C.CAMO.edges}個`,
        `練習${C.CAMO_PRACTICE_REPS}回（数えない）と本番${C.CAMO_MAIN_REPS}回`,
        `練習${C.CAMO_PATTERNS.length * C.CAMO_PRACTICE_REPS}回と本番${C.CAMO_PATTERNS.length * C.CAMO_MAIN_REPS}回`,
        `注視点${sec(T.fixation)}秒 → 模様（${sec(T.camoTimeout)}秒まで）`, `${sec(T.feedback)}秒`, `${sec(T.camoMark)}秒見せる`, `間${sec(T.gap)}秒`,
        `${C.EARLY_MS}ミリ秒未満`, `有効な回が${C.MIN_VALID}回以上`, `真ん中の値の${Math.round(C.CAMO_SIMILAR * 10)}割`, `0.2秒以上${sec(T.camoTimeout)}秒未満`,
        'Fraserら（2007）は1枚5秒', 'Websterら（2013）の探す時間は的ごとの平均で2〜10秒', '研究で決まった値ではない'],
      3: [`${loans.join('・')}百冊`, `${Math.max(...loans)}÷${Math.min(...loans)}≈${f2(Math.max(...loans) / Math.min(...loans))}倍`,
        `下端が40で${f2(C.baselineRatio(loans, 40))}倍、50で${f2(C.baselineRatio(loans, 50))}倍`, `上端が${tops.join('・')}mmのとき、${crossings.join('・')}回`,
        `縦横の比が${aspects.join('・')}のとき、${angles.join('・')}度`],
      4: ['test/fixtures/illusion-data.js', `タブが${TABS.length + 1}つになり`, 'validateData', `${entry('popout-motion').safety.maxSeconds + 2}秒を超える動き`],
      5: ['xorshift32', 'crypto.getRandomValues', 'Math.random'],
    },
    en: {
      0: [`Number of items: ${joinList('en', C.SET_SIZES)}`, `A square ${C.CAMO.size} units wide is split into a ${C.CAMO.grid} × ${C.CAMO.grid} grid`,
        `±${Math.round(jitter * 100)}%`, `${C.PRACTICE_REPS} practice try and ${C.MAIN_REPS} recorded tries`,
        `${C.SET_SIZES.length * 2 * C.PRACTICE_REPS} practice tries and ${C.SET_SIZES.length * 2 * C.MAIN_REPS} recorded tries`,
        `fixation point ${T.fixation} ms → display (up to 4,000 ms) → result line ${T.feedback} ms → pause ${T.gap} ms`, `less than ${C.EARLY_MS} ms`,
        `${C.MIN_VALID} or more valid tries`, `${C.MIN_POINTS} or more numbers of items`, `${C.COARSE_MS} ms or more`, 'requestAnimationFrame',
        'event.timeStamp'],
      1: [`${C.CMP_STEP} ms or more gives`, `more than −${C.CMP_STEP} and under ${C.CMP_STEP}`, `−${C.CMP_STEP} or less`, `more than ${C.ERROR_PERCENT}%`,
        `1.25 × 200 ÷ √${C.MAIN_REPS} = ${median} ms`, `${median} ÷ √${sxx} ≈ ${f1(slope)} ms`, `${f1(slope)} × √2 ≈ ${f1(diff)} ms`, `about 1 run in ${oneIn}`,
        `${ref.treisman1980.conjAbsent} − ${ref.treisman1980.featureAbsent} = ${gaps.treisman} ms`,
        `about ${ref.wolfe1998.conjAbsent} − about ${ref.wolfe1998.featureAbsent} = about ${gaps.wolfe} ms`, 'they are not a test of significance'],
      2: [`a square ${C.CAMO.size} units wide is split into a ${C.CAMO.grid} × ${C.CAMO.grid} grid of spots`,
        `${Math.round(C.CAMO.mothW / (C.CAMO.size / C.CAMO.grid) * 100)}% of a cell wide`, `width to height ratio of ${C.CAMO.mothW / C.CAMO.mothH} to 1`,
        `${C.CAMO.ground.toLocaleString('en-US')} tall oval patches`, `${C.CAMO.patches} patches`, `moves ${C.CAMO.edges} of them`,
        `${C.CAMO_PRACTICE_REPS} practice round (not counted) and ${C.CAMO_MAIN_REPS} recorded rounds`,
        `${C.CAMO_PATTERNS.length * C.CAMO_PRACTICE_REPS} practice rounds and ${C.CAMO_PATTERNS.length * C.CAMO_MAIN_REPS} recorded rounds`,
        `fixation point ${sec(T.fixation)} s → pattern (up to ${sec(T.camoTimeout)} s)`, `(${sec(T.feedback)} s after`, `shown for ${sec(T.camoMark)} s`,
        `pause ${sec(T.gap)} s`, `under ${C.EARLY_MS} ms`, `${C.MIN_VALID} or more valid rounds`, `${Math.round(C.CAMO_SIMILAR * 100)}% of the middle value`,
        `at least 0.2 s and within ${sec(T.camoTimeout)} s`, '5 seconds per image in Fraser et al. (2007)',
        'average search times of 2 to 10 seconds per target in Webster et al. (2013)',
        'the studies themselves did not set it'],
      3: [`(${joinList('en', loans)} hundred books)`, `${Math.max(...loans)} ÷ ${Math.min(...loans)} ≈ ${f2(Math.max(...loans) / Math.min(...loans))}`,
        `at 40, it is ${f2(C.baselineRatio(loans, 40))}; at 50, it is ${f2(C.baselineRatio(loans, 50))}`,
        `${joinList('en', tops)} mm, the lines cross ${joinList('en', crossings.map(String))} times`,
        `aspect ratios of ${joinList('en', aspects)} give ${joinList('en', angles)} degrees`],
      4: ['test/fixtures/illusion-data.js', `there are then seven tabs`, 'validateData',
        `motion longer than ${entry('popout-motion').safety.maxSeconds + 2} seconds`],
      5: ['xorshift32', 'crypto.getRandomValues', 'Math.random'],
    },
  };
  assert.equal(TABS.length + 1, 7);
  assert.equal(C.CMP_STEP, 15, 'the width of the code (not 10)');
  for (const lang of LANGS) {
    for (const [k, fragments] of Object.entries(want[lang])) {
      const text = subText(lang, '🔬', Number(k));
      for (const fragment of fragments) assert.ok(text.includes(fragment), `${FILES[lang]} 🔬 ${h3(lang, '🔬', Number(k))}: ${fragment}`);
    }
  }
});

test('G: the use section opens with "If this is your first visit" of the help and names the controls as the screen does', () => {
  const quote = (lang, s) => (lang === 'ja' ? `「${s}」` : `"${s}"`);
  const labels = ['introRouteHeading', 'predictSummary', 'predictReveal', 'findPress', 'findCover', 'findReveal', 'startFeature', 'startConj', 'expStart',
    'expContinue', 'expAbort', 'resClear', 'camoStart', 'checksHeading', 'helpButton', 'setColor', 'setFill', 'ctl.popout-feature.diff',
    'ctl.popout-feature.variety',
    'ctl.popout-feature.kind', 'ctl.popout-feature.count', 'ctl.gestalt-contour.gap'];
  for (const lang of LANGS) {
    const lines = bodyOf(lang, section(lang, h2(lang, '📖'))), file = FILES[lang];
    const from = lines.findIndex((line) => line.trim()), to = lines.findIndex((line, i) => i > from && !line.trim());
    const first = plain(lines.slice(from, to), lang);
    assert.ok(first.includes(quote(lang, M[lang].helpFirst)), `${file}: the first paragraph names ${M[lang].helpFirst}`);
    assert.ok(first.includes(M[lang].helpFirstText), `${file}: the first paragraph follows ${M[lang].helpFirst}`);
    const text = plain(lines, lang);
    for (const key of labels) assert.ok(text.includes(quote(lang, M[lang][key])), `${file} 📖: ${key} "${M[lang][key]}"`);
    assert.ok(text.includes(quote(lang, M[lang].linkedTo.replace('{names}', '…'))), `${file} 📖: the line of the small figures`);
    assert.ok(text.includes(lang === 'ja' ? `練習${C.SET_SIZES.length * 2}回のあと「${M.ja.expContinue}」で本番${C.SET_SIZES.length * 2 * C.MAIN_REPS}回`
      : `After ${C.SET_SIZES.length * 2} practice tries, "${M.en.expContinue}" moves on to the ${C.SET_SIZES.length * 2 * C.MAIN_REPS} recorded tries`), file);
    assert.equal(listItems(lines, lang).length, 10, `${file}: ten steps`);
  }
});

test('G: the screen layout lists the six tabs and the fifteen entries with their ids, in the order of the data', () => {
  for (const lang of LANGS) {
    const lines = bodyOf(lang, section(lang, h2(lang, '📐'))), file = FILES[lang];
    const table = tablesIn(lines).find((t) => t.rows.length === D.entries.length);
    assert.ok(table, `${file}: the table of the entries`);
    assert.deepEqual(table.header, lang === 'ja' ? ['タブ（タブのid）', '項目', '項目のid'] : ['Tab (tab id)', 'Entry', 'Entry id']);
    const rows = TABS.flatMap((g) => D.entries.filter((e) => e.group === g.id).sort((a, b) => a.order - b.order).map((e) => [
      lang === 'ja' ? `${M.ja[g.labelKey]}（\`${g.id}\`）` : `${M.en[g.labelKey]} (\`${g.id}\`)`, M[lang][`item.${e.id}.title`], `\`${e.id}\``]));
    assert.deepEqual(table.rows, rows, `${file}: the entries, their titles and ids`);
    // The ids are those of the data (and of the addresses that index.html and the other tools link to)
    assert.deepEqual(table.rows.map((r) => r[2].replace(/`/g, '')), D.entries.slice().sort((a, b) => TABS.findIndex((g) => g.id === a.group)
      - TABS.findIndex((g) => g.id === b.group) || a.order - b.order).map((e) => e.id));
    const text = plain(lines, lang);
    assert.ok(text.includes('https://ipusiron.github.io/vision-trap-atlas/#gestalt-contour'), `${file}: an example address`);
    assert.ok(text.includes(lang === 'ja' ? `1行に${TABS.length}つ、720px未満では上の段に${TABS.length / 2}つ・下の段に${TABS.length / 2}つ`
      : `all ${TABS.length} in one row; below 720px, ${TABS.length / 2} in the upper row and ${TABS.length / 2} in the lower row`), `${file}: the tab rows`);
  }
});

// ===== The class sessions =====
const SESSIONS = { ja: ['20分の進め方', '45分の進め方', '話し合いの問い', '探す実験の結果の話し合い方'],
  en: ['A 20-minute session', 'A 45-minute session', 'Discussion questions', 'Talking about the search experiment results'] };
const POE = {
  ja: '予想→観察→説明（POE）は、理科教育で理解を調べる方法の1つで、White & Gunstone（1992）『Probing Understanding』に章があります。',
  en: 'Prediction–observation–explanation (POE) is one of the methods that science education uses to probe understanding, and White & Gunstone (1992), '
    + 'Probing Understanding, has a chapter on it.',
};

test('G: the class sessions: 20 and 45 minutes without gaps, the screen words, the numbers of the misreading entry, three questions, how to '
  + 'talk about the results, and POE as the source puts it', () => {
  const loans = D.datasets.libraryLoans3, bottoms = [0, 40, 50];
  const ratios = bottoms.map((b) => f2(b ? C.baselineRatio(loans, b) : Math.max(...loans) / Math.min(...loans)));
  assert.deepEqual(ratios, ['1.12', '1.50', '4.00']);
  for (const lang of LANGS) {
    const file = FILES[lang], cls = sub(lang, '🎯', 0);
    const h4 = sectionsOf(lang, 4, cls.from, cls.to);
    assert.deepEqual(h4.map((h) => h.title), SESSIONS[lang], `${file}: the parts of the class section`);
    const intro = plain(prose(lang).slice(cls.from, h4[0].line), lang);
    assert.ok(intro.includes(POE[lang]), `${file}: ${POE[lang]}`);
    assert.doesNotMatch(intro, /考案|devised|invented|\bchapter \d|p\.\s?\d|第\d章/i, `${file}: POE is not said to be devised there, and no chapter or page`);
    assert.ok(intro.includes(lang === 'ja' ? 'アカウントは要らず' : 'No account is needed'), file);
    const table = (k) => tablesIn(bodyOf(lang, h4[k]))[0];
    for (const [k, minutes, rows] of [[0, 20, 5], [1, 45, 6]]) {
      const t = table(k);
      assert.equal(t.rows.length, rows, `${file}: ${SESSIONS[lang][k]}`);
      let end = 0;
      for (const row of t.rows) {
        const span = row[0].match(lang === 'ja' ? /^(\d+)〜(\d+)分$/ : /^(\d+)–(\d+) min$/);
        assert.ok(span, `${file}: time ${row[0]}`);
        assert.equal(Number(span[1]), end, `${file}: no gap or overlap at ${row[0]}`);
        end = Number(span[2]);
        assert.ok(row[1] && row[2], `${file}: actions and what to check`);
      }
      assert.equal(end, minutes, `${file}: ends at ${minutes} minutes`);
    }
    // The 20-minute session reads the line of numbers of "Where the vertical axis starts" at the bottoms 0, 40 and 50
    const misreadRow = table(0).rows[3].join(' ');
    assert.ok(misreadRow.includes(lang === 'ja' ? `${bottoms.join('・')}と動かし` : `to ${joinList('en', bottoms)}`), `${file}: the bottoms`);
    const changes = lang === 'ja' ? `${ratios.map((r) => r + '倍').join('・')}と変わる` : `changes to ${joinList('en', ratios)}`;
    assert.ok(misreadRow.includes(changes), `${file}: the ratios`);
    assert.ok(misreadRow.includes(lang === 'ja' ? `${ratios[0]}倍のまま` : `stays at ${ratios[0]}`), `${file}: the value ratio`);
    const sessionText = plain([...table(0).rows.flat(), ...table(1).rows.flat()], lang);
    for (const key of ['predictSummary', 'predictReveal', 'checksHeading', 'chartChecksHeading', 'ctl.popout-feature.variety', 'ctl.popout-feature.kind',
      'ctl.gestalt-contour.gap', 'ctl.misread-baseline.bottom', 'introRouteHeading']) {
      assert.ok(sessionText.includes(M[lang][key]), `${file}: the sessions use the screen label ${key}`);
    }
    const questions = table(2);
    assert.deepEqual(questions.rows.map((r) => r[0]), ['1', '2', '3'], `${file}: three discussion questions`);
    const talk = plain(bodyOf(lang, h4[3]), lang);
    const main = C.SET_SIZES.length * 2 * C.MAIN_REPS;
    for (const fragment of lang === 'ja' ? [`1人${main}回`, `（${C.CMP_STEP}ミリ秒）`, '約6回に1回', '判定しない', '人どうしで比べない']
      : [`Results of ${main} tries`, `(${C.CMP_STEP} ms)`, 'about 1 run in 6', 'Do not judge fast or slow', 'do not compare it between people']) {
      assert.ok(talk.includes(fragment), `${file}: talking about the results: ${fragment}`);
    }
    const tg = D.references.treisman1980;
    assert.ok(talk.includes(`${tg.conjPresent}`) && talk.includes(`${tg.conjAbsent}`), `${file}: research values`);
  }
});

test('G: the research project ideas and the CamoForge examples use the words and values of the screen', () => {
  const loans = D.datasets.libraryLoans3;
  for (const lang of LANGS) {
    const file = FILES[lang], q = (s) => (lang === 'ja' ? `「${s}」` : `"${s}"`);
    const research = sub(lang, '🎯', 1), camo = sub(lang, '🎯', 2);
    assert.equal(sectionsOf(lang, 4, research.from, research.to).length, 6, `${file}: five themes and the tips`);
    assert.equal(sectionsOf(lang, 4, camo.from, camo.to).length, 3, `${file}: three CamoForge examples`);
    const rt = plain(bodyOf(lang, research), lang);
    for (const id of ['search-time', 'search-camo', 'illusion-lightness-contrast', 'gestalt-proximity-similarity', 'misread-baseline']) {
      assert.ok(rt.includes(q(baseTitle(lang, id))), `${file}: the research ideas name ${id}`);
    }
    for (const key of ['ctl.illusion-lightness-contrast.diff', 'ctl.illusion-lightness-contrast.compare', 'ctl.illusion-lightness-contrast.compare.band',
      'ctl.gestalt-proximity-similarity.sim', 'ctl.gestalt-proximity-similarity.sim.rows', 'ctl.gestalt-proximity-similarity.prox',
      'ctl.gestalt-proximity-similarity.prox.even', 'ctl.gestalt-proximity-similarity.prox.cols', 'ctl.gestalt-proximity-similarity.prox.colsMuch',
      'ctl.misread-baseline.mark', 'camoResearchHeading', 'predictSummary']) {
      assert.ok(rt.includes(q(M[lang][key])), `${file}: research ideas: ${key} "${M[lang][key]}"`);
    }
    assert.ok(rt.includes(q(lang === 'ja' ? M.ja.setFillShort : 'Fill × direction')), `${file}: the color-free feature pair`);
    const diffs = control('illusion-lightness-contrast', 'diff').values.map((v) => Math.round(v * 100));
    assert.ok(rt.includes(lang === 'ja' ? `${diffs.join('・')}%` : `(${joinList('en', diffs)}%)`), `${file}: the steps of the surrounds`);
    assert.ok(rt.includes(lang === 'ja' ? `${C.SET_SIZES.join('・')}個` : `${joinList('en', C.SET_SIZES)} items`), `${file}: the numbers of items`);
    const months = lang === 'ja' ? `4月${loans[0]}・5月${loans[1]}・6月${loans[2]}` : `${loans[0]} in April, ${loans[1]} in May and ${loans[2]} in June`;
    assert.ok(rt.includes(months), `${file}: ${months}`);
    for (const b of [0, 30, 50]) assert.ok(control('misread-baseline', 'bottom').values.includes(b), `the bottom ${b} is a step of the slider`);
    assert.ok(rt.includes(`${C.CAMO_TIMEOUT_MS / 1000}`) && rt.includes(lang === 'ja' ? '長くても4分ほど' : 'about 4 minutes at most'), file);
    // The CamoForge examples: the link of the related tool, the entries and controls of this tool, and the sentence of its small scene
    const ct = plain(bodyOf(lang, camo), lang), raw = bodyOf(lang, camo).join('\n');
    assert.ok(raw.includes(`(${D.relatedTools.day085.url})`), `${file}: the link to CamoForge`);
    for (const id of ['illusion-lightness-contrast', 'popout-feature', 'popout-asymmetry']) assert.ok(ct.includes(q(baseTitle(lang, id))), `${file}: ${id}`);
    for (const key of ['ctl.illusion-lightness-contrast.diff', 'ctl.popout-feature.kind', 'ctl.popout-feature.kind.color', 'ctl.popout-feature.kind.lightness',
      'ctl.popout-asymmetry.target', 'ctl.popout-asymmetry.target.withLine']) assert.ok(ct.includes(q(M[lang][key])), `${file}: CamoForge: ${key}`);
    const line = M[lang].asymHide.split(lang === 'ja' ? '。' : '.')[0];
    assert.ok(ct.includes(lang === 'ja' ? `「${line}」` : line[0].toLowerCase() + line.slice(1)), `${file}: the sentence of the small scene: ${line}`);
  }
});

test('G: the other uses name every related tool, and the limits give the rounds of the two experiments', () => {
  for (const lang of LANGS) {
    const other = subText(lang, '🎯', 3), limits = subText(lang, '🎯', 4), file = FILES[lang];
    for (const [key, tool] of Object.entries(D.relatedTools)) assert.ok(other.includes(`${key.replace('day', 'Day')} ${tool.name}`), `${file}: ${key}`);
    const main = C.SET_SIZES.length * 2 * C.MAIN_REPS, camo = C.CAMO_PATTERNS.length * C.CAMO_MAIN_REPS;
    assert.ok(limits.includes(lang === 'ja' ? `探す実験は1人${main}回、迷彩の実験は1人${camo}回` : `${main} tries and the camouflage test ${camo} rounds per person`), file);
  }
});

// ===== Screenshots =====
const SHOTS = ['screenshot.png', 'screenshot2.png', 'screenshot3.png', 'screenshot4.png', 'screenshot5.png', 'screenshot6.png'];
function imageRefs(lang) {
  const text = prose(lang).join('\n');
  const refs = [...[...text.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1])];
  return refs.filter((src) => !/^[a-z][a-z0-9+.-]*:/i.test(src)).map((src) => src.replace(/^\.\//, ''));
}
const pngs = (dir) => (fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)).filter((f) => /\.png$/i.test(f)) : []);
// The chunks of a PNG, each with its CRC checked (CRC-32 of the PNG specification)
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunks(png, image) {
  const chunks = [];
  let at = 8;
  while (at < png.length) {
    assert.ok(at + 12 <= png.length, image + ': a whole chunk at ' + at);
    const length = png.readUInt32BE(at), type = png.subarray(at + 4, at + 8).toString('latin1');
    assert.ok(at + 12 + length <= png.length, `${image}: the chunk ${type} ends inside the file`);
    assert.equal(png.readUInt32BE(at + 8 + length), crc32(png.subarray(at + 4, at + 8 + length)), `${image}: CRC of ${type} at ${at}`);
    chunks.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return chunks;
}
const PNG_COLOR = { 0: [1, [1, 2, 4, 8, 16]], 2: [3, [8, 16]], 3: [1, [1, 2, 4, 8]], 4: [2, [8, 16]], 6: [4, [8, 16]] };
// A PNG read down to its image data: the chunks, the IHDR, one run of IDAT chunks whose data inflates to one filter byte (0 to 4) and one
// row of samples per line
function pngImage(png, image) {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', image + ': PNG signature');
  const chunks = pngChunks(png, image), types = chunks.map((c) => c.type);
  assert.equal(types[0], 'IHDR', image + ': IHDR first');
  assert.equal(types.at(-1), 'IEND', image + ': IEND last');
  const ihdr = chunks[0].data;
  assert.equal(ihdr.length, 13, image + ': IHDR is 13 bytes');
  const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4), [depth, color, compression, filter, interlace] = ihdr.subarray(8);
  assert.ok(PNG_COLOR[color] && PNG_COLOR[color][1].includes(depth), `${image}: bit depth ${depth} for color type ${color}`);
  assert.deepEqual([compression, filter, interlace], [0, 0, 0], image + ': compression 0, filter method 0, not interlaced');
  const first = types.indexOf('IDAT'), last = types.lastIndexOf('IDAT');
  assert.ok(first > 0 && types.slice(first, last + 1).every((t) => t === 'IDAT'), `${image}: one run of IDAT chunks`);
  let data;
  try {
    data = zlib.inflateSync(Buffer.concat(chunks.slice(first, last + 1).map((c) => c.data)));
  } catch (error) {
    assert.fail(`${image}: the IDAT data does not inflate: ${error.message}`);
  }
  const row = Math.ceil((width * PNG_COLOR[color][0] * depth) / 8);
  assert.equal(data.length, height * (1 + row), `${image}: ${height} rows of ${row} bytes, each after its filter byte`);
  assert.deepEqual(Array.from({ length: height }, (_, y) => data[y * (1 + row)]).filter((type) => type > 4), [], image + ': filter types 0 to 4');
  return { width, height };
}
function makePng(width, height, idat, color = 2, depth = 8) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4), crc = Buffer.alloc(4), name = Buffer.from(type, 'latin1');
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = color;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

test('G: pngImage reads a PNG made here, and finds data that does not inflate, rows of the wrong number and a bad filter type', () => {
  const rows = (filter, count = 2) => Buffer.concat(Array.from({ length: count }, () => Buffer.from([filter, 1, 2, 3, 4, 5, 6])));
  assert.deepEqual(pngImage(makePng(2, 2, zlib.deflateSync(rows(0))), 'two rows'), { width: 2, height: 2 });
  assert.throws(() => pngImage(makePng(2, 2, Buffer.from('not the data of a zlib stream')), 'garbage'), /does not inflate/);
  assert.throws(() => pngImage(makePng(2, 2, zlib.deflateSync(rows(0, 1))), 'one row'), /2 rows of 6 bytes/);
  assert.throws(() => pngImage(makePng(2, 2, zlib.deflateSync(rows(5))), 'filter 5'), /filter types 0 to 4/);
});

test('G: the images: every reference exists in order, each PNG in assets/ and assets/en/ is used by its README, and the twelve PNGs decode, '
  + 'are different, 808px wide, at most 1100px high and 300,000 bytes or less', () => {
  for (const lang of LANGS) {
    const refs = imageRefs(lang), file = FILES[lang];
    for (const ref of refs) assert.ok(fs.existsSync(path.join(root, ref)) && fs.statSync(path.join(root, ref)).isFile(), file + ': ' + ref);
    assert.deepEqual(refs, SHOTS.map((name) => 'assets/' + (lang === 'en' ? 'en/' : '') + name), file + ': the screenshots of its language, in order');
  }
  assert.deepEqual(pngs('assets').map((f) => 'assets/' + f).filter((f) => !imageRefs('ja').includes(f)), [], 'every PNG in assets/ is used by README.md');
  assert.deepEqual(pngs('assets/en').map((f) => 'assets/en/' + f).filter((f) => !imageRefs('en').includes(f)), [],
    'every PNG in assets/en/ is used by README.en.md');
  const hashes = new Set();
  for (const image of [...SHOTS.map((n) => 'assets/' + n), ...SHOTS.map((n) => 'assets/en/' + n)]) {
    const png = fs.readFileSync(path.join(root, image));
    const { width, height } = pngImage(png, image);
    assert.equal(width, 808, image + ': width ' + width);
    assert.ok(height >= 1 && height <= 1100, image + ': height ' + height);
    assert.ok(png.length <= 300000, image + ': ' + png.length + ' bytes');
    hashes.add(crypto.createHash('sha256').update(png).digest('hex'));
  }
  assert.equal(hashes.size, SHOTS.length * 2, 'twelve different images');
});

// The captions: one line "> *…*" right after each image, starting with what it shows
const CAPTION_HEADS = {
  ja: ['開いた直後：', `「${M.ja.tabPopout}」タブ：`, `「${M.ja.tabGestalt}」タブ：`, `「${M.ja.tabSearch}」タブの探す実験：`, `「${M.ja.tabSearch}」タブの迷彩の実験：`,
    `「${M.ja.tabMisread}」タブ：`],
  en: ['Right after opening: ', `${M.en.tabPopout} tab: `, `${M.en.tabGestalt} tab: `, `${M.en.tabSearch} tab, search experiment: `,
    `${M.en.tabSearch} tab, camouflage test: `, `${M.en.tabMisread} tab: `],
};
function captions(lang) {
  const empty = (line) => /^>?\s*$/.test(line.trim());
  const lines = bodyOf(lang, section(lang, h2(lang, '📸'))), file = FILES[lang];
  const images = lines.map((line, i) => [line.trim(), i]).filter(([line]) => /^!\[[^\]]*\]\([^)\s]+\.png\)$/.test(line));
  assert.equal(images.length, SHOTS.length, file + ': one image line per screenshot');
  return images.map(([line, i]) => {
    let j = i + 1;
    while (j < lines.length && empty(lines[j])) j++;
    const caption = (lines[j] || '').trim();
    assert.match(caption, /^> \*[^*\s](?:[^*]*[^*\s])?\*$/, `${file}: the caption after ${line}`);
    assert.ok(j + 1 >= lines.length || empty(lines[j + 1]), `${file}: the caption after ${line} is one line`);
    return caption.replace(/^> \*/, '').replace(/\*$/, '');
  });
}

test('G: each screenshot has a one-line caption that starts with what it shows and gives the settings and values of the screen', () => {
  const { uc1 } = useCaseFacts();
  const check = D.groups.find((g) => g.id === 'misread').checks[0], bottom = check.figures[0].params.bottom;
  const values = check.figures[0].params.values;
  const wrong = M.ja[`check.${check.id}.choice.a`], right = M.ja[`check.${check.id}.choice.${check.answer}`];
  assert.deepEqual([bottom, (values[2] - bottom) / (values[0] - bottom), values[2] / values[0]], [45, 3, 1.2], 'the question of the last screenshot');
  const defaults = (lang) => ['kind', 'diff', 'variety'].map((cid) => V.stepLabel(M[lang], entry('popout-feature'), control('popout-feature', cid),
    control('popout-feature', cid).default)).concat(String(control('popout-feature', 'count').default));
  const want = {
    ja: [
      [`導入の${M.ja.introShort.split('。').filter(Boolean).length}文`, '「この図鑑でできること」の4項目', '「はじめて読むときの順路」の3つのボタン', `${TABS.length}つのタブ`],
      [`「${baseTitle('ja', 'popout-feature')}」`,
        `（違いの種類＝${defaults('ja')[0]}、違いの大きさ＝${defaults('ja')[1]}、周りのばらつき＝${defaults('ja')[2]}、図形の数＝${defaults('ja')[3]}）`,
        `${defaults('ja')[3]}個の棒`],
      [`「${baseTitle('ja', 'gestalt-contour')}」で「${M.ja['ctl.gestalt-contour.gap']}」を${uc1.to}%にした`, `欠けた${uc1.bands}か月`, `${uc1.spots}個の斑点`],
      [`結合探索（${M.ja.setColorShort}）`, '図形は18個', '色と方向の組み合わせだけがほかと違う', 'ない＝F・←、ある＝J・→'],
      ['練習1回目', '蛾の形（底辺を上にした三角形）'],
      [`「${M.ja.checksHeading}」の1問目で「${wrong}」を選んだ`, `縦軸が${bottom}から始まる`, `値の比は${right}`],
    ],
    en: [
      ['the three sentences of the introduction', 'the four items of "What you can do here"', 'the three buttons of "Where to start"', 'the six tabs'],
      [`"${baseTitle('en', 'popout-feature')}"`, `(Kind of difference: ${defaults('en')[0]}; Size of the difference: ${defaults('en')[1]}; Variety around it: `
        + `${defaults('en')[2]}; Number of items: ${defaults('en')[3]})`, `among ${defaults('en')[3]} bars`],
      [`"${baseTitle('en', 'gestalt-contour')}" with "${M.en['ctl.gestalt-contour.gap']}" at ${uc1.to}%`, `the ${uc1.bands} missing months`,
        `${uc1.spots} spots`],
      [`conjunction search practice (${M.en.setColorShort})`, 'There are 18 items', 'only in its combination of color and direction', 'No = F, ←; Yes = J, →'],
      ['the first practice round', 'a triangle with its base at the top'],
      [`"${M.en[`check.${check.id}.choice.a`]}" chosen in the first question of "${M.en.checksHeading}"`, `vertical axis starts at ${bottom}`,
        `a value ratio of ${values[2] / values[0]}`],
    ],
  };
  assert.equal(M.ja.introShort.split('。').filter(Boolean).length, 3);
  for (const lang of LANGS) {
    captions(lang).forEach((caption, k) => {
      assert.ok(caption.startsWith(CAPTION_HEADS[lang][k]), `${FILES[lang]}: caption ${k + 1} starts with "${CAPTION_HEADS[lang][k]}": ${caption}`);
      for (const fragment of want[lang][k]) assert.ok(caption.includes(fragment), `${FILES[lang]}: caption ${k + 1} has "${fragment}": ${caption}`);
    });
  }
});

// ===== The directory tree =====
const TREE = ['vision-trap-atlas/', '|-- .gitattributes', '|-- .github/', '|   `-- workflows/', '|       `-- test.yml', '|-- LICENSE', '|-- README.md',
  '|-- README.en.md', '|-- index.html', '|-- style.css', '|-- theme-init.js', '|-- atlas-core.js', '|-- atlas-data.js', '|-- atlas-view.js',
  '|-- atlas-search.js',
  '|-- messages.js', '|-- app.js', '|-- package.json', '|-- assets/', '|   |-- screenshot.png', '|   |-- screenshot2.png', '|   |-- screenshot3.png',
  '|   |-- screenshot4.png', '|   |-- screenshot5.png', '|   |-- screenshot6.png', '|   `-- en/', '|       |-- screenshot.png', '|       |-- screenshot2.png',
  '|       |-- screenshot3.png', '|       |-- screenshot4.png', '|       |-- screenshot5.png', '|       `-- screenshot6.png', '`-- test/',
  '    |-- core.test.js',
  '    |-- data.test.js', '    |-- view.test.js', '    |-- search.test.js', '    |-- text.test.js', '    |-- structure.test.js', '    |-- i18n.test.js',
  '    |-- format.test.js', '    |-- contrast.test.js', '    |-- theme-init.test.js', '    |-- readme.test.js', '    |-- fixtures/',
  '    |   `-- illusion-data.js',
  '    |-- interface.browser.py', '    `-- startup.browser.py'];
// The files and folders of the repository; only .git (a folder, or a file in a linked work tree) is left out
function walk(dir = root, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((item) => item.name !== '.git').flatMap((item) => {
    const relative = prefix + item.name;
    return item.isDirectory() ? [relative + '/', ...walk(path.join(dir, item.name), relative + '/')] : [relative];
  });
}
function treePaths(lines) {
  const stack = [];
  return lines.slice(1).map((line) => {
    const m = line.match(/^((?:\| {3}| {4})*)(?:\|--|`--) (\S+)$/);
    assert.ok(m, 'tree line: ' + line);
    stack.length = m[1].length / 4;
    const full = [...stack, m[2]].join('/');
    if (m[2].endsWith('/')) stack.push(m[2].slice(0, -1));
    return full;
  });
}

test('G: both directory trees: an explanation on every line, the lines in order, and exactly the files of the repository', () => {
  assert.equal(TREE[0], SLUG + '/');
  assert.deepEqual(treePaths(TREE).sort(), walk().sort(), 'the tree and the files of the repository');
  for (const lang of LANGS) {
    const s = section(lang, h2(lang, '📁')), raw = doc(lang).split('\n').slice(s.from, s.to).join('\n'), file = FILES[lang];
    const fences = [...raw.matchAll(/^```[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm)];
    assert.equal(fences.length, 1, file + ': one code block in the directory section');
    const lines = fences[0][1].split('\n').filter((line) => line.trim());
    const parts = lines.map((line) => {
      const m = line.match(/^(.*?\S)\s+# (\S.*)$/);
      assert.ok(m, `${file}: an explanation after "# " on the tree line: ${line}`);
      return m[1];
    });
    assert.deepEqual(parts, TREE, file + ': the tree lines and their order');
    // The letter of each test file is the letter its tests start with
    for (const line of lines.filter((l) => /\.test\.js\s/.test(l))) {
      const [, name, letter] = line.match(/(\S+\.test\.js)\s+# ([A-H])/);
      const first = fs.readFileSync(path.join(root, 'test', name), 'utf8').match(/^test\('([A-H]):/m);
      assert.equal(first[1], letter, `${file}: ${name} is ${letter}`);
    }
  }
});

// ===== The other sections =====
const HUB = {
  ja: 'ツールの一覧と学習の入口は、[ハッキング・ラボ・オンライン](https://hackinglab.online/)にまとめています。',
  en: 'All tools in the series are listed on [Hacking Lab Online](https://hackinglab.online/).',
};

test('G: the about section links the series page and ends with the line to the hub', () => {
  for (const lang of LANGS) {
    const lines = bodyOf(lang, section(lang, h2(lang, '🛠️'))).filter((line) => line.trim()), file = FILES[lang];
    assert.equal(lines.at(-1).trim(), HUB[lang], file + ': the last line of the about section');
    assert.ok(lines.join('\n').includes('https://akademeia.info/?page_id=44607'), file + ': the page of the series');
  }
});

test('G: the security section gives the CSP of index.html and the two storage keys of the scripts', () => {
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1];
  const scripts = fs.readdirSync(root).filter((f) => f.endsWith('.js'));
  const stored = [...new Set(scripts.flatMap((f) => [...fs.readFileSync(path.join(root, f), 'utf8').matchAll(/localStorage\.setItem\(\s*'([^']+)'/g)]
    .map((m) => m[1])))].sort();
  assert.equal(stored.length, 2);
  for (const lang of LANGS) {
    const lines = bodyOf(lang, section(lang, h2(lang, '🔒'))), file = FILES[lang];
    const codes = [...lines.join('\n').matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
    assert.deepEqual(codes.filter((code) => /default-src/.test(code)), [csp], file + ': the CSP of index.html');
    assert.deepEqual([...new Set(codes.filter((code) => /^vision-trap-atlas\./.test(code)))].sort(), stored, file + ': the storage keys');
  }
});

test('G: the Node.js version in both READMEs is the one of package.json, and the tests section names npm test', () => {
  const engine = require('../package.json').engines.node.match(/^>=(\d+)$/)[1];
  for (const lang of LANGS) {
    const named = [...doc(lang).matchAll(/\bNode(?:\.js)?\s*(\d+)/g)].map((m) => m[1]);
    assert.ok(named.length >= 2, FILES[lang] + ': Node.js named in the tests and the requirements');
    assert.deepEqual([...new Set(named)], [engine], FILES[lang]);
    assert.match(bodyOf(lang, section(lang, h2(lang, '🧪'))).join('\n'), /npm test/);
  }
});

// ===== References =====
const SEARCH_TERMS = ['camouflage and data visualization "same" perceptual principles salience highlight hide teaching',
  'Project Nightjar game find the camouflaged bird search time citizen science', 'PsyToolkit visual search experiment library online',
  'Healey perception in visualization preattentive processing demo', 'interactive Gestalt principles demo proximity similarity closure explorable',
  'interactive misleading chart playground slider y-axis baseline aspect ratio explorable'];
const JA_TERMS = ['視覚探索 ポップアウト 体験 デモ ブラウザ 反応時間', 'ゲシュタルトの法則 体験 インタラクティブ 近接 類同 閉合'];
const ABSENT = {
  ja: '同じ視覚の性質を、見せる側（データ可視化）と隠す側（迷彩）の両方から体験し、自分の探す時間を研究の傾きと並べ、誤読させるグラフまで1つの図鑑で日本語と英語で'
    + `扱う教材は、2026-11-12にWeb検索で調べた範囲（主な検索語：${[...SEARCH_TERMS, ...JA_TERMS].join('、')}）では見当たりませんでした。`,
  en: 'No teaching material that lets you experience the same visual traits from both the showing side (data visualization) and the hiding side '
    + '(camouflage), sets your own search times beside the slopes from research, and covers misleading charts as well, in one atlas in Japanese and '
    + `English, was found in web searches on 2026-11-12 (main search terms: ${SEARCH_TERMS.join(', ')}, and two Japanese queries for visual search `
    + 'pop-out demos and interactive Gestalt principles).',
};
// The rows of the prior work, in order: the name in the first cell and the address of its link
const PRIOR = [['Healey', 'https://www.csc2.ncsu.edu/faculty/healey/PP/index.html'], ['Michael Bach', 'https://michaelbach.de/ot/'],
  ['PsyToolkit', 'https://www.psytoolkit.org/experiment-library/search.html'], ['jsPsych', 'https://www.jspsych.org/latest/plugins/visual-search-circle/'],
  [{ ja: 'キソジオンライン', en: 'Kisoji Online' }, 'https://kohske.github.io/KisojiOnline/'],
  ['Hanover ISLE', 'https://isle.hanover.edu/isle2/Ch05Object/Ch05ProxSim_evt.html'],
  ['Calling Bullshit', 'https://callingbullshit.org/tools/tools_misleading_axes.html'],
  ['React Graph Gallery', 'https://www.react-graph-gallery.com/example/dual-y-axis-interactive'],
  ['Zero baseline explainer', 'https://vpascual.github.io/explainer-zeroaxis'], ['Project Nightjar', 'https://thentrythis.org/projects/project-nightjar/'],
  ['CamoEvo', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9314924/'],
  ['TU Graz', 'https://courses.isds.tugraz.at/ivis/surveys/ss2026/ivis-ss2026-g2-survey-dishonest-chart-techniques.pdf'],
  ['FlowingData', 'https://flowingdata.com/projects/dishonest-charts/']];
// A source of the data as the READMEs list it: its citation, then the link of its DOI (or its address)
const sourceLine = (s) => s.cite + (s.doi ? ` DOI [${s.doi}](https://doi.org/${s.doi})` : s.url ? ` [Datawrapper](${s.url})` : '');

test('G: the references: the prior-work table, the dated sentence with its search terms, the sources of the data in the order of their '
  + 'authors, and the related tools of the data', () => {
  const sources = Object.values(D.sources).slice().sort((a, b) => (a.cite < b.cite ? -1 : a.cite > b.cite ? 1 : 0));
  assert.equal(sources.length, 37);
  for (const lang of LANGS) {
    const lines = bodyOf(lang, section(lang, h2(lang, '🔗'))), text = plain(lines, lang), file = FILES[lang];
    const tables = tablesIn(lines);
    const prior = tables[0];
    assert.equal(prior.header.length, 3, file + ': the prior-work table has three columns');
    assert.equal(prior.rows.length, PRIOR.length, file + ': the rows of the prior work');
    prior.rows.forEach((row, k) => {
      const [name, href] = PRIOR[k], label = typeof name === 'string' ? name : name[lang];
      assert.ok(row[0].includes(label) && row[0].includes(`](${href})`), `${file}: prior-work row ${k + 1}: ${row[0]}`);
      assert.ok(row[1] && row[2], `${file}: what it has and what this atlas adds`);
    });
    assert.ok(text.includes(ABSENT[lang]), file + ': ' + ABSENT[lang]);
    // The sources of the screen (atlas-data.js), each once, in the order of their citations
    const listed = lines.filter((line) => /^- [A-Z]/.test(line) && /\(\d{4}\)/.test(line) && !/White, R\./.test(line)).map((line) => line.slice(2));
    assert.deepEqual(listed, sources.map(sourceLine), `${file}: the sources of the data`);
    assert.ok(lines.some((line) => line.includes('White, R., & Gunstone, R. (1992). Probing Understanding. Falmer Press.')), `${file}: the source of POE`);
    // The related tools: the rows of the data, each with its link and the sentence of the screen
    const related = tables.find((t) => t.rows.length === Object.keys(D.relatedTools).length && t.rows[0][0].includes('Day101'));
    assert.ok(related, file + ': the table of related tools');
    assert.deepEqual(related.rows, Object.entries(D.relatedTools).map(([key, tool]) => [`[${key.replace('day', 'Day')} ${tool.name}](${tool.url})`,
      M[lang][tool.textKey]]), `${file}: the related tools`);
  }
});

// ===== Words =====
// Words a README of this tool avoids: the words of how the work went (joined at run time so that this file does not carry them), the
// wording of a recommendation, "XXX のタブ" for a tab, and the words of the house style (literal verbs, claims of being first)
const HISTORY = [['第', '1弾'], ['第', '2弾'], ['段', '階'], [String.fromCodePoint(0x6e1a)], ['Co', 'dex'], ['作', '者'], ['試', '作'], ['プロト', 'タイプ']]
  .map((parts) => parts.join(''));
const AVOIDED_JA = ['おすすめ', 'オススメ', '効く', '走る', '走ら', '照合', '突き合わ', '断定', '構図', '落とし穴', '潰', '踏み込', '浮き彫り', '向き', '本数',
  '1項目あたり', '分かる', '分かり', '分から', '全て', '既に', '考案', '初の', '唯一', '世界初', 'どこにもない'];
const AVOIDED_PATTERNS_JA = [/」のタブ/, /浮[かきくけこい]/, /てみ[るたよてまれ]/];
const AVOIDED_EN = [/\brecommend/i, /\bfirst ever\b/i, /\bworld'?s first\b/i, /\bnowhere else\b/i, /\bdevised\b/i, /\binvented\b/i,
  /\bthe only (?:tool|atlas|teaching|one)\b/i, /\bunique\b/i];

test('G: no README word of how the work went, no recommendation wording, no "XXX のタブ", and the words of the house style', () => {
  for (const lang of LANGS) {
    const text = doc(lang), file = FILES[lang];
    for (const word of HISTORY) assert.ok(!text.includes(word), `${file}: ${word}`);
    if (lang === 'ja') {
      for (const word of AVOIDED_JA) assert.ok(!text.includes(word), `${file}: ${word}`);
      for (const pattern of AVOIDED_PATTERNS_JA) assert.doesNotMatch(text, pattern, file);
    } else for (const pattern of AVOIDED_EN) assert.doesNotMatch(text, pattern, file);
  }
});

// Japanese letters and the full-width marks
const JA_WIDE = '[\\u3000-\\u303f\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uff00-\\uffef]';

test('G: README.md has no half-width space between Japanese (or a full-width mark) and Latin letters, digits or code', () => {
  const pattern = new RegExp(`${JA_WIDE} +[A-Za-z0-9]|[A-Za-z0-9] +${JA_WIDE}`);
  const found = [];
  prose('ja').forEach((line, i) => {
    const body = line.replace(/`[^`\n]*`/g, 'x').replace(/\]\([^)]*\)/g, ']').replace(/<[^>]*>/g, 'x').replace(/https?:\/\/[^\s)>\]]+/g, 'x');
    const m = body.match(pattern);
    if (m) found.push(`README.md:${i + 1}: "${m[0]}" in ${line.trim().slice(0, 80)}`);
  });
  assert.deepEqual(found, [], 'spaces between Japanese and Latin letters or digits:\n' + found.join('\n'));
});

test('G: emphasis stays rare (at most one bold span per section, the opening only the series line), no bold item names, no quotation or '
  + 'rule as a separator', () => {
  for (const lang of LANGS) {
    const lines = prose(lang), file = FILES[lang];
    const blocks = [{ title: 'the opening', from: 0, to: firstH2(lang) }, ...sectionsOf(lang, 2)];
    for (const b of blocks) {
      const marks = (lines.slice(b.from, b.to).join('\n').replace(/`[^`\n]*`/g, '').match(/\*\*/g) || []).length;
      assert.ok(marks / 2 <= 1, `${file}: ${marks / 2} bold spans in ${b.title}`);
    }
    const bold = lines.map((line, i) => [line, i]).filter(([line]) => /^\s*(?:[-*+]|\d+\.)\s+\*\*/.test(line));
    assert.deepEqual(bold.map(([line, i]) => `${file}:${i + 1}: ${line}`), [], file + ': list items do not start with bold');
    // A quotation only for the caption under a screenshot; no horizontal rule in the text
    const shots = section(lang, h2(lang, '📸'));
    const quotes = lines.map((line, i) => [line, i]).filter(([line]) => /^\s*>/.test(line));
    assert.ok(quotes.every(([line, i]) => i >= shots.from && i < shots.to && /^> \*.+\*$/.test(line)), `${file}: quotations are captions only`);
    assert.deepEqual(lines.filter((line) => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)), [], `${file}: no horizontal rule`);
  }
});

test('G: README.en.md has no Japanese letter or full-width mark outside its first line (code blocks and tables included)', () => {
  const wide = new RegExp(JA_WIDE);
  const found = doc('en').split('\n').map((line, i) => [line, i]).filter(([line, i]) => i > 0 && wide.test(line));
  assert.deepEqual(found.map(([line, i]) => `README.en.md:${i + 1}: ${line}`), []);
});

test('G: both READMEs use the words of the screen: the six tabs and the names of the experiments as messages.js has them', () => {
  for (const lang of LANGS) {
    const text = plain(prose(lang), lang);
    for (const key of ['tabPopout', 'tabSearch', 'tabGestalt', 'tabFigureGround', 'tabMisread', 'tabIllusion', 'camoStart', 'startFeature', 'startConj']) {
      assert.ok(text.includes(M[lang][key]), `${FILES[lang]}: ${key} "${M[lang][key]}"`);
    }
  }
});
