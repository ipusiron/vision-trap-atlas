"""Browser gates for Vision Trap Atlas (Playwright for Python; not part of CI).

Run with a Python that already has Playwright and its Chromium, Firefox and WebKit:
    python -X utf8 -B test/interface.browser.py --stage 3
    python -X utf8 -B test/interface.browser.py --stage 3 --output <folder>
    python -X utf8 -B test/interface.browser.py --stage 3 --browser chromium
Every case runs at 320x568, 390x844, 720x900 and 1280x800, in Japanese and English, light and dark, in the three
browsers: no console error, no CSP violation, no sideways page scroll, and the checks of the screen (the header, the
introduction and the contrast table, the tabs and their names, the help, the explanations of the terms, the two cards of
the Pop out tab with every value of their controls, and "Find and tap" with the clock held by Playwright). From --stage 3,
the Search time tab and its experiment with the clock held and paused: the answers are put in at chosen times, and the table
and the sentences of the results must be those that AtlasCore computes from the test's own record of the tries. Then the
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
STAGES = ("2", "3")
SIZES = ((320, 568), (390, 844), (720, 900), (1280, 800))
BROWSERS = ("chromium", "firefox", "webkit")
GROUPS = ("popout", "search", "gestalt", "figure-ground", "misread")
CARDS = ("popout-feature", "popout-asymmetry")
CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; "
    "img-src 'self' data:; base-uri 'none'; form-action 'none'; "
    "frame-src 'none'; object-src 'none'; connect-src 'none'"
)
JAPANESE = re.compile("[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿！-｠]")
FOOTER_HREF = "https://github.com/ipusiron/vision-trap-atlas"


def load_module(name):
    """The value of a UMD file of the repository (read with Node, the same file the page loads)."""
    code = "process.stdout.write(JSON.stringify(require(process.argv[1])))"
    out = subprocess.run(["node", "-e", code, str(ROOT / name)], capture_output=True, check=True, encoding="utf-8").stdout
    return json.loads(out)


M = load_module("messages.js")
DATA = load_module("atlas-data.js")


def fill(template, **values):
    return re.sub(r"\{([a-zA-Z0-9_]+)\}", lambda m: str(values.get(m.group(1), m.group(0))), template)


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
TAB_LINES = """() => Array.from(document.querySelectorAll('[role="tab"]'), tab => {
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
  const frame = card.querySelector('.figure-frame').getBoundingClientRect();
  return {frame: top(card.querySelector('.figure-frame')), frameW: frame.width, frameH: frame.height,
    read: top(card.querySelector('.read-stack')), find: top(card.querySelector('.find-line')),
    uses: Array.from(card.querySelectorAll('.use-figure svg'), s => top(s)),
    linked: Array.from(card.querySelectorAll('.use-linked'), s => top(s))}; }"""
CARD_TEXTS = """id => { const card = document.getElementById(id);
  const text = el => el ? el.textContent.trim() : '';
  return {read: text(card.querySelector('.read-live')), find: text(card.querySelector('.find-live')),
    linked: Array.from(card.querySelectorAll('.use-linked > p:not([aria-hidden])'), p => p.textContent.trim()).filter(Boolean),
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


def assert_first_view(page, language):
    """The introduction, the contrast table and the tabs are filled in (in the language of the page)."""
    assert_language_text(page.locator(".intro-short").inner_text(), language, "introduction")
    check(page.locator(".intro-short").inner_text() == M[language]["introShort"], "introduction text")
    check(not page.locator("#intro-more").evaluate("el => el.open"), "the full introduction starts closed")
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
        check(len(set(tops[:3])) == 1 and len(set(tops[3:])) == 1 and tops[3] > tops[0], ("three tabs, then two", tops))
    else:
        check(len(set(tops)) == 1, ("five tabs in one row", tops))
    if language == "ja" and width == 320:
        gestalt = next(t for t in tabs if t["id"] == "tab-gestalt")["term"]
        check(gestalt["lines"] == ["ゲシュタルト", "の法則"], ("ゲシュタルト｜の法則 at 320px", gestalt["lines"]))
    return tabs


def test_tabs(page, width, layouts, language):
    check(page.locator('[role="tablist"]').count() == 1 and page.locator('[role="tab"]').count() == 5, "five tabs")
    assert_selected(page, "popout")
    history = page.evaluate("() => history.length")
    page.locator("#tabs").scroll_into_view_if_needed()
    for group in GROUPS:
        y = page.evaluate("() => scrollY")
        page.locator("#tab-" + group).click()
        assert_selected(page, group)
        heading = page.locator(f"#heading-{group}").evaluate(VISIBLE_TEXT)
        check(heading == heading_text(group, language), ("panel heading", group, heading))
        # The tab bar is on the screen: pressing a tab does not move the page; the address ends with the group (no new history)
        top = page.locator("#tabs").bounding_box()["y"]
        if top >= 0:
            check(abs(page.evaluate("() => scrollY") - y) <= 1, ("the page did not move", group))
        check(page.url.endswith("#" + group), ("address", page.url))
        assert_layout(page, width, "tab-" + group, layouts)
    check(page.evaluate("() => history.length") == history, "a tab adds no history entry")
    page.locator("#tab-popout").click()
    page.locator("#tab-popout").focus()
    for key, expected in (("ArrowRight", "search"), ("ArrowRight", "gestalt"), ("ArrowLeft", "search"), ("End", "misread"),
                          ("ArrowRight", "popout"), ("ArrowLeft", "misread"), ("Home", "popout")):
        page.keyboard.press(key)
        assert_selected(page, expected)
        check(page.evaluate("() => document.activeElement.id") == "tab-" + expected, ("tab focus", key, expected))
    page.keyboard.press("Tab")
    check(page.evaluate("() => document.activeElement.id") == "panel-popout", "Tab from the selected tab enters its panel")


def test_help(page, width, layouts, screenshot, language):
    page.locator("#help").focus()
    page.keyboard.press("Enter")
    dialog = page.locator("#help-dialog")
    check(dialog.is_visible() and dialog.evaluate("el => el.open && el.matches(':modal')"), "modal help")
    check(page.locator("#help-title").inner_text() == M[language]["helpButton"], "help title")
    check(page.evaluate("() => document.activeElement.id") == "close-help", "help opens on the close button")
    terms = page.locator("#help-terms > dt").count()
    check(terms == 35 and page.locator("#help-terms > dd").count() == 35, ("35 terms", terms))
    check(page.locator("#help-first + p").inner_text() == M[language]["helpFirstText"], "first steps")
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


def control_buttons(page, card):
    return page.locator(f"#{card} .controls .choice button").evaluate_all("els => els.map(b => b.dataset.key)")


def test_card_controls(page, width, height, layouts, language, card, screenshot):
    """Every value of every control: the figure frame, the reading line, the line of "Find and tap" and the small figures stay in place."""
    page.locator("#tab-popout").click()
    before = page.evaluate(CARD_PLACES, card)
    texts = page.evaluate(CARD_TEXTS, card)
    assert_language_text(texts["read"], language, card + " reading")
    check(all(d for d in texts["desc"]) and len(texts["desc"]) == 3, (card, "descriptions of the three figures", texts["desc"]))
    for d in texts["desc"]:
        assert_language_text(d, language, card + " desc")
    check(abs(before["frameW"] - before["frameH"]) <= 1, (card, "a square figure", before))
    uses = page.locator(f"#{card} .use-figure svg").evaluate_all("els => els.map(s => { const r = s.getBoundingClientRect(); "
                                                                   "return [r.left, r.top, r.width, r.bottom]; })")
    if width < 720:
        check(abs(uses[0][1] - uses[1][1]) <= 1 and uses[1][0] > uses[0][0] + uses[0][2] - 1, (card, "two small figures side by side", uses))
    else:
        check(uses[1][1] >= uses[0][3] - 1, (card, "two small figures one above the other", uses))
    if (width, height) == (390, 844):
        top = page.evaluate("""id => { const card = document.getElementById(id), range = card.querySelector('.controls input[type=range]');
          return (range ? range.closest('.control') : card.querySelector('.controls')).getBoundingClientRect().top + scrollY; }""", card)
        bottom = max(u[3] for u in uses) + page.evaluate("() => scrollY")
        check(bottom - top <= height, (card, "from the controls to the small figures in one screen", bottom - top))

    def same_places(name):
        now = page.evaluate(CARD_PLACES, card)
        for key in ("frame", "frameH", "read", "find"):
            check(abs(now[key] - before[key]) <= 1, (card, name, key, before[key], now[key]))
        for a, b in zip(now["uses"] + now["linked"], before["uses"] + before["linked"]):
            check(abs(a - b) <= 1, (card, name, "small figures", before["uses"], now["uses"]))
        t = page.evaluate(CARD_TEXTS, card)
        assert_language_text(t["read"], language, (card, name, "reading"))
        return t

    keys = control_buttons(page, card)
    seen_linked = set()
    for key in keys:
        button = page.locator(f'[data-key="{key}"]')
        if button.is_disabled():
            continue
        button.click()
        check(button.get_attribute("aria-pressed") == "true", (key, "pressed"))
        t = same_places(key)
        seen_linked.update(t["live"])
        if key.startswith(f"ctl:{card}:kind:shape"):
            # 形: the two shape pairs, and the sliders are off with the note beside them
            for pair in page.locator(f'#{card} [data-key^="ctl:{card}:shape:"]').all():
                pair.click()
                same_places(pair.get_attribute("data-key"))
            check(page.locator(f"#{card} input[type=range]").evaluate_all("els => els.every(e => e.disabled)"), "sliders off for shape")
            notes = page.locator(f"#{card} .tick-note").evaluate_all("els => els.map(e => getComputedStyle(e).visibility)")
            check(notes == ["visible", "visible"], ("the note beside the sliders", notes))
    for slider in page.locator(f"#{card} .controls input[type=range]").all():
        if slider.is_disabled():
            continue
        slider.focus()
        page.keyboard.press("Home")
        for _ in range(int(slider.get_attribute("max")) + 1):
            same_places(slider.get_attribute("data-key") + "=" + slider.input_value())
            check(slider.get_attribute("aria-valuetext"), "the step in words")
            page.keyboard.press("ArrowRight")
    if card == "popout-feature":
        # The line under the small figures: the three operations for color, lightness and size, none for direction and shape
        names = M[language]["linkedTo"].replace("{names}", ("・" if language == "ja" else ", ").join(
            M[language][f"ctl.popout-feature.{c}"] for c in ("kind", "diff", "variety")))
        check({names, M[language]["linkedNone"]} <= seen_linked, ("linked lines", seen_linked))
        page.locator('[data-key="ctl:popout-feature:kind:color"]').click()
        page.locator("#ctl-popout-feature-diff-input").focus()
        page.keyboard.press("End")
        page.locator("#ctl-popout-feature-variety-input").focus()
        page.keyboard.press("Home")
        page.locator('[data-key="ctl:popout-feature:count:18"]').click()
    else:
        page.locator('[data-key="ctl:popout-asymmetry:target:withLine"]').click()
        page.locator('[data-key="ctl:popout-asymmetry:count:18"]').click()
    page.locator(f'[data-key="act:{card}:reshuffle"]').click()
    same_places("reshuffle")
    assert_layout(page, width, card + "-controls", layouts)
    page.evaluate("id => document.getElementById(id).scrollIntoView({block: 'start'})", card)
    shot(page, screenshot)


def test_entry_nav(page, language):
    """"Entries in this tab": a button moves to its card (at the top of the screen), and the button at the end of the card comes back."""
    page.locator("#tab-popout").click()
    hint = page.locator("#nav-popout .section-nav-hint").inner_text()
    check(hint == M[language]["tabNavHint"], ("the hint above the buttons", hint))
    for card in CARDS:
        page.locator(f'[data-key="nav:{card}"]').click()
        top = page.locator("#" + card).bounding_box()["y"]
        check(abs(top) <= 12, (card, "the card at the top of the screen", top))
        check(page.evaluate("() => document.activeElement.id") == card, (card, "the card has the focus"))
        page.locator(f'[data-key="back:{card}"]').click()
        top = page.locator("#nav-popout").bounding_box()["y"]
        check(abs(top) <= 12, (card, "back at the list", top))
        check(page.evaluate(ACTIVE)["key"] == "nav:" + card, (card, "the button of the card has the focus"))


def test_preferences(page, language, theme):
    other_language = "en" if language == "ja" else "ja"
    other_theme = "dark" if theme == "light" else "light"
    page.locator("#tab-misread").click()
    page.locator("#language").click()
    page.locator("#theme").click()
    assert_preference(page, other_language, other_theme)
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
        assert_first_view(page, language)
        assert_layout(page, width, "initial", layouts)
        shot(page, output / (name + "-initial.png"))
        tabs = test_tab_names(page, width, language)
        test_tabs(page, width, layouts, language)
        test_help(page, width, layouts, output / (name + "-help.png"), language)
        test_terms(page, width, language, browser_name == "chromium" and width < 720, output / (name + "-term.png"))
        for card in CARDS:
            test_card_controls(page, width, dict(SIZES)[width], layouts, language, card, output / (name + "-" + card + ".png"))
        test_entry_nav(page, language)
        if language == "en":
            text = page.evaluate("() => { const c = document.body.cloneNode(true); c.querySelectorAll('noscript').forEach(n => n.remove()); "
                                 "return c.textContent; }")
            check(not JAPANESE.search(text), ("Japanese on the English page", JAPANESE.findall(text)[:10]))
        saved = test_preferences(page, language, theme)
        assert_clean(errors, violations)
        return {"case": name, "status": "passed", "layouts": len(layouts), "tabs": tabs, "saved": saved}
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
        for card in CARDS:
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
    answersOff: document.getElementById('exp-absent').disabled};
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
  return {none: Array.from(card.querySelectorAll('.res-none'), text),
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
  results[s] = q[s] ? C.summarizeBlock(q[s].records, { aborted: q[s].aborted, granularity: q[s].granularity }) : null;
}
const cases = C.resultCases(results);
const out = { keys: cases.map((c) => c.key), texts: {}, rows: {} };
for (const lang of ['ja', 'en']) {
  out.texts[lang] = V.resultTexts(M, lang, cases);
  const none = M[lang].resNoValue;
  out.rows[lang] = [['feature', 'present', 'resRowFeatureYes'], ['feature', 'absent', 'resRowFeatureNo'], ['conjunction', 'present', 'resRowConjYes'],
    ['conjunction', 'absent', 'resRowConjNo']].map(([s, side, key]) => {
    const row = results[s] ? results[s].rows[side] : null;
    const medians = C.SET_SIZES.map((n) => (row && row.cells[n].median !== null ? String(Math.round(row.cells[n].median)) : none));
    return { name: M[lang][key], medians, slope: row && row.slope !== null ? C.round1(row.slope).toFixed(1) : none,
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
    a whole block (practice, then 64 recorded tries with keys and buttons, a too early answer, a time-out, a hidden page and wrong
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
        check(page.locator("#panel-search .term").count() == 7, ("the terms of the tab", page.locator("#panel-search .term").count()))
        set_ = "fill" if index % 4 == 3 else "color"
        page.locator(f'[data-key="exp:set:{set_}"]').click()
        assert_layout(page, width, "search-tab", layouts)
        page.evaluate("() => document.getElementById('search-time').scrollIntoView({block: 'start'})")
        shoot("tab")
        searches = ("feature", "conjunction") if index % 2 == 0 else ("conjunction", "feature")
        # A whole first run at 390 and 1280px (both runs whole in the light theme); elsewhere the runs stop after some tries
        whole_first = width in (390, 1280)
        both = whole_first and theme == "light"
        # The cases with two whole runs take the designs in turn, so that each difference of the two searches comes out
        design = DESIGNS[{4: 0, 6: 3, 12: 4, 14: 2}.get(index, index % len(DESIGNS))]
        blocks = {"feature": None, "conjunction": None}
        # Esc before the start: the dialog closes, nothing is measured
        exp_open(page, searches[0])
        check(page.locator("#exp-title").inner_text().strip() == fill(L["expTitle"], search=L["termFeature" if searches[0] == "feature" else "termConjunction"],
                                                                         set=L["setColorShort" if set_ == "color" else "setFillShort"]), "the title")
        message = page.evaluate(EXP_STATE)["message"]
        check(L["expInstr"] in message and L["expReader"] in message, ("before the start", message))
        check(page.locator(".exp-message svg.sample").count() == 1 + (1 if searches[0] == "feature" else 2), "the samples of the run")
        # Before the start the message fits the square, so the place of the answers is already the one of the tries
        assert_experiment_layout(page, "ready", layouts)
        shoot("ready")
        page.keyboard.press("Escape")
        exp_closed(page, searches[0])
        check(page.locator('[data-key="exp:clear"]').is_disabled(), "still nothing measured")
        # The first search, whole
        for n, search in enumerate(searches):
            whole = whole_first if n == 0 else both
            exp_open(page, search)
            run = Experiment(page, language, touch)
            run.practice(seen=lambda s: (assert_experiment_layout(page, "practice", layouts), shoot("practice")) if n == 0 else None)
            mistakes = range(50, 58) if index % 3 == 0 else (8, 50)
            tries = run.recorded(design[search], mistakes=mistakes if whole else (8,), mixed=index % 2 == 1,
                                 stop_after=None if whole else 20 if n == 0 else 6,
                                 seen=lambda s: (assert_experiment_layout(page, "recorded", layouts), shoot("recorded")) if n == 0 else None)
            if whole:
                check(tries == 67, ("64 recorded tries and the three that came back", tries))
            else:
                # Stopped: Esc (or the Stop button) keeps what was measured
                if index % 2:
                    page.locator("#exp-abort").click()
                else:
                    page.keyboard.press("Escape")
            blocks[search] = {"records": run.records, "aborted": not whole, "granularity": None}
            expected = expected_results(blocks)
            s = run.state()
            check(s["message"] and L["expDone" if whole else "expAborted"] in s["message"] and s["focus"] == "exp:expShowResults",
                  ("the end of the run", s["message"], s["focus"]))
            check(s["results"] == expected["texts"][language][:-2], ("the sentences in the dialog", s["results"]))
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


def at_top(page, selector):
    """The element is at the top of the screen, or the page is scrolled as far as it goes (a short panel below it)."""
    top = page.locator(selector).bounding_box()["y"]
    bottom = page.evaluate("() => scrollY >= document.documentElement.scrollHeight - innerHeight - 1")
    return abs(top) <= 12 or (top > 0 and bottom)


def address_case(browser, browser_name, url, width, height, output):
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

    try:
        for value, tab, place in (("popout-asymmetry", "popout", "#popout-asymmetry"), ("misread", "misread", "#tabs"),
                                  ("gestalt-contour", "gestalt", "#tabs"), ("search-time", "search", "#search-time"), ("xyz", "popout", None)):
            open_page(with_hash(url, value))
            assert_selected(page, tab)
            if place:
                check(at_top(page, place), (value, "moved to", place, page.locator(place).bounding_box()["y"]))
            else:
                check(page.evaluate("() => scrollY") == 0, (value, "an unknown id is ignored"))
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
    state = """() => ({tab: document.querySelector('[role=tab][aria-selected=true]').id,
      kind: (document.querySelector('[data-key^="ctl:popout-feature:kind:"][aria-pressed=true]') || {}).dataset.key, y: Math.round(scrollY)})"""
    opened = []
    try:
        page.goto(set_language_query(url, language), wait_until="load")
        wait_ready(page)
        page.locator('[data-key="ctl:popout-feature:kind:size"]').click()
        # Every tab with cards: its sources opened, then each link of the tab and of the footer
        groups = ("popout",) if stage == "2" else ("popout", "search")
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
        cards = 2 if stage == "2" else 3
        check(page.locator(".entry").count() == cards, ("the cards", cards))
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
            if args.only_experiment:
                browser.close()
                continue
            for width, height in ((390, 844), (1280, 800)):
                record(address_case(browser, browser_name, args.url, width, height, output))
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
