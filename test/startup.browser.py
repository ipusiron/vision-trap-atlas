"""Startup checks for Vision Trap Atlas (Playwright for Python; not part of CI).

The first view without saved preferences, and a readable page while JavaScript is held back, missing or disabled, in
Chromium, Firefox and WebKit. The repository is served on an ephemeral loopback port while the checks run.
    python -X utf8 -B test/startup.browser.py
    python -X utf8 -B test/startup.browser.py --output <folder>
Results and screenshots are written to --output (default: a new folder in the system temporary directory). Nothing is
written inside the repository.
"""
import argparse
import base64
import hashlib
import json
import sys
import tempfile
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PREFIX = "vision-trap-atlas."
SOURCES = ("index.html", "style.css", "theme-init.js", "atlas-core.js", "atlas-data.js", "atlas-view.js", "atlas-search.js", "messages.js",
           "app.js", "test/startup.browser.py")
SCRIPTS = ["theme-init.js", "atlas-core.js", "atlas-data.js", "atlas-view.js", "atlas-search.js", "messages.js", "app.js"]
TABS_JA = ["目立つ前注意の特徴", "探す時間視覚探索", "まとまるゲシュタルトの法則", "図と地図と地の分化", "誤読グラフ", "目の錯覚錯視"]
HEADINGS_JA = ["目立つ（前注意の特徴）", "探す時間（視覚探索）", "まとまる（ゲシュタルトの法則）", "図と地（図と地の分化）", "誤読（グラフ）", "目の錯覚（錯視）"]
# The cards drawn when the page is ready: three in the Pop out tab, the Search time card (its experiment opens in a dialog, so it has no
# figure frame), three in the Grouping tab, two in the Figure and ground tab, four in the Misreading tab and one in the Optical illusions tab
CARDS, FIGURES = 14, 13
# The lines of the term of the third tab at 320px before the page is ready (a <wbr> in the page; Firefox has no word-break: auto-phrase)
GESTALT_LINES = """() => { const el = document.querySelector('#tab-gestalt .tab-term'), chars = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
  while ((node = walker.nextNode())) for (let i = 0; i < node.length; i++) {
    const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
    const r = range.getClientRects()[0]; if (r && r.width > 0) chars.push([node.data[i], r.top]); }
  const lines = []; let top = null;
  for (const [ch, t] of chars) { if (top === null || Math.abs(t - top) > 3) { lines.push(''); top = t; } lines[lines.length - 1] += ch; }
  return lines; }"""
CASES = (
    dict(name="first-view-ja-chromium", browser="chromium", width=320, language="ja", theme="light", hold_app=True),
    dict(name="first-view-en-firefox", browser="firefox", width=1280, language="en", theme="dark", hold_app=True),
    dict(name="first-view-ja-webkit", browser="webkit", width=390, language="ja", theme="dark", hold_app=True),
    dict(name="css-then-app-chromium", browser="chromium", width=320, language="en", theme="dark", hold_css=True, hold_app=True),
    dict(name="css-then-app-firefox", browser="firefox", width=1280, language="ja", theme="light", hold_css=True, hold_app=True),
    dict(name="css-then-app-webkit", browser="webkit", width=720, language="en", theme="light", hold_css=True, hold_app=True),
    # Without the calculation, the view and the search fail as they load, and app.js stops at the search (AtlasSearch)
    dict(name="missing-core", browser="chromium", width=320, language="ja", theme="light", fail="atlas-core.js",
         missing=("AtlasCore", "TIMEOUT_MS", "AtlasSearch")),
    dict(name="missing-data", browser="firefox", width=1280, language="en", theme="dark", fail="atlas-data.js", missing="AtlasData"),
    dict(name="missing-view", browser="webkit", width=1280, language="en", theme="light", fail="atlas-view.js", missing="AtlasView"),
    dict(name="missing-search", browser="chromium", width=390, language="ja", theme="dark", fail="atlas-search.js", missing="AtlasSearch"),
    dict(name="missing-messages", browser="firefox", width=320, language="ja", theme="dark", fail="messages.js", missing="AtlasMessages"),
    dict(name="missing-app", browser="webkit", width=390, language="ja", theme="light", fail="app.js"),
    dict(name="javascript-disabled-ja", browser="chromium", width=320, language="ja", theme="light", disabled=True),
    dict(name="javascript-disabled-en", browser="firefox", width=320, language="en", theme="dark", disabled=True),
    dict(name="javascript-disabled-webkit", browser="webkit", width=1280, language="ja", theme="dark", disabled=True),
    dict(name="storage-denied", browser="chromium", width=320, language="en", locale="ja", theme="dark", storage_denied=True),
    dict(name="query-over-saved", browser="firefox", width=1280, language="ja", locale="en", theme="dark",
         saved={"language": "en", "theme": "light"}, hold_app=True),
    dict(name="preference-separation-chromium", browser="chromium", width=320, language="ja", theme="dark", separate=True),
    dict(name="preference-separation-firefox", browser="firefox", width=1280, language="en", theme="light", separate=True),
    dict(name="preference-separation-webkit", browser="webkit", width=390, language="ja", theme="light", separate=True),
)
# Records every state of the page while it starts, so that readiness can be checked against the content that was there.
PROBE = """(() => {
  window.__startup = {states: [], csp: []};
  document.addEventListener('securitypolicyviolation', e => window.__startup.csp.push(e.violatedDirective));
  let previous = '';
  const sample = () => {
    const state = {ready: document.documentElement.dataset.appReady, cards: document.querySelectorAll('.entry').length,
      figures: document.querySelectorAll('.entry .figure-frame svg > rect, .entry .figure-frame svg > path, .entry .figure-frame svg > circle').length,
      note: !!document.querySelector('#startup-note'),
      tools: (document.querySelector('#startup-tools') || {}).disabled, controls: (document.querySelector('#startup-controls') || {}).disabled};
    const key = JSON.stringify(state);
    if (key !== previous) { window.__startup.states.push(state); previous = key; }
  };
  new MutationObserver(sample).observe(document, {subtree: true, childList: true, attributes: true, characterData: true});
})();"""
SNAPSHOT = """() => {
  const note = document.querySelector('#startup-note');
  const text = selector => (document.querySelector(selector) || {}).textContent || '';
  return {readyState: document.readyState, ready: document.documentElement.dataset.appReady,
    lang: document.documentElement.lang, theme: document.documentElement.dataset.theme || null,
    h1: text('h1'), intro: text('.intro-short'), contrast: text('#contrast-line'),
    table: Array.from(document.querySelectorAll('#contrast-table tbody th, #contrast-table tbody td'), c => c.textContent),
    tabs: Array.from(document.querySelectorAll('#tabs [role="tab"]'), tab => tab.textContent.replace(/\\s+/g, '')),
    headings: Array.from(document.querySelectorAll('.panel-heading'), h => { const c = h.cloneNode(true);
      c.querySelectorAll('.term-tip').forEach(t => t.remove()); return c.textContent; }),
    note: note ? note.innerText : '', noteVisible: !!note && note.getClientRects().length > 0,
    toolsDisabled: (document.querySelector('#startup-tools') || {}).disabled,
    controlsDisabled: (document.querySelector('#startup-controls') || {}).disabled,
    // every control of the two guarded groups is disabled or hidden (a disabled fieldset does not stop a summary from opening its
    // details box); the "くわしい説明を読む" summary of #intro-more only opens static Japanese text and may be opened
    allDisabled: Array.from(document.querySelectorAll(['#startup-tools', '#startup-controls']
      .map(group => ['button', 'summary', 'a[href]', 'select', 'input'].map(tag => group + ' ' + tag).join(', ')).join(', ')))
      .filter(control => !control.closest('#intro-more'))
      .every(control => control.matches(':disabled') || !control.getClientRects().length),
    unnamed: Array.from(document.querySelectorAll('button')).filter(b => b.getClientRects().length && !b.textContent.trim()
      && !b.getAttribute('aria-label')).map(b => b.id),
    cards: document.querySelectorAll('.entry').length,
    figures: document.querySelectorAll('.entry .figure-frame svg').length,
    reading: Array.from(document.querySelectorAll('.read-live'), r => r.textContent),
    focus: document.activeElement === document.body ? 'BODY' : (document.activeElement.id || document.activeElement.tagName),
    client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
    evidence: window.__startup || {states: [], csp: []}};
}"""
PREFERENCE_SPY = """(() => {
  window.__writes = [];
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (this === window.localStorage) window.__writes.push([String(key), String(value)]);
    return original.call(this, key, value);
  };
})();"""
# In print media without the application: the page's own text, in the light colors whatever the theme, and no buttons
PRINTED = """() => ({background: getComputedStyle(document.body).backgroundColor, color: getComputedStyle(document.body).color,
  buttons: Array.from(document.querySelectorAll('button')).filter(b => b.getClientRects().length).length,
  intro: document.querySelector('.intro-short').getClientRects().length > 0,
  table: document.querySelector('#contrast-table').getClientRects().length > 0})"""
PREFERENCES = """() => ({theme: document.documentElement.dataset.theme, language: document.documentElement.lang,
  savedTheme: localStorage.getItem('vision-trap-atlas.theme'), savedLanguage: localStorage.getItem('vision-trap-atlas.language'),
  writes: window.__writes})"""


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def pending_contract(page, snap, width):
    """Before the application is ready: the static Japanese text and the startup notice are readable, and every control is disabled."""
    check(snap["ready"] != "true", "an unfinished application must not signal readiness")
    check(snap["toolsDisabled"] and snap["controlsDisabled"] and snap["allDisabled"], "controls stay disabled until ready")
    check(snap["noteVisible"] and "準備中" in snap["note"] and "Loading" in snap["note"], ("bilingual startup notice", snap["note"]))
    check(snap["h1"] == "Vision Trap Atlas", "static heading")
    check(snap["tabs"] == TABS_JA, ("static Japanese tabs", snap["tabs"]))
    check(snap["headings"] == HEADINGS_JA, ("static panel headings", snap["headings"]))
    check("目の罠" in snap["intro"] and "迷彩" in snap["contrast"] and len(snap["table"]) == 9 and all(snap["table"]), "static introduction and table")
    check(snap["cards"] == 0, "no card before the application")
    check(page.locator(".intro-short").is_visible() and page.locator("#contrast-table").is_visible(), "the introduction and the table are shown")
    intro = page.locator("#intro-more")
    check(not intro.evaluate("el => el.open"), "the full introduction starts closed")
    page.locator("#intro-more > summary").click()
    check(page.locator('#intro-more [data-i18n="intro2"]').is_visible(), "the full introduction opens without the application")
    page.locator("#intro-more > summary").click()
    check(not snap["unnamed"], ("unnamed buttons", snap["unnamed"]))
    if width == 320:
        lines = page.evaluate(GESTALT_LINES)
        check(lines == ["ゲシュタルト", "の法則"], ("ゲシュタルト｜の法則 before ready", lines))
    page.locator("#startup-help > summary").click()
    help_text = page.locator("#startup-help").inner_text()
    check("JavaScript" in help_text and "開き直" in help_text, "the startup help explains what to do")
    check(page.locator("#startup-reload").is_visible(), "the reload link is visible")
    check(page.locator("#startup-reload").evaluate("el => el.href === location.href"), "the reload link keeps the URL")
    check(page.locator("#startup-reload").get_attribute("target") == "_blank", "the reload link opens a new tab")
    check(page.locator("#startup-reload").get_attribute("rel") == "noopener noreferrer", "the reload link has no opener")
    page.locator("#startup-help > summary").click()


def ready_contract(page, snap):
    """The first view: the introduction, the table, the tabs, and the cards with their figures (CARDS and FIGURES above)."""
    check(snap["ready"] == "true", "ready")
    check(not snap["toolsDisabled"] and not snap["controlsDisabled"], "the startup guards are released")
    check(not snap["noteVisible"] and not snap["note"], "the startup notice is removed")
    check(snap["cards"] == CARDS and snap["figures"] == FIGURES and all(snap["reading"]), ("the cards", snap["cards"], snap["reading"]))
    check(snap["scroll"] <= snap["client"], "no horizontal page scroll")
    ready_states = [s for s in snap["evidence"]["states"] if s["ready"] == "true"]
    check(ready_states and all(s["cards"] == CARDS and s["figures"] >= 13 and not s["note"] and not s["tools"] and not s["controls"]
                               for s in ready_states), ("readiness never comes before the complete first view", ready_states[:3]))
    check(not page.evaluate("() => !!document.activeElement.closest('[hidden]')"), "the focus is never left in a hidden element")


def preference_separation(page, spec):
    language, theme = spec["language"], spec["theme"]
    other_language = "en" if language == "ja" else "ja"
    other_theme = "light" if theme == "dark" else "dark"
    states = []

    def sample(stage):
        value = page.evaluate(PREFERENCES)
        value["stage"] = stage
        states.append(value)
        return value

    initial = sample("initial")
    check(initial["writes"] == [] and initial["savedTheme"] is None and initial["savedLanguage"] is None,
          "the first view does not save an implicit preference")
    page.locator("#language").click()
    changed = sample("language")
    check(changed["language"] == other_language and changed["savedLanguage"] == other_language, "the language button saves its choice")
    check(changed["theme"] == theme and changed["savedTheme"] is None, "the language button does not pin the theme")
    check(changed["writes"] == [[PREFIX + "language", other_language]], "the language button writes the language key only")
    page.emulate_media(color_scheme=other_theme)
    page.reload(wait_until="load")
    page.wait_for_function("() => document.documentElement.dataset.appReady === 'true'")
    reloaded = sample("reload")
    check(reloaded["theme"] == other_theme and reloaded["savedTheme"] is None, "an unsaved theme follows the system after reload")
    check(reloaded["language"] == language and reloaded["savedLanguage"] == other_language, "the query keeps priority")
    check(reloaded["writes"] == [], "a reload writes nothing")
    page.locator("#theme").click()
    changed = sample("theme")
    check(changed["theme"] == theme and changed["savedTheme"] == theme, "the theme button saves its choice")
    check(changed["writes"] == [[PREFIX + "theme", theme]], "the theme button writes the theme key only")
    return states


# A screenshot in WebKit adds a style element to the page (Playwright's, even with caret="initial"), which the CSP refuses. Those
# refusals, while a screenshot is being taken, are the harness's and are kept apart; the page never adds a style element
SHOOTING = {"on": False, "ignored": []}
STYLE_REFUSED = "Refused to apply a stylesheet"


def screenshot(page, cdp, path):
    if cdp:
        captured = cdp.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
        path.write_bytes(base64.b64decode(captured["data"]))
        return
    before = page.evaluate("() => window.__startup ? window.__startup.csp.length : 0")
    SHOOTING["on"] = True
    try:
        page.screenshot(caret="initial", path=str(path), full_page=False, timeout=10000)
        page.wait_for_timeout(150)
    finally:
        SHOOTING["on"] = False
    dropped = page.evaluate("""n => { if (!window.__startup) return [];
      const extra = window.__startup.csp.splice(n); const other = extra.filter(d => !d.startsWith('style-src'));
      window.__startup.csp.push(...other); return extra.filter(d => d.startsWith('style-src')); }""", before)
    SHOOTING["ignored"].extend(dropped)


def wait_for(page, held, what):
    """Wait for the request of a file to reach the route that holds it (polled every 50 ms, at most 5 s)."""
    for _ in range(100):
        if held:
            return
        page.wait_for_timeout(50)
    check(held, what + " is held")


def run_case(playwright, url, spec, output):
    browser = getattr(playwright, spec["browser"]).launch(headless=True)
    language = spec["language"]
    locale = spec.get("locale", language)
    context = browser.new_context(viewport={"width": spec["width"], "height": 900}, locale="ja-JP" if locale == "ja" else "en-US",
                                  color_scheme=spec["theme"], java_script_enabled=not spec.get("disabled", False), reduced_motion="reduce")
    page = context.new_page()
    errors, failures, console = [], [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("requestfailed", lambda request: failures.append(request.url))
    def on_console(message):
        if message.type != "error":
            return
        if SHOOTING["on"] and STYLE_REFUSED in message.text:
            SHOOTING["ignored"].append(message.text)
        else:
            console.append(message.text)

    page.on("console", on_console)
    page.add_init_script(PROBE)
    if spec.get("separate"):
        page.add_init_script(PREFERENCE_SPY)
    if spec.get("storage_denied"):
        page.add_init_script("""Storage.prototype.getItem = function () { throw new DOMException('blocked for the test', 'SecurityError'); };
          Storage.prototype.setItem = function () { throw new DOMException('blocked for the test', 'SecurityError'); };""")
    if spec.get("saved"):
        page.add_init_script("for (const [key, value] of Object.entries(" + json.dumps(spec["saved"]) + "))"
                             " localStorage.setItem('" + PREFIX + "' + key, value);")
    held = {"app": [], "css": []}
    if spec.get("hold_app"):
        page.route("**/app.js", lambda route: held["app"].append(route))
    if spec.get("hold_css"):
        page.route("**/style.css", lambda route: held["css"].append(route))
    if spec.get("fail"):
        page.route("**/" + spec["fail"], lambda route: route.abort("failed"))
    cdp = context.new_cdp_session(page) if spec["browser"] == "chromium" else None
    result = {"case": spec["name"], "spec": spec, "browser_version": browser.version, "snapshots": []}

    def snap(stage, picture=True):
        value = page.evaluate(SNAPSHOT)
        value["stage"] = stage
        result["snapshots"].append(value)
        if picture:
            screenshot(page, cdp, output / (spec["name"] + "-" + stage + ".png"))
        return value

    try:
        page.goto(url + "?lang=" + language, wait_until="commit")
        if spec.get("hold_css"):
            wait_for(page, held["css"], "style.css")
            release(held["css"])
            page.wait_for_function("() => document.styleSheets.length > 0")
        page.wait_for_function("() => !!document.querySelector('#help-dialog')")
        if spec.get("hold_app"):
            wait_for(page, held["app"], "app.js")
            page.wait_for_function("() => document.readyState !== 'loading'")
            pending = snap("app-pending", picture=spec["browser"] == "chromium")
            pending_contract(page, pending, spec["width"])
            check(pending["theme"] == spec.get("saved", {}).get("theme", spec["theme"]), "the theme is decided before the application")
            release(held["app"])
        page.wait_for_load_state("load")
        if spec.get("fail") or spec.get("disabled"):
            # A missing or disabled script leaves no signal to wait for: the scripts have run by the load event, and 300 ms more lets
            # an error that comes late (from a timer) reach the checks below
            page.wait_for_timeout(300)
            unavailable = snap("unavailable")
            pending_contract(page, unavailable, spec["width"])
            # Printing without the application: the page's own text in the light colors, without the buttons
            page.emulate_media(media="print")
            printed = page.evaluate(PRINTED)
            page.emulate_media(media="screen")
            check(printed["background"] == "rgb(246, 244, 237)" and printed["color"] == "rgb(21, 43, 69)", ("print colors", printed))
            check(printed["buttons"] == 0 and printed["intro"] and printed["table"], ("print shows the text without buttons", printed))
            result["printed"] = printed
            if spec.get("disabled"):
                check(page.locator("noscript").count() == 1, "the noscript message")
                page.locator("#startup-help > summary").click()
                original = page.url
                with context.expect_page() as opened:
                    page.locator("#startup-reload").click()
                reopened = opened.value
                reopened.wait_for_load_state("load")
                check(reopened.url == original and page.url == original, "reopening keeps the URL in both tabs")
                check(reopened.evaluate("() => window.opener === null"), "the reopened tab has no opener")
                reopened.close()
        else:
            page.wait_for_function("() => document.documentElement.dataset.appReady === 'true'")
            page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            ready = snap("ready")
            ready_contract(page, ready)
            expected_theme = spec.get("saved", {}).get("theme", spec["theme"])
            check(ready["lang"] == language and ready["theme"] == expected_theme, ("preferences keep priority", ready["lang"], ready["theme"]))
            check(ready["focus"] == "BODY", ("the startup does not move the focus", ready["focus"]))
            scripts = page.locator("head script[src]").evaluate_all("els => els.map(el => ({src: el.getAttribute('src'), defer: el.defer, "
                                                                     "async: el.async}))")
            check([s["src"] for s in scripts] == SCRIPTS, ("script order", scripts))
            check(not scripts[0]["defer"] and not scripts[0]["async"] and all(s["defer"] and not s["async"] for s in scripts[1:]),
                  "theme-init.js is synchronous and the rest are deferred")
            if spec.get("separate"):
                result["preferences"] = preference_separation(page, spec)
            if spec.get("storage_denied"):
                page.locator("#theme").click()
                page.locator("#language").click()
                check(page.locator("html").get_attribute("lang") == "ja", "the language works without storage")
                check(page.locator("html").get_attribute("data-theme") == "light", "the theme works without storage")
                page.locator('[data-key="ctl:popout-feature:kind:size"]').click()
                check(page.locator('[data-key="ctl:popout-feature:kind:size"]').get_attribute("aria-pressed") == "true",
                      "the controls work without storage")
        evidence = page.evaluate("() => window.__startup || {csp: []}")
        check(not evidence["csp"], ("no CSP violation", evidence["csp"]))
        if spec.get("fail"):
            check(failures and all(u.split("?")[0].endswith("/" + spec["fail"]) for u in failures), ("only the held file fails", failures))
            missing = spec.get("missing", ("NO_ERROR_EXPECTED",))
            missing = (missing,) if isinstance(missing, str) else missing
            check(all(any(m in error for m in missing) for error in errors), ("only the missing global fails", errors))
        else:
            check(not errors and not failures and not console, ("no startup error", errors, failures, console))
        result["status"] = "passed"
    except Exception as error:
        result.update(status="failed", error=str(error))
    finally:
        release(held["app"])
        release(held["css"])
        result.update(page_errors=errors, request_failures=failures, console_errors=console)
        context.close()
        browser.close()
    (output / (spec["name"] + ".json")).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(spec["name"], result["status"], result.get("error", ""), flush=True)
    return result


def release(routes):
    while routes:
        try:
            routes.pop().continue_()
        except Exception:
            pass


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
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
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

    def sources():
        return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCES}

    before = sources()
    report = {"sources_before": before, "cases": []}
    with local_http() as url, sync_playwright() as playwright:
        for spec in CASES:
            report["cases"].append(run_case(playwright, url, spec, output))
            (output / "report.partial.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    report["sources_after"] = sources()
    report["sources_stable"] = before == report["sources_after"]
    report["passed"] = sum(case["status"] == "passed" for case in report["cases"])
    report["screenshot_style_refusals_of_the_harness"] = len(SHOOTING["ignored"])
    report["failed"] = len(report["cases"]) - report["passed"]
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{report['passed']} passed, {report['failed']} failed; {output}", flush=True)
    return bool(report["failed"] or not report["sources_stable"])


if __name__ == "__main__":
    raise SystemExit(main())
