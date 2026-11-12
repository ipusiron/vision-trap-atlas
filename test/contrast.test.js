'use strict';
// F: the colors of style.css: the page colors of both themes, the figure colors (the same values as AtlasData.palette), text at
// 4.5:1 or more, and the stimuli, the lines of the figures and the parts of the small figures at 3:1 or more, in both themes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../atlas-data.js');
const V = require('../atlas-view.js');
const C = require('../atlas-core.js');
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const variables = (body) => Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]));
const lightBlock = css.match(/(?:^|\n):root\s*\{([^}]+)\}/)[1];
const darkBlock = css.match(/@media screen \{\s*:root\[data-theme="dark"\]\s*\{([^}]+)\}/)[1];
const light = variables(lightBlock);
const dark = { ...light, ...variables(darkBlock) };
const ratio = (a, b) => C.contrastRatio(a, b);
const round2 = (n) => Math.round(n * 100) / 100;

// The page colors (the same values as Day127, without the colors of its map) and their ratios against the paper and the ground
const SPEC = {
  light: {
    bg: '#f6f4ed', paper: '#fffdf7', line: '#aabccb', shadow: '#d9d6cc', 'on-accent': '#fffdf7',
    ink: ['#152b45', 14.11, 13.04], muted: ['#44576b', 7.32, 6.76], accent: ['#1d6b5a', 6.25, 5.78], focus: ['#1d6b5a', 6.25, 5.78],
  },
  dark: {
    bg: '#0d1b2d', paper: '#172940', line: '#668098', shadow: '#091523', 'on-accent': '#172940',
    ink: ['#eaf1f6', 12.90, 15.19], muted: ['#c5d4df', 9.71, 11.44], accent: ['#7fd4bd', 8.44, 9.95], focus: ['#7fd4bd', 8.44, 9.95],
  },
};
const TEXT = ['ink', 'muted', 'accent', 'focus'];
const PAGE_NAMES = ['bg', 'paper', 'ink', 'muted', 'line', 'accent', 'focus', 'shadow', 'on-accent'];
// The palette as CSS variables: --c-<name> or --c-<name>-<index> (paper and ink are the page's --paper and --ink)
function paletteVariables(theme) {
  const out = {};
  for (const [name, value] of Object.entries(D.palette[theme])) {
    if (name === 'paper' || name === 'ink') continue;
    if (Array.isArray(value)) value.forEach((v, i) => { out[`c-${name}-${i}`] = v.toLowerCase(); });
    else out[`c-${name}`] = value.toLowerCase();
  }
  return out;
}

test('F: the page colors of both themes are the values of the spec, and the figure colors are those of AtlasData.palette', () => {
  // One block per theme; no variable is set anywhere else (a later block would override the values read here)
  assert.equal((css.match(/(?:^|\n):root\s*\{/g) || []).length, 1);
  assert.equal((css.match(/:root\[data-theme="dark"\]\s*\{/g) || []).length, 1);
  const outside = css.replace(/(?:^|\n):root\s*\{[^}]+\}/, '').replace(/:root\[data-theme="dark"\]\s*\{[^}]+\}/, '');
  assert.doesNotMatch(outside, /--[\w-]+\s*:/, 'variables are set in the two theme blocks only');
  for (const [theme, colors, block] of [['light', light, lightBlock], ['dark', dark, darkBlock]]) {
    const own = variables(block);
    const expected = [...PAGE_NAMES, ...Object.keys(paletteVariables(theme))].sort();
    assert.deepEqual(Object.keys(own).sort(), expected, theme);
    const spec = SPEC[theme];
    for (const name of ['bg', 'paper', 'line', 'shadow', 'on-accent']) assert.equal(colors[name], spec[name], theme + ' ' + name);
    for (const name of TEXT) assert.equal(colors[name], spec[name][0], theme + ' ' + name);
    assert.equal(colors.paper, D.palette[theme].paper.toLowerCase(), theme + ' paper is the palette paper');
    assert.equal(colors.ink, D.palette[theme].ink.toLowerCase(), theme + ' ink is the palette ink');
    for (const [name, value] of Object.entries(paletteVariables(theme))) assert.equal(colors[name], value, theme + ' ' + name);
  }
});

test('F: every color class used by the figures has its rule, with the variable of the same name', () => {
  for (const name of Object.keys(paletteVariables('light'))) {
    const base = name.slice(2);
    assert.ok(css.includes(`.fill-${base} { fill: var(--${name}); }`), 'fill-' + base);
    assert.ok(css.includes(`.stroke-${base} { stroke: var(--${name}); }`), 'stroke-' + base);
  }
  // The classes that the figures use are among them (every figure of every entry in its default and every value of 1-1)
  const used = new Set();
  const walk = (shapes) => {
    for (const s of shapes) {
      for (const c of (s.cls || '').split(' ')) if (/^(fill|stroke)-/.test(c)) used.add(c);
      walk(s.children || []);
    }
  };
  const ctx = { t: (k) => k, data: D };
  const draw = (e, v) => {
    if (e.figure) walk(V.renderMain(e, v, ctx).shapes);
    for (const u of e.uses) walk(V.renderUse(u, v, ctx).shapes);
  };
  for (const e of D.entries) {
    const values = V.controlValues(e);
    if (e.id !== 'popout-feature') { draw(e, values); continue; }
    for (const kind of ['color', 'direction', 'size', 'shape', 'lightness']) for (const diff of V.DIFF) for (const variety of V.VARIETY) {
      draw(e, { ...values, kind, diff, variety });
    }
  }
  assert.ok(used.size > 20);
  for (const cls of used) assert.match(css, new RegExp('\\.' + cls + ' \\{'), cls);
});

test('F: text keeps at least 4.5:1 against the paper and the ground in both themes (the explanations of terms too)', (t) => {
  for (const [theme, colors] of [['light', light], ['dark', dark]]) {
    const spec = SPEC[theme];
    for (const name of TEXT) {
      const onPaper = ratio(colors[name], colors.paper), onGround = ratio(colors[name], colors.bg);
      t.diagnostic(`${theme} ${name}: paper ${onPaper.toFixed(2)}:1, ground ${onGround.toFixed(2)}:1`);
      assert.deepEqual([round2(onPaper), round2(onGround)], spec[name].slice(1), theme + ' ' + name);
      assert.ok(onPaper >= 4.5 && onGround >= 4.5, theme + ' ' + name);
    }
    assert.ok(ratio(colors['on-accent'], colors.accent) >= 4.5, theme + ' text on a pressed button');
    // The explanation of a term: the text color on the ground (one step darker than the panel)
    assert.match(css, /\.term-tip \{[^}]*background: var\(--bg\);[^}]*color: var\(--ink\);/);
  }
});

test('F: the stimuli, the lines and the parts of the small figures keep at least 3:1 against the paper in both themes', (t) => {
  for (const theme of ['light', 'dark']) {
    const p = D.palette[theme], paper = p.paper;
    const parts = [['stimCool', p.stimCool], ['stimHot', p.stimHot], ['seriesTarget', p.seriesTarget],
      ...['popColor', 'popOthers', 'popLight', 'popLightOthers', 'seriesOthers', 'groups'].flatMap((n) => p[n].map((v, i) => [`${n}-${i}`, v])),
      ['muted', theme === 'light' ? light.muted : dark.muted], ['ink', p.ink], ['focus', theme === 'light' ? light.focus : dark.focus]];
    for (const [name, color] of parts) {
      const r = ratio(color, paper);
      t.diagnostic(`${theme} ${name} ${color}: ${r.toFixed(2)}:1`);
      assert.ok(r >= 3, `${theme} ${name}: ${r}`);
    }
    // The two regions of figure and ground are told apart from each other
    assert.ok(ratio(p.regionA, p.regionB) >= 3, theme + ' regionA / regionB');
    // 3-1 calls its wedges dark and light: the dark one is darker in both themes, and the two keep 3:1 as parts of a figure
    assert.ok(C.relativeLuminance(p.areaDark) < C.relativeLuminance(p.areaLight), theme + ' areaDark is the darker');
    t.diagnostic(`${theme} areaDark / areaLight: ${ratio(p.areaDark, p.areaLight).toFixed(2)}:1`);
    assert.ok(ratio(p.areaDark, p.areaLight) >= 3, theme + ' areaDark / areaLight');
    // The dark wedge stands apart from the background of the figure as well (2:1 or more), so that it does not look like a hole
    t.diagnostic(`${theme} areaDark / paper: ${ratio(p.areaDark, paper).toFixed(2)}:1`);
    assert.ok(ratio(p.areaDark, paper) >= 2, theme + ' areaDark / paper');
    // The focus mark against the ground as well
    assert.ok(ratio(theme === 'light' ? light.focus : dark.focus, theme === 'light' ? light.bg : dark.bg) >= 3, theme + ' focus on the ground');
  }
});

test('F: no external fonts or images in the style', () => {
  assert.doesNotMatch(css, /@import|@font-face|url\(/);
});
