"""Exercise the opt-in Saturn flight on a loopback origin or extracted offline copy."""
import argparse
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urljoin

from playwright.sync_api import expect, sync_playwright

from engines import file_choice, start_check
from galaxy import AUDIO_PROBE, static_server, write_tone
from wheel_travel import begin, land, quiet_map


def screen(browser, engine, url, width, height, touch, reduced=False, profile=None, executable=None):
    options = dict(viewport={"width": width, "height": height}, has_touch=touch,
                   is_mobile=touch and engine != "firefox", reduced_motion="reduce" if reduced else "no-preference")
    if profile:
        driver = browser.browser_type
        context = driver.launch_persistent_context(str(profile), executable_path=executable or driver.executable_path, **options)
    else:
        context = browser.new_context(**options)
    if url.startswith("file:"):
        context.route("http://**/*", lambda r: r.abort())
        context.route("https://**/*", lambda r: r.abort())
    context.add_init_script(AUDIO_PROBE + """
      window.touchEvents = 0;
      document.addEventListener('pointerdown', e => {
        if (e.isTrusted && e.pointerType === 'touch') touchEvents++;
      }, true);
      window.radioContexts = [];
      if (window.AudioContext) window.AudioContext = class extends window.AudioContext {
        constructor(...args) { super(...args); radioContexts.push(this); }
      };
    """)
    page = context.pages[0] if context.pages else context.new_page()
    page.set_default_timeout(5500)
    page.goto(url)
    expect(page.locator("[data-id=my-galaxy]")).to_be_visible()
    return context, page


def reachable(page, selector):
    button = page.locator(selector)
    expect(button).to_be_visible()
    geometry = button.evaluate("""el => {
      const {x,y,width,height} = el.getBoundingClientRect();
      return {x,y,width,height,hit:el.contains(document.elementFromPoint(x+width/2,y+height/2)),
              inside:y>=0 && x>=0 && x+width<=innerWidth+.5 && y+height<=innerHeight+.5};
    }""")
    assert geometry["hit"] and geometry["inside"], (selector, geometry)
    if page.evaluate("matchMedia('(pointer: coarse)').matches"):
        assert geometry["height"] >= 43, (selector, geometry)


def journey(browser, engine, url, width, height, touch, evidence, baseline):
    ctx, p = screen(browser, engine, url, width, height, touch)
    clicks = []

    def visit(selector):
        el = p.locator(selector)
        (el.tap if touch else el.click)()
        clicks.append(selector)

    def shot(name):
        if evidence:
            quiet_map(p)
            p.screenshot(path=evidence / f"{engine}-{width}-{name}.png")

    if baseline:
        for selector in ("[data-id=milky-way]", "[data-id=solar-system]", "[data-id=saturn]", "[data-moon=titan]"):
            visit(selector)
        titan = len(clicks)
        expect(p.locator("#world-title")).to_have_text("Titan")
        visit("#back")
        if not p.locator("#radio-link").is_visible():
            visit("#playlist-toggle")
        visit("#radio-link")
    else:
        assert not p.locator("#first-flight").is_visible() and not p.evaluate("testAudio.length")
        reachable(p, "#first-flight-start"); reachable(p, "#open-finder")
        shot("home"); visit("#first-flight-start")
        expect(p.locator("#map-name")).to_have_text("ระบบสุริยะ")
        expect(p.locator(".flight-destination")).to_have_attribute("data-id", "saturn")
        reachable(p, "#first-flight-next")
        shot("solar"); visit("#first-flight-next")
        expect(p.locator("#world-title")).to_have_text("Saturn")
        expect(p.locator(".flight-destination")).to_have_attribute("data-moon", "titan")
        visit("#first-flight-next")
        titan = len(clicks)
        expect(p.locator("#world-title")).to_have_text("Titan")
        reachable(p, "#first-flight-radio"); reachable(p, "#first-flight-exit")
        assert not p.evaluate("testAudio.length")
        if touch:
            assert p.evaluate("touchEvents") >= titan
        shot("titan"); visit("#first-flight-radio")
    expect(p.locator("#power")).to_have_attribute("aria-pressed", "false")
    assert p.evaluate("radioContexts.length === 0")
    print(f"{width}×{height} {'touch' if touch else 'mouse'} · Titan {titan}, receiver {len(clicks)} actions · standby", flush=True)
    if not baseline:
        shot("receiver"); visit("#power")
        expect(p.locator("#power")).to_have_attribute("aria-pressed", "true")
        p.wait_for_function("radioContexts.some(c=>c.state==='running')")
        visit(".wordmark")
        expect(p.locator("#world-title")).to_have_text("Titan")
        p.go_back(); expect(p.locator("#world-title")).to_have_text("Saturn")
        p.go_back(); expect(p.locator("#map-name")).to_have_text("ระบบสุริยะ")
        p.go_back(); expect(p.locator("#first-flight-start")).to_be_focused()
    ctx.close()


def with_music(browser, engine, url, touch, tmp, executable):
    ctx, p = screen(browser, engine, url, 390 if touch else 1160, 844 if touch else 760, touch,
                    profile=tmp / "mp3-profile" if touch else None, executable=executable)
    def act(selector):
        el = p.locator(selector)
        (el.tap if touch else el.click)()
    if touch:
        name = "Flyby"
        p.goto(url+"#planet=tide")
        file_choice(p, "#add-mp3", tmp / "Fixture - Flyby.mp3")
        button = p.locator(".track-main").filter(has_text=name)
        expect(button).to_be_visible()
        button.tap()
    else:
        name = "Afterglow"
        p.goto(url+"#map=midnight"); act("[data-id=ember]")
    start_check(p, name)
    p.wait_for_function("testAudio.some(a=>!a.paused && a.currentTime >= 2)", timeout=9000)
    position = p.evaluate("testAudio.find(a=>!a.paused).currentTime")
    allocated = p.evaluate("window.flightPlayer = testAudio.find(a=>!a.paused); testAudio.length")
    act("#home")
    reachable(p, "#first-flight-start"); reachable(p, "#toggle")
    act("#first-flight-start"); quiet_map(p)

    if touch:
        act("#thumb-flight"); act("[data-id=saturn]")
        slider = p.locator("#thumb-range")
        rect = slider.bounding_box()
        p.touchscreen.tap(rect["x"]+rect["width"]*.55, rect["y"]+rect["height"]/2)
        assert 30 < int(slider.input_value()) < 75 and p.url.endswith("#map=solar-system")
        act("#first-flight-exit")
        expect(p.locator("#map-name")).to_have_text("ระบบสุริยะ")
        expect(p.locator("#first-flight")).to_be_hidden()
        assert not p.locator("[data-wheel-approach]").count()
        start_check(p, name, position)
        act("#home"); act("#first-flight-start")
    act("[data-id=saturn]"); quiet_map(p)
    if touch:
        act("#thumb-flight"); act("[data-moon=titan]")
        rect = p.locator("#thumb-range").bounding_box()
        p.touchscreen.tap(rect["x"]+rect["width"]-2, rect["y"]+rect["height"]/2)
    else:
        begin(p, "[data-moon=titan]")
        p.keyboard.press("Escape"); expect(p.locator("#world-title")).to_have_text("Saturn")
        begin(p, "[data-moon=titan]"); land(p, "#planet=titan")
    expect(p.locator("#world-title")).to_have_text("Titan")
    expect(p.locator("#first-flight-radio")).to_contain_text("พักเพลง")
    played = start_check(p, name, position)
    assert p.evaluate("testAudio.length") == allocated and p.evaluate("!flightPlayer.paused"), allocated
    act("#first-flight-radio")
    expect(p.locator("#power")).to_have_attribute("aria-pressed","false")
    assert p.evaluate("radioContexts.length === 0")
    p.go_back()
    expect(p.locator("#world-title")).to_have_text("Titan")
    expect(p.locator("#toggle")).to_have_attribute("aria-label","เล่นต่อ")
    assert p.evaluate("testAudio.every(a=>a.paused)")
    act("#toggle")
    resumed = start_check(p,name,played-.18)
    assert resumed < played+1.5, (played, resumed)
    act("#first-flight-exit")
    expect(p.locator("#world-title")).to_have_text("Titan")
    assert not p.locator("#first-flight").is_visible()
    print(f"{'Thumb' if touch else 'Wheel'} · {name}, interrupted, landed, radio Back, explicit resume {played:.2f} → {resumed:.2f}s", flush=True)
    ctx.close()


def leave_route(browser, engine, url):
    ctx, p = screen(browser, engine, url, 320, 568, True)
    p.locator("#first-flight-start").tap()
    p.locator("[data-id=earth]").tap()
    expect(p.locator("#world-title")).to_have_text("Earth")
    expect(p.locator("#first-flight")).to_be_hidden()
    p.go_back(); expect(p.locator("#first-flight-next")).to_contain_text("Saturn")
    p.locator("#first-flight-next").tap()
    p.locator("#first-flight-exit").tap()
    quiet_map(p)
    expect(p.locator("#world-title")).to_have_text("Saturn")
    expect(p.locator("#first-flight")).to_be_hidden()
    assert not p.evaluate("testAudio.length")
    # A copied receiver link opened on its own still offers a working Titan destination.
    tab = ctx.new_page(); tab.goto(urljoin(url, "radio.html#first-flight"))
    expect(tab.locator("#power")).to_have_attribute("aria-pressed","false")
    tab.locator(".wordmark").tap()
    expect(tab.locator("#world-title")).to_have_text("Titan")
    expect(tab.locator("#first-flight")).to_be_hidden()
    assert not tab.evaluate("testAudio.length")
    print("Independent Earth visit, exit during the Saturn leg, standalone radio return passed", flush=True)
    ctx.close()


def keyboard(browser, engine, url):
    ctx, p = screen(browser, engine, url, 1160, 760, False, reduced=True)
    # Reach the entry by tabbing from the actual document.
    for _ in range(20):
        p.keyboard.press("Tab")
        if p.locator("#first-flight-start").evaluate("b=>b===document.activeElement"):
            break
    expect(p.locator("#first-flight-start")).to_be_focused()
    p.keyboard.press("Enter")
    for target in ("Saturn", "Titan"):
        expect(p.locator("#first-flight")).to_be_focused()
        p.keyboard.press("Tab")
        expect(p.locator("#first-flight-next")).to_be_focused()
        expect(p.locator("#first-flight-next")).to_contain_text(target)
        p.keyboard.press("Enter")
    p.keyboard.press("Tab")
    expect(p.locator("#first-flight-radio")).to_be_focused()
    expect(p.locator("#world-title")).to_have_text("Titan")
    assert not p.locator(".flight-body,.flight-context,[data-flying]").count() and not p.evaluate("testAudio.length")
    p.go_back(); expect(p.locator("#first-flight-next")).to_contain_text("Titan")
    p.go_forward(); p.locator("#first-flight-exit").press("Enter")
    expect(p.locator("#world-title")).to_be_focused()
    p.reload()
    expect(p.locator("#world-title")).to_have_text("Titan")
    expect(p.locator("#first-flight")).to_be_hidden()
    p.goto(url+"#planet=titan")
    assert not p.evaluate("testAudio.length")
    print("Keyboard, reduced motion, Back/Forward, exit and shared Titan link passed", flush=True)
    ctx.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", choices=["chromium","webkit","firefox"], default="chromium")
    parser.add_argument("--executable")
    parser.add_argument("--url", help="Origin or extracted Playlist Galaxy.html file URL")
    parser.add_argument("--baseline", action="store_true", help="Visit the unguided route (also works on the previous revision)")
    parser.add_argument("--evidence", type=Path)
    args = parser.parse_args()
    if args.evidence:
        args.evidence.mkdir(parents=True, exist_ok=True)
    with static_server() as local_url, sync_playwright() as pw, TemporaryDirectory() as directory:
        engine = getattr(pw,args.browser)
        b = engine.launch(executable_path=args.executable or engine.executable_path)
        print(args.browser, b.version, flush=True)
        url = args.url or local_url
        for width, height, touch in ((320,568,True),(390,844,True),(1200,800,False)):
            journey(b,args.browser,url,width,height,touch,args.evidence,args.baseline)
        if not args.baseline:
            keyboard(b,args.browser,url)
            leave_route(b,args.browser,url)
            tmp = Path(directory)
            write_tone(tmp / "Fixture - Flyby.mp3", 384)
            with_music(b,args.browser,url,True,tmp,args.executable)
            if args.browser=="chromium":
                with_music(b,args.browser,url,False,tmp,args.executable)
        b.close()


if __name__ == "__main__":
    main()
