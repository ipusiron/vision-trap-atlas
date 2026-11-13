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

const IDS = ['popout-feature', 'popout-asymmetry', 'search-time', 'gestalt-proximity-similarity', 'gestalt-region-connection', 'gestalt-contour',
  'figure-ground-area', 'figure-ground-symmetry', 'misread-baseline', 'misread-area', 'misread-dual-axis', 'misread-aspect-range'];
const GROUPS = ['popout', 'search', 'gestalt', 'figure-ground', 'misread'];
const RELATED = ['day101', 'day085', 'day070', 'day075', 'day125'];
const SIDES = ['show', 'hide', 'readable', 'read'];
const ordered = (list) => list.slice().sort((a, b) => a.order - b.order);
const inBoth = (key) => typeof M.ja[key] === 'string' && typeof M.en[key] === 'string';
const clone = (v) => JSON.parse(JSON.stringify(v));

test('B: the twelve entry ids are fixed, ASCII and in order; the five groups are fixed', () => {
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
    }
  }
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
      if (u.noteKey) assert.ok(inBoth(u.noteKey), u.noteKey);
      if (u.side === 'hide') assert.equal(u.noteKey, 'hideNote', `${e.id}: the hiding side always carries hideNote`);
      if (u.link) assert.ok(Object.hasOwn(D.relatedTools, u.link));
      assert.ok(inBoth(`fig.${e.id}.${u.side}.title`), `fig.${e.id}.${u.side}.title`);
    }
    if (e.figure) assert.ok(inBoth(`fig.${e.id}.main.title`), e.id);
    for (const k of ['title', 'oneLine', 'howTo']) assert.ok(inBoth(`item.${e.id}.${k}`), `item.${e.id}.${k}`);
    for (const k of [e.gapKey, e.checkKey].filter(Boolean)) assert.ok(inBoth(k), k);
  }
  // The show side of 3-1 and 3-2 carries showNote; the four misreading entries have only the easier-to-read form
  for (const id of ['figure-ground-area', 'figure-ground-symmetry']) {
    assert.equal(D.entries.find((e) => e.id === id).uses.find((u) => u.side === 'show').noteKey, 'showNote');
  }
  for (const e of D.entries.filter((x) => x.group === 'misread')) assert.deepEqual(e.uses.map((u) => u.side), ['readable'], e.id);
  for (const e of D.entries.filter((x) => x.group !== 'misread' && x.id !== 'search-time')) {
    assert.deepEqual(e.uses.map((u) => u.side), ['show', 'hide'], e.id);
  }
  assert.deepEqual(D.entries.find((e) => e.id === 'search-time').uses.map((u) => u.side), ['show'], 'no hiding figure for search time');
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

test('B: the safety marks: no flashes, no motion in the first release, and a color-free switch where color alone is used', () => {
  for (const e of D.entries) {
    const s = e.safety;
    assert.equal(s.flashes, false, e.id);
    assert.equal(s.motion, 'none', e.id);
    assert.ok(s.maxSeconds <= 5, e.id);
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

test('B: the data shape takes an illusion group: six tabs, and the entry gets the notice, Play, Stop and Show', () => {
  const { data, messages } = fixture;
  assert.equal(C.validateData(data, { parts: V.partNames() }), true);
  const vm = V.buildViewModel(data);
  assert.equal(vm.tabs.length, 6);
  assert.equal(vm.tabs[5].id, 'illusion');
  assert.deepEqual(vm.tabs[4].next, { id: 'illusion', labelKey: 'tabIllusion' });
  const entry = vm.tabs[5].entries[0];
  assert.equal(entry.id, 'illusion-sample');
  assert.equal(entry.safety.noticeKey, 'fixtureStripesNotice');
  assert.deepEqual(entry.safety.actions.map((a) => a.id), ['play', 'stop', 'show']);
  assert.equal(entry.safety.maxSeconds, 5);
  assert.equal(entry.uses[0].side, 'read');
  for (const lang of ['ja', 'en']) {
    for (const key of [entry.safety.noticeKey, ...entry.safety.actions.map((a) => a.labelKey), entry.uses[0].labelKey, entry.uses[0].textKey]) {
      assert.equal(typeof messages[lang][key], 'string', `${lang} ${key}`);
    }
  }
  // The first release has no motion and no stripes, so the atlas itself shows none of these
  for (const tab of V.buildViewModel(D).tabs) for (const e of tab.entries) assert.deepEqual(e.safety.actions, [], e.id);
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
