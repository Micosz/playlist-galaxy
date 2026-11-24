"""Measure where a planet stays during real wheel, keyboard and pinch input."""
import argparse
from math import dist

from playwright.sync_api import sync_playwright
from camera import rect_center, sprite
from galaxy import static_server


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
        browser.close()


if __name__ == "__main__":
    main()
