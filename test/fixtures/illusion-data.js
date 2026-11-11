'use strict';
// B: a small data set that adds one illusion group and one entry to the atlas data, to check that the data shape can take
// illusions later: a figure that moves only after "Play" (stopping within 5 seconds), fine stripes shown only after "Show",
// and a small figure on the "read" side (what happens when reading a chart). The texts it needs are given here as well.
const base = require('../../atlas-data.js');

const data = JSON.parse(JSON.stringify(base));
data.groups.push({ id: 'illusion', order: 60, labelKey: 'tabIllusion', termKey: 'tabIllusionTerm', termTip: null });
data.entries.push({
  id: 'illusion-sample', group: 'illusion', order: 10, titleTerms: [],
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
  ja: { tabIllusion: '錯視', tabIllusionTerm: '錯視', fixtureStripesNotice: '細かい縞を含む図です。', fixtureReadText: '読むときに起きること。',
    readLabel: '読むとき', motionPlay: '再生', motionStop: '止める', stripesShow: '表示する', 'ctl.illusion-sample.share': '割合' },
  en: { tabIllusion: 'Illusions', tabIllusionTerm: 'Illusions', fixtureStripesNotice: 'This figure has fine stripes.',
    fixtureReadText: 'What happens when reading.', readLabel: 'When reading', motionPlay: 'Play', motionStop: 'Stop', stripesShow: 'Show',
    'ctl.illusion-sample.share': 'Share' },
};

module.exports = { data, messages };
