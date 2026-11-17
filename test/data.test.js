'use strict';
// B: the data in atlas-data.js (the fixed ids, the shape of each entry, the links to the messages and parts, the safety marks,
// the fictional data written in the spec) and the data shape that can take illusions later (test/fixtures/illusion-data.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../atlas-core.js');
const D = require('../atlas-data.js');
const V = require('../atlas-view.js');
const M = require('../messages.js');
const fixture = require('./fixtures/illusion-data.js');

const IDS = ['popout-feature', 'popout-asymmetry', 'popout-motion', 'search-time', 'search-camo', 'gestalt-proximity-similarity',
  'gestalt-region-connection', 'gestalt-contour', 'figure-ground-area', 'figure-ground-symmetry', 'misread-baseline', 'misread-area', 'misread-dual-axis',
  'misread-aspect-range', 'illusion-lightness-contrast'];
const GROUPS = ['popout', 'search', 'gestalt', 'figure-ground', 'misread', 'illusion'];
const RELATED = ['day101', 'day085', 'day070', 'day075', 'day125'];
const SIDES = ['show', 'hide', 'readable', 'read'];
const ordered = (list) => list.slice().sort((a, b) => a.order - b.order);
const inBoth = (key) => typeof M.ja[key] === 'string' && typeof M.en[key] === 'string';
const clone = (v) => JSON.parse(JSON.stringify(v));

test('B: the fifteen entry ids are fixed, ASCII and in order; the six groups are fixed', () => {
  const ids = GROUPS.flatMap((g) => ordered(D.entries.filter((e) => e.group === g)).map((e) => e.id));
  assert.deepEqual(ids, IDS);
  assert.deepEqual(D.entries.map((e) => e.id), IDS);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z]+(?:-[a-z]+)*$/);
  assert.deepEqual(ordered(D.groups).map((g) => g.id), GROUPS);
  for (const e of D.entries) assert.ok(GROUPS.includes(e.group), e.id);
});

test('B: controls have a known type, a default among their values, and messages for the name and each step', () => {
  for (const e of D.entries) {
    const seen = new Set();
    for (const c of e.controls) {
      assert.ok(!seen.has(c.id), `${e.id}.${c.id} repeated`);
      seen.add(c.id);
      assert.ok(['choice', 'range', 'toggle'].includes(c.type), `${e.id}.${c.id}`);
      assert.ok(inBoth(`ctl.${e.id}.${c.id}`), `name of ${e.id}.${c.id}`);
      if (c.type === 'toggle') assert.equal(typeof c.default, 'boolean');
      else {
        const values = c.type === 'range' ? c.values : c.options;
        assert.ok(Array.isArray(values) && values.length >= 2, `${e.id}.${c.id}`);
        assert.ok(values.includes(c.default), `default of ${e.id}.${c.id}`);
        if (c.steps) assert.equal(c.steps.length, values.length);
        if (c.type === 'choice' || c.named) {
          values.forEach((v, i) => assert.ok(inBoth(`ctl.${e.id}.${c.id}.${c.steps ? c.steps[i] : String(v)}`), `step ${e.id}.${c.id}.${v}`));
        }
      }
      // offValue: the value a control shows while it cannot be pressed (one of its values; only on a control that can be off)
      if (c.offValue !== undefined) {
        assert.ok(c.enabledWhen || c.disabledWhen, `${e.id}.${c.id} offValue needs a condition`);
        assert.ok(V.controlOptions(c).includes(c.offValue), `${e.id}.${c.id} offValue among its values`);
      }
      // A switch can be off as well (3-2: swapping needs a cue)
      for (const cond of [c.enabledWhen, c.disabledWhen].filter(Boolean)) {
        for (const [k, list] of Object.entries(cond)) {
          const other = e.controls.find((x) => x.id === k);
          assert.ok(other, `${e.id}.${c.id} refers to ${k}`);
          for (const v of list) assert.ok(V.controlOptions(other).includes(v), `${e.id}.${c.id} refers to ${k}=${v}`);
        }
      }
      if (c.disabledNoteKey) assert.ok(inBoth(c.disabledNoteKey));
      // Every control that can be off says why (the shape pairs of "Kind and size of the difference" as well: only for the shape)
      if (c.enabledWhen || c.disabledWhen) assert.ok(c.disabledNoteKey, `${e.id}.${c.id} says why it cannot be pressed`);
    }
  }
  assert.equal(D.entries[0].controls.find((c) => c.id === 'shape').disabledNoteKey, 'shapeOnly');
  assert.equal(M.ja.shapeOnly, '「形」を選んだときだけ押せます');
});

test('B: the boxes at the end of a tab: a heading and a sentence, and lines that each name an existing entry with its short name', () => {
  const ids = new Set();
  for (const g of D.groups) {
    for (const box of g.endBoxes || []) {
      assert.ok(!ids.has(box.id) && /^[a-z][a-z0-9-]*$/.test(box.id), box.id);
      ids.add(box.id);
      assert.ok(inBoth(box.headingKey) && (!box.leadKey || inBoth(box.leadKey)), box.id);
      assert.ok(box.items.length >= 1, box.id);
      for (const item of box.items) {
        assert.ok(inBoth(item.textKey), `${box.id} ${item.textKey}`);
        assert.ok(D.entries.some((e) => e.id === item.entry), `${box.id} ${item.entry}`);
        assert.ok(inBoth(`item.${item.entry}.short`), `${box.id} short name of ${item.entry}`);
      }
    }
  }
  // The checks when reading a chart: after the misreading entries, one line for each of the four, in their order
  const misread = D.groups.find((g) => g.id === 'misread');
  assert.deepEqual(misread.endBoxes.map((b) => b.id), ['chart-checks']);
  assert.deepEqual(misread.endBoxes[0].items.map((i) => i.entry),
    D.entries.filter((e) => e.group === 'misread').sort((a, b) => a.order - b.order).map((e) => e.id));
  assert.ok(inBoth('toEntry') && M.ja.toEntry.includes('{name}') && M.en.toEntry.includes('{name}'));
});

test('B: uses have a known side, registered parts, binds to existing controls, and existing texts', () => {
  const parts = new Set(V.partNames());
  for (const e of D.entries) {
    assert.ok(e.uses.length <= 2, e.id);
    if (e.figure) assert.ok(parts.has(e.figure.part), e.id);
    for (const u of e.uses) {
      assert.ok(SIDES.includes(u.side), `${e.id} ${u.side}`);
      assert.ok(parts.has(u.part), `${e.id} ${u.part}`);
      for (const w of u.with || []) assert.ok(parts.has(w.part), `${e.id} ${w.part}`);
      for (const [cid, spec] of Object.entries(u.bind || {})) {
        const c = e.controls.find((x) => x.id === cid);
        assert.ok(c, `${e.id} binds unknown control ${cid}`);
        if (typeof spec === 'object') for (const v of V.controlOptions(c)) assert.ok(Object.hasOwn(spec.map, String(v)), `${e.id} ${cid}=${v}`);
      }
      for (const k of Object.keys(u.bindWhen || {})) assert.ok(e.controls.some((x) => x.id === k), `${e.id} bindWhen ${k}`);
      if (u.textKey) assert.ok(inBoth(u.textKey), u.textKey);
      // The cases of the sentence under the small figure: existing controls and values, and texts in both languages
      for (const c of u.textKeyWhen || []) {
        assert.ok(inBoth(c.key) && u.textKey, `${e.id} ${c.key}`);
        for (const [k, list] of Object.entries(c.when)) {
          const control = e.controls.find((x) => x.id === k);
          assert.ok(control && list.every((v) => V.controlOptions(control).includes(v)), `${e.id} textKeyWhen ${k}`);
        }
      }
      if (u.linkedNoneKey) assert.ok(inBoth(u.linkedNoneKey) && u.bindWhen, `${e.id} ${u.linkedNoneKey}`);
      if (u.noteKey) assert.ok(inBoth(u.noteKey), u.noteKey);
      if (u.side === 'hide') assert.equal(u.noteKey, 'hideNote', `${e.id}: the hiding side always carries hideNote`);
      if (u.link) assert.ok(Object.hasOwn(D.relatedTools, u.link));
      assert.ok(inBoth(`fig.${e.id}.${u.side}.title`), `fig.${e.id}.${u.side}.title`);
    }
    if (e.figure) assert.ok(inBoth(`fig.${e.id}.main.title`), e.id);
    for (const k of ['title', 'oneLine', 'howTo']) assert.ok(inBoth(`item.${e.id}.${k}`), `item.${e.id}.${k}`);
    for (const k of [e.gapKey, e.gapHeadingKey, e.checkKey].filter(Boolean)) assert.ok(inBoth(k), k);
  }
  // The show side of 3-1 and 3-2 carries showNote; the four misreading entries have only the easier-to-read form
  for (const id of ['figure-ground-area', 'figure-ground-symmetry']) {
    assert.equal(D.entries.find((e) => e.id === id).uses.find((u) => u.side === 'show').noteKey, 'showNote');
  }
  for (const e of D.entries.filter((x) => x.group === 'misread')) assert.deepEqual(e.uses.map((u) => u.side), ['readable'], e.id);
  for (const e of D.entries.filter((x) => x.group !== 'misread' && x.group !== 'search')) {
    assert.deepEqual(e.uses.map((u) => u.side), ['show', 'hide'], e.id);
  }
  assert.deepEqual(D.entries.find((e) => e.id === 'search-time').uses.map((u) => u.side), ['show'], 'no hiding figure for search time');
  // The camouflage experiment is the other way round: the hiding figure only
  assert.deepEqual(D.entries.find((e) => e.id === 'search-camo').uses.map((u) => u.side), ['hide'], 'no showing figure for the camouflage test');
});

test('B: the camouflage experiment: the second entry of the search tab, an experiment with the two controls of its small figure', () => {
  const e = D.entries.find((x) => x.id === 'search-camo');
  assert.deepEqual([e.group, e.order, e.experiment, e.figure], ['search', 20, true, null]);
  assert.deepEqual(e.titleTerms.map((t) => t.term), ['termBackground', 'termDisruptive'], 'the existing terms, no new ones');
  assert.deepEqual(e.controls.map((c) => [c.id, c.type, c.options, c.default]),
    [['pattern', 'choice', ['match', 'disrupt', 'symmetric'], 'match'], ['mark', 'choice', ['off', 'on'], 'off']]);
  assert.deepEqual(C.CAMO_PATTERNS, ['match', 'disrupt', 'symmetric'], 'the patterns of the control are those of the experiment');
  assert.deepEqual(e.actions, ['startCamo']);
  assert.deepEqual(e.read, { cases: 'camo' });
  const [use] = e.uses;
  assert.equal(use.part, 'camoSearchScene');
  assert.equal(use.bind.pattern, 'pattern');
  assert.deepEqual(use.bind.mark, { to: 'mark', map: { off: false, on: true } });
  assert.equal(use.link, 'day085');
  assert.deepEqual([e.gapKey, e.gapHeadingKey], ['camoGap', 'camoGapHeading']);
  assert.equal(e.safety.motion, 'none');
  assert.equal(e.safety.colorOnly, false);
  assert.deepEqual(e.sources, ['fraser2007', 'webster2013', 'cuthill2006', 'merilaita2017', 'stevensMerilaita2009']);
  assert.deepEqual(e.related, ['day085']);
  // The two sources of the screen experiments, with their DOIs
  assert.equal(D.sources.fraser2007.doi, '10.1098/rspb.2007.0153');
  assert.equal(D.sources.webster2013.doi, '10.1098/rsbl.2013.0501');
  for (const k of ['fraser2007', 'webster2013']) assert.equal(D.sources[k].level, 'A', k);
});

test('B: groups, sources and related tools exist; every source has the level A, B or C', () => {
  for (const g of D.groups) {
    for (const k of [g.labelKey, g.termKey, ...(g.leadKeys || [])]) assert.ok(inBoth(k), k);
    if (g.termTip) assert.ok(inBoth(g.termTip) && inBoth(g.termTip + 'Meaning'), g.termTip);
  }
  assert.equal(D.groups.find((g) => g.id === 'misread').termTip, null, '"Charts" is not a term');
  for (const e of D.entries) {
    assert.ok(e.sources.length > 0, e.id);
    for (const s of e.sources) assert.ok(Object.hasOwn(D.sources, s), `${e.id} ${s}`);
    for (const r of e.related) assert.ok(RELATED.includes(r), `${e.id} ${r}`);
  }
  for (const [id, s] of Object.entries(D.sources)) {
    assert.ok(['A', 'B', 'C'].includes(s.level), id);
    assert.ok(s.cite && s.cite.length > 20, id);
    assert.ok(s.doi === null || /^10\.\d{4,5}\//.test(s.doi), id);
  }
  assert.deepEqual(Object.keys(D.relatedTools), RELATED);
  for (const t of Object.values(D.relatedTools)) {
    assert.match(t.url, /^https:\/\/ipusiron\.github\.io\/[a-z-]+\/$/);
    assert.ok(inBoth(t.textKey), t.textKey);
  }
});

test('B: every related tool is named by at least one entry (its link is shown under "Sources and related tools")', () => {
  const named = new Set(D.entries.flatMap((e) => e.related));
  assert.deepEqual(RELATED.filter((r) => !named.has(r)), []);
  // Day125 Overlay QR Shares: the stacked white is 50% gray and halves the contrast, which the lightness contrast entry is about
  assert.deepEqual(D.entries.filter((e) => e.related.includes('day125')).map((e) => e.id), ['illusion-lightness-contrast']);
  assert.equal(D.relatedTools.day125.name, 'Overlay QR Shares');
  assert.match(M.ja.relDay125, /50%の灰/);
  assert.match(M.en.relDay125, /50% gray/);
});

test('B: safety marks: no flashes; only popout-motion moves (only after Play, 3 seconds or less); color-free switch where color alone is used', () => {
  for (const e of D.entries) {
    const s = e.safety;
    assert.equal(s.flashes, false, e.id);
    if (e.id === 'popout-motion') {
      assert.equal(s.motion, 'onPlay', e.id);
      assert.ok(s.maxSeconds > 0 && s.maxSeconds <= 5, e.id);
    } else {
      assert.equal(s.motion, 'none', e.id);
      assert.equal(s.maxSeconds, 0, e.id);
    }
    assert.equal(s.stripes, false, e.id);
  }
  const colorOnly = D.entries.filter((e) => e.safety.colorOnly).map((e) => e.id);
  assert.deepEqual(colorOnly, ['popout-feature', 'search-time']);
  const pf = D.entries.find((e) => e.id === 'popout-feature');
  const kind = pf.controls.find((c) => c.id === 'kind');
  for (const v of pf.safety.colorAlt.values) assert.ok(kind.options.includes(v));
  assert.deepEqual(pf.safety.colorAlt.values, ['direction', 'size']);
  assert.ok(inBoth(pf.safety.colorHintKey));
  const st = D.entries.find((e) => e.id === 'search-time');
  assert.equal(st.safety.colorAlt.experimentSet, 'fill');
  assert.equal(st.safety.colorHintKey, 'setHint');
});

test('B: validateData accepts the data and rejects the seven kinds of invalid data', () => {
  const parts = V.partNames();
  assert.equal(C.validateData(D, { parts }), true);
  const bad = [
    ['duplicate id', (d) => { d.entries[1].id = d.entries[0].id; }],
    ['unknown group', (d) => { d.entries[0].group = 'nowhere'; }],
    ['unknown part', (d) => { d.entries[0].uses[0].part = 'pieChart3d'; }],
    ['unknown source', (d) => { d.entries[0].sources.push('nobody2026'); }],
    ['unknown control in bind', (d) => { d.entries[0].uses[0].bind.speed = 'popDiff'; }],
    ['flashes', (d) => { d.entries[0].safety.flashes = true; }],
    ['maxSeconds 6', (d) => { d.entries[0].safety.motion = 'onPlay'; d.entries[0].safety.maxSeconds = 6; }],
  ];
  for (const [name, change] of bad) {
    const d = clone(D);
    change(d);
    assert.throws(() => C.validateData(d, { parts }), /invalid data/, name);
  }
});

test('B: the data shape takes another group: seven tabs, and the entry gets the notice, Play, Next frame, Stop and Show', () => {
  const { data, messages } = fixture;
  assert.equal(C.validateData(data, { parts: V.partNames() }), true);
  const vm = V.buildViewModel(data);
  assert.equal(vm.tabs.length, 7);
  assert.equal(vm.tabs[6].id, 'future');
  assert.deepEqual(vm.tabs[5].next, { id: 'future', labelKey: 'tabFuture' });
  const entry = vm.tabs[6].entries[0];
  assert.equal(entry.id, 'future-sample');
  assert.equal(entry.safety.noticeKey, 'fixtureStripesNotice');
  assert.deepEqual(entry.safety.actions.map((a) => a.id), ['play', 'frame', 'stop', 'show']);
  assert.equal(entry.safety.maxSeconds, 5);
  assert.equal(entry.uses[0].side, 'read');
  for (const lang of ['ja', 'en']) {
    for (const key of [entry.safety.noticeKey, ...entry.safety.actions.map((a) => a.labelKey), entry.uses[0].labelKey, entry.uses[0].textKey]) {
      assert.equal(typeof messages[lang][key], 'string', `${lang} ${key}`);
    }
  }
  // In the atlas itself, only popout-motion has moving actions, no entry shows stripes
  for (const tab of V.buildViewModel(D).tabs) for (const e of tab.entries) {
    if (e.id === 'popout-motion') assert.deepEqual(e.safety.actions.map((a) => a.id), ['play', 'frame', 'stop'], e.id);
    else assert.deepEqual(e.safety.actions, [], e.id);
  }
  // A figure that moves needs a stop time of 5 seconds or less, and stripes need a notice
  const moving = clone(data);
  moving.entries.at(-1).safety.maxSeconds = 0;
  assert.throws(() => C.validateData(moving, { parts: V.partNames() }), /invalid data/);
  const silent = clone(data);
  delete silent.entries.at(-1).safety.noticeKey;
  assert.throws(() => C.validateData(silent, { parts: V.partNames() }), /invalid data/);
});

test('B: the fictional data and research values are the ones written in the spec', () => {
  assert.deepEqual(D.datasets.libraryLoans3, [52, 55, 58]);
  assert.deepEqual(D.datasets.townTemp, [4, 5, 9, 14, 19, 22, 26, 27, 23, 17, 11, 6]);
  assert.deepEqual(D.datasets.townRain, [50, 60, 110, 130, 140, 170, 160, 120, 210, 190, 90, 50]);
  assert.deepEqual(D.datasets.libraryLoans24, [40, 42, 41, 44, 46, 45, 48, 50, 49, 52, 54, 53, 56, 58, 57, 60, 62, 61, 60, 58, 57, 55, 54, 52]);
  const m = D.datasets.monthly12;
  assert.deepEqual(m.series6, [
    [30, 33, 39, 44, 50, 55, 60, 64, 70, 75, 80, 85], [56, 55, 58, 57, 60, 62, 76, 80, 74, 66, 68, 71],
    [15, 19, 22, 27, 31, 35, 40, 43, 47, 51, 54, 57], [66, 64, 63, 60, 58, 56, 53, 50, 48, 46, 45, 43],
    [44, 46, 45, 42, 40, 38, 37, 35, 33, 32, 30, 29], [88, 82, 77, 70, 64, 57, 50, 44, 36, 29, 22, 15]]);
  assert.equal(m.target, 1);
  assert.deepEqual(m.band, [6, 8]);
  assert.deepEqual(m.cross.p, [20, 26, 31, 37, 44, 50, 56, 63, 68, 74, 79, 85]);
  assert.deepEqual(m.cross.q, [82, 77, 71, 64, 57, 50, 43, 37, 30, 24, 19, 15]);
  assert.equal(m.cross.p[m.cross.meet], m.cross.q[m.cross.meet]);
  assert.deepEqual(m.cross.missing, [8, 9]);
  // The band is the three largest months of the series to find
  const s1 = m.series6[1];
  assert.deepEqual(s1.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map((x) => x[1]).sort(), [6, 7, 8]);
  for (const series of [...m.series6, m.cross.p, m.cross.q, D.datasets.popBars, D.datasets.shareBars, ...D.datasets.groupBars]) {
    for (const v of series) assert.ok(Number.isInteger(v) && v >= 0 && v <= 100);
  }
  assert.deepEqual(D.references.treisman1980, { featurePresent: 3.1, featureAbsent: 25.1, conjPresent: 28.7, conjAbsent: 67.1 });
  assert.deepEqual(D.references.wolfe1998, { featurePresent: 3, featureAbsent: 6, conjPresent: 10, conjAbsent: 27, approx: true });
});

test('B: control values that the spec fixes (steps of each control)', () => {
  const ctl = (id, c) => D.entries.find((e) => e.id === id).controls.find((x) => x.id === c);
  assert.deepEqual(ctl('popout-feature', 'kind').options, ['color', 'direction', 'size', 'shape', 'lightness']);
  assert.deepEqual(ctl('popout-feature', 'diff').values, ['same', 'small', 'medium', 'large']);
  assert.deepEqual(ctl('popout-feature', 'variety').values, ['uniform', 'some', 'mixed']);
  assert.deepEqual(ctl('popout-feature', 'count').options, [6, 12, 18]);
  assert.deepEqual(ctl('popout-asymmetry', 'count').options, [6, 12, 18]);
  assert.deepEqual(ctl('gestalt-proximity-similarity', 'prox').values, [-2, -1, 0, 1, 2]);
  assert.deepEqual(ctl('gestalt-contour', 'gap').values, [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
  assert.deepEqual(ctl('figure-ground-area', 'share').values, [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
  assert.deepEqual(ctl('figure-ground-symmetry', 'regions').options, [2, 8]);
  assert.deepEqual(ctl('misread-baseline', 'bottom').values, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
  assert.deepEqual(ctl('misread-area', 'ratio').values, [1, 1.5, 2, 2.5, 3, 3.5, 4]);
  assert.deepEqual(ctl('misread-dual-axis', 'rightTop').values, [200, 300, 400, 600]);
  assert.deepEqual(ctl('misread-aspect-range', 'aspect').values, [0.5, 1, 2, 4]);
  assert.deepEqual(ctl('misread-aspect-range', 'range').options, ['all', 'last6']);
});

test('B: the palette has the same names in both themes, and every value is a 6-digit color', () => {
  const { light, dark } = D.palette;
  assert.deepEqual(Object.keys(light), Object.keys(dark));
  for (const theme of [light, dark]) {
    for (const [k, v] of Object.entries(theme)) {
      for (const c of [].concat(v)) assert.match(c, /^#[0-9a-f]{6}$/, k);
    }
  }
  for (const k of Object.keys(light)) assert.equal([].concat(light[k]).length, [].concat(dark[k]).length, k);
  assert.equal(light.paper, '#fffdf7');
  assert.equal(dark.paper, '#172940');
});

// ===== Clue box of the figure-and-ground tab (across-tab navigation) =====
test('B: the camouflage clues box at the end of figure-and-ground points to figure-ground-symmetry and popout-motion', () => {
  const fg = D.groups.find((g) => g.id === 'figure-ground');
  assert.deepEqual(fg.endBoxes.map((b) => b.id), ['camo-clues']);
  const box = fg.endBoxes[0];
  assert.equal(box.headingKey, 'camoCluesHeading');
  assert.equal(box.leadKey, 'camoCluesLead');
  assert.deepEqual(box.items.map((i) => i.entry), ['figure-ground-symmetry', 'popout-motion']);
  // Each entry id must be a real entry, and each has a short name in both languages
  for (const item of box.items) {
    assert.ok(D.entries.some((e) => e.id === item.entry), item.entry);
    assert.ok(typeof M.ja[`item.${item.entry}.short`] === 'string', `ja short ${item.entry}`);
    assert.ok(typeof M.en[`item.${item.entry}.short`] === 'string', `en short ${item.entry}`);
    assert.ok(typeof M.ja[item.textKey] === 'string' && typeof M.en[item.textKey] === 'string', item.textKey);
  }
});

// ===== Illusion group and its lightness-contrast entry =====
test('B: the illusion group and the lightness-contrast entry have the expected shape', () => {
  const illusion = D.groups.find((g) => g.id === 'illusion');
  assert.equal(illusion.order, 60);
  assert.equal(illusion.termTip, 'termIllusion', 'illusion itself is a specialist word, and gets a tooltip');
  assert.ok(typeof M.ja.termIllusionMeaning === 'string' && typeof M.en.termIllusionMeaning === 'string');
  const lc = D.entries.find((e) => e.id === 'illusion-lightness-contrast');
  assert.equal(lc.group, 'illusion');
  assert.deepEqual(lc.controls.map((c) => c.id), ['diff', 'compare']);
  assert.deepEqual(lc.uses.map((u) => u.side), ['show', 'hide']);
  assert.equal(lc.uses[0].part, 'heatmap');
  assert.equal(lc.uses[1].part, 'camoScene');
  // The related tools: Day101 (color illusions), Day085 (camouflage) and Day125 (stacked white read as 50% gray), in this order
  assert.deepEqual(lc.related, ['day101', 'day085', 'day125']);
});

// ===== Why it happens, the predictions and the questions at the end of each tab =====
test('B: every entry has why it happens and a prediction: two or three choices, one of them right, and the texts in both languages', () => {
  for (const e of D.entries) {
    assert.ok(inBoth(`item.${e.id}.why`), `${e.id} why`);
    const p = e.predict;
    assert.ok(p && Array.isArray(p.choices) && p.choices.length >= 2 && p.choices.length <= 3, `${e.id} choices`);
    assert.equal(new Set(p.choices).size, p.choices.length, `${e.id} distinct choices`);
    assert.equal(p.choices.filter((c) => c === p.answer).length, 1, `${e.id} one right choice`);
    for (const k of ['question', 'explain', ...p.choices.map((c) => `choice.${c}`)]) assert.ok(inBoth(`predict.${e.id}.${k}`), `${e.id} ${k}`);
    for (const lang of ['ja', 'en']) {
      assert.equal(new Set(p.choices.map((c) => M[lang][`predict.${e.id}.choice.${c}`])).size, p.choices.length, `${lang} ${e.id} choices differ`);
    }
  }
  assert.equal(D.entries.filter((e) => e.predict).length, 15);
});

test('B: every tab ends with two questions: figures of known parts, two or three choices with one right answer, and the texts in both languages',
  () => {
    const parts = new Set([...V.partNames(), V.RESULT_CHART]), ids = new Set();
    for (const g of D.groups) {
      assert.equal((g.checks || []).length, 2, g.id);
      for (const q of g.checks) {
        assert.ok(!ids.has(q.id) && /^[a-z]+(?:-[a-z]+)*$/.test(q.id), q.id);
        ids.add(q.id);
        for (const f of q.figures) assert.ok(parts.has(f.part), `${q.id} ${f.part}`);
        // Two figures are named A and B (the names stand above them); one figure has no name
        assert.deepEqual(q.figures.map((f) => f.label || null), q.figures.length === 2 ? ['A', 'B'] : [null], q.id);
        assert.ok(q.choices.length >= 2 && q.choices.length <= 3 && new Set(q.choices).size === q.choices.length, q.id);
        assert.equal(q.choices.filter((c) => c === q.answer).length, 1, `${q.id} one right choice`);
        for (const k of ['title', 'desc', 'question', 'explain']) assert.ok(inBoth(`check.${q.id}.${k}`), `${q.id} ${k}`);
        // A choice named after a figure (A, B) shows that name; every other choice has its text in both languages
        for (const c of q.choices) {
          if (q.figures.some((f) => f.label === c)) assert.equal(M.ja[`check.${q.id}.choice.${c}`], undefined, `${q.id} ${c}`);
          else assert.ok(inBoth(`check.${q.id}.choice.${c}`), `${q.id} ${c}`);
        }
        if (q.noteKey) assert.ok(inBoth(q.noteKey), q.noteKey);
      }
    }
    assert.equal(ids.size, 12);
    // The view model: each tab with its two questions, each entry with its prediction and why. The line after a choice: the experiments say
    // to run the test, the moving entry to switch and press Play (Next frame with reduced motion), the others to make the change in the question
    const vm = V.buildViewModel(D);
    assert.deepEqual(vm.tabs.map((t) => t.checks.length), [2, 2, 2, 2, 2, 2]);
    for (const tab of vm.tabs) {
      for (const e of tab.entries) {
        assert.equal(e.whyKey, `item.${e.id}.why`);
        const moving = e.safety.actions.some((a) => a.id === 'play');
        assert.equal(e.predict.chosenKey, e.experiment ? 'predictChosenTest' : moving ? 'predictChosenPlay' : 'predictChosen', e.id);
        assert.equal(e.predict.chosenReducedKey, moving ? 'predictChosenFrame' : null, e.id);
        for (const key of [e.predict.chosenKey, e.predict.chosenReducedKey].filter(Boolean)) assert.ok(inBoth(key), key);
      }
    }
    assert.deepEqual(vm.tabs.flatMap((t) => t.entries).filter((e) => e.predict.chosenReducedKey).map((e) => e.id), ['popout-motion']);
    assert.deepEqual(vm.tabs[2].checks[0].choices.map((c) => [c.id, c.label, c.key]),
      [['A', 'A', null], ['B', 'B', null], ['same', null, 'check.gestalt-store-bars.choice.same']]);
    // A group without questions (the shape of another group) has none
    assert.deepEqual(V.buildViewModel(fixture.data).tabs.at(-1).checks, []);
  });

test('B: the sources of why it happens and of the answers are listed under their entries; the questions cite studies listed in the atlas', () => {
  const sourcesOf = (id) => D.entries.find((e) => e.id === id).sources;
  const expected = {
    'popout-feature': ['wolfeHorowitz2004', 'wolfeHorowitz2017'], 'popout-asymmetry': ['treismanSouther1985', 'healeyEnns2012'],
    'popout-motion': ['wolfeHorowitz2004', 'wolfeHorowitz2017', 'hall2013'], 'search-time': ['treismanGelade1980', 'wolfe2021', 'wolfeHorowitz2017'],
    'search-camo': ['fraser2007', 'webster2013', 'cuthill2006', 'merilaita2017', 'stevensMerilaita2009'],
    'gestalt-proximity-similarity': ['wagemans2012'], 'gestalt-region-connection': ['wagemans2012'],
    'gestalt-contour': ['merilaita2017', 'wagemans2012', 'stevensMerilaita2009', 'stevensCuthill2006'],
    'figure-ground-area': ['wagemans2012', 'fowlkes2007'], 'figure-ground-symmetry': ['fowlkes2007', 'cuthill2006', 'wagemans2012'],
    'misread-baseline': ['correll2020'], 'misread-area': ['heerBostock2010', 'clevelandMcGill1984'], 'misread-dual-axis': ['datawrapperDualAxis', 'lo2022'],
    'misread-aspect-range': ['heerAgrawala2006', 'lo2022'], 'illusion-lightness-contrast': ['mittelstadt2014', 'adelson2000'],
  };
  for (const [id, keys] of Object.entries(expected)) for (const k of keys) assert.ok(sourcesOf(id).includes(k), `${id} ${k}`);
  // The two sources added for why it happens (level A or B, with their DOIs)
  assert.deepEqual([D.sources.stevensCuthill2006.doi, D.sources.stevensCuthill2006.level], ['10.1098/rspb.2006.3556', 'A']);
  assert.deepEqual([D.sources.fowlkes2007.doi, D.sources.fowlkes2007.level], ['10.1167/7.8.2', 'B']);
  // A study named in parentheses: in the answer of a prediction, among the sources of its entry; in a question, among the sources of the atlas
  const cited = { 'Treisman & Gelade 1980': 'treismanGelade1980', 'Fraser et al. 2007': 'fraser2007', 'Cuthill, Hiby & Lloyd 2006': 'cuthill2006' };
  const named = (text) => [...text.matchAll(/（([^（）]*\d{4})）/g)].map((m) => m[1]);
  for (const e of D.entries) {
    for (const study of named(M.ja[`predict.${e.id}.explain`])) assert.ok(e.sources.includes(cited[study]), `${e.id}: ${study}`);
  }
  const listed = new Set(D.entries.flatMap((e) => e.sources));
  let count = 0;
  for (const [key, text] of Object.entries(M.ja).filter(([k]) => k.startsWith('check.'))) {
    for (const study of named(text)) { assert.ok(listed.has(cited[study]), `${key}: ${study}`); count += 1; }
  }
  assert.equal(count, 2, 'the questions name two studies');
});
