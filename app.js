/* Vision Trap Atlas - MIT (c) 2026 ipusiron. */
// DOM と状態。状態は1つで、描画は状態から行う。図は AtlasView が返す形の一覧を createElementNS と setAttribute で SVG にする。
(function () {
  'use strict';
  const PREFIX = 'vision-trap-atlas.';
  const $ = (id) => document.getElementById(id);
  const stored = (key) => {
    try { return localStorage.getItem(PREFIX + key); } catch (_) { return null; }
  };
  const validLanguage = (value) => (['ja', 'en'].includes(value) ? value : null);
  const queryLanguage = validLanguage(new URLSearchParams(location.search).get('lang'));
  const Data = AtlasData;
  const View = AtlasView;
  const Search = AtlasSearch;
  const Messages = AtlasMessages;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const VM = View.buildViewModel(Data);
  const TABS = VM.tabs.map((tab) => tab.id);
  const ENTRIES = new Map(Data.entries.map((e) => [e.id, e]));
  const MODELS = new Map(VM.tabs.flatMap((tab) => tab.entries).map((m) => [m.id, m]));
  // The groups whose entry cards are drawn (the other tabs show their heading and the way to the next tab)
  const CARD_GROUPS = ['popout'];
  const drawnEntries = (tab) => (CARD_GROUPS.includes(tab.id) ? tab.entries : []);
  // The entries with "Find and tap"
  const FIND_ENTRIES = Data.entries.filter((e) => (e.actions || []).includes('find')).map((e) => e.id);
  // Terms inside the sentences of the cards and the panels: the first appearance of the word gets the dashed underline
  const TEXT_TERMS = {
    misreadLead: [{ term: 'termMasquerade', ja: '擬態', en: 'masquerade' }],
    popHide: [{ term: 'termBackground', ja: '背景合わせ', en: 'background matching' }],
    regionHide: [{ term: 'termDisruptive', ja: '分断色', en: 'disruptive coloration' }],
    contourHide: [{ term: 'termDisruptive', ja: '分断色', en: 'disruptive coloration' }],
  };

  const state = {
    language: queryLanguage || validLanguage(stored('language')) || (navigator.language.startsWith('ja') ? 'ja' : 'en'),
    theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    tab: TABS[0],
    // Per entry: the control values, the seed of its figure, and (1-2) the two times of "Find and tap" in seconds. Never stored
    items: Object.fromEntries(Data.entries.map((e) => [e.id, { values: View.controlValues(e), seed: e.figure ? e.figure.seed : null,
      times: { withLine: null, noLine: null } }])),
  };

  const dictionaries = { ja: View.dictionary(Messages, 'ja'), en: View.dictionary(Messages, 'en') };
  const t = (key, values = {}) => View.fill(dictionaries[state.language][key], values);

  function saveLanguage() {
    try {
      localStorage.setItem('vision-trap-atlas.language', state.language);
    } catch (_) { /* Preferences are optional. */ }
  }
  function saveTheme() {
    try {
      localStorage.setItem('vision-trap-atlas.theme', state.theme);
    } catch (_) { /* Preferences are optional. */ }
  }
  // The seed of a new arrangement ("Rearrange" and every "Find and tap"). Not a security use: the seed only fixes the order
  const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] || 1;

  // ===== Building elements (text only; no HTML strings) =====
  function E(tag, attributes = {}, ...children) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === null || value === undefined || value === false) continue;
      if (name === 'class') element.className = value;
      else element.setAttribute(name, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) element.append(child);
    return element;
  }
  function S(tag, attributes = {}, text) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value !== null && value !== undefined) element.setAttribute(name, String(value));
    }
    if (text !== undefined) element.textContent = text;
    return element;
  }
  // A shape of the list made by AtlasView: geometry in attributes, colors and lines in classes
  function shapeElement(shape) {
    const element = S(shape.type, shape.attrs);
    if (shape.cls) element.setAttribute('class', shape.cls);
    if (shape.type === 'text') element.textContent = shape.text;
    for (const child of shape.children || []) element.append(shapeElement(child));
    return element;
  }
  // Japanese words stay together where a box wraps (word-break: keep-all in style.css): a line breaks only at a <wbr>, put
  // after a particle before the next word, between katakana and kanji, before an opening bracket, after a closing bracket
  // and after ：・、。, but never before a mark that may not start a line (、。・：）」ー, small kana and the like). A short
  // quote (「探して押す」) stays whole, and so does の法則, so that ゲシュタルトの法則 breaks only as ゲシュタルト｜の法則.
  // Text without Japanese comes back as it is (English breaks at its spaces).
  const PARTICLES = 'のでをにがはとかもへやて';
  const NO_LINE_START = '、。，．・：；？！ー）」』】〕ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ';
  const JOINED = '＋＝／→×';
  const WHOLE = ['の法則'];
  const SHORT_QUOTE = /「[^「」]{1,10}」/g;
  const SPLITS = ['ゲシュタルト|の法則'];
  const scriptOf = (ch) => (/[゠-ヿ]/.test(ch) ? 'katakana' : /[㐀-䶿一-鿿]/.test(ch) ? 'kanji'
    : /[぀-ゟ]/.test(ch) ? 'hiragana' : 'other');
  function phrases(text) {
    if (!/[぀-ヿ㐀-䶿一-鿿]/.test(text)) return [text];
    const chars = [...text], out = [];
    // inside: the places between two characters of a whole label (i: between chars[i] and chars[i + 1])
    const inside = new Set();
    const wholes = [...WHOLE, ...(text.match(SHORT_QUOTE) || [])];
    for (const label of wholes) {
      const size = [...label].length;
      for (let at = text.indexOf(label); at >= 0; at = text.indexOf(label, at + label.length)) {
        const start = [...text.slice(0, at)].length;
        for (let i = start; i < start + size - 1; i++) inside.add(i);
      }
    }
    // split: the places inside a long word where a line may break
    const split = new Set();
    for (const word of SPLITS) {
      const whole = word.replace('|', ''), head = [...word.split('|')[0]].length;
      for (let at = text.indexOf(whole); at >= 0; at = text.indexOf(whole, at + whole.length)) {
        split.add([...text.slice(0, at)].length + head - 1);
      }
    }
    let piece = '';
    const flush = () => {
      const marked = ([...piece].slice(1).some((ch) => JOINED.includes(ch)) && !/\s/.test(piece))
        || wholes.some((label) => piece.includes(label));
      out.push(marked ? E('span', { class: 'joined' }, piece) : piece);
      piece = '';
    };
    chars.forEach((ch, i) => {
      piece += ch;
      const next = chars[i + 1];
      if (next === undefined || NO_LINE_START.includes(next) || JOINED.includes(next) || inside.has(i)) return;
      const pair = scriptOf(ch) + '>' + scriptOf(next);
      if ((PARTICLES.includes(ch) && scriptOf(next) !== 'hiragana') || pair === 'katakana>kanji' || pair === 'kanji>katakana'
        || ((next === '（' || next === '「') && ch !== ' ') || ch === '）' || '：・、。'.includes(ch) || split.has(i)) {
        flush();
        out.push(E('wbr'));
      }
    });
    if (piece) flush();
    return out;
  }
  const setWords = (element, text) => element.replaceChildren(...phrases(text));
  const newTabLink = (href, text, className = null) => E('a', { href, target: '_blank', rel: 'noopener noreferrer', class: className }, text);

  // ===== Terms: the word with a dashed underline is a button; its explanation shows right under it =====
  let tipCount = 0;
  function tipFor(termKey) {
    tipCount += 1;
    return E('span', { role: 'tooltip', id: 'tip-' + tipCount, class: 'term-tip', hidden: true }, phrases(t(termKey + 'Meaning')));
  }
  function termWidget(termKey, word, scope) {
    const tip = tipFor(termKey);
    const button = E('button', { type: 'button', class: 'term', 'data-term': termKey, 'data-key': 'term:' + scope + ':' + termKey,
      'aria-describedby': tip.id }, phrases(word));
    return wireTerm(E('span', { class: 'term-wrap' }, button, tip));
  }
  // "?" beside a word where an underline would be hard to read (a table heading)
  function termHelp(termKey, scope) {
    const tip = tipFor(termKey);
    const button = E('button', { type: 'button', class: 'term-help', 'data-term': termKey, 'data-key': 'help-term:' + scope + ':' + termKey,
      'aria-label': t('termHelpLabel', { term: t(termKey) }), 'aria-describedby': tip.id }, E('span', { 'aria-hidden': 'true' }, '?'));
    return wireTerm(E('span', { class: 'term-wrap' }, button, tip));
  }
  // A sentence with its terms: the first appearance of each word (not used before in the same scope) gets the underline
  function richText(text, terms = [], used = new Set(), scope = 'x') {
    const found = [];
    for (const term of terms) {
      if (used.has(term.term)) continue;
      const word = term[state.language];
      const at = word ? text.indexOf(word) : -1;
      if (at >= 0 && !found.some((f) => at < f.at + f.word.length && f.at < at + word.length)) found.push({ at, word, term: term.term });
    }
    found.sort((a, b) => a.at - b.at);
    const out = [];
    let last = 0;
    for (const f of found) {
      // The bracket before the word and the marks after it go with the word, so that a line never ends with （ nor starts with ）
      const pre = f.at > last && GLUE_BEFORE.includes(text[f.at - 1]) ? text[f.at - 1] : '';
      let end = f.at + f.word.length;
      while (end < text.length && GLUE_AFTER.includes(text[end])) end += 1;
      const before = text.slice(last, f.at - pre.length);
      // An explicit break before the glued word (WebKit does not break between a word kept whole and an opening bracket in a span)
      out.push(...phrases(before), before && !/\s$/.test(before) ? E('wbr') : null,
        glued(pre, termWidget(f.term, f.word, scope), text.slice(f.at + f.word.length, end)));
      used.add(f.term);
      last = end;
    }
    out.push(...phrases(text.slice(last)));
    return out.filter((part) => part !== '' && part !== null);
  }
  const GLUE_BEFORE = '（「(“"';
  const GLUE_AFTER = NO_LINE_START + ')”".,;:';
  const glued = (pre, widget, post) => E('span', { class: 'term-glue' }, pre || null, widget, post || null);

  // Showing and hiding the explanations (WCAG 1.4.13): the mouse shows one after about 300 ms and keeps it while the pointer is on
  // the word or the explanation; a touch shows or hides it; the keyboard focus shows it and Esc hides it (the focus stays on the
  // word, and the explanation stays hidden until the focus moves to another word). One at a time
  const HOVER_MS = 300;
  const tips = { open: null, showTimer: null, hideTimer: null, escaped: null, pointer: 'mouse' };
  function clearTipTimers() {
    clearTimeout(tips.showTimer);
    clearTimeout(tips.hideTimer);
    tips.showTimer = tips.hideTimer = null;
  }
  // Under the word; when it would leave the screen on the right, its right edge goes to the inner right edge of the panel; when it
  // would leave the screen at the bottom, it goes above the word
  function placeTip(wrap) {
    const tip = wrap.querySelector(':scope > .term-tip');
    wrap.classList.remove('tip-right', 'tip-above');
    const width = document.documentElement.clientWidth;
    let box = tip.getBoundingClientRect();
    if (box.right > width - 2 || box.left < 0) {
      wrap.classList.add('tip-right');
      box = tip.getBoundingClientRect();
    }
    if (box.bottom > innerHeight - 2 && box.top - box.height > 0) wrap.classList.add('tip-above');
  }
  function showTip(wrap) {
    clearTipTimers();
    if (tips.open === wrap) return;
    hideTip();
    wrap.querySelector(':scope > .term-tip').hidden = false;
    tips.open = wrap;
    placeTip(wrap);
  }
  function hideTip() {
    clearTipTimers();
    if (!tips.open) return;
    tips.open.querySelector(':scope > .term-tip').hidden = true;
    tips.open.classList.remove('tip-right', 'tip-above');
    tips.open = null;
  }
  function wireTerm(wrap) {
    const button = wrap.querySelector('button');
    wrap.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse') return;
      clearTimeout(tips.hideTimer);
      if (tips.open !== wrap) tips.showTimer = setTimeout(() => showTip(wrap), HOVER_MS);
    });
    wrap.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'mouse') return;
      clearTimeout(tips.showTimer);
      if (tips.open === wrap) tips.hideTimer = setTimeout(hideTip, HOVER_MS);
    });
    button.addEventListener('pointerdown', (event) => { tips.pointer = event.pointerType || 'mouse'; });
    button.addEventListener('click', (event) => {
      tips.escaped = null;
      // The keyboard (Enter, Space) and a touch show or hide it; a mouse click shows it
      if (event.detail !== 0 && tips.pointer === 'mouse') showTip(wrap);
      else if (tips.open === wrap) hideTip();
      else showTip(wrap);
    });
    button.addEventListener('focus', () => {
      if (button.matches(':focus-visible') && tips.escaped !== button) showTip(wrap);
    });
    // Leaving the word with the keyboard hides it (and the next focus on it shows it again); the mouse keeps it while the pointer is
    // on the word or the explanation
    button.addEventListener('blur', () => {
      if (tips.escaped === button) tips.escaped = null;
      if (tips.open === wrap && !wrap.matches(':hover')) hideTip();
    });
    return wrap;
  }
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !tips.open) return;
    const active = document.activeElement;
    if (active && tips.open.contains(active)) tips.escaped = active;
    hideTip();
    // Esc hides the explanation only (the help dialog stays open)
    event.preventDefault();
    event.stopPropagation();
  }, true);
  document.addEventListener('pointerdown', (event) => {
    if (tips.open && !tips.open.contains(event.target)) hideTip();
  }, true);

  // ===== Header, introduction, contrast table, tabs and panel headings =====
  function renderHeader() {
    setWords($('theme-label'), t(state.theme === 'dark' ? 'themeLight' : 'themeDark'));
    $('language').textContent = state.language === 'ja' ? 'EN' : 'JA';
  }
  function renderContrastTerms() {
    for (const slot of document.querySelectorAll('.term-slot[data-term-help]')) slot.replaceChildren(termHelp(slot.dataset.termHelp, 'contrast'));
  }
  function renderTabs() {
    for (const tab of VM.tabs) {
      const selected = tab.id === state.tab;
      const button = $('tab-' + tab.id);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      $('panel-' + tab.id).hidden = !selected;
    }
  }
  // The panel heading: "{tab} ({term})", the term with its explanation (not for 誤読's グラフ, which is not a specialist word)
  function panelHeading(tab) {
    const name = t(tab.labelKey), term = t(tab.termKey);
    const [space, open, close] = state.language === 'ja' ? ['', '（', '）'] : [' ', '(', ')'];
    const termPart = tab.termTip ? glued(open, termWidget(tab.termTip, term, 'panel-' + tab.id), close) : phrases(open + term + close);
    $('heading-' + tab.id).replaceChildren(...phrases(name), space || E('wbr'), ...[termPart].flat());
  }

  // ===== Entry cards =====
  const cards = new Map();
  const controlLabel = (entry, control) => t(`ctl.${entry.id}.${control.id}`);
  const optionLabel = (model, control, index) => t(model.controls.find((c) => c.id === control.id).optionKeys[index]);
  function stepText(entry, control, value) {
    const model = MODELS.get(entry.id), index = View.controlOptions(control).indexOf(value);
    if (control.type === 'choice' || control.named) return optionLabel(model, control, index);
    if (control.unit === 'percent') return Math.round(value * 100) + '%';
    return String(value);
  }
  // The order on the screen: the switches first, then the sliders (right above the figure), then the buttons of the entry
  const displayControls = (entry) => [...entry.controls.filter((c) => c.type !== 'range'), ...entry.controls.filter((c) => c.type === 'range')];

  function buildControl(entry, control, parts) {
    const id = entry.id, nameId = `ctl-${id}-${control.id}`;
    if (control.type === 'range') {
      const options = View.controlOptions(control);
      const input = E('input', { type: 'range', id: nameId + '-input', min: 0, max: options.length - 1, step: 1,
        'data-key': `ctl:${id}:${control.id}` });
      input.addEventListener('input', () => setControl(id, control.id, options[Number(input.value)]));
      const ticks = E('div', { class: 'ticks' }, options.map((v) => E('span', { 'data-value': String(v) }, phrases(stepText(entry, control, v)))));
      const note = control.disabledNoteKey ? E('p', { class: 'tick-note' }, phrases(t(control.disabledNoteKey))) : null;
      parts.ranges.set(control.id, { input, ticks, note });
      return E('div', { class: 'control range' },
        E('label', { class: 'control-name', for: input.id }, phrases(controlLabel(entry, control))),
        input, E('div', { class: 'stack tick-stack', 'aria-hidden': 'true' }, ticks, note));
    }
    const buttons = [];
    if (control.type === 'toggle') {
      const button = E('button', { type: 'button', 'data-key': `ctl:${id}:${control.id}` }, phrases(controlLabel(entry, control)));
      button.addEventListener('click', () => setControl(id, control.id, !state.items[id].values[control.id]));
      buttons.push([true, button]);
      parts.choices.set(control.id, buttons);
      return E('div', { class: 'control' }, E('div', { class: 'choice' }, button));
    }
    View.controlOptions(control).forEach((value) => {
      const button = E('button', { type: 'button', 'data-key': `ctl:${id}:${control.id}:${value}` }, phrases(stepText(entry, control, value)));
      button.addEventListener('click', () => setControl(id, control.id, value));
      buttons.push([value, button]);
    });
    parts.choices.set(control.id, buttons);
    return E('div', { class: 'control', role: 'group', 'aria-labelledby': nameId },
      E('span', { class: 'control-name', id: nameId }, phrases(controlLabel(entry, control))),
      E('div', { class: 'choice' }, buttons.map(([, b]) => b)));
  }

  // Every case of the reading sentences, each in the same cell (only the current one is shown): the height is that of the longest
  const SAMPLE_TIME = 88.8;
  function readSignatures(entry) {
    const extras = entry.read && entry.read.cases === 'asymmetry'
      ? [{}, { times: { withLine: SAMPLE_TIME } }, { times: { noLine: SAMPLE_TIME } }, { times: { withLine: SAMPLE_TIME, noLine: SAMPLE_TIME } }]
      : [{}];
    const all = new Map();
    const walk = (i, values) => {
      if (i === entry.controls.length) {
        for (const extra of extras) {
          const cases = View.readCases(Data, entry.id, values, extra);
          const sig = cases.map((c) => c.key).join('|'), text = View.texts(Messages, state.language, cases);
          if (!all.has(sig) || text.join('').length > all.get(sig).join('').length) all.set(sig, text);
        }
        return;
      }
      const c = entry.controls[i];
      for (const v of View.controlOptions(c)) walk(i + 1, { ...values, [c.id]: v });
    };
    walk(0, {});
    return all;
  }
  function stackOf(texts, live, className) {
    const sizers = texts.map((lines) => E('div', { class: 'off', 'aria-hidden': 'true' }, lines.map((line) => E('p', {}, phrases(line)))));
    return E('div', { class: 'stack ' + className }, ...sizers, live);
  }

  function svgFor(kind, idBase) {
    return S('svg', { role: 'img', 'aria-labelledby': idBase + '-title', 'aria-describedby': idBase + '-desc', class: kind });
  }
  function paintSvg(svg, result, title, desc, extra = []) {
    const idBase = svg.getAttribute('aria-labelledby').replace(/-title$/, '');
    svg.setAttribute('viewBox', `0 0 ${result.width} ${result.height}`);
    svg.replaceChildren(S('title', { id: idBase + '-title' }, title), S('desc', { id: idBase + '-desc' }, desc || title),
      ...result.shapes.map(shapeElement), ...extra.map(shapeElement));
  }

  function buildCard(model) {
    const entry = ENTRIES.get(model.id), id = entry.id, used = new Set();
    const square = entry.figure && ['popoutGrid', 'asymGrid'].includes(entry.figure.part);
    const parts = { choices: new Map(), ranges: new Map(), uses: [] };
    // Title (with its terms), what it is, how to use it
    const title = E('h3', { id: id + '-title', class: 'entry-title' }, richText(t(model.titleKey), model.titleTerms.map((tt) => ({ term: tt.term,
      ja: tt.ja, en: tt.en })), used, id));
    const controls = E('div', { class: 'controls' });
    for (const control of displayControls(entry)) {
      controls.append(buildControl(entry, control, parts));
      if (entry.safety.colorHintKey && entry.safety.colorOnlyWhen && control.id === Object.keys(entry.safety.colorOnlyWhen)[0]) {
        parts.colorHint = E('p', { class: 'control-note' }, phrases(t(entry.safety.colorHintKey)));
        controls.append(parts.colorHint);
      }
    }
    const actions = E('div', { class: 'actions' });
    if ((entry.actions || []).includes('reshuffle')) {
      const button = E('button', { type: 'button', 'data-key': `act:${id}:reshuffle` }, phrases(t('reshuffle')));
      button.addEventListener('click', () => reshuffle(id));
      actions.append(button);
    }
    if ((entry.actions || []).includes('find')) {
      const button = E('button', { type: 'button', class: 'find-button', 'data-key': `act:${id}:find` }, phrases(t('findPress')));
      button.addEventListener('click', (event) => finds[id].press(event));
      actions.append(button);
    }
    if (actions.children.length) controls.append(actions);

    // The figure, with the board of "Find and tap" over it
    const mainSvg = svgFor('main-figure', 'fig-' + id);
    const frame = E('div', { class: 'figure-frame' }, mainSvg);
    if (FIND_ENTRIES.includes(id)) {
      const cover = E('button', { type: 'button', class: 'find-cover', 'data-key': `cover:${id}`, hidden: true }, phrases(t('findCover')));
      cover.addEventListener('pointerdown', (event) => finds[id].pressCover(event));
      cover.addEventListener('click', (event) => { if (event.detail === 0) finds[id].press(event); });
      frame.append(cover);
      parts.cover = cover;
      mainSvg.addEventListener('pointerdown', (event) => pressFigure(id, mainSvg, event));
    }
    parts.frame = frame;
    parts.mainSvg = mainSvg;

    // How to read, then the line of "Find and tap"
    parts.readSigs = readSignatures(entry);
    parts.readLive = E('div', { class: 'read-live' });
    const read = E('div', { class: 'entry-read' }, stackOf([...parts.readSigs.values()], parts.readLive, 'read-stack'));
    if (FIND_ENTRIES.includes(id)) {
      const sample = (key, values) => [t(key, values)];
      const sizers = [sample('findTime', { t: SAMPLE_TIME.toFixed(1) }), sample('findWrong'), sample('findShown'), sample('findKeyboard')];
      parts.findLive = E('p', { class: 'find-live', 'aria-live': 'polite' });
      parts.reveal = E('button', { type: 'button', class: 'find-reveal', 'data-key': `reveal:${id}`, hidden: true }, phrases(t('findReveal')));
      parts.reveal.addEventListener('click', () => finds[id].showAnswer());
      const buttonSizer = E('div', { class: 'off', 'aria-hidden': 'true' }, E('button', { type: 'button', class: 'find-reveal', tabindex: '-1' },
        phrases(t('findReveal'))));
      const stack = stackOf(sizers, parts.findLive, 'find-line');
      stack.append(buttonSizer, parts.reveal);
      read.append(stack);
    }

    // Same controls, showing and hiding (or the easier-to-read form)
    const uses = E('section', { class: 'entry-uses', 'aria-labelledby': id + '-uses' },
      E('h4', { id: id + '-uses', class: 'uses-heading' }, phrases(t(model.usesHeadingKey))));
    const list = E('div', { class: 'uses-list' });
    model.uses.forEach((um, index) => {
      const use = entry.uses[index];
      const svg = svgFor('use-svg', `use-${id}-${um.side}`);
      const linkedTexts = new Map();
      const walk = (i, values) => {
        if (i === entry.controls.length) { const s = View.linkedText(Messages, state.language, entry, use, values); linkedTexts.set(s, s); return; }
        const c = entry.controls[i];
        for (const v of View.controlOptions(c)) walk(i + 1, { ...values, [c.id]: v });
      };
      walk(0, {});
      const linkedLive = E('p', {});
      const texts = E('div', { class: 'use-texts' },
        stackOf([...linkedTexts.values()].map((s) => [s]), linkedLive, 'use-linked'));
      if (um.textKey) texts.append(E('p', { class: 'use-text' }, richText(t(um.textKey), TEXT_TERMS[um.textKey], used, id)));
      if (um.noteKey) texts.append(E('p', { class: 'use-note' }, noteText(um)));
      list.append(E('figure', { class: 'use use-' + um.side },
        E('figcaption', { class: 'use-label' }, phrases(t(um.labelKey))), E('div', { class: 'use-figure' }, svg), texts));
      parts.uses.push({ use, model: um, svg, linkedLive });
    });
    uses.append(list);

    const stage = E('div', { class: 'entry-stage' }, E('div', { class: 'entry-main' }, frame), read, uses);
    const article = E('article', { id, class: 'entry' + (square ? ' square' : ''), 'aria-labelledby': title.id, tabindex: '-1' },
      title, E('p', { class: 'entry-oneline' }, phrases(t(model.oneLineKey))), E('p', { class: 'entry-howto' }, phrases(t(model.howToKey))),
      controls, stage);
    if (model.gapKey) {
      article.append(E('div', { class: 'gap-note' }, E('p', { class: 'gap-head' }, phrases(t('gapHeading'))), E('p', {}, phrases(t(model.gapKey)))));
    }
    article.append(sourcesBox(model));
    parts.article = article;
    cards.set(id, parts);
    return article;
  }
  // The note under a small figure: the name of a related tool in it becomes its link (a new tab)
  function noteText(um) {
    const text = t(um.noteKey), tool = um.link && Data.relatedTools[um.link];
    const at = tool ? text.indexOf(tool.name) : -1;
    if (at < 0) return phrases(text);
    return [...phrases(text.slice(0, at)), newTabLink(tool.url, tool.name, 'inline-link'), ...phrases(text.slice(at + tool.name.length))];
  }
  function sourcesBox(model) {
    const box = E('details', { class: 'entry-sources' }, E('summary', {}, E('h4', {}, phrases(t('sourcesHeading')))));
    box.append(E('p', { class: 'sources-label' }, phrases(t('sourcesLabel'))));
    box.append(E('ul', { class: 'source-list' }, model.sources.map((key) => {
      const s = Data.sources[key], href = s.doi ? 'https://doi.org/' + s.doi : s.url;
      return E('li', {}, s.cite, href ? [' ', newTabLink(href, href)] : null);
    })));
    if (model.related.length) {
      box.append(E('p', { class: 'sources-label' }, phrases(t('relatedLabel'))));
      box.append(E('ul', { class: 'source-list' }, model.related.map((key) => {
        const tool = Data.relatedTools[key];
        return E('li', {}, newTabLink(tool.url, tool.name), t('nameSep'), phrases(t(tool.textKey)));
      })));
    }
    return box;
  }

  // ===== Drawing a card from the state =====
  const ctx = () => ({ t: (key) => t(key), data: Data });
  function updateCard(id) {
    const parts = cards.get(id);
    if (!parts) return;
    const entry = ENTRIES.get(id), item = state.items[id], values = item.values;
    for (const control of entry.controls) {
      const enabled = View.controlEnabled(control, values);
      if (control.type === 'range') {
        const r = parts.ranges.get(control.id), options = View.controlOptions(control), index = options.indexOf(values[control.id]);
        if (Number(r.input.value) !== index) r.input.value = String(index);
        r.input.setAttribute('aria-valuetext', stepText(entry, control, values[control.id]));
        r.input.disabled = !enabled;
        for (const span of r.ticks.children) span.classList.toggle('now', span.dataset.value === String(values[control.id]));
        r.ticks.classList.toggle('off', !enabled && !!r.note);
        if (r.note) r.note.classList.toggle('off', enabled);
      } else {
        for (const [value, button] of parts.choices.get(control.id)) {
          button.setAttribute('aria-pressed', String(control.type === 'toggle' ? !!values[control.id] : value === values[control.id]));
          button.disabled = !enabled;
        }
      }
    }
    if (parts.colorHint) {
      const when = entry.safety.colorOnlyWhen;
      parts.colorHint.classList.toggle('off', !Object.entries(when).every(([k, list]) => list.includes(values[k])));
    }
    // The figure: the seed of "Find and tap" while it runs; nothing under the board; the marks after an answer
    const find = finds[id] ? finds[id].state() : null;
    const covered = !!find && find.phase === 'cover';
    const result = View.renderMain(entry, values, ctx(), item.seed);
    const marks = find && find.marks ? View.markShapes(find.marks) : [];
    paintSvg(parts.mainSvg, covered ? { ...result, shapes: [] } : result, t(`fig.${id}.main.title`), View.descText(Messages, state.language, entry,
      values, 'main'), marks);
    if (parts.cover) parts.cover.hidden = !covered;
    parts.frame.classList.toggle('finding', !!find && ['shown', 'timing'].includes(find.phase));
    // How to read
    const cases = View.readCases(Data, id, values, { times: item.times });
    parts.readLive.replaceChildren(...View.texts(Messages, state.language, cases).map((line) => E('p', {}, phrases(line))));
    if (find) {
      const text = find.result ? View.messageText(Messages, state.language, find.result) : '';
      if (parts.findLive.textContent !== text) setWords(parts.findLive, text);
      parts.reveal.hidden = !(find.phase === 'timing' && find.revealOffered);
    }
    // The small figures and the line under each
    for (const u of parts.uses) {
      paintSvg(u.svg, View.renderUse(u.use, values, ctx()), t(u.model.titleKey), View.descText(Messages, state.language, entry, values, u.model.side));
      const linked = View.linkedText(Messages, state.language, entry, u.use, values);
      if (u.linkedLive.textContent !== linked) setWords(u.linkedLive, linked);
    }
  }

  // ===== Operations of a card =====
  function setControl(id, controlId, value) {
    const item = state.items[id];
    if (item.values[controlId] === value) return;
    item.values = { ...item.values, [controlId]: value };
    if (finds[id]) finds[id].reset(); else updateCard(id);
  }
  function reshuffle(id) {
    state.items[id].seed = newSeed();
    if (finds[id]) finds[id].reset(); else updateCard(id);
  }
  // A press on the figure while "Find and tap" runs: the cell under the pointer (row × 6 + column)
  function pressFigure(id, svg, event) {
    const find = finds[id], s = find.state();
    if (!['shown', 'timing'].includes(s.phase)) return;
    const box = svg.getBoundingClientRect();
    const col = Math.floor((event.clientX - box.left) / box.width * 6), row = Math.floor((event.clientY - box.top) / box.height * 6);
    if (col < 0 || col > 5 || row < 0 || row > 5) return;
    find.pressCell(row * 6 + col, event);
    const after = find.state();
    // 1-2 keeps the time of each shape to find, to put them side by side
    if (id === 'popout-asymmetry' && after.result && after.result.key === 'findTime' && after.timeMs !== null) {
      const item = state.items[id];
      item.times = { ...item.times, [item.values.target]: after.timeMs / 1000 };
      updateCard(id);
    }
  }
  const finds = {};
  for (const id of FIND_ENTRIES) {
    finds[id] = Search.createFind({
      now: () => performance.now(),
      raf: (callback) => requestAnimationFrame(callback),
      seed32: newSeed,
      layout: (seed) => View.findLayout(id, { ...state.items[id].values, seed }),
      onChange: (s) => {
        // Every "Find and tap" arranges the shapes anew; the figure keeps that arrangement afterwards
        if (s.phase === 'cover' && s.seed !== null) state.items[id].seed = s.seed;
        updateCard(id);
      },
    });
  }

  // ===== Panels: the leads, "Entries in this tab", the cards and the way to the next tab =====
  function buildPanels() {
    cards.clear();
    for (const tab of VM.tabs) {
      panelHeading(tab);
      const body = $('body-' + tab.id), used = new Set(), children = [];
      for (const key of tab.leadKeys) children.push(E('p', { class: 'panel-lead' }, richText(t(key), TEXT_TERMS[key], used, 'panel-' + tab.id)));
      const entries = drawnEntries(tab);
      const nav = entries.length >= 2 ? E('nav', { class: 'section-nav', id: 'nav-' + tab.id, 'aria-labelledby': 'nav-label-' + tab.id, tabindex: '-1' },
        E('p', { class: 'section-nav-label', id: 'nav-label-' + tab.id }, phrases(t('tabNavHeading'))),
        E('p', { class: 'section-nav-hint' }, phrases(t('tabNavHint'))),
        E('div', { class: 'section-nav-buttons' }, entries.map((m) => {
          const button = E('button', { type: 'button', 'data-key': 'nav:' + m.id }, phrases(t(m.titleKey)));
          button.addEventListener('click', () => goToEntry(m.id));
          return button;
        }))) : null;
      if (nav) children.push(nav);
      for (const m of entries) {
        const article = buildCard(m);
        if (nav) {
          const back = E('button', { type: 'button', class: 'back-to-list', 'data-key': 'back:' + m.id },
            E('span', { 'aria-hidden': 'true' }, '▲'), phrases(t('backToList').replace(/^▲\s*/, '')));
          back.addEventListener('click', () => backToList(tab.id, m.id));
          article.append(back);
        }
        children.push(article);
      }
      if (tab.next) {
        const next = E('button', { type: 'button', class: 'next-tab', 'data-key': 'next:' + tab.id },
          phrases(t('nextTab', { tab: t(tab.next.labelKey) })));
        next.addEventListener('click', () => goToTab(tab.next.id));
        children.push(next);
      }
      body.replaceChildren(...children);
    }
    for (const id of cards.keys()) updateCard(id);
  }
  function goToEntry(id) {
    const card = cards.get(id);
    if (!card) return;
    card.article.scrollIntoView({ block: 'start' });
    card.article.focus({ preventScroll: true });
  }
  function backToList(tabId, id) {
    const nav = $('nav-' + tabId);
    nav.scrollIntoView({ block: 'start' });
    const button = nav.querySelector(`[data-key="nav:${id}"]`);
    (button || nav).focus({ preventScroll: true });
  }

  // ===== History: the address keeps the tab (#popout …). A tab button replaces the address; the button to the next tab adds
  // an entry with the place on the page, so that the browser's back button returns there =====
  function writeHistory(entry, mode) {
    try {
      if (mode === 'push') history.pushState(entry, '', '#' + entry.tab);
      else if (mode === 'hash') history.replaceState(entry, '', '#' + entry.tab);
      else history.replaceState(entry, '');
    } catch (_) { /* A browser may refuse to write the history of a local file; the page works without it. */ }
  }
  const tabsBar = () => $('tabs');
  // A tab button does not move the page; only when the tab bar is above the screen, it comes to the top of the screen
  function selectTab(name) {
    hideTip();
    state.tab = name;
    renderTabs();
    writeHistory({ tab: name }, 'hash');
    if (tabsBar().getBoundingClientRect().top < 0) tabsBar().scrollIntoView({ block: 'start' });
  }
  function goToTab(name) {
    hideTip();
    writeHistory({ tab: state.tab, y: Math.round(scrollY) }, 'replace');
    state.tab = name;
    renderTabs();
    writeHistory({ tab: name }, 'push');
    tabsBar().scrollIntoView({ block: 'start' });
    $('tab-' + name).focus({ preventScroll: true });
  }
  addEventListener('popstate', (event) => {
    const entry = event.state && TABS.includes(event.state.tab) ? event.state : null;
    if (!entry) return;
    hideTip();
    state.tab = entry.tab;
    renderTabs();
    if (typeof entry.y === 'number') scrollTo(0, entry.y);
    else if (tabsBar().getBoundingClientRect().top < 0) tabsBar().scrollIntoView({ block: 'start' });
  });

  // Elements redrawn on a language change carry data-key; focus returns to the element with the same key when it is visible
  function restoreFocus(key) {
    if (!key || document.activeElement?.dataset?.key === key) return;
    const target = [...document.querySelectorAll('[data-key]')].find((el) => el.dataset.key === key);
    if (target && target.getClientRects().length) target.focus({ preventScroll: true });
  }
  // Everything that depends on the language: the texts of index.html, the headings, the explanations and the cards. The values,
  // the seeds and the results of "Find and tap" stay as they are
  function render() {
    const focusKey = document.activeElement?.dataset?.key || null;
    hideTip();
    document.documentElement.lang = state.language;
    document.documentElement.dataset.theme = state.theme;
    document.querySelectorAll('[data-i18n]').forEach((el) => { setWords(el, t(el.dataset.i18n)); });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    renderHeader();
    renderContrastTerms();
    renderTabs();
    buildPanels();
    restoreFocus(focusKey);
  }

  // ===== Tabs, header buttons and the help =====
  TABS.forEach((name, index) => {
    $('tab-' + name).addEventListener('click', () => selectTab(name));
    $('tab-' + name).addEventListener('keydown', (event) => {
      const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!move && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + move + TABS.length) % TABS.length;
      selectTab(TABS[next]);
      $('tab-' + state.tab).focus();
    });
  });
  $('theme').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    saveTheme();
    document.documentElement.dataset.theme = state.theme;
    renderHeader();
  });
  $('language').addEventListener('click', () => {
    state.language = state.language === 'ja' ? 'en' : 'ja';
    saveLanguage();
    render();
  });
  // The help opens where it was left; only after the language changed does it open at the top
  let helpLanguage = null;
  $('help').addEventListener('click', () => {
    hideTip();
    $('help-dialog').showModal();
    if (helpLanguage !== state.language) $('help-dialog').querySelector('.help-body').scrollTop = 0;
    helpLanguage = state.language;
  });
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  // Both ends of a pointer gesture must be on the backdrop; a drag from the help text keeps it open.
  let helpBackdropDown = false;
  function isHelpBackdrop(event) {
    if (event.target !== $('help-dialog')) return false;
    const box = $('help-dialog').getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  }
  $('help-dialog').addEventListener('pointerdown', (event) => { helpBackdropDown = isHelpBackdrop(event); });
  $('help-dialog').addEventListener('pointercancel', () => { helpBackdropDown = false; });
  $('help-dialog').addEventListener('click', (event) => {
    const close = helpBackdropDown && isHelpBackdrop(event);
    helpBackdropDown = false;
    if (close) $('help-dialog').close();
  });
  $('help-dialog').addEventListener('close', () => {
    helpBackdropDown = false;
    $('help').focus({ preventScroll: true });
  });
  function visibleFocusTarget(element) {
    if (element.matches(':disabled') || !element.getClientRects().length) return false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS' && !parent.open && !parent.querySelector(':scope > summary')?.contains(element)) return false;
    }
    return true;
  }
  $('help-dialog').addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...$('help-dialog').querySelectorAll('button, a[href], input, select, summary, [tabindex="0"]')]
      .filter(visibleFocusTarget);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  // Crossing 720px changes the layout of the cards only. When the focus was on an element that is no longer shown, it moves to
  // the panel of the tab. The browser may take the focus away before or after the media query reports the change, so an
  // element that lost the focus while it was no longer shown is remembered.
  let vanished = null;
  document.addEventListener('focusout', (event) => {
    vanished = !event.relatedTarget && !event.target.getClientRects().length ? event.target : null;
  });
  matchMedia('(max-width: 719px)').addEventListener('change', () => {
    hideTip();
    const active = document.activeElement;
    const hidden = active && active !== document.body ? active : vanished;
    const lost = hidden && !hidden.getClientRects().length;
    vanished = null;
    if (lost) $('panel-' + state.tab).focus();
  });

  // ===== Startup: draw, release the two guarded groups and remove the startup notice. An address that ends in a group or an
  // entry id (#misread, #popout-feature) opens that tab once, and moves to the entry; an unknown id is ignored =====
  const hash = decodeURIComponent(location.hash.slice(1));
  const hashEntry = ENTRIES.get(hash);
  if (TABS.includes(hash)) state.tab = hash;
  else if (hashEntry) state.tab = hashEntry.group;
  writeHistory({ tab: state.tab }, 'replace');
  render();
  $('startup-tools').disabled = false;
  $('startup-controls').disabled = false;
  $('startup-note').remove();
  document.documentElement.dataset.appReady = 'true';
  if (hashEntry && cards.has(hash)) cards.get(hash).article.scrollIntoView({ block: 'start' });
  else if (TABS.includes(hash) || hashEntry) tabsBar().scrollIntoView({ block: 'start' });
}());
