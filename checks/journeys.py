"""Measure where bodies depart and land during real flights across both map branches."""
import argparse
import json
from math import hypot
from pathlib import Path

from playwright.sync_api import sync_playwright

from camera import hit
from galaxy import AUDIO_PROBE, local_playing, static_server


PROBE = """() => {
  function center(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height};
  }
  function pixels(canvas) {
    const copy = document.createElement('canvas');
    copy.width = 32;
    copy.height = 24;
    const ctx = copy.getContext('2d');
    ctx.drawImage(canvas, 0, 0, 32, 24);
    return ctx.getImageData(0, 0, 32, 24).data;
  }
  const field = document.querySelector('#map-field');
  window.mapPaints = 0;
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function(...args) {
    if (this.canvas.id === 'orbits') window.mapPaints++;
    return clear.apply(this, args);
  };
  document.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;
    const target = button.querySelector('canvas,.moon-dot') || (button.id === 'back' && document.querySelector('#portrait'));
    window.leg = {
      from: location.hash, origin: center(target), previousVisual: center(document.querySelector('.flight-body')),
      trusted: e.isTrusted, flying: field.hasAttribute('data-flying'), start: performance.now(), frames: []
    };
  }, true);
  window.addEventListener('click', () => {
    const leg = window.leg;
    if (!leg) return;
    leg.to = location.hash;
    const sprite = document.querySelector('.flight-body');
    const saturn = leg.from === '#planet=saturn' && leg.to === '#map=solar-system'
      ? document.querySelector('[data-id=saturn] canvas') : null;
    leg.initial = center(sprite || saturn);
    if (leg.from === '#planet=titan' && leg.to === '#planet=saturn') {
      const titan = [...document.querySelectorAll('#moons button')].find(b => b.textContent.trim() === 'Titan');
      leg.moonTarget = center(titan?.firstElementChild);
    }
    if (leg.to === '#planet=titan' && sprite) {
      const travelling = pixels(sprite), portrait = pixels(document.querySelector('#portrait'));
      leg.sameMoon = travelling.every((v, i) => v === portrait[i]);
    }
    function sample(now) {
      if (leg !== window.leg) return;
      const body = document.querySelector('.flight-body');
      const flying = field.hasAttribute('data-flying');
      const context = !!document.querySelector('.flight-context');
      if (body || flying) leg.frames.push({
        t: now - leg.start, body: center(body || saturn), target: center(saturn), context
      });
      if (body || flying || context) requestAnimationFrame(sample);
      else leg.done = true;
    }
    requestAnimationFrame(sample);
  });
}"""


def separation(a, b):
    return hypot(a["x"] - b["x"], a["y"] - b["y"])


def journey(browser, url, mobile, evidence, measure_only):
    device = "touch" if mobile else "desktop"
    ctx = browser.new_context(viewport={"width": 390 if mobile else 1160, "height": 844 if mobile else 760},
                              has_touch=mobile, is_mobile=mobile)
    page = ctx.new_page()
    page.goto(url)
    page.locator(".world").first.wait_for()
    page.evaluate(PROBE)

    def go(name, selector, capture=False):
        hit(page, selector, mobile)
        if evidence and capture:
            page.wait_for_timeout(130)
            page.screenshot(path=evidence / f"{device}-{name}.jpg", type="jpeg", quality=84)
        page.wait_for_function("window.leg && leg.done")
        leg = page.evaluate("leg")
        assert leg["trusted"] and leg["frames"], (name, leg)
        if evidence:
            (evidence / f"{device}-{name}.json").write_text(json.dumps(leg))
        return leg

    for name in ("milky-way", "solar-system", "saturn"):
        go(name, f'[data-id="{name}"]', True)
    moon = go("titan", "#moons button", True)
    departure = separation(moon["origin"], moon["initial"])
    returning = go("titan-return", "#back", True)
    arrival = separation(returning["frames"][-1]["body"], returning["moonTarget"])
    retreat = go("saturn-return", "#back", True)
    mismatch = max(separation(s["body"], s["target"]) for s in retreat["frames"] if s["body"] and s["target"])
    if not measure_only:
        assert departure < 2 and arrival < 3 and moon["sameMoon"], (departure, arrival, moon["sameMoon"])
        assert separation(retreat["initial"], retreat["origin"]) < 2
        assert mismatch < 2, f"The visible body and its target separated by {mismatch:.2f}px"
    print(f"{device}: Titan departure {departure:.2f}px, arrival {arrival:.2f}px, matching texture {moon['sameMoon']}; "
          f"peak Saturn return gap {mismatch:.2f}px.", flush=True)

    go("root", "#home")
    for name in ("my-galaxy", "midnight", "ember"):
        go(name, f'[data-id="{name}"]', True)
    go("midnight-return", "#back")
    paints = page.evaluate("mapPaints")
    page.wait_for_timeout(300)
    assert page.evaluate("mapPaints") == paints, "The settled map kept repainting"
    assert not page.locator(".flight-body,.in-flight,.flight-context,[data-flying]").count()
    go("tide", '[data-id="tide"]', True)
    hit(page, "#back", mobile)
    hit(page, '[data-id="ember"]', mobile)
    assert page.url.endswith("#planet=ember") and page.evaluate("leg.trusted && leg.flying")
    if not measure_only:
        # Same-document hash navigation keeps the click probe installed.
        page.goto(url + "#planet=saturn")
        page.locator("#moons button").first.wait_for()
        hit(page, "#moons button", mobile)
        for selector in ("#back", "#moons button"):
            page.wait_for_function("!!document.querySelector('.flight-body')")
            page.wait_for_timeout(110)
            hit(page, selector, mobile)
            turn = page.evaluate("leg")
            assert turn["trusted"] and separation(turn["initial"], turn["previousVisual"]) < 2, turn
        assert page.url.endswith("#planet=titan")
        print(f"{device}: two mid-flight reversals preserved the visible moon position.", flush=True)
    ctx.close()


def interrupt_arrival(browser, url):
    ctx = browser.new_context(viewport={"width": 470, "height": 380})
    ctx.add_init_script(AUDIO_PROBE)
    ctx.add_init_script("""window.addEventListener('scroll', () => {
      if (scrollY > 0 && document.querySelector('.flight-body')) window.scrolledDuringFlight = true;
    }, true)""")
    p = ctx.new_page()
    p.goto(url + "#map=midnight")
    hit(p, '[data-id="ember"]')
    p.wait_for_function("!!document.querySelector('.flight-body')")
    p.mouse.move(230, 310)
    p.mouse.wheel(0, 160)
    p.wait_for_function("window.scrolledDuringFlight && !document.querySelector('.flight-body,.in-flight,.flight-context')")
    local_playing(p, "Afterglow", .08)
    p.keyboard.press("Escape")
    p.wait_for_function("!!document.querySelector('[data-flying]')")
    p.emulate_media(reduced_motion="reduce")
    p.wait_for_function("!document.querySelector('[data-flying],.flight-body,.flight-context,.in-flight')")
    local_playing(p, "Afterglow", .15)
    print("Scrolling the playlist and enabling reduced motion mid-flight both released the artwork; audio continued.")
    ctx.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chromium")
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--measure-only", action="store_true", help="Measure a revision from before the fixes")
    args = parser.parse_args()
    if args.evidence:
        args.evidence.mkdir(parents=True, exist_ok=True)
    with static_server() as url, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=args.chromium,
                                     args=["--disable-webgl", "--autoplay-policy=user-gesture-required"])
        for mobile in (False, True):
            journey(browser, url, mobile, args.evidence, args.measure_only)
        if not args.measure_only:
            interrupt_arrival(browser, url)
        browser.close()


if __name__ == "__main__":
    main()
