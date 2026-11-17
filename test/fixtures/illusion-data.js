'use strict';
// B: a small data set that adds another group and one entry to the atlas data, to check that the data shape can take new groups
// later: a figure that stops within 5 seconds, fine stripes shown only after "Show", and a small figure on the "read" side (what
// happens when reading a chart). The texts it needs are given here as well. The group id is "future" so it does not collide with
// the real "illusion" group
const base = require('../../atlas-data.js');

const data = JSON.parse(JSON.stringify(base));
data.groups.push({ id: 'future', order: 70, labelKey: 'tabFuture', termKey: 'tabFutureTerm', termTip: null });
data.entries.push({
  id: 'future-sample', group: 'future', order: 10, titleTerms: [],
  figure: { part: 'barChart', seed: 6101, params: { mode: 'share' } },
  controls: [{ id: 'share', type: 'range', values: [0.2, 0.5, 0.8], default: 0.5 }],
  actions: [],
  read: null,
  uses: [{ side: 'read', part: 'lineChart', params: { mode: 'region' }, bind: {}, textKey: 'fixtureReadText' }],
  gapKey: null,
  safety: { motion: 'onPlay', maxSeconds: 5, stripes: true, flashes: false, colorOnly: false, noticeKey: 'fixtureStripesNotice' },
  sources: [], related: [],
});

const messages = {
  ja: { tabFuture: '別の群', tabFutureTerm: '別の群', fixtureStripesNotice: '細かい縞を含む図です。', fixtureReadText: '読むときに起きること。',
    readLabel: '読むとき', motionPlay: '再生', motionFrame: '次のコマ', motionStop: '止める', stripesShow: '表示する',
    'ctl.future-sample.share': '割合' },
  en: { tabFuture: 'Future', tabFutureTerm: 'Future', fixtureStripesNotice: 'This figure has fine stripes.',
    fixtureReadText: 'What happens when reading.', readLabel: 'When reading', motionPlay: 'Play', motionFrame: 'Next frame', motionStop: 'Stop',
    stripesShow: 'Show', 'ctl.future-sample.share': 'Share' },
};

module.exports = { data, messages };
