"""Test Planet A -> B -> A with real MP3s and the MusicKit integration with a test double."""
import argparse
from contextlib import contextmanager, nullcontext
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import tempfile
import threading

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
AUDIO_PROBE = """
const NativeAudio = window.Audio;
window.testAudio = [];
window.Audio = function (...args) {
  const audio = new NativeAudio(...args);
  window.testAudio.push(audio);
  return audio;
};
window.Audio.prototype = NativeAudio.prototype;
"""
MUSICKIT = """
const calls = [];
const events = new EventTarget();
const mk = window.testMusic = {
  calls, isAuthorized: false, storefrontId: 'th', currentPlaybackTime: 0, currentPlaybackDuration: 180,
  authorize() { calls.push(['authorize', navigator.userActivation.isActive]); this.isAuthorized=true; return Promise.resolve('test-user'); },
  unauthorize() { this.isAuthorized=false; return Promise.resolve(); },
  async setQueue(q) { calls.push(['queue', q.song]); await new Promise(r=>setTimeout(r,this.delay || 70)); this.currentPlaybackTime=0; },
  async play() { calls.push(['play']); this.playing=true; },
  async pause() { calls.push(['pause']); this.playing=false; },
  async seekToTime(t) { calls.push(['seek',t]); this.currentPlaybackTime=t; },
  addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
  api: { async music(path, options) {
    calls.push(['search',path,options.term]);
    return {data:{results:{songs:{data:[{id:'201',attributes:{name:'Cloud Atlas',artistName:'Test Artist',url:'https://music.apple.com/th/song/cloud-atlas/201'}}]}}}};
  }}
};
window.MusicKit = {async configure(){},getInstance:()=>mk, PlaybackStates:{paused:3,ended:5,completed:10}};
document.dispatchEvent(new Event('musickitloaded'));
"""


@contextmanager
def static_server():
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    with ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT))) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}/"
        finally:
            server.shutdown()
            thread.join()


def write_tone(path, frequency):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i",
                    f"sine=frequency={frequency}:duration=15", "-codec:a", "libmp3lame",
                    "-q:a", "5", str(path)], check=True)


def sky(page):
    page.locator("#home").click()
    expect(page.locator("#map")).to_be_visible()


def enter(page, name):
    button = page.get_by_role("button", name="เปิดดาว " + name, exact=True)
    if not button.count():
        while page.locator("#prev-page").is_visible() and page.locator("#prev-page").is_enabled():
            page.locator("#prev-page").click()
        while not button.count() and page.locator("#next-page").is_visible() and page.locator("#next-page").is_enabled():
            page.locator("#next-page").click()
    button.click()
    expect(page.locator("#world-title")).to_have_text(name)


def local_playing(page, name, minimum=0):
    expect(page.locator("#now-title")).to_have_text(name)
    page.wait_for_function(
        "s => testAudio.filter(a=>!a.paused && a.src).length===1 && "
        "testAudio.some(a=>!a.paused && a.currentTime>=s && a.readyState>=2)", arg=minimum)
    return page.evaluate("testAudio.find(a=>!a.paused).currentTime")


def check_files(browser, url, files, screenshots):
    context = browser.new_context(viewport={"width": 1280, "height": 820}, reduced_motion="reduce")
    page = context.new_page()
    errors, writes, apple_requests = [], [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda req: writes.append(req.method) if req.method != "GET" else None)
    page.on("request", lambda req: apple_requests.append(req.url) if "api/music-token" in req.url or "js-cdn.music.apple.com" in req.url else None)
    context.add_init_script(AUDIO_PROBE)
    page.goto(url)
    expect(page.locator(".world")).to_have_count(3)
    expect(page.locator("#tracks")).to_be_hidden()
    assert page.evaluate("testAudio.length") == 0
    if screenshots:
        page.screenshot(path=str(screenshots / "map.png"))
    page.locator("#new-world").click()
    page.locator("#world-name").fill("Night Drive")
    page.locator("#colors [value=jade]").check()
    page.locator("#save-world").click()
    expect(page.locator("#world-title")).to_have_text("Night Drive")
    page.locator("#files").set_input_files(files[:2])
    expect(page.locator("#tracks li")).to_have_count(2)
    page.locator("#tracks .track-main").nth(1).click()
    local_playing(page, "A2", .15)
    page.locator("#seek").evaluate("(e)=>{e.value=4.2;e.dispatchEvent(new Event('input'));}")
    local_playing(page, "A2", 4.1)
    if screenshots:
        page.screenshot(path=str(screenshots / "playlist.png"))
    sky(page)
    local_playing(page, "A2", 4.1)
    enter(page, "Luna")
    expect(page.locator("#transport")).to_be_hidden()
    assert page.evaluate("testAudio.every(a=>a.paused)")
    page.locator("#files").set_input_files(files[2])
    page.locator("#tracks .track-main").click()
    local_playing(page, "B", .1)
    page.locator("#seek").evaluate("(e)=>{e.value=8.1;e.dispatchEvent(new Event('input'));}")
    local_playing(page, "B", 8.0)
    sky(page)
    enter(page, "Night Drive")
    resumed = local_playing(page, "A2", 4.1)
    assert resumed < 8, resumed
    sky(page)
    enter(page, "Luna")
    assert 8 <= local_playing(page, "B", 8) < 12
    sky(page)
    enter(page, "Night Drive")
    resumed = local_playing(page, "A2", 4.1)
    page.reload()
    expect(page.locator("#tracks li")).to_have_count(2)
    assert page.evaluate("testAudio.length") == 0
    sky(page)
    enter(page, "Night Drive")
    restored = local_playing(page, "A2", 4.1)
    assert abs(resumed - restored) < 1.8, (resumed, restored)
    # A native ended event advances the playlist to the next stored file.
    page.locator("#tracks .track-main").first.click()
    local_playing(page, "A1", .1)
    page.evaluate("testAudio.find(a=>!a.paused).currentTime=testAudio.find(a=>!a.paused).duration-.15")
    local_playing(page, "A2", .05)
    page.locator("#manage").click()
    page.locator("#new-moon").click()
    page.locator("#world-name").fill("Quiet moon")
    page.locator("#save-world").click()
    expect(page.locator("#world-title")).to_have_text("Quiet moon")
    page.locator("#back").click()
    local_playing(page, "A2", .05)
    expect(page.locator("#moons button")).to_have_text("Quiet moon")
    assert not apple_requests, apple_requests
    page.route("**/api/music-token", lambda route: route.fulfill(json={"configured": False}))
    page.locator("#open-apple").click()
    expect(page.locator("#connect-apple")).to_be_disabled()
    expect(page.locator("#apple-status")).to_contain_text("ยังไม่ได้เปิดใช้")
    page.locator("#apple-links summary").click()
    page.locator("#song-url").fill("https://music.apple.com/th/album/example/101?i=301")
    page.locator("#song-label").fill("Saved Apple song")
    page.locator("#link-form button").click()
    expect(page.locator("#apple-feedback")).to_contain_text("เพิ่ม")
    page.locator("#apple [data-close]").click()
    expect(page.locator(".catalog-link")).to_have_attribute("href", "https://music.apple.com/th/song/301")
    assert not writes and not errors, (writes, errors)
    print(f"MP3 A2 resumed at {resumed:.2f}s, B resumed past 8s, reload restored {restored:.2f}s; no uploads or overlapping local players.")
    context.close()


def check_musickit(browser, url, file):
    context = browser.new_context()
    context.add_init_script(AUDIO_PROBE)
    context.route("**/api/music-token", lambda route: route.fulfill(json={"configured": True, "developerToken": "test-only"}))
    context.route("https://js-cdn.music.apple.com/musickit/v3/musickit.js", lambda route: route.fulfill(body=MUSICKIT, content_type="application/javascript"))
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url)
    enter(page, "Saturn")
    page.locator("#open-apple").click()
    page.locator("#connect-apple").click()
    expect(page.locator("#query")).to_be_visible()
    page.locator("#query").fill("Atlas")
    page.locator("#search-form button").click()
    page.locator("#results button").click()
    expect(page.locator("#apple-feedback")).to_contain_text("Cloud Atlas")
    page.locator("#apple [data-close]").click()
    page.locator("#tracks .track-main").click()
    page.wait_for_function("testMusic.playing === true")
    page.evaluate("testMusic.currentPlaybackTime=24.25")
    sky(page)
    enter(page, "Luna")
    assert not page.evaluate("testMusic.playing")
    page.locator("#files").set_input_files(file)
    page.locator("#tracks .track-main").click()
    local_playing(page, "B", .1)
    sky(page)
    enter(page, "Saturn")
    page.wait_for_function("testMusic.playing && testMusic.currentPlaybackTime===24.25")
    assert page.evaluate("testAudio.every(a=>a.paused)")
    calls = page.evaluate("testMusic.calls")
    assert ["authorize", True] in calls and ["search", "/v1/catalog/th/search", "Atlas"] in calls
    assert calls.count(["queue", "201"]) == 2 and ["seek", 24.25] in calls
    # Leave while MusicKit is preparing an Apple queue. A stale completion must not restart it.
    sky(page)
    enter(page, "Luna")
    local_playing(page, "B", .1)
    page.evaluate("testMusic.delay=850")
    sky(page)
    enter(page, "Saturn")
    page.wait_for_function("testMusic.calls.filter(c=>c[0]==='queue').length===3")
    sky(page)
    enter(page, "Luna")
    local_playing(page, "B", .1)
    page.wait_for_timeout(950)
    assert not page.evaluate("testMusic.playing")
    assert page.evaluate("testAudio.filter(a=>!a.paused && a.src).length") == 1
    sky(page)
    enter(page, "Saturn")
    page.wait_for_function("testMusic.playing && testMusic.currentPlaybackTime===24.25")
    page.locator("#open-apple").click()
    page.locator("#connect-apple").click()
    expect(page.locator("#connect-apple")).to_have_text("เชื่อมต่อ Apple Music")
    assert not page.evaluate("testMusic.playing")
    assert not errors, errors
    print("MusicKit test double: user-gesture authorization, storefront search, queue, MP3 handoff, 24.25s resume and disconnect passed.")
    context.close()


def check_mobile(browser, url, screenshots):
    context = browser.new_context(is_mobile=True, has_touch=True, viewport={"width": 390, "height": 844}, reduced_motion="reduce")
    page = context.new_page()
    page.goto(url)
    expect(page.locator(".world")).to_have_count(3)
    if screenshots:
        page.screenshot(path=str(screenshots / "mobile.png"))
    for name in ("Luna","Saturn","Neptune"):
        page.get_by_role("button", name="เปิดดาว " + name).tap()
        expect(page.locator("#world-title")).to_have_text(name)
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
        page.locator("#home").tap()
    context.close()
    print("Mobile Chromium emulation: all three map bodies reachable by touch.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chromium")
    parser.add_argument("--url", help="Test an existing deployment instead of starting a static server")
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp, (nullcontext(args.url) if args.url else static_server()) as url, sync_playwright() as api:
        files = [Path(temp) / name for name in ("Test - A1.mp3", "Test - A2.mp3", "Test - B.mp3")]
        for i, path in enumerate(files):
            write_tone(path, 200 + i*70)
        with api.chromium.launch(executable_path=args.chromium, args=["--autoplay-policy=user-gesture-required"]) as browser:
            check_files(browser, url, files, args.screenshots)
            check_musickit(browser, url, files[2])
            check_mobile(browser, url, args.screenshots)
            print("Galaxy checks passed in Chromium", browser.version)


if __name__ == "__main__":
    main()
