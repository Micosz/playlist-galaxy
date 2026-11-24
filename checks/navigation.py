"""Measure where a planet stays during real wheel, keyboard and pinch input."""
import argparse
from math import dist
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import sync_playwright
from camera import hit, rect_center, sprite, view
from galaxy import AUDIO_PROBE, local_playing, static_server, write_tone


def touch(session, kind, points):
    session.send("Input.dispatchTouchEvent", {
        "type": kind,
        "touchPoints": [{"id": i + 1, "x": x, "y": y} for i, (x, y) in enumerate(points)],
    })


def point(art):
    return rect_center(art.bounding_box())


def check_anchor(browser, url, method, reduced=False):
    mobile = method == "pinch"
    ctx = browser.new_context(viewport={"width": 390 if mobile else 1160, "height": 844 if mobile else 760},
                              is_mobile=mobile, has_touch=mobile, reduced_motion="reduce" if reduced else "no-preference")
    p = ctx.new_page()
    name = {"pinch": "saturn", "wheel": "neptune", "keyboard": "tide"}[method]
    route = "#map=midnight" if method == "keyboard" else "#map=solar-system"
    p.goto(url + route)
    art = sprite(p, name)
    art.wait_for()
    if method == "keyboard":
        p.locator(f'[data-id="{name}"]').focus()
    elif method == "wheel":
        p.mouse.move(*point(art))
    x, y = point(art)
    width = art.bounding_box()["width"]
    art.evaluate("""el => {
      window.samples = [];
      function sample() {
        const r = el.getBoundingClientRect();
        samples.push([r.left + r.width / 2, r.top + r.height / 2]);
        window.sampleFrame = requestAnimationFrame(sample);
      }
      sample();
    }""")
    dx = dy = 0
    wheel_steps = [245, 245, 190]
    if method == "pinch":
        cdp = ctx.new_cdp_session(p)
        touch(cdp, "touchStart", [(x - 19, y), (x + 19, y)])
        dx, dy = 48, -30
        for i in range(1, 9):
            px, py = x + dx * i / 8, y + dy * i / 8
            touch(cdp, "touchMove", [(px - 19 - 3 * i, py), (px + 19 + 3 * i, py)])
        touch(cdp, "touchEnd", [])
    elif method == "wheel":
        for amount in wheel_steps:
            p.mouse.wheel(0, -amount)
    else:
        for _ in range(4):
            p.keyboard.press("+")
    p.wait_for_timeout(670)
    assert art.bounding_box()["width"] > width * 1.35, "The input must really magnify the planet"
    final = dist(point(art), (x + dx, y + dy))
    assert final < 2.5, (method, name, final)
    if not mobile:
        if method == "wheel":
            for amount in reversed(wheel_steps):
                p.mouse.wheel(0, amount)
        else:
            for _ in range(4):
                p.keyboard.press("-")
        p.wait_for_timeout(670)
        assert abs(art.bounding_box()["width"] - width) < 1, "Zooming out must restore the original scale"
    samples = p.evaluate("() => {cancelAnimationFrame(window.sampleFrame); return window.samples}")
    peak = max(dist(s, (x, y)) for s in samples)
    if not mobile:
        assert peak < 2.5, (method, name, peak)
    assert p.url.endswith(route)
    ctx.close()
    print(f"{method} {name}, {'reduced' if reduced else 'normal'} motion: {final:.2f}px end error"
          + ("" if mobile else f", {peak:.2f}px peak including reverse zoom"), flush=True)


def check_held_gesture(browser, url, mobile, mp3=None):
    """Back out with fingers/mouse held, then finish the old gesture over the parent."""
    ctx = browser.new_context(viewport={"width": 390 if mobile else 1160, "height": 844 if mobile else 760},
                              is_mobile=mobile, has_touch=mobile)
    ctx.add_init_script(AUDIO_PROBE)
    p = ctx.new_page()
    cdp = ctx.new_cdp_session(p) if mobile else None
    p.goto(url + "#map=my-galaxy")
    p.locator('[data-id="midnight"]').wait_for()
    overview = view(p)
    hit(p, '[data-id="midnight"]', mobile)
    field = p.locator("#map-field")
    box = field.bounding_box()
    x, y = box["x"] + box["width"] * .38, box["y"] + box["height"] * .27
    hit(p, '[data-id="ember"]', mobile)
    title = "Afterglow"
    if mp3:
        p.locator("#files").set_input_files(mp3)
        p.locator("#tracks .track-main").last.click()
        title = mp3.stem
    local_playing(p, title, .05)
    p.locator("#seek").focus()
    p.keyboard.press("Home")
    for _ in range(35):
        p.keyboard.press("ArrowRight")
    start = local_playing(p, title, 3.4)
    p.evaluate("""() => {
      const field = document.querySelector('#map-field');
      window.presses = [];
      field.addEventListener('pointerdown', e => presses.push({
        trusted: e.isTrusted, flying: field.hasAttribute('data-flying')
      }), true);
      const player = testAudio.find(a => a.src && !a.paused);
      window.audioMismatch = false;
      function listen() {
        const playing = testAudio.filter(a => a.src && !a.paused);
        if (playing.length !== 1 || playing[0] !== player) window.audioMismatch = true;
        window.audioFrame = requestAnimationFrame(listen);
      }
      listen();
    }""")
    p.go_back()
    assert p.url.endswith("#map=midnight")
    if mobile:
        touch(cdp, "touchStart", [(x - 18, y), (x + 18, y)])
        touch(cdp, "touchMove", [(x - 21, y + 7), (x + 27, y + 7)])
    else:
        p.mouse.move(x, y)
        p.mouse.down()
        p.mouse.move(x + 15, y + 8)
    assert p.evaluate("presses[0]?.trusted && presses[0]?.flying")
    assert field.evaluate("el => el.classList.contains('dragging') && !el.hasAttribute('data-flying')")
    if mobile:
        p.keyboard.press("Escape")
    else:
        p.go_back()
    assert p.url.endswith("#map=my-galaxy")
    assert field.evaluate("el => el.hasAttribute('data-flying')"), "Parent flight must actually have started"
    if mobile:
        touch(cdp, "touchMove", [(x - 34, y + 15), (x + 57, y + 23)])
        touch(cdp, "touchMove", [(x + 12, y + 35), (x + 64, y + 32)])
        touch(cdp, "touchEnd", [])
    else:
        p.mouse.move(x + 65, y + 32)
        p.mouse.up()
    assert p.url.endswith("#map=my-galaxy"), "A stale release selected another body"
    p.wait_for_function("!document.querySelector('[data-flying], .flight-body, .dragging')")
    restored = view(p)
    error = max(dist(first[:2], last[:2]) for first, last in zip(overview, restored))
    assert error < .12, f"Old gesture shifted the parent map by {error:.2f}px"
    assert all(abs(first[2] - last[2]) < .001 for first, last in zip(overview, restored))
    clock = local_playing(p, title, start)
    assert not p.evaluate("() => {cancelAnimationFrame(window.audioFrame); return window.audioMismatch}")
    hit(p, '[data-id="midnight"]', mobile)
    hit(p, '[data-id="tide"]', mobile)
    local_playing(p, "Blue Hour", .05)
    hit(p, "#back", mobile)
    hit(p, '[data-id="ember"]', mobile)
    resumed = local_playing(p, title, clock - .12)
    assert resumed < clock + 3, (clock, resumed)
    print(f"{'Touch + Escape' if mobile else 'Mouse + browser Back'} during flight: parent view error {error:.2f}px, "
          f"{title} stayed active; Tide → Ember resumed at {resumed:.2f}s (left at {clock:.2f}s).", flush=True)
    ctx.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chromium")
    args = parser.parse_args()
    with static_server() as url, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=args.chromium,
                                     args=["--disable-webgl", "--autoplay-policy=user-gesture-required"])
        for method in ("wheel", "pinch", "keyboard"):
            check_anchor(browser, url, method)
        check_anchor(browser, url, "pinch", reduced=True)
        check_held_gesture(browser, url, True)
        with TemporaryDirectory() as tmp:
            mp3 = Path(tmp) / "Held orbit.mp3"
            write_tone(mp3, 275)
            check_held_gesture(browser, url, False, mp3)
        browser.close()


if __name__ == "__main__":
    main()
