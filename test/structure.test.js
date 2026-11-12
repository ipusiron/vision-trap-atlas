'use strict';
// F: static structure of index.html, the scripts and the style: CSP, script order, no sending or storing beyond the two preferences,
// no HTML injection, no motion, the header and footer, the help, and no local paths or words of how the work went.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const SCRIPTS = ['theme-init.js', 'atlas-core.js', 'atlas-data.js', 'atlas-view.js', 'atlas-search.js', 'messages.js', 'app.js'];
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
  + "base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'";
const GROUPS = ['popout', 'search', 'gestalt', 'figure-ground', 'misread'];
const css = read('style.css');
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('F: strict offline CSP, referrer, icon, noscript and no inline code', () => {
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`));
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(html, /<link rel="icon" href="data:,">/);
  assert.match(html, /<noscript>[^<]+<\/noscript>/);
  assert.match(html, /<title>Vision Trap Atlas<\/title>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline script');
  assert.doesNotMatch(html, /<script[^>]*\btype=/, 'classic scripts only (no modules)');
  assert.doesNotMatch(html, /<style\b|\sstyle=/, 'no inline style');
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'no inline event handlers');
  assert.match(html, /<html lang="ja" data-app-ready="false">/);
  // Five tabs in the order of the groups, each with its panel; a panel can take the focus right after its tab
  assert.deepEqual([...html.matchAll(/<button id="tab-([a-z-]+)" role="tab"/g)].map((m) => m[1]), GROUPS);
  assert.deepEqual([...html.matchAll(/<section id="panel-([a-z-]+)" class="panel" role="tabpanel" aria-labelledby="tab-\1" tabindex="0"/g)]
    .map((m) => m[1]), GROUPS);
  for (const g of GROUPS) assert.match(html, new RegExp(`aria-controls="panel-${g}"`), g);
  assert.match(html, /<dialog id="help-dialog" aria-labelledby="help-title">/);
  // The startup type: both guarded groups start disabled, with the notice and the link to reopen the page
  assert.match(html, /<fieldset id="startup-tools" class="header-tools startup-control-group" disabled /);
  assert.match(html, /<fieldset id="startup-controls" class="startup-control-group" disabled /);
  assert.match(html, /<aside id="startup-note" class="startup-note" role="status">/);
  assert.match(html, /<a id="startup-reload" href="" target="_blank" rel="noopener noreferrer">/);
});

test('F: the script order is fixed; theme-init.js is synchronous and the rest are deferred', () => {
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  assert.match(head, /<link rel="stylesheet" href="style\.css">\s*<script src="theme-init\.js"><\/script>/);
  const tags = [...html.matchAll(/<script\b([^>]*)><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(tags.map((attributes) => attributes.match(/\bsrc="([^"]+)"/)[1]), SCRIPTS);
  assert.equal(tags[0], ' src="theme-init.js"');
  for (const attributes of tags.slice(1)) assert.match(attributes, /^ src="[^"]+" defer$/);
});

test('F: UMD globals; the calculation reads no other file; the view and the search take AtlasCore', () => {
  const globals = [['atlas-core.js', 'AtlasCore'], ['atlas-data.js', 'AtlasData'], ['atlas-view.js', 'AtlasView'], ['atlas-search.js', 'AtlasSearch'],
    ['messages.js', 'AtlasMessages']];
  for (const [file, name] of globals) {
    assert.match(read(file), new RegExp('root\\.' + name + ' = factory\\('), file);
    assert.equal(typeof require('../' + file), 'object', file);
  }
  assert.doesNotMatch(read('atlas-core.js'), /\brequire\s*\(|\bimport\b|root\.Atlas(?!Core\b)/);
  for (const [file, name] of [['atlas-view.js', 'AtlasView'], ['atlas-search.js', 'AtlasSearch']]) {
    assert.match(read(file), /module\.exports = factory\(require\('\.\/atlas-core\.js'\)\)/, file);
    assert.match(read(file), new RegExp('root\\.' + name + ' = factory\\(root\\.AtlasCore\\)'), file);
  }
  for (const file of ['atlas-data.js', 'messages.js']) assert.doesNotMatch(read(file), /\brequire\s*\(/, file);
  // Only app.js and theme-init.js touch the page
  for (const file of ['atlas-core.js', 'atlas-data.js', 'atlas-view.js', 'atlas-search.js', 'messages.js']) {
    assert.doesNotMatch(read(file), /\bdocument\.|\bwindow\.|localStorage/, file);
  }
});

test('F: no random numbers, network, HTML injection, inline styles or address changes in the scripts', () => {
  for (const file of SCRIPTS) {
    const code = read(file);
    assert.doesNotMatch(code, /Math\.random\s*\(|fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|innerHTML|outerHTML|insertAdjacentHTML/, file);
    assert.doesNotMatch(code, /document\.write|\beval\s*\(|new Function\s*\(/, file);
    assert.doesNotMatch(code, /\.style\.|setAttribute\(\s*['"]style['"]/, file);
    assert.doesNotMatch(code, /location\.hash\s*=|location\.(?:assign|replace)\s*\(|location\.href\s*=/, file);
    if (file !== 'app.js') assert.doesNotMatch(code, /history\.(?:pushState|replaceState)/, file);
  }
  // app.js writes the history in one function: a new entry with the tab in the address (the button to the next tab), the current
  // entry with the tab in the address (a tab button), or the current entry without changing the address (the place on the page)
  const app = read('app.js');
  assert.deepEqual([...app.matchAll(/history\.(pushState|replaceState)\(([^)]*)\)/g)].map((m) => m[1] + '(' + m[2] + ')'),
    ["pushState(entry, '', '#' + entry.tab)", "replaceState(entry, '', '#' + entry.tab)", "replaceState(entry, '')"]);
  // The seed of a new arrangement is the only use of crypto
  assert.deepEqual([...app.matchAll(/crypto\.\w+/g)].map((m) => m[0]), ['crypto.getRandomValues']);
});

test('F: only the language and theme preferences are stored', () => {
  const code = SCRIPTS.map(read).join('\n');
  const keys = [...code.matchAll(/localStorage\.setItem\(\s*'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys, ['vision-trap-atlas.language', 'vision-trap-atlas.theme']);
  assert.equal((code.match(/localStorage\.setItem\(/g) || []).length, 2, 'every stored key is a literal');
  assert.doesNotMatch(code, /sessionStorage|indexedDB|document\.cookie/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('F: no text input: the only <input> is the slider (type="range", made by app.js); no textarea or contenteditable', () => {
  assert.doesNotMatch(html, /<input\b|<textarea|contenteditable/i);
  const app = read('app.js');
  const inputs = [...app.matchAll(/E\('input', \{([^}]*)\}/g)].map((m) => m[1]);
  assert.equal(inputs.length, 1);
  assert.match(inputs[0], /^ type: 'range',/);
  for (const file of SCRIPTS) {
    assert.doesNotMatch(read(file), /createElement\(\s*['"](?:input|textarea|select)['"]|contentEditable|contenteditable/, file);
  }
});

test('F: no transition, animation or keyframes in the style; the body has no grid background', () => {
  assert.doesNotMatch(cssRules, /transition|animation|@keyframes/i);
  const body = cssRules.match(/(?:^|\n)body\s*\{([^}]*)\}/)[1];
  assert.doesNotMatch(body, /background-image|linear-gradient|background-size/);
  assert.doesNotMatch(cssRules, /linear-gradient|repeating-/);
  // The dark theme is for the screen; printing keeps the light colors and hides the buttons and the dialogs
  assert.match(cssRules, /@media screen \{\s*:root\[data-theme="dark"\] \{/);
  const print = cssRules.match(/@media print \{([\s\S]*?)\n\}/)[1];
  assert.match(print, /button, dialog, \.find-cover \{ display: none !important; \}/);
  assert.doesNotMatch(print, /--[a-z]/, 'no colors redefined for printing');
});

// Local paths, in any case: a drive letter, an MSYS drive outside the http(s) addresses, and the work folders by name (written in
// pieces, so that this file does not carry what it looks for)
const DRIVE = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/;
const MSYS_DRIVE = /(?<![\w.~%/-])\/[A-Za-z]\/(?=[^\s/])/;
const WORK_FOLDERS = new RegExp(['ipusiron' + '-work', 'App' + 'Data', 'tm' + 'p/day'].join('|'), 'i');
const ADDRESS = /https?:\/\/[\w\-.~:\/?#[\]@!$&()*+,;=%]+/gi;
function localPath(text) {
  const blanked = text.replace(ADDRESS, (address) => ' '.repeat(address.length));
  return text.match(DRIVE) || blanked.match(MSYS_DRIVE) || text.match(WORK_FOLDERS);
}
function textFiles(dir = root, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.name !== '.git').flatMap((entry) => {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) return textFiles(path.join(dir, entry.name), relative + '/');
    return /\.png$/i.test(entry.name) ? [] : [relative];
  });
}
// Words of how the work went (joined at run time so that this file does not carry them)
const HISTORY_WORDS = [[String.fromCodePoint(0x6e1a)], ['段', '階'], ['試', '作'], ['プロト', 'タイプ'], ['Co', 'dex'], ['第', '1弾'], ['第', '2弾'], ['作', '者']]
  .map((parts) => parts.join(''));

test('F: the check for local paths finds drive letters, MSYS drives and work folders, and leaves addresses alone', () => {
  const slash = (...parts) => parts.join('/'), back = (...parts) => parts.join('\\');
  for (const text of [slash('', 'c', 'Users', 'a'), slash('', 'D', 'work', 'x'), back('C:', 'Users', 'x'), slash('d:', 'work'), 'x ' + 'ipusiron' + '-work']) {
    assert.notEqual(localPath(text), null, text);
  }
  for (const text of [slash('https:', '', 'example.com', 'c', 'x'), 'and/or', 'A/B', 'assets/en/screenshot.png', '.github/workflows/test.yml',
    slash('https:', '', 'doi.org', '10.1016', '0010-0285(80)90005-5')]) assert.equal(localPath(text), null, text);
});

test('F: no local paths or words of how the work went in the files of the repository', () => {
  const files = textFiles();
  for (const file of ['index.html', 'style.css', 'app.js', 'theme-init.js', 'package.json', '.github/workflows/test.yml', 'test/structure.test.js',
    'test/interface.browser.py', 'test/startup.browser.py']) assert.ok(files.includes(file), file);
  for (const file of files) {
    const text = read(file);
    const m = localPath(text);
    assert.equal(m, null, m && `${file}: ${m[0]}`);
    for (const word of HISTORY_WORDS) assert.ok(!text.includes(word), `${file} has ${word}`);
  }
});

test('F: external links open in a new tab without opener or referrer (index.html and the links made by app.js)', () => {
  const links = [...html.matchAll(/<a\b[^>]*\bhref="http[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.ok(links.length >= 1);
  for (const link of links) {
    assert.match(link, /\btarget="_blank"/, link);
    assert.match(link, /\brel="noopener noreferrer"/, link);
  }
  const app = read('app.js');
  const anchors = [...app.matchAll(/E\('a',[^)]*\)/g)].map((m) => m[0]);
  assert.equal(anchors.length, 1, 'one place makes links');
  assert.match(anchors[0], /target: '_blank', rel: 'noopener noreferrer'/);
  assert.doesNotMatch(app, /window\.open\(|\.opener\b|createElement\(\s*['"]a['"]/);
  assert.doesNotMatch(read('messages.js'), /https?:\/\//, 'no address in the dictionary');
  const D = require('../atlas-data.js');
  for (const tool of Object.values(D.relatedTools)) assert.match(tool.url, /^https:\/\/ipusiron\.github\.io\/[a-z-]+\/$/);
  for (const s of Object.values(D.sources)) if (s.url) assert.match(s.url, /^https:\/\//);
});

test('F: the header has no decorative Day line, and the footer has the GitHub link only', () => {
  const header = html.slice(html.indexOf('<header class="page-header">'), html.indexOf('</header>'));
  assert.match(header, /<h1>Vision Trap <span>Atlas<\/span><\/h1>/);
  assert.doesNotMatch(header, /day\s*\d|eyebrow|<p\b|MIT/i);
  assert.equal((header.match(/<button\b/g) || []).length, 3);
  const footer = html.match(/<footer>([\s\S]*?)<\/footer>/)[1];
  assert.equal(footer, '<a href="https://github.com/ipusiron/vision-trap-atlas" data-i18n="footerGitHub" target="_blank" '
    + 'rel="noopener noreferrer">GitHub（ipusiron/vision-trap-atlas）</a>');
  const M = require('../messages.js');
  assert.equal(M.ja.footerGitHub, 'GitHub（ipusiron/vision-trap-atlas）');
  assert.equal(M.en.footerGitHub, 'GitHub (ipusiron/vision-trap-atlas)');
});

test('F: the help has two tabs, help and glossary; the help panel has the first steps, the controls as a list and the note on this atlas', () => {
  const dialog = html.match(/<dialog id="help-dialog" aria-labelledby="help-title">([\s\S]*?)<\/dialog>/)[1];
  assert.match(dialog, /<div class="help-tabs" role="tablist" aria-labelledby="help-title">/);
  const tab = new RegExp('<button id="help-tab-(\\w+)" class="help-tab" type="button" role="tab" aria-selected="(true|false)" '
    + 'aria-controls="help-panel-\\1"', 'g');
  const tabs = [...dialog.matchAll(tab)];
  assert.deepEqual(tabs.map((m) => [m[1], m[2]]), [['help', 'true'], ['glossary', 'false']]);
  const panels = [...dialog.matchAll(/<div id="help-panel-(\w+)" class="help-body" role="tabpanel" aria-labelledby="help-tab-\1" tabindex="0"( hidden)?>/g)];
  assert.deepEqual(panels.map((m) => [m[1], !!m[2]]), [['help', false], ['glossary', true]]);
  const help = dialog.match(/<div id="help-panel-help"[^>]*>([\s\S]*?)<\/div>/)[1];
  const order = [...help.matchAll(/<h3 id="[^"]+" tabindex="-1" data-i18n="(\w+)"|<p data-i18n="(\w+)"|<li data-i18n="([\w.]+)"/g)]
    .map((m) => m[1] || m[2] || m[3]);
  assert.deepEqual(order, ['helpFirst', 'helpFirstText', 'helpKeysHeading', 'helpKey.tabs', 'helpKey.slider', 'helpKey.experiment',
    'helpAboutHeading', 'helpAbout']);
  assert.match(html, /<button id="close-help" type="button" data-i18n="close">閉じる<\/button>/);
  // No lessons: the help and the glossary only
  assert.doesNotMatch(html, /座学/);
});

test('F: the contrast table has the three rows of the spec, with "?" beside the showing and hiding sides', () => {
  const table = html.match(/<table id="contrast-table"[\s\S]*?<\/table>/)[0];
  const cells = (head) => ['trait', 'show', 'hide'].map((c) => `${head}.${c}`);
  assert.deepEqual([...table.matchAll(/data-i18n="(contrast[\w.]+)"/g)].map((m) => m[1]),
    [...cells('contrastHead'), ...cells('contrastRow1'), ...cells('contrastRow2'), ...cells('contrastRow3')]);
  assert.deepEqual([...table.matchAll(/data-term-help="(\w+)"/g)].map((m) => m[1]), ['termShowSide', 'termHideSide']);
  assert.match(table, /aria-labelledby="contrast-line"/);
});

test('F: the experiment dialog: the title, Stop, the square, the result line and the two answers; no theme or language button inside', () => {
  const dialog = html.match(/<dialog id="exp-dialog" class="exp-dialog" aria-labelledby="exp-title">([\s\S]*?)<\/dialog>/)[1];
  assert.deepEqual([...dialog.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]),
    ['exp-title', 'exp-progress', 'exp-abort', 'exp-stage', 'exp-feedback', 'exp-absent', 'exp-present']);
  assert.doesNotMatch(dialog, /id="(?:theme|language|help)"/);
  assert.match(dialog, /<button id="exp-abort" class="exp-abort" type="button" data-i18n="expAbort">中断<\/button>/);
  const app = read('app.js');
  // The answers: pointerdown on the buttons and keydown, each with event.timeStamp; the display changes inside requestAnimationFrame
  assert.match(app, /button\.addEventListener\('pointerdown', \(event\) => \{[\s\S]{0,200}timeStamp: event\.timeStamp/);
  assert.match(app, /run\.exp\.respond\(\{ answer, timeStamp: event\.timeStamp, input: 'key', repeat: event\.repeat \}\)/);
  assert.match(app, /raf: \(callback\) => requestAnimationFrame\(callback\)/);
  assert.match(app, /addEventListener\('visibilitychange', \(\) => \{\s*if \(run\.exp\) run\.exp\.setHidden\(document\.hidden\);/);
  // The answer buttons and the square take a tap at once (no double-tap zoom)
  assert.match(css, /\.exp-answer \{[^}]*touch-action: manipulation/);
  assert.match(css, /\.exp-stage \{[^}]*touch-action: manipulation/);
});
