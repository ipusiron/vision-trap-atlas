"""Browser gates for Vision Trap Atlas (Playwright for Python; not part of CI).

Run with a Python that already has Playwright and its Chromium, Firefox and WebKit:
    python -X utf8 -B test/interface.browser.py
    python -X utf8 -B test/interface.browser.py --output <folder>
    python -X utf8 -B test/interface.browser.py --browser chromium
(--stage picks how much of the page is checked; the last one, the default, checks everything.)
Every case runs at 320x568, 390x844, 720x900 and 1280x800, in Japanese and English, light and dark, in the three
browsers: no console error, no CSP violation, no sideways page scroll, and the checks of the screen (the header, the
introduction and the contrast table, the tabs and their names, the help, the explanations of the terms, the two cards of
the Pop out tab with every value of their controls, and "Find and tap" with the clock held by Playwright). From --stage 3,
the Search time tab and its experiment with the clock held and paused: the answers are put in at chosen times, and the table
and the sentences of the results must be those that AtlasCore computes from the test's own record of the tries. From
--stage 4, the three cards of the Grouping tab and the two of the Figure and ground tab, with every value of their controls:
the figure and the small figures change, the sentence under the figure, the line under each small figure and the description of
each figure follow the settings (the test computes them from the data and the dictionary), and nothing moves. From --stage 5,
the four cards of the Misreading tab in the same way, with the line of numbers under the figure and the line of what to check
(the test computes the ratios, the crossings and the slopes from the definitions of the spec), the moving entry (its figures stand
still until Next frame, which marks where each moving shape was), the lightness contrast and the camouflage card the same way,
"Why", "Predict before you try" and the two questions at the end of each tab (what they say, the keyboard, nothing stored, the
sizes of the figures and of the sentences kept, the choices kept when the cards are drawn again), and the camouflage card of the
Search time tab with its test: the clock held and the seed of each run known, so that the rounds, the table, the chart and the
sentences of the results are those that AtlasCore computes from the test's own record of the tries. From --stage 6, the
shared summary (the six OGP tags and the meta description) has the values of the README front matter and stays as written
when the language is switched and after a reload, and on the English page no attribute that carries words (aria-label,
title, alt and the like) nor the document title holds Japanese. Then the
addresses with a group or an entry id, the button to the next tab and the browser's back button, the links to other
sites, the saved preferences, and the page served over HTTP.
Results and viewport screenshots are written to --output (default: a new folder in the system temporary directory).
Nothing is written inside the repository.
Screenshots keep the caret (caret="initial"): to hide it, Playwright adds a style element to the page, which the
CSP of the page refuses in WebKit (a violation that the page itself never causes).
"""
import argparse
import json
import math
import re
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PREFIX = "vision-trap-atlas."
STAGES = ("2", "3", "4", "5", "6")
SIZES = ((320, 568), (390, 844), (720, 900), (1280, 800))
BROWSERS = ("chromium", "firefox", "webkit")
GROUPS = ("popout", "search", "gestalt", "figure-ground", "misread", "illusion")
# The cards with "Find and tap" (square figures), and the cards with controls drawn at each stage (the search card is apart)
FIND_CARDS = ("popout-feature", "popout-asymmetry")
GROUPING_CARDS = ("gestalt-proximity-similarity", "gestalt-region-connection", "gestalt-contour", "figure-ground-area", "figure-ground-symmetry")
MISREAD_CARDS = ("misread-baseline", "misread-area", "misread-dual-axis", "misread-aspect-range")
# The cards of the other tabs checked the same way: the moving entry (its figures stand still until Play or Next frame), the camouflage
# card (a small figure, no main figure) and the lightness contrast
OTHER_CARDS = ("popout-motion", "search-camo", "illusion-lightness-contrast")
MOVING_CARDS = ("popout-motion",)
SQUARE_PARTS = ("popoutGrid", "asymGrid", "motionGrid")
# The cards whose figures, sentences and descriptions the test computes from the data and the dictionary
CHECKED_CARDS = GROUPING_CARDS + MISREAD_CARDS + OTHER_CARDS
STAGE_CARDS = {"2": FIND_CARDS, "3": FIND_CARDS, "4": FIND_CARDS + GROUPING_CARDS, "5": FIND_CARDS + CHECKED_CARDS,
               "6": FIND_CARDS + CHECKED_CARDS}
STAGE_GROUPS = {"2": ("popout",), "3": ("popout", "search"), "4": ("popout", "search", "gestalt", "figure-ground"),
                "5": ("popout", "search", "gestalt", "figure-ground", "misread", "illusion"),
                "6": ("popout", "search", "gestalt", "figure-ground", "misread", "illusion")}
RUN = {"stage": STAGES[-1]}


def cards():
    return STAGE_CARDS[RUN["stage"]]
CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; "
    "img-src 'self' data:; base-uri 'none'; form-action 'none'; "
    "frame-src 'none'; object-src 'none'; connect-src 'none'"
)
JAPANESE = re.compile("[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿！-｠]")
FOOTER_HREF = "https://github.com/ipusiron/vision-trap-atlas"
# The shared summary (OGP) and the meta description, as the README front matter gives the description: the page keeps them as written
# in Japanese whatever the language shown (sites that make a summary do not run the scripts)
DESCRIPTION_JA = re.search(r'^description_ja: "(.*)"$', (Path(__file__).resolve().parents[1] / "README.md").read_text(encoding="utf-8"),
                           re.M).group(1)
OGP = (("property", "og:title", "Vision Trap Atlas"), ("property", "og:description", DESCRIPTION_JA),
       ("property", "og:url", "https://ipusiron.github.io/vision-trap-atlas/"),
       ("property", "og:image", "https://ipusiron.github.io/vision-trap-atlas/assets/screenshot.png"),
       ("property", "og:type", "website"), ("name", "twitter:card", "summary_large_image"), ("name", "description", DESCRIPTION_JA))
OGP_STATE = """() => Array.from(document.head.querySelectorAll('meta[property], meta[name]'),
  m => [m.hasAttribute('property') ? 'property' : 'name', m.getAttribute('property') || m.getAttribute('name'), m.getAttribute('content')])"""
# The attributes that carry words (read aloud or shown), and the document title: none may hold Japanese on the English page
ATTRIBUTE_WORDS = """() => { const out = [['TITLE', 'document.title', document.title]];
  for (const el of document.body.querySelectorAll('*')) {
    for (const name of ['aria-label', 'title', 'alt', 'placeholder', 'aria-valuetext', 'aria-description', 'aria-roledescription', 'data-label']) {
      const value = el.getAttribute(name); if (value) out.push([el.tagName, name, value]); } }
  return out; }"""


def assert_ogp(page, name):
    """The six OGP tags and the meta description, each once in <head>, with the values of the README front matter."""
    tags = page.evaluate(OGP_STATE)
    for attribute, key, value in OGP:
        found = [t for t in tags if t[0] == attribute and t[1] == key]
        check(len(found) == 1 and found[0][2] == value, (name, "OGP", key, found))
    check(len([t for t in tags if re.match(r"^(?:og|twitter):", t[1] or "")]) == 6, (name, "no other og: or twitter: tag"))


def load_module(name):
    """The value of a UMD file of the repository (read with Node, the same file the page loads)."""
    code = "process.stdout.write(JSON.stringify(require(process.argv[1])))"
    out = subprocess.run(["node", "-e", code, str(ROOT / name)], capture_output=True, check=True, encoding="utf-8").stdout
    return json.loads(out)


M = load_module("messages.js")
DATA = load_module("atlas-data.js")
ENTRY = {e["id"]: e for e in DATA["entries"]}


def fill(template, **values):
    return re.sub(r"\{([a-zA-Z0-9_]+)\}", lambda m: str(values.get(m.group(1), m.group(0))), template)


def js_str(value):
    """String(value) in JavaScript (the step names and the data-key of the buttons use it)."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def control_options(control):
    return control["values"] if control["type"] == "range" else control["options"] if control["type"] == "choice" else [False, True]


def step_name(card, control, value, language):
    """The name of a value, as under the sliders and on the buttons."""
    L = M[language]
    if control["type"] == "toggle":
        return L["toggleOn" if value else "toggleOff"]
    if control["type"] == "choice" or control.get("named"):
        index = control_options(control).index(value)
        return L[f"ctl.{card}.{control['id']}." + (control["steps"][index] if control.get("steps") else js_str(value))]
    if control.get("unit") == "percent":
        return f"{round(value * 100)}%"
    return js_str(value)


def use_settings(use, values):
    """The settings of a small figure: its own, with the values of the controls bound to it (when its condition holds)."""
    settings, linked = dict(use.get("params") or {}), []
    when = use.get("bindWhen")
    if not when or all(values[k] in allowed for k, allowed in when.items()):
        for cid, spec in (use.get("bind") or {}).items():
            if isinstance(spec, str):
                settings[spec] = values[cid]
            else:
                settings[spec["to"]] = spec["map"][js_str(values[cid])]
            linked.append(cid)
    return settings, linked


def linked_ids(card, use, values):
    linked = use_settings(use, values)[1]
    return [c["id"] for c in ENTRY[card]["controls"] if c["id"] in linked]


def use_text_key(use, values):
    """The sentence under a small figure: the first case of textKeyWhen that the values meet, else textKey (as AtlasView.useTextKey)."""
    for case in use.get("textKeyWhen") or []:
        if all(values[k] in allowed for k, allowed in case["when"].items()):
            return case["key"]
    return use.get("textKey")


def changing_text(use):
    """Whether the sentence under a small figure changes with the values (then the page keeps all its cases in one cell)."""
    return len({c["key"] for c in use.get("textKeyWhen") or []} | ({use["textKey"]} if use.get("textKey") else set())) > 1


def expected_linked(card, use, values, language):
    L, ids = M[language], linked_ids(card, use, values)
    if not use.get("bind"):
        return L["linkedNever"]
    if not ids:
        # An entry may say why its small figure does not change now (the small figures of Pop out draw no direction and no shape)
        return L[use.get("linkedNoneKey") or "linkedNone"]
    return fill(L["linkedTo"], names=("・" if language == "ja" else ", ").join(L[f"ctl.{card}.{cid}"] for cid in ids))


def control_enabled(control, values):
    """A control is off while its enabledWhen does not hold or its disabledWhen holds (the same rule as AtlasView.controlEnabled)."""
    def hit(cond):
        return all(values[k] in allowed for k, allowed in cond.items())
    if control.get("enabledWhen") and not hit(control["enabledWhen"]):
        return False
    return not (control.get("disabledWhen") and hit(control["disabledWhen"]))


def expected_desc(card, side, values, language):
    """The <desc> of a figure of the cards with controls: its title with the current settings (the main figure: every control that can be
    used now; a small figure: the controls that change it)."""
    L, entry = M[language], ENTRY[card]
    title = L[f"fig.{card}.{side}.title"]
    if side == "main":
        ids = [c["id"] for c in entry["controls"] if control_enabled(c, values)]
    else:
        ids = linked_ids(card, next(u for u in entry["uses"] if u["side"] == side), values)
    if not ids:
        return title
    controls = {c["id"]: c for c in entry["controls"]}
    pairs = [fill(L["descPair"], name=L[f"ctl.{card}.{cid}"], value=step_name(card, controls[cid], values[cid], language)) for cid in ids]
    return fill(L["descSettings"], title=title, settings=("、" if language == "ja" else "; ").join(pairs))


def expected_read(card, values, language):
    """The sentences under the figure of the Grouping and Figure and ground cards, from the cases of the spec."""
    L = M[language]
    if card == "gestalt-proximity-similarity":
        side = "rows" if values["prox"] < 0 else "cols" if values["prox"] > 0 else "even"
        return [L[f"proxRead.{side}.{values['sim']}"]]
    if card == "gestalt-region-connection":
        return [L["regionRead." + values["link"]]]
    if card == "gestalt-contour":
        p = round(values["gap"] * 100)
        first = L["contourRead.gap0"] if p == 0 else fill(L["contourRead.gapLow" if p <= 30 else "contourRead.gapHigh"], p=p)
        return [first, L["contourRead." + values["crossing"]]]
    if card == "figure-ground-area":
        p = round(values["share"] * 100)
        return [L["areaRead.darkNarrow" if p < 50 else "areaRead.equal" if p == 50 else "areaRead.lightNarrow"]]
    if card == "figure-ground-symmetry":
        if values["cue"] == "none":
            return [L["symRead.none"]]
        # The bands with the cue are named by their color: the dark ones, or once swapped the light ones
        band = "light" if values["swap"] else "dark"
        if values["cue"] == "convex":
            return [L[f"symRead.convex{2 if values['regions'] == 2 else 8}.{band}"]]
        return [L[f"symRead.symmetric.{band}"]]
    if card in MISREAD_CARDS:
        return expected_misread(card, values, language)
    if card == "popout-motion":
        random = values["others"] == "random"
        if values["amount"] == "none":
            return [L["motionRead.oneStill" if random else "motionRead.none"]]
        # Small, Medium and Large each have their own sentence
        return [L["motionRead.allMove" if random else "motionRead." + values["amount"]]]
    if card == "search-camo":
        return [L["camoRead." + values["pattern"]]]
    if card == "illusion-lightness-contrast":
        if not values["diff"]:
            return [L["lightRead.same"]]
        return [L["lightRead.band" if values["compare"] == "band" else "lightRead.apart"]]
    raise ValueError(card)


def round_fixed(x, digits):
    """Math.round(x * 10^digits) / 10^digits, then toFixed(digits) (the rounding of the screen)."""
    f = 10 ** digits
    return f"{math.floor(x * f + 0.5) / f:.{digits}f}"


DS = DATA["datasets"]


def baseline_ratio(bottom):
    values = DS["libraryLoans3"]
    return (max(values) - bottom) / (min(values) - bottom)


def area_scales(v, mode):
    return {"height": (v, v), "both": (v, v * v), "area": (math.sqrt(v), v)}[mode]


def dual_crossings(top):
    """The sign of (temperature on 0-30) - (rain on 0-top) changes between neighboring months (months with no difference skipped)."""
    signs = []
    for t, r in zip(DS["townTemp"], DS["townRain"]):
        d = t / 30 - r / top
        if d != 0:
            signs.append(1 if d > 0 else -1)
    return sum(1 for a, b in zip(signs, signs[1:]) if a != b)


def mean_abs_angle(values, aspect):
    """The mean of the absolute angles of the segments (degrees), on the axis widened to multiples of 10."""
    lo, hi = math.floor(min(values) / 10) * 10, math.ceil(max(values) / 10) * 10
    steps = len(values) - 1
    return sum(math.degrees(math.atan2(abs(b - a) / (hi - lo), aspect / steps)) for a, b in zip(values, values[1:])) / steps


def books(value):
    """A value in hundreds of books, as books with a thousands separator (4,000)."""
    return f"{value * 100:,}"


def expected_numbers(card, values, language):
    L = M[language]
    if card == "misread-baseline":
        return fill(L["baseNumbers"], r=round_fixed(baseline_ratio(values["bottom"]), 2))
    if card == "misread-area":
        h, a = area_scales(values["ratio"], values["stretch"])
        return fill(L["areaNumbers"], v=round_fixed(values["ratio"], 2), h=round_fixed(h, 2), a=round_fixed(a, 2))
    if card == "misread-dual-axis":
        return fill(L["dualNumbers"], n=dual_crossings(values["rightTop"]))
    if card == "misread-aspect-range":
        shown = DS["libraryLoans24"][-6:] if values["range"] == "last6" else DS["libraryLoans24"]
        return fill(L["aspectNumbers"], deg=round_fixed(mean_abs_angle(shown, values["aspect"]), 1))
    raise ValueError(card)


def expected_misread(card, values, language):
    """The sentences under the figure of the misreading cards, from the cases of the spec."""
    L = M[language]
    if card == "misread-baseline":
        if not values["bottom"]:
            return [L["baseRead.zero"]]
        # The two ratios of the line of numbers (two decimals): a difference under 0.05 is still small (the bottom at 5, 10 and 15)
        ratio = round_fixed(baseline_ratio(values["bottom"]), 2)
        value_ratio = round_fixed(max(DS["libraryLoans3"]) / min(DS["libraryLoans3"]), 2)
        gap = round_fixed(float(ratio) - float(value_ratio), 2)
        if float(gap) < 0.05:
            out = [fill(L["baseRead.raisedSmall"], b=values["bottom"], r=ratio, d=gap)]
        else:
            out = [fill(L["baseRead.raised"], b=values["bottom"], r=ratio)]
        if values["mark"] == "shown":
            out.append(L["baseRead.mark"])
        if values["chart"] == "line":
            out.append(L["baseRead.line"])
        return out
    if card == "misread-area":
        if values["ratio"] == 1:
            return [L["areaMisRead.one"]]
        h, a = area_scales(values["ratio"], values["stretch"])
        return [fill(L["areaMisRead." + values["stretch"]], v=round_fixed(values["ratio"], 2), h=round_fixed(h, 2), a=round_fixed(a, 2))]
    if card == "misread-dual-axis":
        n = dual_crossings(values["rightTop"])
        if n == 0:
            return [fill(L["dualRead.none"], m=values["rightTop"])]
        if n == 1:
            return [fill(L["dualRead.crossOnce"], m=values["rightTop"])]
        return [fill(L["dualRead.cross"], m=values["rightTop"], n=n)]
    if card == "misread-aspect-range":
        loans = DS["libraryLoans24"]
        shown = loans[-6:] if values["range"] == "last6" else loans
        deg = math.floor(mean_abs_angle(shown, values["aspect"]) * 10 + 0.5) / 10
        key = "aspectRead.steep" if deg > 60 else "aspectRead.mid" if deg >= 30 else "aspectRead.flat"
        first = fill(L[key], deg=f"{deg:.1f}")
        if values["range"] == "last6":
            return [first, fill(L["aspectRead.last6"], start6=books(loans[-6]), end=books(loans[-1]), start=books(loans[0]))]
        return [first, fill(L["aspectRead.all"], start=books(loans[0]), end=books(loans[-1]))]
    raise ValueError(card)


def sentences(text):
    """The sentences of a text, as app.js splits them to show one per line (after 。, or after a period and a space)."""
    return [x for x in re.split(r"(?<=。)|(?<=\.)\s+", text) if x]


# The lines of a text, split at its <br> elements (the explanations of the terms left out)
LINES = """sel => { const el = document.querySelector(sel), lines = [''];
  for (const n of el.childNodes) {
    if (n.nodeName === 'BR') { lines.push(''); continue; }
    const c = n.cloneNode(true);
    if (c.querySelectorAll) c.querySelectorAll('.term-tip').forEach(t => t.remove());
    lines[lines.length - 1] += c.textContent;
  }
  return {lines, breaks: el.querySelectorAll('br').length}; }"""


def assert_sentence_lines(page, selector, key, language):
    """One sentence per line: a forced break after every sentence but the last, and nowhere inside a sentence."""
    r = page.evaluate(LINES, selector)
    check(r["lines"] == sentences(M[language][key]) and r["breaks"] == len(r["lines"]) - 1, (selector, "one sentence per line", r))


def heading_text(group, language):
    g = next(x for x in DATA["groups"] if x["id"] == group)
    name, term = M[language][g["labelKey"]], M[language][g["termKey"]]
    return name + "（" + term + "）" if language == "ja" else name + " (" + term + ")"


# The layout of the page: its width, the controls smaller than their size, boxes that scroll sideways, and the tab names
PROBE = """() => {
  const shown = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const label = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.dataset && el.dataset.key ? '[' + el.dataset.key + ']' : '')
    + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
  const px = n => Math.round(n * 1000) / 1000;
  const inlineLink = el => el.tagName === 'A' && el.parentElement && el.parentElement.textContent.trim() !== el.textContent.trim();
  const small = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, summary, [role="button"]')) {
    if (!shown(el) || inlineLink(el) || el.classList.contains('term')) continue;
    const r = el.getBoundingClientRect(), need = el.classList.contains('term-help') ? 24 : 44;
    if (r.width + 1e-3 < need || r.height + 1e-3 < need) small.push({el: label(el), w: px(r.width), h: px(r.height), need});
  }
  const wraps = Array.from(document.querySelectorAll('body *')).filter(shown)
    .filter(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1)
    .map(el => ({el: label(el), width: el.clientWidth, scroll: el.scrollWidth}));
  const overflowing = Array.from(document.querySelectorAll('body *')).filter(shown).filter(el => {
    const r = el.getBoundingClientRect(); return r.right > document.documentElement.clientWidth + 0.5 || r.left < -0.5; })
    .filter(el => !el.closest('.visually-hidden')).slice(0, 5).map(label);
  return {viewport: innerWidth, client: document.documentElement.clientWidth, page: document.documentElement.scrollWidth,
    small, wraps, overflowing};
}"""
# Each tab: the lines of its word and of its term, and whether every line starts at a place where a break is allowed (after a <wbr>
# or a space); the font sizes
TAB_LINES = """() => Array.from(document.querySelectorAll('#tabs [role="tab"]'), tab => {
  const part = el => {
    let text = ''; const allowed = new Set(), chars = [];
    const walk = node => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          for (let i = 0; i < child.length; i++) {
            const ch = child.data[i];
            if (/\\s/.test(ch)) { if (text && !text.endsWith(' ')) { text += ' '; allowed.add(text.length); } continue; }
            const range = document.createRange(); range.setStart(child, i); range.setEnd(child, i + 1);
            const r = range.getClientRects()[0];
            chars.push([text.length, r ? r.top : null]); text += ch;
          }
        } else if (child.nodeName === 'WBR') allowed.add(text.length);
        else walk(child);
      }
    };
    walk(el);
    const lines = [], bad = []; let top = null;
    for (const [i, t] of chars) {
      if (t === null) continue;
      if (top === null || Math.abs(t - top) > 3) { if (top !== null && !allowed.has(i)) bad.push(i); lines.push(i); top = t; }
    }
    const pieces = lines.map((start, k) => text.slice(start, k + 1 < lines.length ? lines[k + 1] : text.length).trim());
    return {text: text.trim(), lines: pieces, bad, size: parseFloat(getComputedStyle(el).fontSize)};
  };
  const r = tab.getBoundingClientRect();
  return {id: tab.id, top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width),
    name: part(tab.querySelector('.tab-name')), term: part(tab.querySelector('.tab-term'))};
})"""
HEADING_LEVELS = """() => Array.from(document.querySelectorAll('h1, h2, h3, h4'), el => Number(el.tagName[1]))"""
NO_MOTION = """() => Array.from(document.querySelectorAll('*')).every(el => { const s = getComputedStyle(el);
  return s.animationName === 'none' && s.transitionDuration.split(',').every(d => parseFloat(d) === 0); })"""
# The places of the parts of a card, in page coordinates (so that a scroll by Playwright before a click does not count)
CARD_PLACES = """id => { const card = document.getElementById(id), top = el => el ? el.getBoundingClientRect().top + scrollY : null;
  const f = card.querySelector('.figure-frame'), frame = f ? f.getBoundingClientRect() : null;
  return {frame: top(f), frameW: frame ? frame.width : null, frameH: frame ? frame.height : null, why: top(card.querySelector('.entry-why')),
    read: top(card.querySelector('.read-stack')), find: top(card.querySelector('.find-line')),
    numbers: top(card.querySelector('.numbers-stack')), check: top(card.querySelector('.entry-check')),
    uses: Array.from(card.querySelectorAll('.use-figure svg'), s => top(s)),
    linked: Array.from(card.querySelectorAll('.use-linked'), s => top(s))}; }"""
# The names of the steps under each slider of a card: their boxes and the box of the slider's control
TICKS = """id => Array.from(document.querySelectorAll('#' + id + ' .controls .control.range'), c => { const b = c.getBoundingClientRect();
  return {key: c.querySelector('input').dataset.key, left: b.left, right: b.right,
    spans: Array.from(c.querySelectorAll('.ticks > span'), s => { const r = s.getBoundingClientRect(); return [r.left, r.right]; })}; })"""
# The frame of the keyboard focus of a slider (drawn by the slider or by its control) and the boxes of the names of its steps
FOCUS_RING = """id => { const input = document.getElementById(id), control = input.closest('.control');
  const box = el => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  const ringOf = el => { const s = getComputedStyle(el), w = parseFloat(s.outlineWidth) || 0;
    if (s.outlineStyle === 'none' || w === 0) return null;
    const o = parseFloat(s.outlineOffset) || 0, b = box(el);
    return {by: el === input ? 'slider' : 'control', outer: [b[0] - o - w, b[1] - o - w, b[2] + o + w, b[3] + o + w],
      inner: [b[0] - o, b[1] - o, b[2] + o, b[3] + o]}; };
  return {focused: document.activeElement === input, visible: input.matches(':focus-visible'), ring: ringOf(input) || ringOf(control),
    spans: Array.from(control.querySelectorAll('.ticks > span'), box)}; }"""
# The boxes of the texts of a figure and of the figure itself
FIGURE_TEXTS = """id => { const svg = document.querySelector('#' + id + ' .figure-frame svg'), f = svg.getBoundingClientRect();
  return {frame: [f.left, f.top, f.right, f.bottom], texts: Array.from(svg.querySelectorAll('text'), t => {
    const r = t.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, t.textContent]; })}; }"""
CARD_TEXTS = """id => { const card = document.getElementById(id);
  const text = el => el ? el.textContent.trim() : '';
  return {read: text(card.querySelector('.read-live')), find: text(card.querySelector('.find-live')),
    numbers: text(card.querySelector('.numbers-live')), check: text(card.querySelector('.entry-check')),
    linked: Array.from(card.querySelectorAll('.use-linked > p:not([aria-hidden])'), p => p.textContent.trim()).filter(Boolean),
    useTexts: Array.from(card.querySelectorAll('.use-texts'), t => (s => s ? s.lastElementChild.textContent.trim() : null)(t.querySelector(':scope > .stack.use-text'))),
    live: Array.from(card.querySelectorAll('.use-linked > p'), p => p.textContent.trim()),
    desc: Array.from(card.querySelectorAll('svg > desc'), d => d.textContent.trim()),
    marks: {pressed: card.querySelectorAll('.figure-frame .mark-pressed').length, target: card.querySelectorAll('.figure-frame .mark-target').length},
    cover: (c => c ? !c.hidden : null)(card.querySelector('.find-cover')),
    reveal: (b => b ? !b.hidden : null)(card.querySelector('.find-reveal:not([tabindex])')),
    shapes: card.querySelectorAll('.figure-frame svg > :not(title):not(desc)').length}; }"""
# The center of the first and the last shape of the figure (the first is the shape to find: AtlasView puts it first)
SHAPE_POINTS = """id => { const svg = document.querySelector('#' + id + ' .figure-frame svg');
  const shapes = Array.from(svg.children).filter(el => !['title', 'desc'].includes(el.tagName) && !/mark-/.test(el.getAttribute('class') || ''));
  const center = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  return {first: center(shapes[0]), last: center(shapes[shapes.length - 1])}; }"""
TIP_STATE = """() => { const open = Array.from(document.querySelectorAll('.term-tip')).filter(t => !t.hidden);
  return open.map(t => { const r = t.getBoundingClientRect(), b = t.parentElement.querySelector('button').getBoundingClientRect();
    return {id: t.id, text: t.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, wordBottom: b.bottom, wordTop: b.top,
      client: document.documentElement.clientWidth, page: document.documentElement.scrollWidth}; }); }"""
# The text of an element without the explanations of its terms (they are hidden until asked for)
VISIBLE_TEXT = "el => { const c = el.cloneNode(true); c.querySelectorAll('.term-tip').forEach(t => t.remove()); return c.textContent; }"
ACTIVE = "() => { const a = document.activeElement; return {id: a.id, key: (a.dataset || {}).key || null, cls: a.className || ''}; }"
# Event.timeStamp follows the page's clock while Playwright holds it (the browser stamps events with the real clock)
TIMESTAMP_SHIM = "Object.defineProperty(Event.prototype, 'timeStamp', { configurable: true, get() { return performance.now(); } });"


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def set_language_query(url, value):
    parts = urlsplit(url)
    query = [(key, item) for key, item in parse_qsl(parts.query) if key != "lang"]
    if value is not None:
        query.append(("lang", value))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def with_hash(url, value):
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, value))


def observe(page, url):
    """Collect page errors, console errors, failed or unexpected requests and CSP violations (also across reloads)."""
    errors, violations = [], []
    allowed = urlsplit(url)

    def request_sent(request):
        target = urlsplit(request.url)
        if target.scheme in ("http", "https") and (target.scheme != allowed.scheme or target.netloc != allowed.netloc):
            errors.append("Unexpected network request: " + request.url)

    def console(message):
        if message.type != "error":
            return
        if SHOOTING["on"] and STYLE_REFUSED in message.text:
            SHOOTING["ignored"].append(message.text)
        else:
            errors.append("console: " + message.text)

    def violation(directive, blocked):
        if SHOOTING["on"] and directive.startswith("style-src"):
            SHOOTING["ignored"].append(directive)
        else:
            violations.append({"directive": directive, "blocked": blocked})

    page.on("pageerror", lambda error: errors.append("pageerror: " + str(error)))
    page.on("console", console)
    page.on("requestfailed", lambda request: errors.append("requestfailed: " + request.url + " " + str(request.failure)))
    page.on("request", request_sent)
    page.expose_function("__qaCspViolation", violation)
    page.add_init_script("""document.addEventListener('securitypolicyviolation', event => {
        window.__qaCspViolation(event.violatedDirective, event.blockedURI);
      });""")
    return errors, violations


# A screenshot in WebKit adds a style element to the page (Playwright's, even with caret="initial"), which the CSP refuses. Those
# refusals, while a screenshot is being taken, are the harness's and are kept apart (in SHOOTING["ignored"]); the page never adds a
# style element (structure.test.js)
SHOOTING = {"on": False, "ignored": []}
STYLE_REFUSED = "Refused to apply a stylesheet"


def shot(page, path):
    SHOOTING["on"] = True
    try:
        page.screenshot(caret="initial", path=str(path), full_page=False)
        page.wait_for_timeout(150)
    finally:
        SHOOTING["on"] = False


def assert_clean(errors, violations):
    check(not errors, errors)
    check(not violations, violations)


def new_context(browser, browser_name, width, height, language, theme):
    options = {
        "viewport": {"width": width, "height": height},
        "locale": "ja-JP" if language == "ja" else "en-US",
        "color_scheme": theme, "reduced_motion": "reduce",
        "has_touch": browser_name == "chromium" and width < 720,
    }
    if browser_name == "chromium":
        options["is_mobile"] = width < 720
    return browser.new_context(**options)


def wait_ready(page):
    page.wait_for_function("() => document.documentElement.dataset.appReady === 'true'")


def assert_layout(page, width, name, results):
    m = page.evaluate(PROBE)
    check(m["viewport"] == width, (name, m))
    check(m["page"] <= m["client"], (name, "page overflow", m["page"], m["client"], m["overflowing"]))
    check(not m["overflowing"], (name, "elements outside the page", m["overflowing"]))
    check(not m["small"], (name, "small targets", m["small"]))
    check(not m["wraps"], (name, "scrolling boxes", m["wraps"]))
    results.append({"state": name, "page": m["page"], "client": m["client"]})


def assert_language_text(text, language, name):
    check(bool(text and text.strip()), (name, "empty"))
    check(bool(JAPANESE.search(text)) == (language == "ja"), (name, language, text))


def assert_selected(page, name):
    for group in GROUPS:
        selected = group == name
        tab, panel = page.locator("#tab-" + group), page.locator("#panel-" + group)
        check(tab.get_attribute("aria-selected") == str(selected).lower(), ("aria-selected", group))
        check(tab.get_attribute("tabindex") == ("0" if selected else "-1"), ("tabindex", group))
        check(panel.is_visible() == selected, ("panel visibility", group))


def assert_preference(page, language, theme):
    check(page.locator("html").get_attribute("lang") == language, "language " + language)
    check(page.locator("html").get_attribute("data-theme") == theme, "theme " + theme)
    shown = page.locator("#language").inner_text()
    check(shown == ("EN" if language == "ja" else "JA"), ("language button text", shown))
    aria = page.locator("#language").get_attribute("aria-label")
    check(aria == M[language]["languageToggle"] and aria.startswith(shown), ("the language button's name starts with its text", aria))
    check(page.locator("#theme-label").inner_text() == M[language]["themeLight" if theme == "dark" else "themeDark"], "theme label")
    for group in GROUPS:
        name = page.locator(f"#tab-{group} .tab-name").evaluate("el => el.textContent")
        g = next(x for x in DATA["groups"] if x["id"] == group)
        check(name == M[language][g["labelKey"]], ("tab name", group, name))


def assert_ready_state(page, language):
    check(page.locator("html").get_attribute("data-app-ready") == "true", "ready marker")
    check(page.locator("#startup-note").count() == 0, "startup notice is removed from the DOM")
    for group, key in (("startup-tools", "displayControls"), ("startup-controls", "learningControls")):
        locator = page.locator("#" + group)
        check(not locator.evaluate("el => el.disabled"), group + " released")
        check(locator.get_attribute("aria-label") == M[language][key], (group, locator.get_attribute("aria-label")))
    check(page.locator("#tabs").get_attribute("aria-label") == M[language]["tablist"], "tablist label")


def assert_heading(page, language):
    check(page.locator("h1").count() == 1 and page.locator("h1").inner_text() == "Vision Trap Atlas", "h1")
    header = page.locator("header.page-header")
    check(not re.search(r"day\s*\d", header.inner_text(), re.I), "no Day line in the header")
    check(header.locator("button").count() == 3, "three header buttons")
    for control in ("theme", "language", "help"):
        box = page.locator("#" + control).bounding_box()
        check(box["width"] + 1e-3 >= 44 and box["height"] + 1e-3 >= 44, (control, box))
    footer = page.locator("footer a")
    check(footer.count() == 1 and footer.evaluate("el => el.textContent") == M[language]["footerGitHub"], "footer text")
    check(footer.get_attribute("href") == FOOTER_HREF and footer.get_attribute("target") == "_blank"
          and footer.get_attribute("rel") == "noopener noreferrer", "footer link")
    levels = page.evaluate(HEADING_LEVELS)
    check(levels[0] == 1 and all(b - a <= 1 for a, b in zip(levels, levels[1:])), ("heading levels", levels))


# Each "?" of the table heads and the last character of its heading: the "?" stands on the line of that character
HEAD_HELP = """() => Array.from(document.querySelectorAll('#contrast-table thead .term-help'), b => {
  const th = b.closest('th'), rb = b.getBoundingClientRect(), cell = th.getBoundingClientRect(), mid = (rb.top + rb.bottom) / 2;
  const walker = document.createTreeWalker(th, NodeFilter.SHOW_TEXT); let node, last = null;
  while ((node = walker.nextNode())) {
    if (b.contains(node) || node.parentElement.closest('.term-tip')) continue;
    for (let i = 0; i < node.length; i++) {
      if (/\\s/.test(node.data[i])) continue;
      const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1);
      const x = r.getClientRects()[0]; if (x && x.width > 0) last = {top: x.top, bottom: x.bottom, right: x.right};
    }
  }
  return {key: b.dataset.term, last, top: rb.top, bottom: rb.bottom, mid, left: rb.left, right: rb.right, cellRight: cell.right};
})"""


def assert_first_view(page, language, width):
    """The introduction (the purpose and what the atlas lets you do), the contrast table and the tabs are filled in (in the language of
    the page)."""
    assert_language_text(page.locator(".intro-short").inner_text(), language, "introduction")
    lines = page.locator(".intro-short").inner_text().split("\n")
    check(lines == sentences(M[language]["introShort"]), ("introduction text, one sentence per line", lines))
    check(not page.locator("#intro-more").evaluate("el => el.open"), "the full introduction starts closed")
    # What the atlas lets you do: a heading and four items under the purpose, shown from the start (outside "Read more")
    features = page.locator("#intro-features")
    check(features.is_visible() and features.evaluate("el => !el.closest('details')"), "the list of what you can do is shown from the start")
    check(page.locator("#intro-features-heading").inner_text() == M[language]["introFeaturesHeading"], "the heading of the list")
    items = [t.strip() for t in page.locator(".intro-features-list > li").all_inner_texts()]
    check(items == [M[language][f"introFeature{n}"] for n in (1, 2, 3, 4)], ("the four items", items))
    boxes = [page.locator(s).bounding_box() for s in (".intro-short", "#intro-features", "#intro-more")]
    check(boxes[0]["y"] < boxes[1]["y"] < boxes[2]["y"], ("the purpose, the list, then Read more", boxes))
    if width >= 1000:
        # Wide screens: the lines stop at about 46 characters (46rem)
        check(all(b["width"] <= 736.5 for b in boxes[:2]), ("not spread over the whole width", boxes))
    # The "?" of a table heading is right after the last character, never alone on the next line, and inside its cell
    for h in page.evaluate(HEAD_HELP):
        check(h["last"] and h["last"]["top"] - 2 <= h["mid"] <= h["last"]["bottom"] + 2, ("the ? on the line of its heading", h))
        check(0 <= h["left"] - h["last"]["right"] <= 8 and h["right"] <= h["cellRight"] + 0.5, ("the ? right after the heading", h))
    check(page.locator("#contrast-line").inner_text() == M[language]["contrastLine"], "contrast line")
    cells = page.locator("#contrast-table tbody th, #contrast-table tbody td").all_inner_texts()
    check(len(cells) == 9 and all(c.strip() for c in cells), ("contrast table", cells))
    expected = [M[language][f"contrastRow{n}.{c}"] for n in (1, 2, 3) for c in ("trait", "show", "hide")]
    check([c.strip() for c in cells] == expected, ("contrast table text", cells))
    for group in GROUPS:
        assert_language_text(page.locator("#tab-" + group).inner_text(), language, "tab " + group)
    # The tab bar and the first card are reached from the first screen without guessing: the tabs follow the table
    check(page.locator("#tabs").bounding_box()["y"] > page.locator("#contrast-table").bounding_box()["y"], "tabs after the table")


def test_tab_names(page, width, language):
    tabs = page.evaluate(TAB_LINES)
    for tab in tabs:
        for part, minimum in (("name", 14), ("term", 12)):
            p = tab[part]
            check(p["size"] + 1e-3 >= minimum, (tab["id"], part, "font size", p["size"]))
            check(1 <= len(p["lines"]) <= 2, (tab["id"], part, "one or two lines", p["lines"]))
            check(not p["bad"], (tab["id"], part, "breaks only between words", p["lines"]))
    tops = [t["top"] for t in tabs]
    if width < 720:
        check(len(set(tops[:3])) == 1 and len(set(tops[3:])) == 1 and tops[3] > tops[0], ("three tabs, then three", tops))
    else:
        check(len(set(tops)) == 1, ("six tabs in one row", tops))
    if language == "ja" and width == 320:
        gestalt = next(t for t in tabs if t["id"] == "tab-gestalt")["term"]
        check(gestalt["lines"] == ["ゲシュタルト", "の法則"], ("ゲシュタルト｜の法則 at 320px", gestalt["lines"]))
    return tabs


def test_tabs(page, width, layouts, language):
    # The tab bar (the help has a tab list of its own, inside its dialog)
    check(page.locator('main [role="tablist"]').count() == 1 and page.locator('#tabs [role="tab"]').count() == 6, "six tabs")
    assert_selected(page, "popout")
    history = page.evaluate("() => history.length")
    page.locator("#tabs").scroll_into_view_if_needed()
    for group in GROUPS:
        y = page.evaluate("() => scrollY")
        page.locator("#tab-" + group).click()
        assert_selected(page, group)
        heading = page.locator(f"#heading-{group}").evaluate(VISIBLE_TEXT)
        check(heading == heading_text(group, language), ("panel heading", group, heading))
        # The tab bar is on the screen: pressing a tab does not move the page; the address ends with the group (no new history).
        # When the new panel is so short that the page cannot reach the old place, the browser stops at the end of the page
        top = page.locator("#tabs").bounding_box()["y"]
        if top >= 0:
            now, end = page.evaluate("() => [scrollY, document.documentElement.scrollHeight - innerHeight]")
            check(abs(now - y) <= 1 or (now < y and y > end and abs(now - end) <= 1), ("the page did not move", group, y, now, end))
        check(page.url.endswith("#" + group), ("address", page.url))
        assert_layout(page, width, "tab-" + group, layouts)
    check(page.evaluate("() => history.length") == history, "a tab adds no history entry")
    page.locator("#tab-popout").click()
    page.locator("#tab-popout").focus()
    for key, expected in (("ArrowRight", "search"), ("ArrowRight", "gestalt"), ("ArrowLeft", "search"), ("End", "illusion"),
                          ("ArrowRight", "popout"), ("ArrowLeft", "illusion"), ("Home", "popout")):
        page.keyboard.press(key)
        assert_selected(page, expected)
        check(page.evaluate("() => document.activeElement.id") == "tab-" + expected, ("tab focus", key, expected))
    page.keyboard.press("Tab")
    check(page.evaluate("() => document.activeElement.id") == "panel-popout", "Tab from the selected tab enters its panel")


# The tabs and panels of the help: which tab is chosen, which panel is shown, and where each panel is scrolled to
HELP_STATE = """() => ({tabs: Array.from(document.querySelectorAll('#help-dialog [role=tab]'), t => [t.id, t.getAttribute('aria-selected'), t.tabIndex]),
  shown: Array.from(document.querySelectorAll('#help-dialog [role=tabpanel]')).filter(p => !p.hidden && p.getClientRects().length).map(p => p.id),
  places: Object.fromEntries(Array.from(document.querySelectorAll('#help-dialog [role=tabpanel]'), p => [p.id, p.scrollTop])),
  active: document.activeElement.id})"""
TWO_FRAMES = "() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))"
# The box of the help and the top of its tab strip, with the height it should have (90% of the screen, at most 56rem)
HELP_BOX = """() => { const d = document.getElementById('help-dialog').getBoundingClientRect();
  const strip = document.querySelector('#help-dialog .help-tabs').getBoundingClientRect(), rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return {width: d.width, height: d.height, top: d.top, left: d.left, right: d.right, bottom: d.bottom, strip: strip.top,
    expected: Math.min(0.9 * innerHeight, 56 * rem), innerWidth, innerHeight}; }"""


def same_help_box(page, first, name):
    """The help keeps its size and place on every tab: the width, the height, the top and the tab strip within 1px."""
    now = page.evaluate(HELP_BOX)
    check(all(abs(now[k] - first[k]) < 1 for k in ("width", "height", "top", "strip")), (name, "the help keeps its size", first, now))
GLOSS_GROUPS = ("all", "popout", "search", "gestalt", "figure-ground", "misread", "illusion")
TERM_KEYS = sorted(k for k in M["ja"] if re.match(r"^term[A-Z]", k) and not re.search(r"(Meaning|Expert)$", k) and k != "termHelpLabel")


def help_tab_state(page, name):
    """The help shows the tab name: chosen, the only one in the tab order, and its panel the only one shown."""
    st = page.evaluate(HELP_STATE)
    other = "glossary" if name == "help" else "help"
    return st["tabs"] == [[f"help-tab-{n}", "true" if n == name else "false", 0 if n == name else -1] for n in ("help", "glossary")] and \
        st["shown"] == [f"help-panel-{name}"], st, other


def test_help(page, width, layouts, screenshot, language):
    L = M[language]
    page.locator("#help").focus()
    page.keyboard.press("Enter")
    dialog = page.locator("#help-dialog")
    check(dialog.is_visible() and dialog.evaluate("el => el.open && el.matches(':modal')"), "modal help")
    check(page.locator("#help-title").inner_text() == L["helpButton"], "help title")
    check(page.evaluate("() => document.activeElement.id") == "close-help", "help opens on the close button")
    # Two tabs, the help first: one panel shown at a time
    check([page.locator("#help-tab-help").inner_text().strip(), page.locator("#help-tab-glossary").inner_text().strip()]
          == [L["helpTabHelp"], L["helpTabGlossary"]], "the names of the two tabs")
    ok, st, _ = help_tab_state(page, "help")
    check(ok, ("the help tab first", st))
    # One size for both tabs, the size of the glossary: on the help tab the help is not shrunk to its short text
    size = page.evaluate(HELP_BOX)
    check(abs(size["height"] - size["expected"]) < 1, ("the height of the help", size))
    check(size["left"] >= 0 and size["top"] >= 0 and size["right"] <= size["innerWidth"] + 0.5 and size["bottom"] <= size["innerHeight"] + 0.5,
          ("the help inside the screen", size))
    # The help: the first steps, the controls as a list, the note on this atlas; the headings stand apart from the text
    check(page.locator("#help-panel-help h3").all_inner_texts() == [L["helpFirst"], L["helpKeysHeading"], L["helpAboutHeading"]], "help headings")
    check(page.locator("#help-panel-help .help-list li").all_inner_texts() == [L["helpKey.tabs"], L["helpKey.slider"], L["helpKey.experiment"]],
          "the controls as a list")
    check(page.locator("#help-first + p").inner_text() == L["helpFirstText"], "first steps")
    look = page.evaluate("""() => { const h = getComputedStyle(document.querySelector('#help-ops')), p = getComputedStyle(document.querySelector('#help-first + p'));
      return {h: parseFloat(h.fontSize), p: parseFloat(p.fontSize), weight: Number(h.fontWeight), gap: parseFloat(h.marginTop)}; }""")
    check(look["h"] > look["p"] and look["weight"] >= 700 and look["gap"] >= look["p"], ("the headings stand apart", look))
    # ←→, Home and End switch the tabs as in the tab bar (and the focus goes with them)
    page.locator("#help-tab-help").focus()
    for key, name in (("ArrowRight", "glossary"), ("ArrowLeft", "help"), ("ArrowLeft", "glossary"), ("Home", "help"), ("End", "glossary")):
        page.keyboard.press(key)
        ok, st, _ = help_tab_state(page, name)
        check(ok and st["active"] == f"help-tab-{name}", (key, name, st))
        same_help_box(page, size, key)
    # The glossary: the groups by tab, every term once
    check(page.locator("#help-panel-glossary .gloss-group h3").all_inner_texts() == [L["glossGroup." + g] for g in GLOSS_GROUPS], "glossary groups")
    keys = page.locator("#help-panel-glossary dt > span:first-child").evaluate_all("els => els.map(e => e.dataset.i18n)")
    check(len(keys) == len(TERM_KEYS) and sorted(keys) == TERM_KEYS, ("the terms once each", len(keys), len(TERM_KEYS)))
    check(page.locator("#help-panel-glossary dd").count() == len(TERM_KEYS), "a meaning for each term")
    assert_layout(page, width, "help-glossary", layouts)
    shot(page, screenshot.with_name(screenshot.stem + "-glossary.png"))
    # Closed and opened again: the same tab at the same place
    place = page.evaluate("() => { const p = document.getElementById('help-panel-glossary'); p.scrollTop = Math.min(300, p.scrollHeight - p.clientHeight); "
                          "return p.scrollTop; }")
    page.evaluate(TWO_FRAMES)
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.querySelector('#help-dialog').open && document.activeElement.id === 'help'", timeout=3000)
    page.locator("#help").click()
    ok, st, _ = help_tab_state(page, "glossary")
    check(ok and place > 0 and abs(st["places"]["help-panel-glossary"] - place) <= 1, ("reopened on the glossary at its place", place, st))
    page.locator("#help-tab-help").click()
    # After a language change the help opens on the help tab at its top (then the language is set back)
    for _ in range(2):
        # Down the glossary, closed, the language changed, opened again
        page.locator("#help-tab-glossary").click()
        page.evaluate("() => { document.getElementById('help-panel-glossary').scrollTop = 200; }")
        page.evaluate(TWO_FRAMES)
        page.keyboard.press("Escape")
        page.wait_for_function("() => !document.querySelector('#help-dialog').open", timeout=3000)
        page.locator("#language").click()
        page.locator("#help").click()
        ok, st, _ = help_tab_state(page, "help")
        check(ok and st["places"]["help-panel-help"] == 0, ("after a language change: the help tab at its top", st))
        page.locator("#help-tab-glossary").click()
        check(page.evaluate("() => document.getElementById('help-panel-glossary').scrollTop") == 0, "the glossary from its top as well")
    page.locator("#help-tab-help").click()
    same_help_box(page, size, "help tab, clicked")
    page.locator("#help-tab-glossary").click()
    same_help_box(page, size, "glossary tab, clicked")
    page.locator("#help-tab-help").click()
    check(page.locator("html").get_attribute("lang") == language, "the language is back")
    text = dialog.evaluate("el => el.textContent")
    if language == "en":
        check(not JAPANESE.search(text), ("Japanese in the English help", JAPANESE.findall(text)[:10]))
    for key in ("Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"):
        page.keyboard.press(key)
        check(dialog.evaluate("el => el.contains(document.activeElement)"), "focus stays in the help")
    box = dialog.bounding_box()
    check(box["x"] >= 0 and box["x"] + box["width"] <= width + 0.5, box)
    assert_layout(page, width, "help-open", layouts)
    shot(page, screenshot)
    # WebKit closes the dialog and gives the focus back a moment after the key (the cancel and close events come later)
    closed = "() => !document.querySelector('#help-dialog').open && document.activeElement.id === 'help'"
    page.keyboard.press("Escape")
    page.wait_for_function(closed, timeout=3000)
    check(not dialog.is_visible(), "Escape closes help")
    check(page.evaluate("() => document.activeElement.id") == "help", "focus back on the help button after Escape")
    page.locator("#help").click()
    page.locator("#close-help").click()
    page.wait_for_function(closed, timeout=3000)
    check(not dialog.is_visible(), "the close button closes help")
    check(page.evaluate("() => document.activeElement.id") == "help", "focus back on the help button after Close")
    return {k: round(size[k], 2) for k in ("width", "height", "top", "strip", "expected")}


def tips_open(page):
    return page.evaluate(TIP_STATE)


def assert_tip_inside(tip, name):
    check(tip["left"] >= -0.5 and tip["right"] <= tip["client"] + 0.5, (name, "explanation inside the screen", tip))
    check(tip["page"] <= tip["client"], (name, "page overflow with the explanation", tip))


def test_terms(page, width, language, has_touch, screenshot):
    """The explanations of the terms: a click, the mouse over the word, the keyboard and Esc, one at a time, inside the screen."""
    page.locator("#tab-popout").click()
    targets = ["#contrast .term-help >> nth=0", "#contrast .term-help >> nth=1", "#heading-popout .term", "#popout-feature-title .term",
               "#popout-asymmetry-title .term", "#popout-feature .use-text .term"]
    check(page.locator(".term").count() >= 4 and page.locator(".term-help").count() == 2, "terms on the screen")
    labels = page.locator("#contrast .term-help").evaluate_all("els => els.map(b => b.getAttribute('aria-label'))")
    check(labels == [fill(M[language]["termHelpLabel"], term=M[language][k]) for k in ("termShowSide", "termHideSide")], ("? labels", labels))
    for selector in targets:
        locator = page.locator(selector)
        locator.scroll_into_view_if_needed()
        locator.click()
        tips = tips_open(page)
        key = locator.get_attribute("data-term")
        check(len(tips) == 1 and tips[0]["text"] == M[language][key + "Meaning"], (selector, "one explanation, the meaning", tips))
        assert_tip_inside(tips[0], selector)
        # Under the word (or above it when there is no room below)
        check(tips[0]["top"] >= tips[0]["wordBottom"] - 2 or tips[0]["bottom"] <= tips[0]["wordTop"] + 2, (selector, "under the word", tips[0]))
        if selector.startswith("#contrast .term-help >> nth=1"):
            shot(page, screenshot)
        page.keyboard.press("Escape")
        check(not tips_open(page), (selector, "Esc hides it"))
    # One at a time: a second word hides the first
    page.locator("#heading-popout .term").click()
    page.locator("#popout-feature-title .term").click()
    tips = tips_open(page)
    check(len(tips) == 1 and tips[0]["text"] == M[language]["termPopoutMeaning"], ("one at a time", tips))
    page.mouse.click(2, 2)
    check(not tips_open(page), "a press elsewhere hides it")
    # The mouse: shown after about 300 ms over the word, kept over the explanation, hidden about 300 ms after leaving both
    word = page.locator("#popout-feature-title .term")
    word.scroll_into_view_if_needed()
    box = word.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(80)
    check(not tips_open(page), "not shown at once")
    page.wait_for_timeout(500)
    tips = tips_open(page)
    check(len(tips) == 1, ("shown after hovering", tips))
    page.mouse.move((tips[0]["left"] + tips[0]["right"]) / 2, (tips[0]["top"] + tips[0]["bottom"]) / 2, steps=4)
    page.wait_for_timeout(500)
    check(len(tips_open(page)) == 1, "kept while the pointer is on the explanation")
    page.mouse.move(2, 2, steps=2)
    page.wait_for_timeout(600)
    check(not tips_open(page), "hidden after leaving")
    # The keyboard: the focus shows it, Esc hides it and the focus stays; it shows again after the focus comes back
    page.locator("#panel-popout").focus()
    page.keyboard.press("Tab")
    check(page.evaluate(ACTIVE)["cls"] == "term" and len(tips_open(page)) == 1, ("Tab to the word shows it", page.evaluate(ACTIVE)))
    page.keyboard.press("Escape")
    check(not tips_open(page) and page.evaluate(ACTIVE)["cls"] == "term", "Esc hides it, the focus stays")
    page.keyboard.press("Tab")
    check(not tips_open(page), "the next control has no explanation")
    page.keyboard.press("Shift+Tab")
    check(len(tips_open(page)) == 1, "back on the word, shown again")
    page.keyboard.press("Escape")
    if has_touch:
        target = page.locator("#heading-popout .term")
        target.tap()
        check(len(tips_open(page)) == 1, "a tap shows it")
        target.tap()
        check(not tips_open(page), "a second tap hides it")


def test_card_terms(page, language):
    """The terms of the Grouping, Figure and ground and (from --stage 5) Misreading tabs (the panel headings, the lead of the
    Misreading tab, the card titles and the sentences beside the small figures): each shows its own explanation, inside the screen,
    and Esc hides it."""
    groups = ("gestalt", "figure-ground") + (("misread", "illusion") if RUN["stage"] >= "5" else ())
    for group in groups:
        page.locator("#tab-" + group).click()
        selectors = [f"#heading-{group} .term"] if group != "misread" else ["#panel-misread .panel-lead .term"]
        if group == "misread":
            check(page.locator("#heading-misread .term").count() == 0, "the heading of the Misreading tab has no term")
        for card in (c for c in CHECKED_CARDS if ENTRY[c]["group"] == group):
            count = page.locator(f"#{card}-title .term").count()
            check(count == len(ENTRY[card]["titleTerms"]), (card, "the terms of the title", count))
            selectors += [f"#{card}-title .term >> nth={i}" for i in range(count)]
            selectors += [f"#{card} .use-text .term >> nth={i}" for i in range(page.locator(f"#{card} .use-text .term").count())]
        for selector in selectors:
            locator = page.locator(selector)
            locator.scroll_into_view_if_needed()
            locator.click()
            tips = tips_open(page)
            key = locator.get_attribute("data-term")
            check(len(tips) == 1 and tips[0]["text"] == M[language][key + "Meaning"], (selector, "one explanation, the meaning", tips))
            assert_tip_inside(tips[0], selector)
            page.keyboard.press("Escape")
            check(not tips_open(page), (selector, "Esc hides it"))
        if group == "gestalt":
            check(page.locator("#panel-gestalt .use-text .term").count() == 2, "分断色 in the two hiding sentences of the Grouping tab")


def keyboard_focus(page, locator):
    """The keyboard focus on an element: from the element before it with Shift+Tab and back with Tab (a focus set by a script does
    not always count as a keyboard focus)."""
    locator.focus()
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Tab")


def crosses_band(rect, ring):
    """Whether a box runs into the line of a frame (the band between its inner and outer edges), with half a pixel of tolerance."""
    outer, inner = ring["outer"], ring["inner"]
    meets_outer = rect[0] < outer[2] - 0.5 and rect[2] > outer[0] + 0.5 and rect[1] < outer[3] - 0.5 and rect[3] > outer[1] + 0.5
    inside_inner = rect[0] >= inner[0] - 0.5 and rect[2] <= inner[2] + 0.5 and rect[1] >= inner[1] - 0.5 and rect[3] <= inner[3] + 0.5
    return meets_outer and not inside_inner


def assert_texts_apart(page, card, name):
    """The texts of a figure stay inside it and do not overlap one another (the aspect-ratio figure puts its title, axis title and
    scale around a plotting area whose size changes)."""
    f = page.evaluate(FIGURE_TEXTS, card)
    frame, texts = f["frame"], f["texts"]
    check(len(texts) >= 6, (card, name, "the texts of the figure", texts))
    for t in texts:
        check(t[0] >= frame[0] - 0.5 and t[2] <= frame[2] + 0.5 and t[1] >= frame[1] - 0.5 and t[3] <= frame[3] + 0.5,
              (card, name, "a text inside the figure", t, frame))
    for i, a in enumerate(texts):
        for b in texts[i + 1:]:
            apart = a[2] <= b[0] + 0.5 or b[2] <= a[0] + 0.5 or a[3] <= b[1] + 0.5 or b[3] <= a[1] + 0.5
            check(apart, (card, name, "two texts of the figure overlap", a, b))


ROUTE = (("popout-feature", "popout"), ("search-time", "search"), ("gestalt-contour", "gestalt"))
SELECTED_TAB = "() => document.querySelector('#tabs [role=tab][aria-selected=true]').id.replace(/^tab-/, '')"


def test_route(page, width, layouts, language):
    """Where to start: under what the atlas lets you do and above "Read more"; three steps (one row from 720px, one column below), the
    buttons 44px high; each opens its tab at its entry with a new history entry, and the browser's back button returns to the place."""
    L = M[language]
    order = page.evaluate("""() => { const at = id => document.getElementById(id), after = (a, b) => !!(at(a).compareDocumentPosition(at(b)) & 4);
      return [after('intro-features', 'intro-route'), after('intro-route', 'intro-more')]; }""")
    check(order == [True, True], ("the steps between what the atlas lets you do and Read more", order))
    check(page.locator("#intro-route-heading").inner_text().strip() == L["introRouteHeading"], "the heading of the steps")
    check(page.locator("#intro-route .route-button").all_inner_texts() == [L[f"introRoute{k}"] for k in (1, 2, 3)], "the step buttons")
    check(page.locator("#intro-route .route-note").all_inner_texts() == [L[f"introRoute{k}Note"] for k in (1, 2, 3)], "the step lines")
    boxes = page.locator("#intro-route .route-button").evaluate_all("els => els.map(b => { const r = b.getBoundingClientRect(); "
                                                                    "return [r.top, r.height, r.left]; })")
    check(all(h >= 43.5 for _, h, _ in boxes), ("the step buttons are 44px high", boxes))
    if width >= 720:
        check(max(b[0] for b in boxes) - min(b[0] for b in boxes) < 1 and boxes[0][2] < boxes[1][2] < boxes[2][2], ("three columns", boxes))
    else:
        check(boxes[0][0] < boxes[1][0] < boxes[2][0] and abs(boxes[0][2] - boxes[2][2]) < 1, ("one column", boxes))
    for card, group in ROUTE:
        page.evaluate("() => document.getElementById('intro-route').scrollIntoView({block: 'center'})")
        y, tab = page.evaluate("() => scrollY"), page.evaluate(SELECTED_TAB)
        page.locator(f'[data-key="route:{card}"]').click()
        assert_selected(page, group)
        check(at_top(page, "#" + card), (card, "the step moves to its entry", page.locator("#" + card).bounding_box()["y"]))
        check(page.evaluate("() => document.activeElement.id") == card, (card, "the entry has the focus"))
        # A new history entry for the entry (after a back the number of entries may stay the same: the new one replaces the forward one)
        pushed = page.evaluate("() => [history.state && history.state.entry, location.hash]")
        check(pushed == [card, "#" + card], (card, "a new history entry", pushed))
        page.go_back()
        page.wait_for_function("tab => document.querySelector('#tab-' + tab).getAttribute('aria-selected') === 'true'", arg=tab)
        page.wait_for_function("y => Math.abs(scrollY - y) <= 2", arg=y)
        assert_selected(page, tab)
    assert_layout(page, width, "route", layouts)


def test_end_box(page, width, layouts, language):
    """The checks when reading a chart: after the four misreading cards, a heading, one sentence and four lines, each ending with a
    button to its card; the button moves within the tab, as "Entries in this tab" does (no history entry)."""
    L = M[language]
    page.locator("#tab-misread").click()
    box = page.locator("#box-chart-checks")
    check(box.is_visible(), "the box of checks")
    check(page.evaluate("() => !!(document.getElementById('misread-aspect-range').compareDocumentPosition(document.getElementById('box-chart-checks')) & 4)"),
          "the box after the last entry")
    check(page.locator("#box-chart-checks-heading").inner_text().strip() == L["chartChecksHeading"], "the heading of the box")
    check(page.locator("#box-chart-checks .end-box-lead").inner_text().strip() == L["chartChecksLead"], "the sentence of the box")
    check(page.locator("#box-chart-checks .end-box-text").all_inner_texts() == [L[f"chartCheck{k}"] for k in (1, 2, 3, 4)], "the four checks")
    entries = [e["id"] for e in sorted((e for e in DATA["entries"] if e["group"] == "misread"), key=lambda e: e["order"])]
    buttons = page.locator("#box-chart-checks .end-box-button")
    check(buttons.all_inner_texts() == [fill(L["toEntry"], name=L[f"item.{e}.short"]) for e in entries], "the buttons name the entries")
    check(all(h >= 43.5 for h in buttons.evaluate_all("els => els.map(b => b.getBoundingClientRect().height)")), "the buttons are 44px high")
    for card in entries:
        length = page.evaluate("() => history.length")
        page.locator(f'[data-key="box:chart-checks:{card}"]').click()
        check(at_top(page, "#" + card), (card, "the check moves to its entry"))
        check(page.evaluate("() => document.activeElement.id") == card, (card, "the entry has the focus"))
        check(page.evaluate("() => history.length") == length and page.evaluate(SELECTED_TAB) == "misread", (card, "within the tab, no history entry"))
    box.scroll_into_view_if_needed()
    assert_layout(page, width, "end-box", layouts)


def control_buttons(page, card):
    return page.locator(f"#{card} .controls .choice button").evaluate_all("els => els.map(b => b.dataset.key)")


def test_card_controls(page, width, height, layouts, language, card, screenshot):
    """Every value of every control: the figure frame, the reading line, the line of "Find and tap" and the small figures stay in place.
    For the Grouping and Figure and ground cards also: each control changes the figure, each control bound to a small figure changes
    it and the others never do, and the sentence under the figure, the lines under the small figures and the descriptions of the
    figures are those of the current settings."""
    entry = ENTRY[card]
    # The camouflage card has no main figure; the moving entry stands still until Play or Next frame
    has_figure, moving = entry["figure"] is not None, card in MOVING_CARDS
    page.locator("#tab-" + entry["group"]).click()
    before = page.evaluate(CARD_PLACES, card)
    texts = page.evaluate(CARD_TEXTS, card)
    assert_language_text(texts["read"], language, card + " reading")
    figures = (1 if has_figure else 0) + len(entry["uses"])
    check(all(d for d in texts["desc"]) and len(texts["desc"]) == figures, (card, "descriptions of the figures", texts["desc"]))
    for d in texts["desc"]:
        assert_language_text(d, language, card + " desc")
    if not has_figure:
        check(before["frame"] is None, (card, "no main figure", before))
    elif entry["figure"]["part"] in SQUARE_PARTS:
        check(abs(before["frameW"] - before["frameH"]) <= 1, (card, "a square figure", before))
    elif card == "misread-aspect-range":
        # The aspect-ratio figure keeps its frame of 280×220 whatever the settings; only the plotting area inside changes
        check(abs(before["frameW"] * 220 / 280 - before["frameH"]) <= 1.5, (card, "a 280:220 figure", before))
    else:
        check(abs(before["frameW"] * 3 / 4 - before["frameH"]) <= 1.5, (card, "a 4:3 figure", before))
    grouping = card in CHECKED_CARDS
    misread = card in MISREAD_CARDS
    if misread:
        # Under the figure, in this order: the line of numbers, the sentences, the line of what to check (and below 720px the small
        # figure after them; from 720px it stands beside them)
        check(before["frame"] + before["frameH"] - 1 <= before["numbers"] < before["read"] < before["check"],
              (card, "the order of the lines under the figure", before))
        check(width >= 720 or before["check"] < before["uses"][0], (card, "the small figure below the lines", before))
        check(texts["check"] == M[language][entry["checkKey"]], (card, "what to check", texts["check"]))
        assert_language_text(texts["numbers"], language, card + " numbers")
    values = {c["id"]: c["default"] for c in entry["controls"]}
    controls = {c["id"]: c for c in entry["controls"]}
    drawn = page.evaluate(FIGURE_SHAPES, card)
    changed = {"main": set(), "uses": set()}

    def follow(control_id, value):
        """After a change of one control: what changed is recorded, the small figures that it is not bound to stay the same, and the
        sentences follow the settings."""
        nonlocal drawn
        old = dict(values)
        values[control_id] = value
        now = page.evaluate(FIGURE_SHAPES, card)
        if now["main"] != drawn["main"]:
            changed["main"].add(control_id)
        for i, use in enumerate(entry["uses"]):
            if now["uses"][i] != drawn["uses"][i]:
                changed["uses"].add((i, control_id))
            if grouping and use_settings(use, old)[0] == use_settings(use, values)[0]:
                check(now["uses"][i] == drawn["uses"][i], (card, control_id, value, "a small figure not bound to the control stays the same", i))
        drawn = now
        if grouping:
            t = page.evaluate(CARD_TEXTS, card)
            check(t["read"] == "".join(expected_read(card, values, language)), (card, control_id, value, "the sentence under the figure", t["read"]))
            check(t["linked"] == [expected_linked(card, u, values, language) for u in entry["uses"]], (card, control_id, value, "linked", t["linked"]))
            check(t["useTexts"] == [M[language][use_text_key(u, values)] if changing_text(u) else None for u in entry["uses"]],
                  (card, control_id, value, "the sentence under the small figure", t["useTexts"]))
            sides = (["main"] if has_figure else []) + [u["side"] for u in entry["uses"]]
            check(t["desc"] == [expected_desc(card, s, values, language) for s in sides], (card, control_id, value, "descriptions", t["desc"]))
            if misread:
                check(t["numbers"] == expected_numbers(card, values, language), (card, control_id, value, "the line of numbers", t["numbers"]))
                check(t["check"] == M[language][entry["checkKey"]], (card, control_id, value, "what to check", t["check"]))
        if card == "misread-aspect-range":
            assert_texts_apart(page, card, (control_id, value))
    uses = page.locator(f"#{card} .use-figure svg").evaluate_all("els => els.map(s => { const r = s.getBoundingClientRect(); "
                                                                   "return [r.left, r.top, r.width, r.bottom]; })")
    labels = page.locator(f"#{card} .use-label").count()
    check(labels == (len(uses) if len(uses) > 1 else 0), (card, "a label above each small figure only when there are two", labels))
    if card == "misread-aspect-range":
        assert_texts_apart(page, card, "first values")
    if len(uses) == 2 and width < 720:
        check(abs(uses[0][1] - uses[1][1]) <= 1 and uses[1][0] > uses[0][0] + uses[0][2] - 1, (card, "two small figures side by side", uses))
    elif len(uses) == 2:
        check(uses[1][1] >= uses[0][3] - 1, (card, "two small figures one above the other", uses))
    if (width, height) == (390, 844):
        top = page.evaluate("""id => { const card = document.getElementById(id), range = card.querySelector('.controls input[type=range]');
          return (range ? range.closest('.control') : card.querySelector('.controls')).getBoundingClientRect().top + scrollY; }""", card)
        bottom = max(u[3] for u in uses) + page.evaluate("() => scrollY")
        check(bottom - top <= height, (card, "from the controls to the small figures in one screen", bottom - top))

    def same_places(name):
        now = page.evaluate(CARD_PLACES, card)
        for key in ("frame", "frameH", "read", "find", "numbers", "check", "why"):
            if before[key] is None:
                check(now[key] is None, (card, name, key, now[key]))
            else:
                check(abs(now[key] - before[key]) <= 1, (card, name, key, before[key], now[key]))
        for a, b in zip(now["uses"] + now["linked"], before["uses"] + before["linked"]):
            check(abs(a - b) <= 1, (card, name, "small figures", before["uses"], now["uses"]))
        t = page.evaluate(CARD_TEXTS, card)
        assert_language_text(t["read"], language, (card, name, "reading"))
        return t

    # The names of the steps under each slider neither overlap nor leave the slider's box (320px too)
    for ticks in page.evaluate(TICKS, card):
        spans = ticks["spans"]
        check(spans[0][0] >= ticks["left"] - 0.5 and spans[-1][1] <= ticks["right"] + 0.5, (card, ticks["key"], "step names inside", ticks))
        check(all(a[1] <= b[0] + 0.5 for a, b in zip(spans, spans[1:])), (card, ticks["key"], "step names apart", spans))
    # The frame of the keyboard focus of each slider never runs over the names of its steps (it goes around them, or stays off them)
    for slider in page.locator(f"#{card} .controls input[type=range]").all():
        if slider.is_disabled():
            continue
        keyboard_focus(page, slider)
        ring = page.evaluate(FOCUS_RING, slider.get_attribute("id"))
        check(ring["focused"] and ring["visible"] and ring["ring"], (card, slider.get_attribute("id"), "a frame of the keyboard focus", ring))
        for span in ring["spans"]:
            check(not crosses_band(span, ring["ring"]), (card, slider.get_attribute("id"), "the frame crosses a step name", span, ring["ring"]))
        page.keyboard.press("Escape")

    def press(key, control_id, value):
        page.locator(f'[data-key="{key}"]').click()
        follow(control_id, value)
        same_places(key)

    if card == "figure-ground-symmetry":
        # While the cue is none there is no cue to swap: the switch cannot be pressed, shows "off" (the figure is not swapped) and the
        # note under it says why. Choosing a cue makes it pressable again and brings the choice back: swapped, then the cue none (shown
        # off), then bulging outward (shown swapped again). Nothing below moves meanwhile
        swap, note = page.locator(f'[data-key="ctl:{card}:swap"]'), page.locator(f"#ctl-{card}-swap-note")

        def swap_state():
            return {"disabled": swap.is_disabled(), "pressed": swap.get_attribute("aria-pressed"),
                    "note": note.evaluate("n => getComputedStyle(n).visibility"), "described": swap.get_attribute("aria-describedby")}
        off = {"disabled": True, "pressed": "false", "note": "visible", "described": note.get_attribute("id")}

        def on(pressed):
            return {"disabled": False, "pressed": pressed, "note": "hidden", "described": None}
        check(note.inner_text().strip() == M[language]["cueNeeded"], (card, "the note under the switch", note.inner_text()))
        check(swap_state() == off, (card, "cue none", swap_state()))
        press(f"ctl:{card}:cue:convex", "cue", "convex")
        check(swap_state() == on("false"), (card, "cue convex", swap_state()))
        press(f"ctl:{card}:swap", "swap", True)
        check(swap_state() == on("true"), (card, "swapped", swap_state()))
        press(f"ctl:{card}:cue:none", "cue", "none")
        check(swap_state() == off, (card, "swapped, then the cue none: shown off", swap_state()))
        press(f"ctl:{card}:cue:convex", "cue", "convex")
        check(swap_state() == on("true"), (card, "the cue again: swapped as chosen", swap_state()))
        press(f"ctl:{card}:swap", "swap", False)
        press(f"ctl:{card}:cue:none", "cue", "none")
    if card == "misread-baseline":
        # The axis-break mark: "On" chosen, then the bottom at 0 (nothing to break: the buttons cannot be pressed, "Off" shows as
        # pressed because the figure has no mark, and the note says why), then the bottom back at 40: "On" comes back. Nothing below
        # moves meanwhile
        marks, note = page.locator(f'#{card} [data-key^="ctl:{card}:mark:"]'), page.locator(f"#ctl-{card}-mark-note")

        def mark_state():
            return {"disabled": marks.evaluate_all("els => els.map(b => b.disabled)"),
                    "pressed": marks.evaluate_all("els => els.map(b => b.getAttribute('aria-pressed'))"),
                    "note": note.evaluate("n => getComputedStyle(n).visibility"),
                    "described": marks.evaluate_all("els => els.map(b => b.getAttribute('aria-describedby'))")}

        def on(pressed):
            return {"disabled": [False, False], "pressed": pressed, "note": "hidden", "described": [None, None]}
        # The note is not shown while the axis is raised (the first values); its text is there all the same
        check(note.text_content().strip() == M[language]["bottomNeeded"], (card, "the note under the mark", note.text_content()))
        check(values["bottom"] == 40 and mark_state() == on(["true", "false"]), (card, "the first values: from 40, no mark", mark_state()))
        press(f"ctl:{card}:mark:shown", "mark", "shown")
        check(mark_state() == on(["false", "true"]), (card, "mark on", mark_state()))
        slider = page.locator(f"#ctl-{card}-bottom-input")
        slider.focus()
        page.keyboard.press("Home")
        follow("bottom", 0)
        same_places("bottom 0")
        check(mark_state() == {"disabled": [True, True], "pressed": ["true", "false"], "note": "visible", "described": [note.get_attribute("id")] * 2},
              (card, "bottom 0: shown without the mark", mark_state()))
        for value in controls["bottom"]["values"][1:controls["bottom"]["values"].index(40) + 1]:
            page.keyboard.press("ArrowRight")
            follow("bottom", value)
            same_places(f"bottom {value}")
        check(mark_state() == on(["false", "true"]), (card, "bottom 40 again: the mark as chosen", mark_state()))
        press(f"ctl:{card}:mark:none", "mark", "none")
    if card == "popout-feature":
        # The two shape pairs can be pressed only for the shape: until then the note under them says so
        pairs, shape_note = page.locator(f'#{card} [data-key^="ctl:{card}:shape:"]'), page.locator(f"#ctl-{card}-shape-note")

        def shape_state():
            return {"disabled": pairs.evaluate_all("els => els.map(b => b.disabled)"), "note": shape_note.evaluate("n => getComputedStyle(n).visibility"),
                    "described": pairs.evaluate_all("els => els.map(b => b.getAttribute('aria-describedby'))")}
        check(shape_note.text_content().strip() == M[language]["shapeOnly"], (card, "the note under the shape pairs", shape_note.text_content()))
        check(values["kind"] == "color" and shape_state() == {"disabled": [True, True], "note": "visible", "described": [shape_note.get_attribute("id")] * 2},
              (card, "the first values: the shape pairs off", shape_state()))
    keys = control_buttons(page, card)
    seen_linked = set()
    first = dict(drawn)
    skipped = []
    for key in keys:
        button = page.locator(f'[data-key="{key}"]')
        if button.is_disabled():
            skipped.append(key)
            continue
        button.click()
        check(button.get_attribute("aria-pressed") == "true", (key, "pressed"))
        parts = key.split(":")
        control = controls[parts[2]]
        follow(parts[2], not values[parts[2]] if control["type"] == "toggle"
               else next(v for v in control_options(control) if js_str(v) == parts[3]))
        t = same_places(key)
        seen_linked.update(t["live"])
        if key.startswith(f"ctl:{card}:kind:shape"):
            # 形: the two shape pairs (pressable now, without the note), and the sliders are off with the note beside them
            check(shape_state() == {"disabled": [False, False], "note": "hidden", "described": [None, None]}, (card, "the shape pairs on", shape_state()))
            for pair in page.locator(f'#{card} [data-key^="ctl:{card}:shape:"]').all():
                pair.click()
                follow("shape", pair.get_attribute("data-key").split(":")[3])
                same_places(pair.get_attribute("data-key"))
            check(page.locator(f"#{card} input[type=range]").evaluate_all("els => els.every(e => e.disabled)"), "sliders off for shape")
            notes = page.locator(f"#{card} .tick-note").evaluate_all("els => els.map(e => getComputedStyle(e).visibility)")
            check(notes == ["visible", "visible"], ("the note beside the sliders", notes))
    for slider in page.locator(f"#{card} .controls input[type=range]").all():
        if slider.is_disabled():
            continue
        control_id = slider.get_attribute("data-key").split(":")[2]
        options = control_options(controls[control_id])
        slider.focus()
        page.keyboard.press("Home")
        follow(control_id, options[int(slider.input_value())])
        for _ in range(int(slider.get_attribute("max")) + 1):
            same_places(slider.get_attribute("data-key") + "=" + slider.input_value())
            check(slider.get_attribute("aria-valuetext"), "the step in words")
            if grouping:
                check(slider.get_attribute("aria-valuetext") == step_name(card, controls[control_id], values[control_id], language),
                      (card, control_id, "the step in words", slider.get_attribute("aria-valuetext")))
            page.keyboard.press("ArrowRight")
            follow(control_id, options[int(slider.input_value())])
    for key in skipped:
        # After the sliders (each ends at its last value): the buttons that could not be pressed before
        button = page.locator(f'[data-key="{key}"]')
        if button.is_disabled():
            continue
        button.click()
        parts = key.split(":")
        control = controls[parts[2]]
        follow(parts[2], not values[parts[2]] if control["type"] == "toggle"
               else next(v for v in control_options(control) if js_str(v) == parts[3]))
        same_places(key)
    if card == "popout-feature":
        # The line under the small figures: the three operations for color, lightness and size; for direction and shape the line
        # says that the small figures do not draw them
        names = M[language]["linkedTo"].replace("{names}", ("・" if language == "ja" else ", ").join(
            M[language][f"ctl.popout-feature.{c}"] for c in ("kind", "diff", "variety")))
        check({names, M[language]["popLinkedNone"]} <= seen_linked and M[language]["linkedNone"] not in seen_linked, ("linked lines", seen_linked))
    if grouping and moving:
        # Standing still, the moving entry draws the same figures whatever the controls (the next Play or Next frame uses the new values)
        check(not changed["main"] and not changed["uses"], (card, "the still figures do not follow the controls", changed))
    elif grouping:
        # Every control changes the figure (when there is one); every control bound to a small figure changes it
        check(changed["main"] == (set(controls) if has_figure else set()), (card, "the controls that changed the figure", changed["main"]))
        bound = {(i, cid) for i, use in enumerate(entry["uses"]) for cid in (use.get("bind") or {})}
        check(bound <= changed["uses"], (card, "the controls that changed the small figures", sorted(changed["uses"]), sorted(bound)))
    # Back to the first values (a control that is off now keeps its value)
    for control in entry["controls"]:
        control_id, default = control["id"], control["default"]
        if values[control_id] == default:
            continue
        if control["type"] == "range":
            slider = page.locator(f"#ctl-{card}-{control_id}-input")
            if slider.is_disabled():
                continue
            slider.focus()
            page.keyboard.press("Home")
            for _ in range(control_options(control).index(default)):
                page.keyboard.press("ArrowRight")
        else:
            button = page.locator(f'[data-key="ctl:{card}:{control_id}"]' if control["type"] == "toggle"
                                  else f'[data-key="ctl:{card}:{control_id}:{js_str(default)}"]')
            if button.is_disabled():
                continue
            button.click()
        follow(control_id, default)
    if grouping:
        check(page.evaluate(FIGURE_SHAPES, card) == first, (card, "the first values draw the first figures again"))
    reshuffle = page.locator(f'[data-key="act:{card}:reshuffle"]')
    if reshuffle.count():
        reshuffle.click()
        same_places("reshuffle")
    else:
        same_places("first values")
    if moving:
        assert_next_frame(page, card)
        same_places("next frame")
    assert_layout(page, width, card + "-controls", layouts)
    page.evaluate("id => document.getElementById(id).scrollIntoView({block: 'start'})", card)
    shot(page, screenshot)


# Next frame (reduced motion) of the moving entry: the outlines of the frame before in each figure (their element, their size, their
# line and fill), the sizes of the moving shapes, and whether Stop can be pressed
NEXT_FRAME = """id => { const c = document.getElementById(id), svgs = [c.querySelector('.figure-frame svg'), ...c.querySelectorAll('.use-figure svg')];
  return {figures: svgs.map(svg => ({outlines: Array.from(svg.querySelectorAll('.fig-trail'), t => { const s = getComputedStyle(t);
      return [t.tagName, t.getAttribute('r'), s.strokeDasharray !== 'none' && s.strokeDasharray !== '', s.fill === 'none'
        || s.fill === 'rgba(0, 0, 0, 0)']; }),
    sizes: Array.from(svg.querySelectorAll('circle.fill-stimCool, circle[class^="fill-series"]'), m => m.getAttribute('r'))})),
    stop: c.querySelector('.motion-stop').disabled}; }"""


def assert_next_frame(page, card):
    """With reduced motion, "Next frame" twice: one dashed outline in each figure (the circle, the marker, the object that moves), the
    size of the moving shape, without a fill; Stop cannot be pressed (nothing plays)."""
    for _ in range(2):
        page.locator(f'[data-key="act:{card}:frame"]').click()
    f = page.evaluate(NEXT_FRAME, card)
    main, chart, camo = f["figures"]
    check([o[:2] for o in main["outlines"]] == [["circle", "12"]] and set(main["sizes"]) == {"12"}, (card, "the outline of the circle", main))
    check([o[:2] for o in chart["outlines"]] == [["circle", "4"]] and set(chart["sizes"]) == {"4"}, (card, "the outline of the marker", chart))
    check([o[0] for o in camo["outlines"]] == ["path"], (card, "the outline of the object", camo))
    check(all(o[2] and o[3] for fig in f["figures"] for o in fig["outlines"]), (card, "dashed, without a fill", f))
    check(f["stop"], (card, "Stop cannot be pressed while nothing plays", f))


# The shapes of the figure and of each small figure of a card (without the title and the description)
FIGURE_SHAPES = """id => { const c = document.getElementById(id), main = c.querySelector('.figure-frame svg');
  const inner = svg => Array.from(svg.children).filter(el => !['title', 'desc'].includes(el.tagName)).map(el => el.outerHTML).join('');
  return {main: main ? inner(main) : null, uses: Array.from(c.querySelectorAll('.use-figure svg'), inner)}; }"""


# The bottom edges of the figure and of the small figures of a card, on the screen
FIGURE_BOTTOMS = """id => { const c = document.getElementById(id);
  return {frame: c.querySelector('.figure-frame').getBoundingClientRect().bottom, inner: innerHeight,
    uses: Array.from(c.querySelectorAll('.use-figure svg'), s => s.getBoundingClientRect().bottom)}; }"""


def assert_figure_on_screen(page, card, width, height):
    """From 720px, right after moving to the card, the bottom edge of its figure is on the screen (the square figure is held by the
    height of the screen too; at 1280x800 the small figures beside it are on the screen as well)."""
    if width < 720:
        return None
    b = page.evaluate(FIGURE_BOTTOMS, card)
    check(b["frame"] <= b["inner"], (card, "the bottom of the figure on the screen", b))
    if (width, height) == (1280, 800) and card in FIND_CARDS:
        check(max(b["uses"]) <= b["inner"], (card, "the small figures on the screen", b))
    return b


def test_entry_nav(page, language, width, height):
    """"Entries in this tab" (each tab with two cards or more): a button moves to its card (at the top of the screen, or as far as the
    page goes), and the button at the end of the card comes back. Returns the bottom edges of the figures right after the move."""
    bottoms = {}
    for group in STAGE_GROUPS[RUN["stage"]]:
        group_cards = [c for c in cards() if ENTRY[c]["group"] == group]
        if len(group_cards) < 2:
            continue
        page.locator("#tab-" + group).click()
        hint = page.locator(f"#nav-{group} .section-nav-hint").inner_text()
        check(hint == M[language]["tabNavHint"], ("the hint above the buttons", group, hint))
        for card in group_cards:
            page.locator(f'[data-key="nav:{card}"]').click()
            check(at_top(page, "#" + card), (card, "the card at the top of the screen", page.locator("#" + card).bounding_box()["y"]))
            bottoms[card] = assert_figure_on_screen(page, card, width, height)
            check(page.evaluate("() => document.activeElement.id") == card, (card, "the card has the focus"))
            page.locator(f'[data-key="back:{card}"]').click()
            top = page.locator(f"#nav-{group}").bounding_box()["y"]
            check(abs(top) <= 12, (card, "back at the list", top))
            check(page.evaluate(ACTIVE)["key"] == "nav:" + card, (card, "the button of the card has the focus"))
    return bottoms


def test_preferences(page, language, theme):
    other_language = "en" if language == "ja" else "ja"
    other_theme = "dark" if theme == "light" else "light"
    page.locator("#tab-misread").click()
    page.locator("#language").click()
    page.locator("#theme").click()
    assert_preference(page, other_language, other_theme)
    assert_sentence_lines(page, "#startup-controls .intro-short", "introShort", other_language)
    assert_sentence_lines(page, "#panel-misread .panel-lead", "misreadLead", other_language)
    assert_ready_state(page, other_language)
    assert_selected(page, "misread")
    saved = page.evaluate("() => Object.fromEntries(Object.entries(localStorage))")
    check(saved == {PREFIX + "language": other_language, PREFIX + "theme": other_theme}, saved)
    page.reload()
    wait_ready(page)
    assert_preference(page, other_language, other_theme)
    assert_selected(page, "misread")
    return saved


def matrix_case(browser, browser_name, url, width, height, language, theme, output):
    name = f"{browser_name}-{width}-{language}-{theme}"
    context = new_context(browser, browser_name, width, height, language, theme)
    page = context.new_page()
    errors, violations = observe(page, url)
    layouts = []
    try:
        page.goto(set_language_query(url, None), wait_until="load")
        wait_ready(page)
        check(page.title() == "Vision Trap Atlas", "document title")
        check(page.locator('meta[http-equiv="Content-Security-Policy"]').get_attribute("content") == CSP, "CSP")
        check(page.locator('meta[name="referrer"]').get_attribute("content") == "no-referrer", "referrer")
        check(page.evaluate("() => matchMedia('(prefers-reduced-motion: reduce)').matches"), "reduced motion")
        check(page.evaluate(NO_MOTION), "no transition or animation")
        assert_preference(page, language, theme)
        assert_ready_state(page, language)
        assert_heading(page, language)
        assert_first_view(page, language, width)
        assert_sentence_lines(page, "#startup-controls .intro-short", "introShort", language)
        assert_sentence_lines(page, "#panel-misread .panel-lead", "misreadLead", language)
        assert_layout(page, width, "initial", layouts)
        shot(page, output / (name + "-initial.png"))
        tabs = test_tab_names(page, width, language)
        test_tabs(page, width, layouts, language)
        help_box = test_help(page, width, layouts, output / (name + "-help.png"), language)
        test_terms(page, width, language, browser_name == "chromium" and width < 720, output / (name + "-term.png"))
        if RUN["stage"] >= "4":
            test_card_terms(page, language)
        for card in cards():
            test_card_controls(page, width, dict(SIZES)[width], layouts, language, card, output / (name + "-" + card + ".png"))
        bottoms = test_entry_nav(page, language, width, height)
        test_end_box(page, width, layouts, language)
        test_route(page, width, layouts, language)
        # A lone small figure (the search card and the misreading cards) has no label of its own: the heading above names it
        check(page.locator('.uses-list.single .use-label').count() == 0, "no label on a lone small figure")
        if language == "en":
            text = page.evaluate("() => { const c = document.body.cloneNode(true); c.querySelectorAll('noscript').forEach(n => n.remove()); "
                                 "return c.textContent; }")
            check(not JAPANESE.search(text), ("Japanese on the English page", JAPANESE.findall(text)[:10]))
            if RUN["stage"] >= "6":
                words = [w for w in page.evaluate(ATTRIBUTE_WORDS) if JAPANESE.search(w[2])]
                check(not words, ("Japanese in an attribute of the English page", words[:10]))
        if RUN["stage"] >= "6":
            # The shared summary stays as written when the language is switched (twice, back to where it was) and after a reload
            assert_ogp(page, "initial")
            for _ in range(2):
                page.locator("#language").click()
                assert_ogp(page, "after switching the language")
        saved = test_preferences(page, language, theme)
        if RUN["stage"] >= "6":
            assert_ogp(page, "after reloading in the other language")
        assert_clean(errors, violations)
        return {"case": name, "status": "passed", "layouts": len(layouts), "tabs": tabs, "saved": saved, "figure_bottoms": bottoms,
                "help_box": help_box}
    except Exception as error:
        try:
            shot(page, output / (name + "-failed.png"))
        except Exception:
            pass
        return {"case": name, "status": "failed", "error": str(error), "errors": errors, "violations": violations}
    finally:
        context.close()


def find_case(browser, browser_name, url, width, height, language, theme, output):
    """"Find and tap" with the clock held: the time, a wrong shape, "Show the answer" after 10 seconds, the keyboard."""
    name = f"{browser_name}-{width}-{language}-{theme}-find"
    context = new_context(browser, browser_name, width, height, language, theme)
    page = context.new_page()
    errors, violations = observe(page, url)
    page.clock.install()
    page.add_init_script(TIMESTAMP_SHIM)
    times = {}
    try:
        page.goto(set_language_query(url, language), wait_until="load")
        check(page.evaluate("() => document.documentElement.dataset.appReady") == "true", "ready")
        L = M[language]
        for card in FIND_CARDS:
            page.evaluate("id => document.getElementById(id).scrollIntoView({block: 'start'})", card)
            places = page.evaluate(CARD_PLACES, card)

            def same(step):
                now = page.evaluate(CARD_PLACES, card)
                for key in ("frame", "frameH", "find", "read"):
                    check(abs(now[key] - places[key]) <= 1, (card, step, key, places[key], now[key]))

            def start():
                page.locator(f'[data-key="act:{card}:find"]').click()
                t = page.evaluate(CARD_TEXTS, card)
                check(t["cover"] and t["shapes"] == 0, (card, "the board covers the figure", t))
                cover = page.locator(f'[data-key="cover:{card}"]').bounding_box()
                frame = page.locator(f"#{card} .figure-frame").bounding_box()
                check(abs(cover["width"] - frame["width"]) <= 3 and abs(cover["height"] - frame["height"]) <= 3, (card, "board size", cover, frame))
                check(page.locator(f'[data-key="cover:{card}"]').inner_text().strip() == L["findCover"], "board text")
                same("board")
                page.locator(f'[data-key="cover:{card}"]').click()
                page.clock.run_for(100)
                t = page.evaluate(CARD_TEXTS, card)
                check(not t["cover"] and t["shapes"] > 0, (card, "the shapes are out", t))

            # The shape to find: the time of the tap
            start()
            page.clock.run_for(600)
            point = page.evaluate(SHAPE_POINTS, card)
            page.mouse.click(*point["first"])
            t = page.evaluate(CARD_TEXTS, card)
            m = re.match(r"^(\d+\.\d)秒で見つかりました。" if language == "ja" else r"^Found in (\d+\.\d) s\.", t["find"])
            check(m and 0.5 <= float(m.group(1)) <= 0.8, (card, "findTime", t["find"]))
            check(t["find"] == fill(L["findTime"], t=m.group(1)), (card, "findTime text", t["find"]))
            check(t["marks"] == {"pressed": 0, "target": 2}, (card, "the mark on the shape to find", t["marks"]))
            times[card] = m.group(1)
            same("found")
            if card == "popout-asymmetry":
                check(t["read"].endswith(L["asymRead.one"]), (card, "one time so far", t["read"]))
                page.locator('[data-key="ctl:popout-asymmetry:target:noLine"]').click()
                start()
                page.clock.run_for(1200)
                page.mouse.click(*page.evaluate(SHAPE_POINTS, card)["first"])
                t = page.evaluate(CARD_TEXTS, card)
                second = re.search(r"(\d+\.\d)", t["find"]).group(1)
                check(t["read"].endswith(fill(L["asymRead.both"], t1=times[card], t2=second)), (card, "both times side by side", t["read"]))
                same("both")
            # A shape that is not the one: no time, two marks
            start()
            page.clock.run_for(400)
            page.mouse.click(*page.evaluate(SHAPE_POINTS, card)["last"])
            t = page.evaluate(CARD_TEXTS, card)
            check(t["find"] == L["findWrong"] and t["marks"] == {"pressed": 1, "target": 2}, (card, "findWrong", t))
            same("wrong")
            # Ten seconds without an answer: "Show the answer"
            start()
            page.clock.run_for(9700)
            check(not page.evaluate(CARD_TEXTS, card)["reveal"], (card, "no answer button before 10 s"))
            page.clock.run_for(500)
            t = page.evaluate(CARD_TEXTS, card)
            check(t["reveal"] and t["find"] == "", (card, "the answer button after 10 s", t))
            check(page.locator(f'[data-key="reveal:{card}"]').inner_text().strip() == L["findReveal"], "answer button text")
            same("reveal offered")
            page.locator(f'[data-key="reveal:{card}"]').click()
            t = page.evaluate(CARD_TEXTS, card)
            check(t["find"] == L["findShown"] and t["marks"] == {"pressed": 0, "target": 2} and not t["reveal"], (card, "findShown", t))
            same("answer shown")
            # From the keyboard it does not start
            page.locator(f'[data-key="act:{card}:find"]').focus()
            page.keyboard.press("Enter")
            t = page.evaluate(CARD_TEXTS, card)
            check(t["find"] == L["findKeyboard"] and not t["cover"], (card, "findKeyboard", t))
            same("keyboard")
            shot(page, output / (name + "-" + card + ".png"))
        assert_clean(errors, violations)
        return {"case": name, "status": "passed", "times": times}
    except Exception as error:
        try:
            shot(page, output / (name + "-failed.png"))
        except Exception:
            pass
        return {"case": name, "status": "failed", "error": str(error), "errors": errors, "violations": violations}
    finally:
        context.close()


# ===== The search experiment (the Search time tab) =====
# The page's clock is held and paused by Playwright, and the answers are put in at chosen times. The clock moves with
# fast_forward, which fires the waiting frame once with the new time (a frame per step, so the steps follow the order of a try:
# the result, the pause, the fixation point, the display, the frame after it, the answer time); run_for would fire every 16 ms
# frame on the way and take far longer. The test keeps its own record of
# every try (the number of bars and whether the bar to find is there, read from the display; the time from the frame after the one
# that showed the display to the key or the tap; the outcome) and computes the summary, the table and the sentences with
# AtlasCore (summarizeBlock, resultCases) and AtlasView.resultTexts in Node. The page must show the same values.
EXP_PROBE = """(() => {
  const qa = window.__qa = {frames: [], shows: 0, shownAt: null, presses: []};
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = cb => raf.call(window, ts => { qa.frames.push(ts); if (qa.frames.length > 600) qa.frames.splice(0, 300); cb(ts); });
  const mark = () => qa.presses.push(performance.now());
  addEventListener('keydown', mark, true);
  addEventListener('pointerdown', mark, true);
  document.addEventListener('DOMContentLoaded', () => {
    const stage = document.getElementById('exp-stage');
    let count = 0;
    new MutationObserver(() => {
      const n = stage.querySelectorAll(':scope > svg path').length;
      if (n > 0 && count === 0) { qa.shows += 1; qa.shownAt = performance.now(); }
      count = n;
    }).observe(stage, {childList: true, subtree: true});
  });
})();"""
EXP_STATE = """() => {
  const qa = window.__qa, svg = document.querySelector('#exp-stage > svg'), message = document.querySelector('.exp-message');
  const paths = Array.from(svg.querySelectorAll('path'));
  const vertical = p => { const b = p.getBBox(); return b.height > b.width; };
  const live = document.querySelector('#exp-feedback [aria-live]');
  return {shows: qa.shows, shownAt: qa.shownAt, now: performance.now(), bars: paths.length,
    present: paths.some(p => /\\b(fill-stimHot|stim-solid)\\b/.test(p.getAttribute('class')) && vertical(p)),
    fixation: svg.querySelectorAll('.fixation').length, progress: document.getElementById('exp-progress').textContent,
    feedback: live ? live.textContent : '', message: message.hidden ? null : message.textContent,
    results: Array.from(document.querySelectorAll('.exp-results p'), p => p.textContent),
    focus: (document.activeElement.dataset || {}).key || document.activeElement.id,
    t0: qa.shownAt === null ? null : (qa.frames.find(f => f > qa.shownAt) ?? null),
    pressed: qa.presses.length ? qa.presses[qa.presses.length - 1] : null, open: document.getElementById('exp-dialog').open,
    answersOff: document.getElementById('exp-absent').disabled, stopShown: document.getElementById('exp-abort').getClientRects().length > 0};
}"""
EXP_LAYOUT = """() => {
  const box = el => { const r = el.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width,
    height: r.height}; };
  const d = document.getElementById('exp-dialog');
  return {stage: box(document.getElementById('exp-stage')), absent: box(document.getElementById('exp-absent')),
    present: box(document.getElementById('exp-present')), abort: box(document.getElementById('exp-abort')),
    feedback: box(document.getElementById('exp-feedback')), title: box(document.getElementById('exp-title')),
    scrollW: d.scrollWidth, clientW: d.clientWidth, innerW: innerWidth, innerH: innerHeight, modal: d.matches(':modal'),
    buttons: Array.from(d.querySelectorAll('button'), b => b.id || (b.dataset || {}).key),
    terms: d.querySelectorAll('.term, .term-help').length, page: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth};
}"""
# The visible results of the tab: the rows of the visible tables, the sentences, the limits, the legend or the names at the line ends
RESULTS_STATE = """() => {
  const shown = el => !!el && el.getClientRects().length > 0;
  const text = el => { const c = el.cloneNode(true); c.querySelectorAll('.term-tip').forEach(t => t.remove()); return c.textContent.trim(); };
  const card = document.getElementById('search-time');
  const charts = Array.from(card.querySelectorAll('svg.res-chart-svg')).filter(shown);
  return {none: Array.from(card.querySelectorAll('.res-none'), text), sets: Array.from(card.querySelectorAll('.res-sets p'), text),
    excluded: Array.from(card.querySelectorAll('.res-excluded-note')).filter(shown).map(text),
    tables: Array.from(card.querySelectorAll('.res-table:not(.res-ref)')).filter(shown).map(t => ({caption: t.caption ? text(t.caption) : null,
      rows: Array.from(t.tBodies[0].rows, r => Array.from(r.cells, c => text(c)))})),
    texts: Array.from(card.querySelectorAll('.res-texts p'), text),
    ref: Array.from(card.querySelectorAll('.res-ref tbody tr'), r => Array.from(r.cells, c => text(c))),
    limits: shown(card.querySelector('.search-limits')) ? Array.from(card.querySelectorAll('.search-limits p'), text) : [],
    legend: Array.from(card.querySelectorAll('.res-legend li')).filter(shown).length,
    labels: charts.map(s => s.querySelectorAll('.fig-legend').length), charts: charts.length,
    marks: charts.map(s => s.querySelectorAll('circle, path:not(.fig-series)').length),
    clear: card.querySelector('[data-key="exp:clear"]').disabled,
    help: Array.from(card.querySelectorAll('.res-table .term-help')).filter(shown).map(b => b.getAttribute('aria-label'))};
}"""
EXPECT_JS = r"""
const [root, input] = [process.argv[1], require('fs').readFileSync(0, 'utf8')];
const C = require(root + '/atlas-core.js'), V = require(root + '/atlas-view.js'), M = require(root + '/messages.js');
const q = JSON.parse(input), results = {};
for (const s of ['feature', 'conjunction']) {
  results[s] = q[s] ? C.summarizeBlock(q[s].records, { aborted: q[s].aborted, granularity: q[s].granularity, set: q[s].set }) : null;
}
const cases = C.resultCases(results);
const out = { keys: cases.map((c) => c.key), texts: {}, end: {}, rows: {}, sets: {} };
for (const lang of ['ja', 'en']) {
  out.texts[lang] = V.resultTexts(M, lang, cases);
  // The end of a run in the dialog: the most important sentence only
  out.end[lang] = V.resultTexts(M, lang, C.resultEndCases(cases));
  out.sets[lang] = V.resultSetTexts(M, lang, results);
  const none = M[lang].resNoValue;
  out.rows[lang] = [['feature', 'present', 'resRowFeatureYes'], ['feature', 'absent', 'resRowFeatureNo'], ['conjunction', 'present', 'resRowConjYes'],
    ['conjunction', 'absent', 'resRowConjNo']].map(([s, side, key]) => {
    const row = results[s] ? results[s].rows[side] : null;
    const medians = C.SET_SIZES.map((n) => (row && row.cells[n].median !== null ? String(Math.round(row.cells[n].median)) : none));
    return { name: M[lang][key], medians, slope: row && row.slope !== null ? V.numberText(C.round1(row.slope).toFixed(1)) : none,
      accuracy: row && row.accuracy !== null ? Math.round(row.accuracy * 100) + '%' : none, excluded: row ? String(row.excluded) : none };
  });
}
process.stdout.write(JSON.stringify(out));
"""


def expected_results(blocks):
    out = subprocess.run(["node", "-e", EXPECT_JS, str(ROOT)], input=json.dumps(blocks), capture_output=True, check=True,
                         encoding="utf-8").stdout
    return json.loads(out)


def js_seconds(rt):
    """A time in seconds with two decimals, rounded like Math.round (the result line of a try)."""
    hundredths = math.floor(rt / 10 + 0.5)
    return f"{hundredths // 100}.{hundredths % 100:02d}"


def wait_until(page, script, timeout=3.0):
    """Polls from here, since the page's timers and frames stand still while its clock is paused."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if page.evaluate(script):
            return True
        time.sleep(0.02)
    raise AssertionError("timed out: " + script)


def wait_message(page):
    """After Esc or Stop during a run: the browser sends the cancel event of the dialog as a task of its own (in WebKit a moment after
    the key), so the message that takes the place of the square is waited for before it is read."""
    wait_until(page, "() => !document.querySelector('.exp-message').hidden", timeout=2)


# Answer times (ms) of a whole block: base + slope × number of bars for (bar there, bar not there), plus a small fixed spread. The
# designs give other result sentences (the ratio of the slopes, the difference of the two searches, a negative slope)
DESIGNS = (
    {"feature": ((450, 3), (480, 7)), "conjunction": ((500, 22), (520, 50))},
    {"feature": ((500, 0.4), (500, 4)), "conjunction": ((500, 12), (520, 20))},
    {"feature": ((560, -2), (500, 10)), "conjunction": ((480, 10), (500, 36))},
    {"feature": ((450, 5), (480, 30)), "conjunction": ((470, 20), (500, 25))},
    {"feature": ((450, 10), (480, 40)), "conjunction": ((480, 18), (500, 12))},
)
SPREAD = (0, 32, -16, 48, -32, 16, 64, -48)


class Experiment:
    """Drives the dialog and keeps the test's own record of the recorded tries."""

    # The steps of the clock to the next display (ms, one frame each): after an answer, the end of the result line (500), the end
    # of the pause (300, the next try begins), the first frame of the fixation point and its end (500); after Start, Continue or
    # Resume, the first frame of the fixation point and its end
    AFTER_ANSWER, AFTER_START = (510, 310, 16, 510), (16, 510)

    def __init__(self, page, language, touch):
        self.page, self.L, self.touch = page, M[language], touch
        self.records, self.skip, self.shows = [], self.AFTER_START, 0

    def state(self):
        return self.page.evaluate(EXP_STATE)

    def press(self, answer, how):
        """An answer: a key (F or J, or an arrow), or the button (a click or a tap at its center)."""
        if how in ("key", "arrow"):
            keys = {"key": ("j", "f"), "arrow": ("ArrowRight", "ArrowLeft")}[how]
            self.page.keyboard.press(keys[0] if answer == "present" else keys[1])
            return "key"
        box = self.page.locator("#exp-" + answer).bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        if how == "tap" and self.touch:
            self.page.touchscreen.tap(x, y)
            return "touch"
        self.page.mouse.click(x, y)
        return "mouse"

    def forward(self, *steps):
        for step in steps:
            self.page.clock.fast_forward(step)

    def wait_display(self):
        """Moves the clock to the next display; None when a message takes the place of the square instead."""
        before = self.shows
        self.forward(*self.skip)
        for _ in range(60):
            s = self.state()
            self.shows = s["shows"]
            if s["shows"] > before:
                return s
            if s["message"] is not None:
                return None
            self.forward(100)
        raise AssertionError("the display did not come")

    def trial(self, kind, rt=600, how="key", seen=None):
        """One try: kind = answer (right), wrong, early (at once, under 200 ms), timeout or hidden. rt may be a function of the
        display. seen(state) runs while the display is out. Returns the display, or None when the block came to its end."""
        s = self.wait_display()
        if s is None:
            return None
        check(s["bars"] in (3, 6, 12, 18) and not s["answersOff"] and s["fixation"] == 0, ("the display", s))
        if seen:
            seen(s)
        record = {"setSize": s["bars"], "present": s["present"]}
        if callable(rt):
            rt = rt(s)
        self.skip = self.AFTER_ANSWER
        if kind in ("answer", "wrong"):
            # The display starts at the frame after the one that showed it (AtlasSearch); the answer comes rt later
            self.forward(16, rt)
            right = "present" if s["present"] else "absent"
            answer = right if kind == "answer" else ("absent" if right == "present" else "present")
            record["input"] = self.press(answer, how)
            after = self.state()
            real = after["pressed"] - after["t0"]
            check(abs(real - rt) < 17, ("the time of the answer", rt, real))
            record["rt"] = real
            if kind == "answer":
                record["outcome"] = "correct"
                check(after["feedback"] == fill(self.L["fbCorrect"], t=js_seconds(real)), ("fbCorrect", after["feedback"], real))
            else:
                record["outcome"] = "miss" if s["present"] else "falseAlarm"
                check(after["feedback"] == self.L["fbMiss" if s["present"] else "fbFalse"], ("wrong", after["feedback"]))
            check(after["bars"] == 0, "the display goes away with the answer")
        elif kind == "early":
            record.update(outcome="early", rt=None, input=self.press("present", how))
            check(self.state()["feedback"] == self.L["fbEarly"], "too early")
        elif kind == "timeout":
            self.forward(16, 3990)
            check(self.state()["feedback"] == "", "not yet at 3,990 ms")
            self.forward(20)
            record.update(outcome="timeout", rt=4000, input=None)
            check(self.state()["feedback"] == self.L["fbTimeout"], "time is up at 4,000 ms")
        elif kind == "hidden":
            self.page.evaluate("""() => { Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
              Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'});
              document.dispatchEvent(new Event('visibilitychange')); }""")
            after = self.state()
            check(after["message"] and self.L["expHidden"] in after["message"] and after["bars"] == 0, ("paused", after["message"]))
            check(after["focus"] == "exp:expResume" and after["answersOff"], ("the focus on Resume", after["focus"]))
            self.page.evaluate("""() => { delete document.hidden; delete document.visibilityState;
              document.dispatchEvent(new Event('visibilitychange')); }""")
            self.forward(400, 400)
            check(self.state()["message"] is not None, "paused until Resume")
            self.page.keyboard.press("Enter")
            record.update(outcome="hidden", rt=None, input=None)
            self.skip = self.AFTER_START
        self.records.append(record)
        return s

    def practice(self, seen=None):
        """Start, one press during the fixation point (too early; the try comes back at the end), the 8 tries with keys and buttons,
        then Continue. Returns the number of tries."""
        L = self.L
        self.page.keyboard.press("Enter")
        self.forward(16, 200)
        s = self.state()
        check(s["message"] is None and s["fixation"] == 2 and s["progress"] == fill(L["expPractice"], i=1), ("the fixation point", s))
        self.page.keyboard.press("f")
        s = self.state()
        check(s["feedback"] == L["fbEarly"], "early during the fixation point")
        self.skip, self.shows, tries = self.AFTER_ANSWER, s["shows"], 1
        for i in range(12):
            s = self.trial("answer", rt=560 + 16 * i, how=("key", "mouse", "arrow", "tap")[i % 4], seen=seen if i == 2 else None)
            if s is None:
                break
            tries += 1
            check(s["progress"] == fill(L["expPractice"], i=min(i + 1, 8)), ("practice progress", i, s["progress"]))
        self.records.clear()
        s = self.state()
        check(s["message"] and L["expPracticeDone"] in s["message"] and s["focus"] == "exp:expContinue", ("practice done", s["message"]))
        check(tries == 9, ("8 tries and the one that came back", tries))
        self.page.keyboard.press("Enter")
        self.skip = self.AFTER_START
        return tries

    def recorded(self, design, mistakes=(8,), mixed=False, stop_after=None, seen=None):
        """The recorded tries: the design's answer times, two too early, one hidden page, one time-out, the given wrong answers.
        stop_after: the number of tries before stopping (None: to the end). Returns the number of tries."""
        tries = 0
        for i in range(90):
            if stop_after is not None and i == stop_after:
                break
            kind = "early" if i in (5, 30) else "hidden" if i == 12 else "timeout" if i == 17 else "wrong" if i in mistakes else "answer"
            how = "mouse" if mixed and i % 3 == 1 else "tap" if mixed and i % 3 == 2 else "key"

            def rt(s, i=i):
                base, slope = design[0] if s["present"] else design[1]
                return max(240, round((base + slope * s["bars"] + SPREAD[i % len(SPREAD)]) / 16) * 16)
            s = self.trial(kind, rt=rt, how=how, seen=seen if i == 3 else None)
            if s is None:
                break
            if i == 0:
                check(s["progress"] == fill(self.L["expMain"], i=1), ("the first recorded try", s["progress"]))
            tries += 1
        return tries


def exp_open(page, search):
    page.locator(f'[data-key="exp:start:{search}"]').click()
    s = page.evaluate(EXP_STATE)
    check(page.locator("#exp-dialog").evaluate("el => el.open && el.matches(':modal')"), "a modal dialog")
    check(s["focus"] == "exp:expStart" and s["answersOff"], ("the focus on Start", s["focus"]))
    return s


def exp_closed(page, search):
    """The dialog is closed and the focus is back on the button that opened it."""
    wait_until(page, "() => !document.getElementById('exp-dialog').open")
    # The close event (which gives the focus back) comes a moment after the dialog closes
    try:
        wait_until(page, f"() => (document.activeElement.dataset || {{}}).key === 'exp:start:{search}'", timeout=2)
    except AssertionError:
        raise AssertionError(("the focus back on the start button", page.evaluate(ACTIVE)))


def assert_experiment_layout(page, name, layouts, trial=True):
    """The square of the display at the size of the spec, the answer buttons and Stop inside the screen, no sideways scroll, no
    theme or language button and no explanation of a term in the dialog. Before the start the message may be taller than the square."""
    m = page.evaluate(EXP_LAYOUT)
    portrait = m["innerH"] >= m["innerW"]
    side = min(m["innerW"] - 32, m["innerH"] - 200, 360) if portrait else min(m["innerH"] - 48, m["innerW"] - 288, 360)
    check(abs(m["stage"]["width"] - side) <= 1 and (abs(m["stage"]["height"] - side) <= 1 or not trial and m["stage"]["height"] > side),
          (name, "the square", side, m["stage"]))
    check(m["modal"] and m["scrollW"] <= m["clientW"] and m["page"] <= m["client"], (name, "no sideways scroll", m))
    for key in ("stage", "absent", "present", "abort", "feedback", "title") if trial else ("abort", "title"):
        b = m[key]
        check(b["left"] >= -0.5 and b["right"] <= m["innerW"] + 0.5 and b["top"] >= -0.5 and b["bottom"] <= m["innerH"] + 0.5,
              (name, key, "inside the screen", b))
    for key in ("absent", "present"):
        check(m[key]["height"] + 1e-3 >= 64, (name, key, "64px high", m[key]))
    check(m["abort"]["height"] + 1e-3 >= 44 and m["abort"]["width"] + 1e-3 >= 44, (name, "Stop 44px", m["abort"]))
    # Stop stands by the top right corner of the square: over its right edge (portrait) or just right of it (landscape)
    gap = m["abort"]["left"] - m["stage"]["right"]
    check(abs(m["abort"]["right"] - m["stage"]["right"]) <= 1 if portrait else 0 <= gap <= 24, (name, "Stop by the square", gap, m["abort"], m["stage"]))
    if portrait:
        # Under the square: no on the left, yes on the right, half the width each
        check(m["absent"]["top"] >= m["stage"]["bottom"] and m["absent"]["right"] <= m["present"]["left"] + 0.5
              and abs(m["absent"]["width"] - m["present"]["width"]) <= 1 and m["absent"]["width"] >= side / 2 - 8, (name, "answers under", m))
    else:
        check(m["absent"]["right"] <= m["stage"]["left"] + 0.5 and m["present"]["left"] >= m["stage"]["right"] - 0.5, (name, "answers beside", m))
    # Stop at the top right, away from the answers
    check(m["abort"]["top"] <= m["stage"]["top"] + 1 and m["abort"]["right"] >= m["stage"]["right"] - 1, (name, "Stop at the top right", m))
    check(m["abort"]["bottom"] + 40 <= m["present"]["top"], (name, "Stop away from the answers", m))
    check(not any(b in ("theme", "language", "help") for b in m["buttons"]), (name, "no theme or language button", m["buttons"]))
    check(m["terms"] == 0, (name, "no term explanations in the experiment"))
    layouts.append({"state": name, "side": side})


def assert_results(page, width, language, blocks, name):
    """The tab shows the values that AtlasCore computes from the test's own record: the table (two tables below 720px), the
    sentences in their order (the two of the limits at the end of the card), the chart's names or legend, the research values."""
    expected = expected_results(blocks)
    got = page.evaluate(RESULTS_STATE)
    L, rows = M[language], expected["rows"][language]
    none = L["resNoValue"]
    if width < 720:
        check(len(got["tables"]) == 2, (name, "two tables below 720px", got["tables"]))
        check([t["caption"] for t in got["tables"]] == [L["resTableMedian"], L["resTableSlope"]], (name, "the titles of the tables"))
        check(got["tables"][0]["rows"] == [[r["name"], *r["medians"]] for r in rows], (name, "middle values", got["tables"][0]["rows"], rows))
        check(got["tables"][1]["rows"] == [[r["name"], r["slope"], r["accuracy"], r["excluded"]] for r in rows], (name, "slopes", got["tables"][1]))
    else:
        check(len(got["tables"]) == 1, (name, "one table from 720px", got["tables"]))
        check(got["tables"][0]["rows"] == [[r["name"], *r["medians"], r["slope"], r["accuracy"], r["excluded"]] for r in rows],
              (name, "the table", got["tables"][0]["rows"], rows))
    texts, keys = expected["texts"][language], expected["keys"]
    check(keys[-2:] == ["resDevice", "resLimits"], keys)
    check(got["texts"] == texts[:-2], (name, "the sentences", got["texts"], texts[:-2]))
    check(got["limits"] == texts[-2:], (name, "the limits", got["limits"]))
    check(got["help"] == [fill(L["termHelpLabel"], term=L["slopeWord"])], (name, "the ? of the slope", got["help"]))
    check(got["sets"] == expected["sets"][language] and got["sets"], (name, "the feature pairs", got["sets"], expected["sets"][language]))
    check(got["excluded"] == [L["resExcludedNote"]], (name, "what the excluded tries are", got["excluded"]))
    drawn = sum(1 for r in rows if any(v != none for v in r["medians"]))
    medians = sum(1 for r in rows for v in r["medians"] if v != none)
    check(got["charts"] == 1, (name, "one chart", got["charts"]))
    if width < 720:
        check(got["legend"] == drawn and got["labels"] == [0] and got["marks"] == [medians], (name, "the legend in words", got))
    else:
        check(got["legend"] == 0 and got["labels"] == [drawn] and got["marks"] == [medians], (name, "names at the line ends", got))
    ref, approx = DATA["references"], lambda v: fill(L["resApprox"], v=v)
    check(got["ref"] == [[L[k], f"{ref['treisman1980'][f]:.1f}", approx(ref["wolfe1998"][f])] for k, f in (
        ("resRowFeatureYes", "featurePresent"), ("resRowFeatureNo", "featureAbsent"), ("resRowConjYes", "conjPresent"),
        ("resRowConjNo", "conjAbsent"))], (name, "research values", got["ref"]))
    check(not got["clear"], (name, "Clear is on"))
    return expected


def experiment_case(browser, browser_name, url, width, height, language, theme, output, index):
    """The Search time tab and its experiment with the clock held: the tab before measuring, the feature pair, Esc before the start,
    a whole block (practice, then 32 recorded tries with keys and buttons, a too early answer, a time-out, a hidden page and wrong
    answers), the other search whole or stopped, Stop during the practice, the results against AtlasCore, and Clear."""
    name = f"{browser_name}-{width}-{language}-{theme}-exp"
    touch = browser_name == "chromium" and width < 720
    context = new_context(browser, browser_name, width, height, language, theme)
    page = context.new_page()
    errors, violations = observe(page, url)
    page.clock.install()
    page.add_init_script(TIMESTAMP_SHIM)
    page.add_init_script(EXP_PROBE)
    layouts, summary = [], {}
    shots = width in (390, 1280)

    def shoot(label):
        if shots:
            shot(page, output / f"{name}-{label}.png")
    try:
        page.goto(set_language_query(url, language), wait_until="load")
        check(page.evaluate("() => document.documentElement.dataset.appReady") == "true", "ready")
        # pause_at takes seconds since the epoch
        page.clock.pause_at(page.evaluate("() => Date.now()") / 1000 + 1)
        L = M[language]
        page.locator("#tab-search").click()
        card = page.locator("#search-time")
        # The tab before measuring
        check(page.locator("#search-time-title").evaluate(VISIBLE_TEXT) == L["item.search-time.title"], "the title")
        check(card.locator(".search-why").evaluate("el => el.textContent") == L["searchWhy"], "why it is measured")
        check(card.locator(".res-none").inner_text().strip() == L["resNone"], "nothing measured yet")
        check(page.locator('[data-key="exp:clear"]').is_disabled() and not card.locator(".search-limits").is_visible(), "no results yet")
        check([page.locator(f'[data-key="exp:set:{s}"]').get_attribute("aria-pressed") for s in ("color", "fill")] == ["true", "false"], "color first")
        samples = lambda: card.locator(".search-measure svg.sample path").evaluate_all("els => els.map(e => e.getAttribute('class'))")
        check(samples() == ["fill-stimHot", "fill-stimCool", "fill-stimCool", "fill-stimHot"], ("samples of color", samples()))
        check(card.locator(".search-measure .control-note").evaluate("el => getComputedStyle(el).visibility") == "visible", "the color hint")
        notes = card.locator(".search-note").all_inner_texts()
        check([n.strip() for n in notes] == [L["expDuration"], L["expReplace"]], ("the length of a run", notes))
        page.locator('[data-key="exp:set:fill"]').click()
        check(samples() == ["stim-solid", "stim-outline", "stim-outline", "stim-solid"], ("samples without color", samples()))
        check(card.locator(".search-measure .control-note").evaluate("el => getComputedStyle(el).visibility") == "hidden", "no color hint")
        # The sentence under the small chart follows the search it shows (the conjunction search first), in a cell that keeps its height
        use, stack = ENTRY["search-time"]["uses"][0], card.locator(".use-texts > .stack.use-text")
        height = stack.evaluate("e => e.getBoundingClientRect().height")
        sentences = []
        for view in ("conjunction", "feature", "conjunction"):
            page.locator(f'[data-key="ctl:search-time:view:{view}"]').click()
            now = stack.evaluate("e => [e.lastElementChild.textContent.trim(), e.getBoundingClientRect().height]")
            check(now[0] == L[use_text_key(use, {"view": view})] and abs(now[1] - height) <= 0.5, ("the sentence of the small chart", view, now, height))
            sentences.append(now[0])
        check(sentences[0] != sentences[1] and sentences[1] == L["searchShowFeature"], ("a sentence for each search", sentences))
        # The heading of the tab, the titles of its two cards (one and two terms), how to use the first card, the theory and the limits
        check(page.locator("#panel-search .term").count() == 9, ("the terms of the tab", page.locator("#panel-search .term").count()))
        set_ = "fill" if index % 4 == 3 else "color"
        page.locator(f'[data-key="exp:set:{set_}"]').click()
        assert_layout(page, width, "search-tab", layouts)
        if width >= 1000:
            # On a wide screen the sentences beside the small figure of each card keep lines that are easy to read: 25 to 40 characters
            # (the width of the column over the size of its letters)
            lines = page.evaluate("""() => ['search-time', 'search-camo'].map(id => { const t = document.querySelector('#' + id + ' .use-texts');
              const size = parseFloat(getComputedStyle(t.querySelector('.use-text, .use-read')).fontSize);
              return Math.round(t.getBoundingClientRect().width / size * 10) / 10; })""")
            check(all(25 <= n <= 40 for n in lines), ("the length of the lines beside the small figures", lines))
        page.evaluate("() => document.getElementById('search-time').scrollIntoView({block: 'start'})")
        shoot("tab")
        searches = ("feature", "conjunction") if index % 2 == 0 else ("conjunction", "feature")
        # A whole first run at 390 and 1280px (both runs whole in the light theme); elsewhere the runs stop after some tries
        whole_first = width in (390, 1280)
        both = whole_first and theme == "light"
        # The cases with two whole runs take the designs in turn, so that each difference of the two searches comes out
        design = DESIGNS[{4: 0, 6: 3, 12: 4, 14: 2}.get(index, index % len(DESIGNS))]
        blocks = {"feature": None, "conjunction": None}
        # In some cases the second search uses the other feature pair (the results then say that the pairs differ)
        sets = (set_, "fill" if set_ == "color" else "color") if index % 4 == 1 else (set_, set_)
        # Esc before the start: the dialog closes, nothing is measured
        exp_open(page, searches[0])
        check(page.locator("#exp-title").inner_text().strip() == fill(L["expTitle"], search=L["termFeature" if searches[0] == "feature" else "termConjunction"],
                                                                         set=L["setColorShort" if set_ == "color" else "setFillShort"]), "the title")
        message = page.evaluate(EXP_STATE)["message"]
        check(L["expInstr"] in message and L["expReader"] in message, ("before the start", message))
        check(page.locator(".exp-message svg.sample").count() == 1 + (1 if searches[0] == "feature" else 2), "the samples of the run")
        # The answer buttons say the answer in a word; the keys (under the words and in a line of the message) only where a mouse is
        # used, since a touch screen has no keys to press. Below 360px the line of the message is left out, so that the message fits its
        # square (the keys stay under the words). Checked before any screenshot of an element (which can change the emulation)
        words = [w.strip() for w in page.locator("#exp-dialog .answer-word").all_inner_texts()]
        check(words == [L["expAbsent"], L["expPresent"]], ("the answer words", words))
        keys = page.evaluate("""() => { const els = [...document.querySelectorAll('#exp-dialog .answer-keys'), ...document.querySelectorAll('#exp-dialog .keys-only')];
          return {fine: matchMedia('(hover: hover) and (pointer: fine)').matches, shown: els.map(e => getComputedStyle(e).display !== 'none'),
            texts: els.map(e => e.textContent.trim())}; }""")
        check(keys["fine"] == (not touch) and keys["shown"] == [not touch, not touch, not touch and width >= 360]
              and keys["texts"] == [L["expAbsentKeys"], L["expPresentKeys"], L["expKeys"]], ("the keys only with a mouse", touch, keys))
        # Before the start the message fits the square, so the place of the answers is already the one of the tries
        assert_experiment_layout(page, "ready", layouts)
        shoot("ready")
        page.keyboard.press("Escape")
        exp_closed(page, searches[0])
        check(page.locator('[data-key="exp:clear"]').is_disabled(), "still nothing measured")
        # The first search, whole
        for n, search in enumerate(searches):
            whole = whole_first if n == 0 else both
            page.locator(f'[data-key="exp:set:{sets[n]}"]').click()
            exp_open(page, search)
            run = Experiment(page, language, touch)
            run.practice(seen=lambda s: (assert_experiment_layout(page, "practice", layouts), shoot("practice")) if n == 0 else None)
            # Four wrong answers (about 13% of the 31 answered tries: the sentence of the wrong answers) or two (about 6%: none)
            mistakes = range(22, 26) if index % 3 == 0 else (8, 24)
            tries = run.recorded(design[search], mistakes=mistakes if whole else (8,), mixed=index % 2 == 1,
                                 stop_after=None if whole else 20 if n == 0 else 6,
                                 seen=lambda s: (assert_experiment_layout(page, "recorded", layouts), shoot("recorded")) if n == 0 else None)
            if whole:
                check(tries == 35, ("32 recorded tries and the three that came back", tries))
            else:
                # Stopped: Esc (or the Stop button) keeps what was measured
                if index % 2:
                    page.locator("#exp-abort").click()
                else:
                    page.keyboard.press("Escape")
                wait_message(page)
            blocks[search] = {"records": run.records, "aborted": not whole, "granularity": None, "set": sets[n]}
            expected = expected_results(blocks)
            s = run.state()
            check(s["message"] and L["expDone" if whole else "expAborted"] in s["message"] and s["focus"] == "exp:expShowResults",
                  ("the end of the run", s["message"], s["focus"]))
            # Nothing is left to stop: no Stop button at the end or once stopped
            check(not s["stopShown"], ("no Stop at the end", s))
            # The dialog shows the most important sentence only (the comparison, else the one search, else why there is no slope);
            # the other sentences stand in the results area below
            check(s["results"] == expected["end"][language] and s["results"], ("the sentences in the dialog", s["results"], expected["end"][language]))
            if n == 0 or not whole:
                shoot("done" if whole else "stopped")
            page.keyboard.press("Enter" if n == 0 else "Escape")
            exp_closed(page, search)
            # The close event comes a moment after the dialog closes
            placed = f"""() => {{ const top = document.querySelector('[data-key="exp:start:{search}"]').closest('.start-row').getBoundingClientRect().top;
              return Math.abs(top) <= 12 || scrollY >= document.documentElement.scrollHeight - innerHeight - 1; }}"""
            try:
                wait_until(page, placed, timeout=2)
            except AssertionError:
                top = page.locator(f'[data-key="exp:start:{search}"]').evaluate("el => el.closest('.start-row').getBoundingClientRect().top")
                raise AssertionError(("the start button at the top, the results below", top, page.evaluate("() => [scrollY, innerHeight, "
                                      "document.documentElement.scrollHeight]")))
            expected = assert_results(page, width, language, blocks, f"results-{n}")
            summary[search] = {"whole": whole, "keys": expected["keys"], "tries": tries}
            assert_layout(page, width, f"results-{n}", layouts)
        if shots:
            # A short camouflage run on the same page: its results put the median of the feature search beside the comparison with charts
            # (both runs are whole in the light theme, so the median is there)
            lines = camo_contrast_check(page, language, touch, blocks["feature"]["records"])
            check(lines == 2 or theme == "dark", ("the median of the feature search after a whole run", lines))
        page.evaluate("() => document.getElementById('search-time-results').scrollIntoView({block: 'start'})")
        shoot("results")
        if shots:
            # The whole results area (the chart, the tables, the sentences and the research values), to read the sentences too
            SHOOTING["on"] = True
            try:
                page.locator("#search-time .search-results").screenshot(caret="initial", path=str(output / f"{name}-results-all.png"))
                page.wait_for_timeout(150)
            finally:
                SHOOTING["on"] = False
        # The "?" of the slope: one explanation, inside the screen
        help_button = page.locator("#search-time .res-table .term-help:visible")
        help_button.click()
        tips = tips_open(page)
        check(len(tips) == 1 and tips[0]["text"] == L["termSlopeMeaning"], ("the explanation of the slope", tips))
        assert_tip_inside(tips[0], "slope")
        page.keyboard.press("Escape")
        # Stop during the practice: nothing recorded, the dialog closes at once and the results stay
        exp_open(page, searches[0])
        page.keyboard.press("Enter")
        for step in (16, 510, 16, 600):
            page.clock.fast_forward(step)
        page.locator("#exp-abort").click()
        exp_closed(page, searches[0])
        assert_results(page, width, language, blocks, "after a stop in the practice")
        # Clear: nothing left, the focus on the heading of the results
        page.locator('[data-key="exp:clear"]').click()
        check(page.evaluate(ACTIVE)["id"] == "search-time-results", "the focus on the results heading after Clear")
        got = page.evaluate(RESULTS_STATE)
        check(got["none"] == [L["resNone"]] and not got["tables"] and not got["limits"] and got["clear"], ("cleared", got))
        if shots:
            # Without the results of the feature search, the camouflage results keep the comparison with charts alone
            contrast = page.evaluate(CAMO_RESULTS)["contrast"]
            check(contrast == [L["camoContrast"]], ("the camouflage results after Clear", contrast))
        if language == "en":
            text = page.evaluate("() => { const c = document.body.cloneNode(true); c.querySelectorAll('noscript').forEach(n => n.remove()); "
                                 "return c.textContent; }")
            check(not JAPANESE.search(text), ("Japanese on the English page", JAPANESE.findall(text)[:10]))
        assert_clean(errors, violations)
        return {"case": name, "status": "passed", "runs": summary, "layouts": len(layouts)}
    except Exception as error:
        try:
            shot(page, output / (name + "-failed.png"))
        except Exception:
            pass
        return {"case": name, "status": "failed", "error": str(error), "errors": errors, "violations": violations}
    finally:
        context.close()


# ===== The camouflage test (the second card of the Search time tab) =====
# The clock is held as for the search experiment. The page's seeds come from crypto.getRandomValues, which the test makes give the
# numbers from a start value, so the test knows the seed of each run and computes its rounds (the pattern and the cell of the moth
# shape of each) with AtlasCore in Node. The cell is also read from the scene (its first path is the moth shape: three points) and must
# be the computed one. The test keeps its own record of the tries and computes the table, the chart and the sentences with AtlasCore
# and AtlasView in Node; the page must show the same.
SEED_STUB = """((start) => { let n = start;
  Crypto.prototype.getRandomValues = function (a) { for (let i = 0; i < a.length; i += 1) a[i] = n++; return a; }; })"""
CAMO_STATE = """() => {
  const qa = window.__qa, svg = document.querySelector('#exp-stage > svg'), message = document.querySelector('.exp-message');
  const ellipses = svg.querySelectorAll('ellipse').length, moth = ellipses ? svg.querySelector('path') : null;
  let cell = null;
  if (moth) { const n = moth.getAttribute('d').match(/-?\\d+(?:\\.\\d+)?/g).map(Number), xs = [n[0], n[2], n[4]], ys = [n[1], n[3], n[5]];
    cell = Math.floor((Math.min(...ys) + Math.max(...ys)) / 2 / 60) * 6 + Math.floor((Math.min(...xs) + Math.max(...xs)) / 2 / 60); }
  const live = document.querySelector('#exp-feedback [aria-live]'), grid = document.querySelector('.camo-grid');
  return {shows: qa.shows, ellipses, cell, mothPoints: moth ? moth.getAttribute('d').match(/[ML]/g).length : 0,
    marked: svg.querySelectorAll('.camo-mark').length, fixation: svg.querySelectorAll('.fixation').length,
    progress: document.getElementById('exp-progress').textContent, feedback: live ? live.textContent : '',
    message: message.hidden ? null : message.textContent, results: Array.from(document.querySelectorAll('.exp-results p'), p => p.textContent),
    focus: (document.activeElement.dataset || {}).key || document.activeElement.id, gridShown: !grid.hidden && grid.getClientRects().length > 0,
    spots: Array.from(document.querySelectorAll('.camo-spot'), b => b.tabIndex),
    t0: qa.shownAt === null ? null : (qa.frames.find(f => f > qa.shownAt) ?? null),
    pressed: qa.presses.length ? qa.presses[qa.presses.length - 1] : null, open: document.getElementById('exp-dialog').open,
    answersHidden: document.getElementById('exp-absent').hidden && document.getElementById('exp-present').hidden,
    stopShown: document.getElementById('exp-abort').getClientRects().length > 0};
}"""
CAMO_LAYOUT = """() => {
  const box = el => { const r = el.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width,
    height: r.height}; };
  const d = document.getElementById('exp-dialog');
  return {stage: box(document.getElementById('exp-stage')), grid: box(document.querySelector('.camo-grid')),
    svg: box(document.querySelector('#exp-stage > svg')), abort: box(document.getElementById('exp-abort')), title: box(document.getElementById('exp-title')),
    feedback: box(document.getElementById('exp-feedback')), spots: Array.from(document.querySelectorAll('.camo-spot'), box),
    answers: ['exp-absent', 'exp-present'].map(id => document.getElementById(id).getClientRects().length),
    scrollW: d.scrollWidth, clientW: d.clientWidth, innerW: innerWidth, innerH: innerHeight, modal: d.matches(':modal'),
    buttons: Array.from(d.querySelectorAll('button'), b => b.id || (b.dataset || {}).key), terms: d.querySelectorAll('.term, .term-help').length,
    page: document.documentElement.scrollWidth, client: document.documentElement.clientWidth};
}"""
# The card: the places of the small figure and of its sentence (page coordinates), its texts, its shapes and the pressed buttons
CAMO_CARD = """() => {
  const card = document.getElementById('search-camo'), top = el => el.getBoundingClientRect().top + scrollY;
  const svg = card.querySelector('.use-figure svg'), b = svg.getBoundingClientRect();
  return {figure: top(svg), width: b.width, height: b.height, read: top(card.querySelector('.read-stack')),
    readText: card.querySelector('.read-live').textContent.trim(),
    linked: card.querySelector('.use-linked > p:not([aria-hidden])').textContent.trim(), desc: svg.querySelector('desc').textContent.trim(),
    marks: svg.querySelectorAll('.camo-mark').length, ellipses: Array.from(svg.querySelectorAll('ellipse'), e => e.getAttribute('cx')).join(' '),
    paths: Array.from(svg.querySelectorAll('path'), p => p.getAttribute('class') + ' ' + p.getAttribute('d')).join('|'),
    pressed: Array.from(card.querySelectorAll('.controls button[aria-pressed=true]'), x => x.dataset.key),
    terms: card.querySelectorAll('#search-camo-title .term').length};
}"""
CAMO_RESULTS = """() => {
  const shown = el => !!el && el.getClientRects().length > 0, text = el => el.textContent.trim();
  const card = document.getElementById('search-camo'), chart = card.querySelector('svg.camo-chart');
  return {none: Array.from(card.querySelectorAll('.res-none'), text),
    tables: Array.from(card.querySelectorAll('.camo-table')).filter(shown).map(t => ({caption: t.caption ? text(t.caption) : null,
      heads: Array.from(t.tHead.rows[0].cells, text), rows: Array.from(t.tBodies[0].rows, r => Array.from(r.cells, text))})),
    texts: Array.from(card.querySelectorAll('.camo-results .res-texts:not(.camo-contrast) p'), text),
    research: Array.from(card.querySelectorAll('.camo-research p'), text), contrast: Array.from(card.querySelectorAll('.camo-contrast p'), text),
    note: Array.from(card.querySelectorAll('.camo-results .res-excluded-note'), text),
    bars: chart ? chart.querySelectorAll('rect').length : null, dots: chart ? chart.querySelectorAll('circle').length : null,
    chartTexts: chart ? Array.from(chart.querySelectorAll('text'), text) : [], clear: card.querySelector('[data-key="camo:clear"]').disabled};
}"""
CAMO_TRIALS_JS = """const C = require(process.argv[1] + '/atlas-core.js');
process.stdout.write(JSON.stringify(C.makeCamoTrials({ rng: C.xorshift32(Number(process.argv[2]) >>> 0 || 1) })));"""
CAMO_EXPECT_JS = r"""
const [root, input] = [process.argv[1], require('fs').readFileSync(0, 'utf8')];
const C = require(root + '/atlas-core.js'), V = require(root + '/atlas-view.js'), M = require(root + '/messages.js');
const q = JSON.parse(input);
const summary = q.records.length ? C.summarizeCamo(q.records, { aborted: q.aborted }) : null;
const feature = q.feature ? C.summarizeBlock(q.feature) : null;
const cases = C.camoResultCases(summary), out = { keys: cases.map((c) => c.key), texts: {}, rows: {}, contrast: {} };
for (const lang of ['ja', 'en']) {
  const none = M[lang].resNoValue, value = (x) => (x === null ? none : String(x));
  out.texts[lang] = V.camoResultTexts(M, lang, cases);
  out.rows[lang] = V.camoResultRows(summary).map((r) => [M[lang][r.labelKey], value(r.median), value(r.valid), value(r.notFound), value(r.wrong)]);
  out.contrast[lang] = V.camoContrastTexts(M, lang, feature);
}
out.bars = summary ? C.CAMO_PATTERNS.filter((p) => summary.rows[p].median !== null).length : 0;
out.dots = summary ? C.CAMO_PATTERNS.reduce((n, p) => n + summary.rows[p].valid, 0) : 0;
process.stdout.write(JSON.stringify(out));
"""


def camo_trials(seed):
    out = subprocess.run(["node", "-e", CAMO_TRIALS_JS, str(ROOT), str(seed)], capture_output=True, check=True, encoding="utf-8").stdout
    return json.loads(out)


def camo_expected(records, aborted, feature=None):
    query = {"records": records, "aborted": aborted, "feature": feature}
    out = subprocess.run(["node", "-e", CAMO_EXPECT_JS, str(ROOT)], input=json.dumps(query), capture_output=True, check=True,
                         encoding="utf-8").stdout
    return json.loads(out)


# The times of the right taps (ms) for each pattern, and a small fixed spread. The designs give other result sentences (longer and
# sooner, no clear difference, longer for the symmetric pattern)
CAMO_DESIGNS = ({"match": 1500, "disrupt": 2400, "symmetric": 1000}, {"match": 1800, "disrupt": 1900, "symmetric": 1700},
                {"match": 1200, "disrupt": 1300, "symmetric": 2600})
CAMO_SPREAD = (0, 48, -32, 96, -64, 16, 32, -16)


class CamoRun:
    """Drives the camouflage test with the clock held and keeps the test's own record of the recorded tries. rounds: the rounds
    computed from the seed (None: the cell of each round is read from the scene, and the pattern is not known)."""

    # The steps of the clock to the next scene (ms, a frame each): after a right spot or a press too early, the end of the result line
    # (500); after a wrong spot or a time-out, the end of the mark (1,000); then the end of the pause (300) and the fixation point (500)
    AFTER = {"short": (510, 310, 16, 510), "mark": (1010, 310, 16, 510)}

    def __init__(self, page, language, touch, rounds=None):
        self.page, self.L, self.touch = page, M[language], touch
        self.rounds = {k: [dict(r) for r in rounds[k]] for k in ("practice", "main")} if rounds else None
        self.block, self.index, self.records, self.skip, self.shows = "practice", 0, [], (510,), 0

    def state(self):
        return self.page.evaluate(CAMO_STATE)

    def forward(self, *steps):
        for step in steps:
            self.page.clock.fast_forward(step)

    def wait_scene(self):
        """Moves the clock to the next scene; None when a message takes the place of the square instead."""
        before = self.shows
        self.forward(*self.skip)
        for _ in range(60):
            s = self.state()
            self.shows = s["shows"]
            if s["shows"] > before:
                return s
            if s["message"] is not None:
                return None
            self.forward(100)
        raise AssertionError("the scene did not come")

    def tap(self, cell, how):
        b = self.page.locator(f'[data-key="camo:spot:{cell}"]').bounding_box()
        x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
        if how == "tap" and self.touch:
            self.page.touchscreen.tap(x, y)
            return "touch"
        self.page.mouse.click(x, y)
        return "mouse"

    def keys_to(self, cell):
        """From the starting spot (row 2, column 2, counted from 0) with the arrow keys, then Enter."""
        row, col = divmod(cell, 6)
        for key, count in (("ArrowDown" if row > 2 else "ArrowUp", abs(row - 2)), ("ArrowRight" if col > 2 else "ArrowLeft", abs(col - 2))):
            for _ in range(count):
                self.page.keyboard.press(key)
        check(self.page.evaluate(ACTIVE)["key"] == f"camo:spot:{cell}", ("the arrow keys reach the spot", cell, self.page.evaluate(ACTIVE)))
        self.page.keyboard.press("Enter")
        return "key"

    def trial(self, kind, rt=1200, how="mouse", seen=None):
        """One try: kind = right, wrong, early (at once), timeout or hidden. Returns the scene, or None at the end of the block."""
        s = self.wait_scene()
        if s is None:
            return None
        current = self.rounds[self.block][self.index] if self.rounds else {"pattern": None, "cell": s["cell"]}
        check(s["cell"] == current["cell"] and s["mothPoints"] == 3, ("the moth shape in the cell of the round", s["cell"], current))
        check(s["ellipses"] == 1800 and s["fixation"] == 0 and s["marked"] == 0 and s["gridShown"] and s["answersHidden"], ("the scene", s))
        check(s["spots"].count(0) == 1 and s["spots"][14] == 0 and s["focus"] == "camo:spot:14", ("the starting spot takes the focus", s))
        if seen:
            seen(s)
        record = {"pattern": current["pattern"], "target": current["cell"], "requeued": bool(current.get("requeued"))}
        after = "short"
        if kind in ("right", "wrong"):
            # The display starts at the frame after the one that showed it; the tap comes rt later
            self.forward(16, rt)
            cell = current["cell"] if kind == "right" else (current["cell"] + 7) % 36
            record["cell"], record["input"] = cell, self.keys_to(cell) if how == "key" else self.tap(cell, how)
            a = self.state()
            real = a["pressed"] - a["t0"]
            check(abs(real - rt) < 17, ("the time of the tap", rt, real))
            record["rt"], record["outcome"] = real, "correct" if kind == "right" else "wrong"
            if kind == "right":
                check(a["feedback"] == self.L["camoFbCorrect"] and a["ellipses"] == 0, ("right: the scene goes away", a["feedback"]))
            else:
                check(a["feedback"] == self.L["camoFbWrong"] and a["ellipses"] == 1800 and a["marked"] == 1, ("wrong: the mark", a["feedback"]))
                after = "mark"
        elif kind == "timeout":
            self.forward(16, 9990)
            check(self.state()["feedback"] == "", "still searching at 9,990 ms")
            self.forward(20)
            a = self.state()
            check(a["feedback"] == self.L["camoFbTimeout"] and a["marked"] == 1 and a["ellipses"] == 1800, ("time is up at 10 s: the mark", a))
            record.update(outcome="timeout", rt=10000, cell=None, input=None)
            after = "mark"
        elif kind == "early":
            self.page.keyboard.press("Enter")
            check(self.state()["feedback"] == self.L["fbEarly"] and self.state()["ellipses"] == 0, "too early")
            record.update(outcome="early", rt=0, cell=14, input="key")
        elif kind == "hidden":
            self.page.evaluate("""() => { Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
              Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'});
              document.dispatchEvent(new Event('visibilitychange')); }""")
            a = self.state()
            check(a["message"] and self.L["expHidden"] in a["message"] and not a["gridShown"] and a["focus"] == "exp:expResume", ("paused", a))
            self.page.evaluate("""() => { delete document.hidden; delete document.visibilityState;
              document.dispatchEvent(new Event('visibilitychange')); }""")
            self.forward(400, 400)
            check(self.state()["message"] is not None, "paused until Resume")
            self.page.keyboard.press("Enter")
            record.update(outcome="hidden", rt=None, cell=None, input=None)
        if self.rounds and kind in ("early", "hidden") and not current.get("requeued"):
            self.rounds[self.block].append({**current, "requeued": True})
        self.skip = (16, 510) if kind == "hidden" else self.AFTER[after]
        self.records.append(record)
        self.index += 1
        return s

    def practice(self, seen=None):
        """Start, the fixation point, the three practice tries (a key answer, a wrong spot, a time-out), then Continue."""
        L = self.L
        self.page.keyboard.press("Enter")
        self.forward(16)
        s = self.state()
        check(s["message"] is None and s["fixation"] == 2 and s["progress"] == fill(L["camoExpPractice"], i=1), ("the fixation point", s))
        check(s["focus"] == "camo:spot:14" and s["gridShown"], ("the focus on the starting spot", s["focus"]))
        self.skip = (510,)
        for i, (kind, how) in enumerate((("right", "key"), ("wrong", "tap"), ("timeout", None))):
            s = self.trial(kind, rt=1400 + 160 * i, how=how, seen=seen if i == 0 else None)
            check(s is not None and s["progress"] == fill(L["camoExpPractice"], i=i + 1), ("practice progress", i, s and s["progress"]))
        check(self.wait_scene() is None, "three practice tries")
        s = self.state()
        check(s["message"] and L["expPracticeDone"] in s["message"] and s["focus"] == "exp:expContinue", ("practice done", s["message"]))
        self.records.clear()
        self.block, self.index = "main", 0
        self.page.keyboard.press("Enter")
        self.skip = (16, 510)

    def recorded(self, design, mixed=False, stop_after=None, seen=None):
        """The recorded tries: the design's times, a wrong spot, a time-out, a press too early (whole runs) and a key answer (mixed).
        stop_after: the number of tries before stopping (None: to the end). Returns the number of tries."""
        tries = 0
        for i in range(30):
            if stop_after is not None and i == stop_after:
                break
            kind = "wrong" if i == 2 else "timeout" if i == 6 else "early" if i == 9 else "right"
            how = "key" if mixed and i == 4 else "tap" if i % 2 else "mouse"
            current = self.rounds["main"][self.index] if self.rounds and self.index < len(self.rounds["main"]) else None
            rt = max(240, round((design[current["pattern"]] if current else 1500) + CAMO_SPREAD[i % len(CAMO_SPREAD)]) // 16 * 16)
            s = self.trial(kind, rt=rt, how=how, seen=seen if i == 1 else None)
            if s is None:
                break
            if i == 0:
                check(s["progress"] == fill(self.L["camoExpMain"], i=1), ("the first recorded try", s["progress"]))
            tries += 1
        return tries


def camo_open(page):
    page.locator('[data-key="camo:start"]').click()
    s = page.evaluate(CAMO_STATE)
    check(page.locator("#exp-dialog").evaluate("el => el.open && el.matches(':modal')"), "a modal dialog")
    check(s["focus"] == "exp:expStart" and s["answersHidden"] and not s["gridShown"], ("the focus on Start, no answer buttons", s))
    return s


def camo_closed(page):
    """The dialog is closed and the focus is back on the button that opened it."""
    wait_until(page, "() => !document.getElementById('exp-dialog').open")
    try:
        wait_until(page, "() => (document.activeElement.dataset || {}).key === 'camo:start'", timeout=2)
    except AssertionError:
        raise AssertionError(("the focus back on the start button", page.evaluate(ACTIVE)))


def assert_camo_layout(page, name, layouts, trial=True):
    """The square of the scene at the size of the spec with the 6 × 6 spots over it (44px or more), Stop inside the screen, no answer
    buttons, no sideways scroll, no theme or language button and no explanation of a term in the dialog."""
    m = page.evaluate(CAMO_LAYOUT)
    portrait = m["innerH"] >= m["innerW"]
    side = min(m["innerW"] - 32, m["innerH"] - 200, 360) if portrait else min(m["innerH"] - 48, m["innerW"] - 288, 360)
    check(abs(m["stage"]["width"] - side) <= 1 and (abs(m["stage"]["height"] - side) <= 1 or not trial and m["stage"]["height"] > side),
          (name, "the square", side, m["stage"]))
    check(m["modal"] and m["scrollW"] <= m["clientW"] and m["page"] <= m["client"], (name, "no sideways scroll", m))
    check(m["answers"] == [0, 0], (name, "no answer buttons", m["answers"]))
    for key in ("abort", "title") + (("stage", "feedback") if trial else ()):
        b = m[key]
        check(b["left"] >= -0.5 and b["right"] <= m["innerW"] + 0.5 and b["top"] >= -0.5 and b["bottom"] <= m["innerH"] + 0.5,
              (name, key, "inside the screen", b))
    check(m["abort"]["height"] + 1e-3 >= 44 and m["abort"]["width"] + 1e-3 >= 44, (name, "Stop 44px", m["abort"]))
    if trial:
        for key in ("left", "top", "width", "height"):
            check(abs(m["grid"][key] - m["svg"][key]) <= 1, (name, "the spots over the scene", m["grid"], m["svg"]))
        check(len(m["spots"]) == 36 and all(b["width"] + 1e-3 >= 44 and b["height"] + 1e-3 >= 44 for b in m["spots"]), (name, "spots 44px", m["spots"][0]))
        check(abs(m["spots"][7]["left"] - m["grid"]["left"] - side / 6) <= 1 and abs(m["spots"][7]["top"] - m["grid"]["top"] - side / 6) <= 1,
              (name, "six spots a row", m["spots"][7]))
    check(not any(b in ("theme", "language", "help") for b in m["buttons"]), (name, "no theme or language button", m["buttons"]))
    check(m["terms"] == 0, (name, "no term explanations in the test"))
    layouts.append({"state": name, "side": side})


def assert_camo_results(page, width, language, expected, name):
    """The card shows the values that AtlasCore computes from the test's own record: the table (two tables below 720px), the chart,
    what a valid round is, the sentences, what studies have found and the comparison with charts."""
    got, L = page.evaluate(CAMO_RESULTS), M[language]
    rows = expected["rows"][language]
    if width < 720:
        check([t["caption"] for t in got["tables"]] == [L["camoTableMedian"], L["camoTableMisses"]], (name, "two tables below 720px", got["tables"]))
        check(got["tables"][0]["rows"] == [r[:3] for r in rows], (name, "medians and valid rounds", got["tables"][0]["rows"], rows))
        check(got["tables"][1]["rows"] == [[r[0], r[3], r[4]] for r in rows], (name, "not found and wrong spots", got["tables"][1]["rows"]))
    else:
        check(len(got["tables"]) == 1 and got["tables"][0]["caption"] is None, (name, "one table from 720px", got["tables"]))
        check(got["tables"][0]["heads"] == [L[k] for k in ("camoColPattern", "camoColMedian", "camoColValid", "camoColNotFound", "camoColWrong")],
              (name, "the heads of the table", got["tables"][0]["heads"]))
        check(got["tables"][0]["rows"] == rows, (name, "the table", got["tables"][0]["rows"], rows))
    check(got["texts"] == expected["texts"][language], (name, "the sentences", got["texts"], expected["texts"][language]))
    check(got["research"] == [L["camoResearchHeading"], L["camoResearch"]], (name, "what studies have found", got["research"]))
    check(got["contrast"] == expected["contrast"][language], (name, "charts and camouflage", got["contrast"], expected["contrast"][language]))
    check(got["note"] == [L["camoValidNote"]], (name, "what a valid round is", got["note"]))
    check(got["bars"] == expected["bars"] and got["dots"] == expected["dots"], (name, "bars and dots", got["bars"], got["dots"], expected))
    check(got["chartTexts"] == [L["camoResAxis"]] + [L[f"ctl.search-camo.pattern.{p}"] for p in ("match", "disrupt", "symmetric")]
          + ["0", "2", "4", "6", "8", "10"], (name, "the names of the patterns and the scale", got["chartTexts"]))
    check(not got["clear"] and not got["none"], (name, "Clear is on", got))


def camo_contrast_check(page, language, touch, feature_records):
    """A short camouflage run (the practice and one recorded try, then Stop) on the page of the search experiment: the cell of each
    round is read from the scene. Its results put the median of the "present" rounds of the feature search beside the comparison."""
    camo_open(page)
    run = CamoRun(page, language, touch)
    run.practice()
    run.recorded(CAMO_DESIGNS[0], stop_after=1)
    page.keyboard.press("Escape")
    wait_message(page)
    s = run.state()
    check(s["message"] and M[language]["expAborted"] in s["message"], ("stopped", s["message"]))
    page.keyboard.press("Enter")
    camo_closed(page)
    # Two sentences when the feature search gave a median of its "present" rounds (3 valid rounds or more), else the first one alone
    expected = camo_expected([], True, feature=feature_records)
    contrast = page.evaluate(CAMO_RESULTS)["contrast"]
    check(contrast == expected["contrast"][language], ("the median of the feature search", contrast, expected["contrast"]))
    return len(contrast)


def camo_card_checks(page, language, width, layouts):
    """The card: its texts, the terms of its title, the two controls (each pattern changes the small figure and its sentence; the mark
    draws the dashed mark), and nothing below moves."""
    L, entry = M[language], ENTRY["search-camo"]
    check(page.locator("#search-camo-title").evaluate(VISIBLE_TEXT) == L["item.search-camo.title"], "the title")
    check(page.locator("#search-camo .entry-oneline").inner_text().strip() == L["item.search-camo.oneLine"], "what it is")
    check(page.locator("#search-camo .entry-howto").inner_text().strip() == L["item.search-camo.howTo"], "how to use it")
    check(page.locator("#search-camo .uses-heading").inner_text().strip() == L["usesHeadingHide"], "the heading of the small figure")
    check([n.strip() for n in page.locator("#search-camo .search-note").all_inner_texts()] == [L["camoDuration"], L["camoReplace"]], "the notes")
    check(page.locator("#search-camo .gap-head").inner_text().strip() == L["camoGapHeading"], "how it differs from the studies")
    check(page.locator("#search-camo .res-none").inner_text().strip() == L["camoResNone"] and page.locator('[data-key="camo:clear"]').is_disabled(),
          "nothing measured yet")
    hrefs = page.locator("#search-camo .entry-sources a").evaluate_all("els => els.map(a => a.getAttribute('href'))")
    for doi in ("10.1098/rspb.2007.0153", "10.1098/rsbl.2013.0501", "10.1098/rspb.2005.3438", "10.1098/rstb.2016.0341"):
        check("https://doi.org/" + doi in hrefs, ("the sources", doi, hrefs))
    use = entry["uses"][0]
    values = {c["id"]: c["default"] for c in entry["controls"]}
    first = page.evaluate(CAMO_CARD)
    check(first["terms"] == 2 and abs(first["width"] - first["height"]) <= 1, ("two terms in the title, a square figure", first))
    check(sorted(first["pressed"]) == ["ctl:search-camo:mark:off", "ctl:search-camo:pattern:match"], ("the first values", first["pressed"]))

    def follow(name):
        now = page.evaluate(CAMO_CARD)
        check(abs(now["figure"] - first["figure"]) <= 1 and abs(now["read"] - first["read"]) <= 1, (name, "nothing moves", first, now))
        check(now["readText"] == L[f"camoRead.{values['pattern']}"], (name, "the sentence of the pattern", now["readText"]))
        check(now["linked"] == expected_linked("search-camo", use, values, language), (name, "the controls that change it", now["linked"]))
        check(now["desc"] == expected_desc("search-camo", "hide", values, language), (name, "the description", now["desc"]))
        check(now["marks"] == (1 if values["mark"] == "on" else 0), (name, "the mark", now["marks"]))
        check(now["ellipses"] == first["ellipses"], (name, "the background stays the same"))
        return now
    follow("first values")
    seen = {}
    for pattern in ("disrupt", "symmetric", "match"):
        page.locator(f'[data-key="ctl:search-camo:pattern:{pattern}"]').click()
        values["pattern"] = pattern
        seen[pattern] = follow("pattern " + pattern)["paths"]
    check(len(set(seen.values())) == 3, "each pattern draws its own object")
    check(seen["match"] == first["paths"], "the first pattern draws the first object again")
    page.locator('[data-key="ctl:search-camo:mark:on"]').click()
    values["mark"] = "on"
    follow("mark on")
    assert_layout(page, width, "camo-card", layouts)
    page.locator('[data-key="ctl:search-camo:mark:off"]').click()
    values["mark"] = "off"
    follow("mark off")
    # The tab has two cards now: "Entries in this tab" moves to the camouflage card and back
    page.locator('[data-key="nav:search-camo"]').click()
    check(at_top(page, "#search-camo") and page.evaluate("() => document.activeElement.id") == "search-camo", "the list moves to the card")
    page.locator('[data-key="back:search-camo"]').click()
    check(page.evaluate(ACTIVE)["key"] == "nav:search-camo", "back at the list")


def camo_case(browser, browser_name, url, width, height, language, theme, output, index):
    """The camouflage card and its test with the clock held: the card and its controls, Esc before the start, the practice (a key
    answer, a wrong spot and a time-out), the recorded tries whole (with a wrong spot, a time-out, a press too early and a key
    answer) or stopped, the results against AtlasCore, and Clear."""
    name = f"{browser_name}-{width}-{language}-{theme}-camo"
    touch = browser_name == "chromium" and width < 720
    context = new_context(browser, browser_name, width, height, language, theme)
    page = context.new_page()
    errors, violations = observe(page, url)
    seed = 7000 + 10 * index
    page.clock.install()
    page.add_init_script(TIMESTAMP_SHIM)
    page.add_init_script(EXP_PROBE)
    page.add_init_script(SEED_STUB + f"({seed});")
    layouts, shots = [], width in (390, 1280)

    def shoot(label):
        if shots:
            shot(page, output / f"{name}-{label}.png")
    try:
        page.goto(set_language_query(url, language), wait_until="load")
        check(page.evaluate("() => document.documentElement.dataset.appReady") == "true", "ready")
        page.clock.pause_at(page.evaluate("() => Date.now()") / 1000 + 1)
        L = M[language]
        page.locator("#tab-search").click()
        camo_card_checks(page, language, width, layouts)
        page.evaluate("() => document.getElementById('search-camo').scrollIntoView({block: 'start'})")
        shoot("card")
        # Esc before the start (the first seed): the dialog closes and nothing is measured
        camo_open(page)
        message = page.evaluate(CAMO_STATE)["message"]
        check(L["camoExpInstr"] in message and L["camoExpKeys"] in message and L["camoSampleMoth"] in message, ("before the start", message))
        check(page.locator("#exp-title").inner_text().strip() == L["camoExpTitle"] and page.locator(".exp-message svg.sample").count() == 1, "title, sample")
        assert_camo_layout(page, "ready", layouts, trial=False)
        shoot("ready")
        page.keyboard.press("Escape")
        camo_closed(page)
        check(page.locator('[data-key="camo:clear"]').is_disabled(), "still nothing measured")
        # The run (the second seed)
        whole = width in (390, 1280)
        design = CAMO_DESIGNS[index % len(CAMO_DESIGNS)]
        camo_open(page)
        run = CamoRun(page, language, touch, camo_trials(seed + 1))
        run.practice(seen=lambda s: (assert_camo_layout(page, "practice", layouts), shoot("practice")))
        tries = run.recorded(design, mixed=index % 2 == 1, stop_after=None if whole else 4,
                             seen=lambda s: (assert_camo_layout(page, "recorded", layouts), shoot("recorded")))
        if whole:
            check(tries == 16, ("15 recorded tries and the one too early that came back", tries))
        elif index % 4 < 2:
            page.keyboard.press("Escape")
        else:
            page.locator("#exp-abort").click()
        if not whole:
            wait_message(page)
        expected = camo_expected(run.records, not whole)
        s = run.state()
        check(s["message"] and L["expDone" if whole else "expAborted"] in s["message"] and s["focus"] == "exp:expShowResults",
              ("the end of the run", s["message"], s["focus"]))
        check(not s["stopShown"] and not s["gridShown"], ("no Stop and no spots at the end", s))
        check(s["results"] == expected["texts"][language], ("the sentences in the dialog", s["results"], expected["texts"][language]))
        shoot("done" if whole else "stopped")
        page.keyboard.press("Enter")
        camo_closed(page)
        placed = """() => { const top = document.querySelector('[data-key="camo:start"]').closest('.start-row').getBoundingClientRect().top;
          return Math.abs(top) <= 12 || scrollY >= document.documentElement.scrollHeight - innerHeight - 1; }"""
        try:
            wait_until(page, placed, timeout=2)
        except AssertionError:
            raise AssertionError(("the start button at the top, the results below", page.evaluate("() => scrollY")))
        assert_camo_results(page, width, language, expected, "results")
        assert_layout(page, width, "camo-results", layouts)
        page.evaluate("() => document.getElementById('search-camo-results').scrollIntoView({block: 'start'})")
        shoot("results")
        # Clear: nothing left, the focus on the heading of the results
        page.locator('[data-key="camo:clear"]').click()
        check(page.evaluate(ACTIVE)["id"] == "search-camo-results", "the focus on the results heading after Clear")
        got = page.evaluate(CAMO_RESULTS)
        check(got["none"] == [L["camoResNone"]] and not got["tables"] and got["clear"], ("cleared", got))
        if language == "en":
            text = page.evaluate("() => { const c = document.body.cloneNode(true); c.querySelectorAll('noscript').forEach(n => n.remove()); "
                                 "return c.textContent; }")
            check(not JAPANESE.search(text), ("Japanese on the English page", JAPANESE.findall(text)[:10]))
        assert_clean(errors, violations)
        return {"case": name, "status": "passed", "tries": tries, "keys": expected["keys"], "layouts": len(layouts)}
    except Exception as error:
        try:
            shot(page, output / (name + "-failed.png"))
        except Exception:
            pass
        return {"case": name, "status": "failed", "error": str(error), "errors": errors, "violations": violations}
    finally:
        context.close()


# ===== Why it happens, "Predict before you try" and the questions at the end of each tab =====
# The "why" of an entry: its heading and sentence, the look of its heading beside the heading of the small figures, and where it stands
WHY_STATE = """id => { const c = document.getElementById(id), w = c.querySelector('.entry-why'), h = w.querySelector('h4');
  const box = el => el ? (r => ({top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left}))(el.getBoundingClientRect()) : null;
  const look = el => { const s = getComputedStyle(el); return [s.fontSize, s.fontWeight, s.lineHeight, s.color]; };
  return {count: c.querySelectorAll('.entry-why').length, tag: h.tagName, heading: h.textContent.trim(),
    text: w.querySelector('.why-text').textContent.trim(), look: look(h), usesLook: look(c.querySelector('.uses-heading')), why: box(w),
    read: box(c.querySelector('.entry-read')), uses: box(c.querySelector('.entry-uses')), inTexts: !!w.closest('.use-texts'),
    before: w.previousElementSibling ? w.previousElementSibling.className : null, after: w.nextElementSibling ? w.nextElementSibling.className : null}; }"""
# The prediction of an entry: the box, its question and choices (the key, aria-pressed and the text of each), the two lines read aloud, the
# button to the answer, and what stands right before and after the box
PREDICT_STATE = """id => { const c = document.getElementById(id), box = c.querySelector('details.predict'), text = el => el ? el.textContent.trim() : '';
  const reveal = box.querySelector('.predict-reveal'), group = box.querySelector('.predict-choices');
  return {count: c.querySelectorAll('details.predict').length, open: box.open, summary: text(box.querySelector('summary')),
    question: text(box.querySelector('.predict-question')),
    named: group.getAttribute('role') === 'group' && group.getAttribute('aria-labelledby') === box.querySelector('.predict-question').id,
    choices: Array.from(group.querySelectorAll('button'), b => [b.dataset.key, b.getAttribute('aria-pressed'), text(b)]),
    chosen: Array.from(box.querySelectorAll('.predict-chosen p'), text), answer: Array.from(box.querySelectorAll('.predict-answer p'), text),
    live: [box.querySelector('.predict-chosen').getAttribute('aria-live'), box.querySelector('.predict-answer').getAttribute('aria-live')],
    reveal: !reveal.hidden && reveal.getClientRects().length > 0, revealText: text(reveal),
    prev: box.previousElementSibling.className, next: box.nextElementSibling.className}; }"""
# The sizes (width and height) of the figures and of the sentences of a card, to compare before and after a choice
CARD_SIZES = """id => { const c = document.getElementById(id), size = el => el ? (r => [r.width, r.height])(el.getBoundingClientRect()) : null;
  return {frame: size(c.querySelector('.figure-frame')), read: size(c.querySelector('.read-stack')), why: size(c.querySelector('.entry-why')),
    uses: Array.from(c.querySelectorAll('.use-figure svg'), size)}; }"""
# A question: its figures (box, viewBox, hidden or not, the number of shapes), the one named figure with its title and description, the
# names A and B, the note above the figure, the question, the choices and the answer read aloud
CHECK_STATE = """id => { const item = document.getElementById('check-' + id), text = el => el ? el.textContent.trim() : '';
  const svgs = Array.from(item.querySelectorAll('svg.check-svg')), images = item.querySelectorAll('svg[role="img"]');
  const group = item.querySelector('.check-choices'), image = images[0];
  return {svgs: svgs.map(s => (r => [r.left, r.top, r.width, r.height])(s.getBoundingClientRect())), viewBoxes: svgs.map(s => s.getAttribute('viewBox')),
    hidden: svgs.map(s => s.getAttribute('aria-hidden')), shapes: svgs.map(s => s.querySelectorAll(':scope > :not(title):not(desc)').length),
    images: images.length, title: image ? text(image.querySelector('title')) : null, desc: image ? text(image.querySelector('desc')) : null,
    named: !!image && image.getAttribute('aria-labelledby') === image.querySelector('title').id
      && image.getAttribute('aria-describedby') === image.querySelector('desc').id,
    labels: Array.from(item.querySelectorAll('.check-label'), p => [text(p), p.getAttribute('aria-hidden')]), note: text(item.querySelector('.check-note')),
    question: text(item.querySelector('.check-question')),
    grouped: group.getAttribute('role') === 'group' && group.getAttribute('aria-labelledby') === item.querySelector('.check-question').id,
    choices: Array.from(group.querySelectorAll('button'), b => { const mark = b.querySelector(':scope > .check-mark');
      const label = Array.from(b.childNodes).filter(n => n !== mark).map(n => n.textContent).join('').trim();
      return [b.dataset.key, b.getAttribute('aria-pressed'), label, mark ? mark.textContent : null, b.dataset.verdict || null,
        mark ? mark.getAttribute('aria-hidden') : null]; }),
    feedback: Array.from(item.querySelectorAll('.check-feedback p'), text), live: item.querySelector('.check-feedback').getAttribute('aria-live')}; }"""
# The box of the questions of a tab: its heading, its list, and what stands before and after it in the panel
CHECK_BOX = """group => { const box = document.getElementById('box-checks-' + group), kids = Array.from(document.getElementById('body-' + group).children);
  const at = kids.indexOf(box), first = el => el.className.split(' ')[0];
  return {heading: box.querySelector('h3').textContent.trim(), labelled: box.getAttribute('aria-labelledby') === box.querySelector('h3').id,
    list: box.querySelector('ol').getAttribute('role'), items: Array.from(box.querySelectorAll(':scope > ol > li'), li => li.id.replace(/^check-/, '')),
    before: kids.slice(0, at).map(first), after: kids.slice(at + 1).map(first)}; }"""
CHECKS = {g["id"]: g.get("checks", []) for g in DATA["groups"]}
CHECK_VIEWBOX = {"barChart": "0 0 200 150", "lineChart": "0 0 200 150", "groupedBars": "0 0 200 150", "scatter": "0 0 200 150",
                 "heatmap": "0 0 200 150", "camoScene": "0 0 200 150", "baselineChart": "0 0 320 240", "dualAxisChart": "0 0 320 240",
                 "camoResultChart": "0 0 280 176"}


def check_why(page, entry, language, width):
    """Why it happens: one heading (h4, in the look of the heading of the small figures) and the sentence of the entry. From 720px right
    under the sentences of the entry, below 720px after the small figures; the two tests put it under the sentence of their small figure."""
    L, card = M[language], entry["id"]
    w = page.evaluate(WHY_STATE, card)
    check(w["count"] == 1 and w["tag"] == "H4" and w["heading"] == L["whyHeading"] and w["text"] == L[f"item.{card}.why"], (card, "why", w))
    check(w["look"] == w["usesLook"], (card, "the heading in the look of the heading of the small figures", w["look"], w["usesLook"]))
    if entry.get("experiment"):
        # The sentence of the small figure of Search time changes with its view (a stack of its sentences keeps its height)
        check(w["inTexts"] and w["before"] == ("stack read-stack use-read" if card == "search-camo" else "stack use-text")
              and w["after"] == ("use-note" if card == "search-camo" else None), (card, "under the sentence of the small figure", w))
    elif width >= 720:
        gap = w["why"]["top"] - w["read"]["bottom"]
        check(-1 <= gap <= 24 and abs(w["why"]["left"] - w["read"]["left"]) <= 1, (card, "right under the sentences", gap, w))
    else:
        check(w["uses"]["bottom"] - 1 <= w["why"]["top"] and w["before"] == "entry-uses", (card, "after the small figures", w))


def check_prediction(page, entry, language, keyboard):
    """"Predict before you try" under how to use the entry and above its controls: closed at first; opened, the question and the choices
    (none pressed); a wrong choice says what was chosen and offers the answer; the answer gives the right choice and why; the right choice
    then hides the answer again; the same choice again changes nothing. With keyboard, the same with Enter and Space, the focus staying on
    the button pressed. The figures and the sentences of the card keep their sizes all the while."""
    L, card, p = M[language], entry["id"], entry["predict"]
    right, wrong = p["answer"], next(c for c in p["choices"] if c != p["answer"])
    # The line after a choice: the test entries ask for the test; the moving entry names "Next frame" (the pages run with reduced
    # motion; "Play" otherwise); the others say to do what the question says
    moving = entry["safety"].get("motion") == "onPlay"
    chosen_key = "predictChosenTest" if entry.get("experiment") else "predictChosenFrame" if moving else "predictChosen"

    def text(c):
        return L[f"predict.{card}.choice.{c}"]
    page.evaluate("id => document.getElementById(id).scrollIntoView({block: 'start'})", card)
    sizes = page.evaluate(CARD_SIZES, card)

    def same(step):
        now = page.evaluate(CARD_SIZES, card)
        for key in ("frame", "read", "why"):
            check((now[key] is None) == (sizes[key] is None) and (now[key] is None or all(abs(a - b) <= 0.5 for a, b in zip(now[key], sizes[key]))),
                  (card, step, key, "the size stays", sizes[key], now[key]))
        check(len(now["uses"]) == len(sizes["uses"]) and all(abs(a - b) <= 0.5 for u, v in zip(now["uses"], sizes["uses"]) for a, b in zip(u, v)),
              (card, step, "the small figures keep their size", sizes["uses"], now["uses"]))

    def state(step, choice, shown):
        s = page.evaluate(PREDICT_STATE, card)
        check(s["open"] and [c[1] for c in s["choices"]] == [str(c == choice).lower() for c in p["choices"]], (card, step, "pressed", s))
        line = fill(L[chosen_key], choice=text(choice)) if choice else None
        check(s["chosen"] == ([line] if line else []) and s["reveal"] == bool(choice), (card, step, "the line of the prediction", s))
        # The answer: first whether the prediction was right, then the right choice and why
        verdict = L["predictMatch" if choice == right else "predictMismatch"]
        answer = [verdict, fill(L["predictAnswer"], choice=text(right)), L[f"predict.{card}.explain"]] if shown else []
        check(s["answer"] == answer, (card, step, "the answer", s["answer"], answer))
        same(step)
        return s

    def press(key, how):
        button = page.locator(f'[data-key="{key}"]')
        if keyboard:
            keyboard_focus(page, button)
            page.keyboard.press(how)
            check(page.evaluate(ACTIVE)["key"] == key, (card, key, "the focus stays on the button", page.evaluate(ACTIVE)))
        else:
            button.click()
    s = page.evaluate(PREDICT_STATE, card)
    after = {"search-time": "search-why", "search-camo": "search-measure"}.get(card, "controls")
    check(s["count"] == 1 and not s["open"] and s["summary"] == L["predictSummary"] and s["prev"] == "entry-howto" and s["next"] == after,
          (card, "closed, under how to use the entry and above the controls", s))
    summary = page.locator(f'[data-key="predict:{card}:open"]')
    if keyboard:
        summary.focus()
        page.keyboard.press("Enter")
    else:
        summary.click()
    s = state("opened", None, False)
    check(s["question"] == L[f"predict.{card}.question"] and s["named"] and [c[2] for c in s["choices"]] == [text(c) for c in p["choices"]]
          and [c[0] for c in s["choices"]] == [f"predict:{card}:{c}" for c in p["choices"]], (card, "the question and its choices", s))
    check(s["live"] == ["polite", "polite"] and s["revealText"] == L["predictReveal"], (card, "the lines read aloud, the answer button", s))
    press(f"predict:{card}:{wrong}", "Space")
    state("a wrong choice", wrong, False)
    press(f"predict:{card}:reveal", "Enter")
    state("the answer", wrong, True)
    press(f"predict:{card}:{right}", "Enter")
    state("the right choice hides the answer", right, False)
    press(f"predict:{card}:{right}", "Space")
    state("the same choice again", right, False)


def check_questions(page, group, language, width):
    """The two questions at the end of a tab: after its entries and boxes, before the button to the next tab, under their heading (h3). Each:
    its figure, or its two figures with A and B above them (side by side from 720px, one above the other below), named and described once;
    the question and its choices; a wrong choice says the right one and why, the right choice says so, read aloud; the figures keep their
    sizes. The first question also with the keyboard (Space and Enter; the focus stays on the choice)."""
    L = M[language]
    b = page.evaluate(CHECK_BOX, group)
    check(b["heading"] == L["checksHeading"] and b["labelled"] and b["list"] == "list" and b["items"] == [q["id"] for q in CHECKS[group]],
          (group, "the box of the questions", b))
    check(b["after"] == ([] if group == GROUPS[-1] else ["next-tab"]) and b["before"][-1] in ("entry", "end-box"), (group, "before the next tab", b))
    for n, q in enumerate(CHECKS[group]):
        qid, pair = q["id"], len(q["figures"]) == 2
        labels = [f["label"] for f in q["figures"] if f.get("label")]
        right, wrong = q["answer"], next(c for c in q["choices"] if c != q["answer"])

        def text(c, qid=qid, labels=labels):
            return c if c in labels else L[f"check.{qid}.choice.{c}"]
        page.locator(f"#check-{qid}").scroll_into_view_if_needed()
        s = page.evaluate(CHECK_STATE, qid)
        check(s["images"] == 1 and s["named"] and s["title"] == L[f"check.{qid}.title"] and s["desc"] == L[f"check.{qid}.desc"],
              (qid, "one named and described figure", s))
        check(s["hidden"] == [None] + ["true"] * (len(q["figures"]) - 1), (qid, "the second half of the figure is not read twice", s["hidden"]))
        check(s["viewBoxes"] == [CHECK_VIEWBOX[f["part"]] for f in q["figures"]] and all(k > 0 for k in s["shapes"]), (qid, "the figures", s))
        check(s["labels"] == ([["A", "true"], ["B", "true"]] if pair else []), (qid, "A and B above the figures", s["labels"]))
        check(s["note"] == (L[q["noteKey"]] if q.get("noteKey") else ""), (qid, "the note above the figure", s["note"]))
        for box, vb in zip(s["svgs"], s["viewBoxes"]):
            vw, vh = map(float, vb.split()[2:])
            check(abs((box[3] - 2) - (box[2] - 2) * vh / vw) <= 1, (qid, "the figure keeps its shape", box, vb))
        if pair:
            fa, fb = s["svgs"]
            side = abs(fa[1] - fb[1]) <= 1 and fb[0] >= fa[0] + fa[2] - 1
            stacked = fb[1] >= fa[1] + fa[3] - 1 and abs(fa[0] - fb[0]) <= 1
            check(side if width >= 720 else stacked, (qid, "side by side from 720px, one above the other below", s["svgs"]))
        check(s["question"] == L[f"check.{qid}.question"] and s["grouped"], (qid, "the question", s["question"]))
        check([c[0] for c in s["choices"]] == [f"check:{qid}:{c}" for c in q["choices"]] and [c[2] for c in s["choices"]] == [text(c) for c in q["choices"]]
              and all(c[1] == "false" for c in s["choices"]) and s["feedback"] == [] and s["live"] == "polite", (qid, "the choices", s))
        check(all(c[3] == "" and c[4] is None and c[5] == "true" for c in s["choices"]), (qid, "no marks before an answer, none read aloud", s["choices"]))

        def answered(step, choice, qid=qid, sizes=s["svgs"], right=right, text=text):
            t = page.evaluate(CHECK_STATE, qid)
            verdict = L["checkRight"] if choice == right else fill(L["checkWrong"], choice=text(right))
            check([c[1] for c in t["choices"]] == [str(c == choice).lower() for c in q["choices"]], (qid, step, "pressed", t["choices"]))
            check(t["feedback"] == [verdict, L[f"check.{qid}.explain"]], (qid, step, "the answer", t["feedback"]))
            # Not by color alone: a circle on the right choice, a cross on a wrong choice pressed (nothing on the others); the labels stay
            marks = ["○" if c == right else "×" if c == choice else "" for c in q["choices"]]
            verdicts = [("right" if c == right else "wrong") if c == choice else None for c in q["choices"]]
            check([c[3] for c in t["choices"]] == marks and [c[4] for c in t["choices"]] == verdicts, (qid, step, "the marks", t["choices"]))
            check([c[2] for c in t["choices"]] == [text(c) for c in q["choices"]], (qid, step, "the labels stay", t["choices"]))
            check(all(abs(x[2] - y[2]) <= 0.5 and abs(x[3] - y[3]) <= 0.5 for x, y in zip(t["svgs"], sizes)), (qid, step, "the figures keep their size"))
        page.locator(f'[data-key="check:{qid}:{wrong}"]').click()
        answered("a wrong choice", wrong)
        page.locator(f'[data-key="check:{qid}:{right}"]').click()
        answered("the right choice", right)
        if n == 0:
            for choice, key in ((wrong, "Space"), (right, "Enter")):
                keyboard_focus(page, page.locator(f'[data-key="check:{qid}:{choice}"]'))
                page.keyboard.press(key)
                answered("with the keyboard", choice)
                check(page.evaluate(ACTIVE)["key"] == f"check:{qid}:{choice}", (qid, "the focus stays on the choice", page.evaluate(ACTIVE)))


def learn_case(browser, browser_name, url, width, height, language, theme, output):
    """Why it happens, "Predict before you try" and the questions at the end of each tab, in every tab: what they say and where they stand,
    the keyboard, the sizes of the figures and of the sentences kept, nothing stored, and the choices and the focus kept when the cards are
    drawn again (a change of language)."""
    name = f"{browser_name}-{width}-{language}-{theme}-learn"
    context = new_context(browser, browser_name, width, height, language, theme)
    page = context.new_page()
    errors, violations = observe(page, url)
    layouts, shots = [], width in (390, 1280)
    try:
        page.goto(set_language_query(url, language), wait_until="load")
        wait_ready(page)
        for group in GROUPS:
            page.locator("#tab-" + group).click()
            for n, entry in enumerate(sorted((e for e in DATA["entries"] if e["group"] == group), key=lambda e: e["order"])):
                check_why(page, entry, language, width)
                check_prediction(page, entry, language, keyboard=n == 0)
            check_questions(page, group, language, width)
            assert_layout(page, width, "learn-" + group, layouts)
            if shots and group in ("search", "figure-ground"):
                shot(page, output / f"{name}-{group}-questions.png")
        check(page.evaluate("() => Object.keys(localStorage).length") == 0, "nothing is stored")
        # Drawn again in the other language (the button pressed by a script, so that the focus stays where it was): the prediction stays open
        # with its choice and its answer, the question keeps its answer, and the focus comes back to the same button. Then back again
        card, qid = "gestalt-contour", "gestalt-edge-spots"
        entry, question = ENTRY[card], next(q for q in CHECKS["gestalt"] if q["id"] == qid)
        page.locator("#tab-gestalt").click()
        page.locator(f'[data-key="predict:{card}:reveal"]').click()
        other = "en" if language == "ja" else "ja"
        for lang, key in ((other, f"predict:{card}:reveal"), (language, f"check:{qid}:{question['answer']}")):
            page.locator(f'[data-key="{key}"]').focus()
            page.evaluate("() => document.getElementById('language').click()")
            check(page.locator("html").get_attribute("lang") == lang, ("the language", lang))
            check(page.evaluate(ACTIVE)["key"] == key, ("the focus back on the same button", key, page.evaluate(ACTIVE)))
            L, p = M[lang], entry["predict"]
            right = L[f"predict.{card}.choice.{p['answer']}"]
            s = page.evaluate(PREDICT_STATE, card)
            check(s["open"] and [c[1] for c in s["choices"]] == [str(c == p["answer"]).lower() for c in p["choices"]]
                  and s["chosen"] == [fill(L["predictChosen"], choice=right)]
                  and s["answer"] == [L["predictMatch"], fill(L["predictAnswer"], choice=right), L[f"predict.{card}.explain"]],
                  ("the prediction kept", lang, s))
            c = page.evaluate(CHECK_STATE, qid)
            check([x[1] for x in c["choices"]] == [str(x == question["answer"]).lower() for x in question["choices"]]
                  and c["feedback"] == [L["checkRight"], L[f"check.{qid}.explain"]], ("the answer of the question kept", lang, c["feedback"]))
        if shots:
            page.evaluate("id => document.getElementById(id).scrollIntoView({block: 'start'})", card)
            shot(page, output / f"{name}-prediction.png")
        if language == "en":
            text = page.evaluate("() => { const c = document.body.cloneNode(true); c.querySelectorAll('noscript').forEach(n => n.remove()); "
                                 "return c.textContent; }")
            check(not JAPANESE.search(text), ("Japanese on the English page", JAPANESE.findall(text)[:10]))
        assert_clean(errors, violations)
        return {"case": name, "status": "passed", "layouts": len(layouts)}
    except Exception as error:
        try:
            shot(page, output / (name + "-failed.png"))
        except Exception:
            pass
        return {"case": name, "status": "failed", "error": str(error), "errors": errors, "violations": violations}
    finally:
        context.close()


def at_top(page, selector):
    """The element is at the top of the screen, or the page is scrolled as far as it goes (a short panel below it)."""
    top = page.locator(selector).bounding_box()["y"]
    bottom = page.evaluate("() => scrollY >= document.documentElement.scrollHeight - innerHeight - 1")
    return abs(top) <= 12 or (top > 0 and bottom)


def address_case(browser, browser_name, url, width, height, output, stage):
    """Opening with #group or #entry, an unknown id, the button to the next tab and the browser's back button."""
    name = f"{browser_name}-{width}-address"
    context = new_context(browser, browser_name, width, height, "ja", "light")
    errors, violations = [], []
    page = None

    def open_page(target):
        # A new page each time (a change of the address after # alone would not load the page again)
        nonlocal page
        if page:
            page.close()
        page = context.new_page()
        e, v = observe(page, url)
        errors.append(e)
        violations.append(v)
        page.goto(target, wait_until="load")
        wait_ready(page)
        return page

    # An entry id moves to its card once the card is drawn (before that, to the tab bar)
    drawn = STAGE_CARDS[stage]

    def to(card):
        return "#" + card if card in drawn else "#tabs"

    try:
        for value, tab, place in (("popout-feature", "popout", "#popout-feature"), ("popout-asymmetry", "popout", "#popout-asymmetry"),
                                  ("misread", "misread", "#tabs"), ("gestalt-contour", "gestalt", to("gestalt-contour")),
                                  ("gestalt-proximity-similarity", "gestalt", to("gestalt-proximity-similarity")),
                                  ("figure-ground", "figure-ground", "#tabs"), ("figure-ground-symmetry", "figure-ground", to("figure-ground-symmetry")),
                                  ("misread-aspect-range", "misread", to("misread-aspect-range")),
                                  ("search-time", "search", "#search-time"), ("xyz", "popout", None)):
            open_page(with_hash(url, value))
            assert_selected(page, tab)
            if place:
                check(at_top(page, place), (value, "moved to", place, page.locator(place).bounding_box()["y"]))
            else:
                check(page.evaluate("() => scrollY") == 0, (value, "an unknown id is ignored"))
            if value in drawn:
                assert_figure_on_screen(page, value, width, height)
            # An element that is not pressed (a card) shows no focus line when the browser moves the focus to it
            ring = page.evaluate("""() => { const a = document.activeElement;
              return a && a.matches('[tabindex="-1"]:not(button, a)') ? [a.id, getComputedStyle(a).outlineStyle] : null; }""")
            check(ring is None or ring[1] == "none", (value, "no focus line on a card", ring))
        open_page(url)
        button = page.locator('[data-key="next:popout"]')
        check(button.inner_text().strip() == fill(M["ja"]["nextTab"], tab=M["ja"]["tabSearch"]), "the next-tab button names the tab")
        button.scroll_into_view_if_needed()
        y = page.evaluate("() => scrollY")
        length = page.evaluate("() => history.length")
        button.click()
        assert_selected(page, "search")
        check(page.evaluate("() => history.length") == length + 1, "the next-tab button adds a history entry")
        check(at_top(page, "#tabs"), "the tab bar at the top")
        check(page.evaluate("() => document.activeElement.id") == "tab-search", "the new tab has the focus")
        page.go_back()
        page.wait_for_function("() => document.querySelector('#tab-popout').getAttribute('aria-selected') === 'true'")
        assert_selected(page, "popout")
        check(abs(page.evaluate("() => scrollY") - y) <= 2, ("back to the place", y, page.evaluate("() => scrollY")))
        page.go_forward()
        page.wait_for_function("() => document.querySelector('#tab-search').getAttribute('aria-selected') === 'true'")
        assert_clean([x for e in errors for x in e], [x for v in violations for x in v])
        return {"case": name, "status": "passed"}
    except Exception as error:
        try:
            shot(page, output / (name + "-failed.png"))
        except Exception:
            pass
        return {"case": name, "status": "failed", "error": str(error), "errors": errors, "violations": violations}
    finally:
        context.close()


def links_case(browser, browser_name, url, width, height, language, theme, output, stage):
    """Every link to another site, clicked: a new tab with the link's address, no opener, the page's state kept."""
    name = f"{browser_name}-{width}-{language}-{theme}-links"
    context = new_context(browser, browser_name, width, height, language, theme)
    answered = []

    def answer(route):
        answered.append(route.request.url)
        route.fulfill(status=200, content_type="text/html", body="<!doctype html><title>link</title>")

    context.route(lambda target: target.startswith(("http://", "https://")) and not target.startswith("http://127.0.0.1"), answer)
    page = context.new_page()
    errors, violations = observe(page, url)
    state = """() => ({tab: document.querySelector('#tabs [role=tab][aria-selected=true]').id,
      kind: (document.querySelector('[data-key^="ctl:popout-feature:kind:"][aria-pressed=true]') || {}).dataset.key, y: Math.round(scrollY)})"""
    opened = []
    try:
        page.goto(set_language_query(url, language), wait_until="load")
        wait_ready(page)
        page.locator('[data-key="ctl:popout-feature:kind:size"]').click()
        # Every tab with cards: its sources opened, then each link of the tab and of the footer
        groups = STAGE_GROUPS[stage]
        total = page.locator('main a[href^="http"], footer a[href^="http"]').count()
        for group in groups:
            page.locator("#tab-" + group).click()
            for summary in page.locator(f"#panel-{group} .entry-sources > summary").all():
                summary.click()
            links = page.locator(f'#panel-{group} a[href^="http"]' + (', footer a[href^="http"]' if group == "popout" else "")).all()
            check(len(links) >= 5, ("links", group, len(links)))
            for link in links:
                href = link.get_attribute("href")
                link.scroll_into_view_if_needed()
                before = page.evaluate(state)
                with context.expect_page() as info:
                    link.click()
                tab = info.value
                tab.wait_for_load_state("load")
                check(tab.url == href, (name, "the new tab opens the link", tab.url, href))
                check(tab.evaluate("() => window.opener === null"), (name, "no opener", href))
                tab.close()
                check(page.evaluate(state) == before, (name, "the page keeps its state", href))
                opened.append(href)
        check(len(opened) == total, (name, "every link of the drawn cards and the footer", len(opened), total))
        check(len(answered) >= len(opened), (name, "requests answered here", len(answered)))
        assert_clean(errors, violations)
        return {"case": name, "status": "passed", "links": len(opened)}
    except Exception as error:
        return {"case": name, "status": "failed", "error": str(error), "errors": errors, "violations": violations, "links": opened}
    finally:
        context.close()


def precedence_cases(browser, browser_name, url):
    cases = (
        ("saved-en", "ja", "light", {"language": "en", "theme": "dark"}, None, "en", "dark"),
        ("saved-ja", "en", "dark", {"language": "ja", "theme": "light"}, None, "ja", "light"),
        ("query-ja", "en", "light", {"language": "en", "theme": "dark"}, "ja", "ja", "dark"),
        ("query-en", "ja", "dark", {"language": "ja", "theme": "light"}, "en", "en", "light"),
        ("invalid-query", "ja", "light", {"language": "en", "theme": "dark"}, "xx", "en", "dark"),
        ("invalid-saved", "en", "dark", {"language": "xx", "theme": "xx"}, None, "en", "dark"),
        ("blocked-storage", "ja", "dark", None, None, "ja", "dark"),
    )
    results = []
    for name, locale, system_theme, stored, query, language, theme in cases:
        context = new_context(browser, browser_name, 390, 844, locale, system_theme)
        if stored is None:
            context.add_init_script("""Object.defineProperty(window, 'localStorage', {
              get() { throw new DOMException('Unavailable for test', 'SecurityError'); }
            });""")
        else:
            values = {PREFIX + key: value for key, value in stored.items()}
            context.add_init_script("""(() => {
              const saved = """ + json.dumps(values) + """;
              for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
            })();""")
        page = context.new_page()
        errors, violations = observe(page, url)
        try:
            page.goto(set_language_query(url, query), wait_until="load")
            wait_ready(page)
            assert_preference(page, language, theme)
            assert_ready_state(page, language)
            page.locator("#language").click()
            page.locator("#theme").click()
            assert_preference(page, "en" if language == "ja" else "ja", "dark" if theme == "light" else "light")
            assert_clean(errors, violations)
            results.append({"case": browser_name + "-" + name, "status": "passed"})
        except Exception as error:
            results.append({"case": browser_name + "-" + name, "status": "failed", "error": str(error), "errors": errors, "violations": violations})
        finally:
            context.close()
    return results


def http_case(browser, browser_name, base_url, width, height, output, stage):
    """The page served over HTTP (as on GitHub Pages): ready, the cards drawn, no error."""
    name = f"{browser_name}-{width}-http"
    context = new_context(browser, browser_name, width, height, "ja", "light")
    page = context.new_page()
    errors, violations = observe(page, base_url)
    try:
        page.goto(base_url, wait_until="load")
        wait_ready(page)
        # The cards with controls and the search card (from the search experiment stage)
        count = len(STAGE_CARDS[stage]) + (1 if "search" in STAGE_GROUPS[stage] else 0)
        check(page.locator(".entry").count() == count, ("the cards", count))
        layouts = []
        assert_layout(page, width, "http", layouts)
        assert_clean(errors, violations)
        return {"case": name, "status": "passed"}
    except Exception as error:
        return {"case": name, "status": "failed", "error": str(error), "errors": errors, "violations": violations}
    finally:
        context.close()


@contextmanager
def local_http():
    """Serve the repository on an ephemeral loopback port; the server stops when the block ends."""
    class QuietHandler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".css": "text/css",
                          ".json": "application/json", ".html": "text/html"}

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield "http://127.0.0.1:" + str(server.server_address[1]) + "/"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stage", choices=STAGES, default=STAGES[-1])
    parser.add_argument("--url", default=(ROOT / "index.html").as_uri())
    parser.add_argument("--browser", choices=BROWSERS, action="append")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--size", action="append", help="only these sizes, such as 390x844 (to look at one case while working)")
    parser.add_argument("--only-experiment", action="store_true", help="only the experiment cases (to look at them while working)")
    args = parser.parse_args()
    check(urlsplit(args.url).scheme in ("file", "http", "https"), "Use a file:// or HTTP(S) URL")
    root = ROOT.resolve()

    def inside_repository(path):
        return path == root or root in path.parents

    # Check the place before creating anything, so that a refused --output leaves no folder behind.
    if args.output:
        output = args.output.resolve()
        check(not inside_repository(output), "Write results outside the repository")
        output.mkdir(parents=True, exist_ok=True)
    else:
        check(not inside_repository(Path(tempfile.gettempdir()).resolve()), "Write results outside the repository")
        output = Path(tempfile.mkdtemp(prefix="vision-trap-atlas-")).resolve()
    RUN["stage"] = args.stage
    report = {"stage": args.stage, "url": args.url, "browsers": {}, "cases": []}

    def record(result):
        report["cases"].append(result)
        (output / (result["case"] + "-result.json")).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        (output / "report.partial.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(result["case"], result["status"], result.get("error", ""), flush=True)

    with sync_playwright() as playwright:
        for browser_name in args.browser or BROWSERS:
            browser = getattr(playwright, browser_name).launch(headless=True)
            report["browsers"][browser_name] = browser.version
            index = 0
            for width, height in SIZES:
                for language in ("ja", "en"):
                    for theme in ("light", "dark"):
                        index += 1
                        if args.size and f"{width}x{height}" not in args.size:
                            continue
                        if not args.only_experiment:
                            record(matrix_case(browser, browser_name, args.url, width, height, language, theme, output))
                            record(find_case(browser, browser_name, args.url, width, height, language, theme, output))
                        if args.stage >= "3":
                            record(experiment_case(browser, browser_name, args.url, width, height, language, theme, output, index - 1))
                        if args.stage >= "5":
                            record(camo_case(browser, browser_name, args.url, width, height, language, theme, output, index - 1))
                            if not args.only_experiment:
                                record(learn_case(browser, browser_name, args.url, width, height, language, theme, output))
            if args.only_experiment:
                browser.close()
                continue
            for width, height in ((390, 844), (1280, 800)):
                record(address_case(browser, browser_name, args.url, width, height, output, args.stage))
            for width, height, language, theme in ((1280, 800, "ja", "light"), (320, 568, "en", "dark")):
                record(links_case(browser, browser_name, args.url, width, height, language, theme, output, args.stage))
            for result in precedence_cases(browser, browser_name, args.url):
                record(result)
            with local_http() as http_url:
                for width, height in ((320, 568), (1280, 800)):
                    record(http_case(browser, browser_name, http_url, width, height, output, args.stage))
            browser.close()
    failed = [item for item in report["cases"] if item["status"] != "passed"]
    report["passed"] = len(report["cases"]) - len(failed)
    report["screenshot_style_refusals_of_the_harness"] = len(SHOOTING["ignored"])
    report["failed"] = len(failed)
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{report['passed']} passed, {report['failed']} failed; {output}", flush=True)
    for item in failed:
        print(item["case"], item.get("error", ""), flush=True)
    return bool(failed)


if __name__ == "__main__":
    raise SystemExit(main())
