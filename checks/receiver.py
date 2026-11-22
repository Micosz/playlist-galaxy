"""Exercise the real receiver in a fresh Chromium profile. See ../README.md."""
import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright


PROBE = r"""
(() => {
  const probe = window.radioCheck = {contexts: [], reads: 0, paints: 0, intervals: new Set(), taps: [], mediaInputs: 0, tapDuringPreview: false};
  window.AudioContext = class extends AudioContext {
    constructor(...args) { super(...args); probe.contexts.push(this); }
  };
  const makeTap = AudioContext.prototype.createMediaStreamDestination;
  AudioContext.prototype.createMediaStreamDestination = function() {
    if (document.querySelector("#clip-player")?.paused === false) probe.tapDuringPreview = true;
    const tap = makeTap.call(this);
    probe.taps.push(tap);
    return tap;
  };
  const mediaInput = AudioContext.prototype.createMediaElementSource;
  AudioContext.prototype.createMediaElementSource = function(element) {
    probe.mediaInputs++;
    return mediaInput.call(this, element);
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination === this.context.destination && !probe.meter) {
      probe.meter = this.context.createAnalyser();
      probe.meter.fftSize = 2048;
      connect.call(this, probe.meter);
    }
    return connect.call(this, destination, ...args);
  };
  probe.peak = () => {
    const samples = new Float32Array(probe.meter.fftSize);
    probe.meter.getFloatTimeDomainData(samples);
    return Math.max(...samples.map(Math.abs));
  };
  const read = AnalyserNode.prototype.getByteTimeDomainData;
  AnalyserNode.prototype.getByteTimeDomainData = function(...args) {
    probe.reads++;
    return read.apply(this, args);
  };
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function(...args) {
    if (this.canvas.id === "sky" && args.length === 3) probe.paints++;
    return draw.apply(this, args);
  };
  const schedule = window.setInterval.bind(window), cancel = window.clearInterval.bind(window);
  window.setInterval = (...args) => {
    const id = schedule(...args);
    probe.intervals.add(id);
    return id;
  };
  window.clearInterval = id => { probe.intervals.delete(id); cancel(id); };
})();
"""


def check_desktop(page, url):
    page.goto(url)
    page.wait_for_function("radioCheck.paints > 0")
    dial, power = page.locator("#dial"), page.locator("#power")
    assert power.inner_text() == "Power on"
    page.keyboard.press("2")
    page.keyboard.press("m")
    assert dial.get_attribute("aria-valuenow") == "2"
    assert page.evaluate("radioCheck.contexts.length") == 0
    power.click()
    page.wait_for_function("radioCheck.intervals.size === 1")
    page.wait_for_timeout(200)
    assert page.evaluate("radioCheck.peak()") == 0
    page.keyboard.press("m")
    for key, name in [("1", "Cassini Drift"), ("2", "Ice Choir"), ("3", "Hex Static")]:
        page.keyboard.press(key)
        assert name in dial.get_attribute("aria-valuetext")
        page.wait_for_function("radioCheck.peak() > .005")
    page.evaluate("radioCheck.reads = radioCheck.paints = 0")
    page.wait_for_timeout(1500)
    reads, paints = page.evaluate("[radioCheck.reads, radioCheck.paints]")
    assert reads == paints and paints > 0
    print(f"On air: {reads} waveform reads / {paints} paints in 1.5 seconds")

    page.locator("#volume").focus()
    page.keyboard.press("Home")
    assert page.locator("#volume").input_value() == "0"
    page.wait_for_function("radioCheck.peak() === 0")
    page.keyboard.press("End")
    dial.focus()
    page.wait_for_function("radioCheck.peak() > .005")
    page.evaluate("for (let i=0; i<30; i++) document.querySelectorAll('.preset')[i%3].click()")
    assert "Hex Static" in dial.get_attribute("aria-valuetext")
    assert page.evaluate("radioCheck.intervals.size") == 1

    page.emulate_media(reduced_motion="reduce")
    page.keyboard.press("Home")
    assert dial.get_attribute("aria-valuenow") == "1"
    page.wait_for_timeout(100)
    frames = page.evaluate("[radioCheck.paints, radioCheck.reads]")
    page.wait_for_timeout(160)
    assert page.evaluate("[radioCheck.paints, radioCheck.reads]") == frames
    page.wait_for_function("radioCheck.peak() > .005")
    page.locator("#guide-open").click()
    page.keyboard.press("3")
    assert dial.get_attribute("aria-valuenow") == "1"
    page.keyboard.press("Escape")
    assert not page.locator("#guide").is_visible()

    power.click()
    page.wait_for_function("radioCheck.contexts[0].state === 'suspended'")
    assert page.evaluate("radioCheck.intervals.size") == 0
    stopped_at = page.evaluate("radioCheck.contexts[0].currentTime")
    page.wait_for_timeout(150)
    assert page.evaluate("radioCheck.contexts[0].currentTime") == stopped_at
    page.evaluate("const p=document.querySelector('#power'); p.click(); p.click()")
    page.wait_for_function("radioCheck.contexts[0].state === 'suspended'")
    assert page.evaluate("radioCheck.intervals.size") == 0
    page.keyboard.press("m")
    power.click()
    page.wait_for_function("radioCheck.intervals.size === 1")
    page.wait_for_timeout(120)
    assert page.evaluate("radioCheck.peak()") == 0
    page.keyboard.press("m")
    page.evaluate("const p=document.querySelector('#power'); p.click(); p.click()")
    page.wait_for_timeout(250)
    assert page.evaluate("[radioCheck.contexts.length, radioCheck.contexts[0].state, radioCheck.intervals.size]") == [1, "running", 1]
    page.wait_for_function("radioCheck.peak() > .005")
    page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))")
    page.wait_for_function("radioCheck.contexts[0].state === 'suspended'")
    assert power.inner_text() == "Power on"
    page.reload()
    assert page.evaluate("radioCheck.contexts.length") == 0


def read_clip(page):
    return page.locator("#save-clip").evaluate("""async link => {
      const blob = await (await fetch(link.href)).blob();
      const decoder = new OfflineAudioContext(2, 1, 48000);
      const audio = await decoder.decodeAudioData(await blob.arrayBuffer());
      let peak = 0;
      for (let ch = 0; ch < audio.numberOfChannels; ch++) {
        for (const value of audio.getChannelData(ch)) peak = Math.max(peak, Math.abs(value));
      }
      return {duration: audio.duration, peak, bytes: blob.size, type: blob.type};
    }""")


def check_aircheck(page):
    power, record, save = (page.locator(selector) for selector in ["#power", "#record", "#save-clip"])
    assert record.is_disabled() and not save.is_visible()
    page.emulate_media(reduced_motion="no-preference")
    power.click()
    page.wait_for_function("radioCheck.peak() > .005")
    record.focus()
    page.keyboard.press("Space")
    page.wait_for_function("document.querySelector('#record').innerText === 'Stop clip'")
    page.wait_for_timeout(350)
    page.keyboard.press("2")
    page.wait_for_timeout(350)
    page.keyboard.press("3")
    save.wait_for(timeout=18000)
    audio = read_clip(page)
    assert 11 <= audio["duration"] <= 13.5 and audio["peak"] > .005, audio
    assert audio["type"].startswith("audio/")
    with page.expect_download() as downloaded:
        save.click()
    download = downloaded.value
    assert download.suggested_filename.startswith("ringband-aircheck-")
    assert download.path().stat().st_size == audio["bytes"]
    print(f'Aircheck: {audio["duration"]:.2f} seconds, {audio["bytes"]} bytes, decoded peak {audio["peak"]:.3f}')

    previous = save.get_attribute("href")
    page.keyboard.press("m")
    page.wait_for_function("radioCheck.peak() === 0")
    record.click()
    page.wait_for_timeout(750)
    power.click()
    page.wait_for_function("url => document.querySelector('#save-clip').href !== url", arg=previous)
    silent = read_clip(page)
    assert .35 <= silent["duration"] < 3 and silent["peak"] < .0001, silent
    assert record.is_disabled()
    print(f'Muted aircheck: {silent["duration"]:.2f} seconds, decoded peak {silent["peak"]:.7f}')
    assert not page.evaluate("async url => { try { await fetch(url); return true; } catch { return false; } }", previous)

    # A completed take survives encoder failure; a departing page releases every take.
    power.click()
    old_url = save.get_attribute("href")
    page.evaluate("""() => {
      window.originalStart = MediaRecorder.prototype.start;
      MediaRecorder.prototype.start = () => { throw new Error("encoder unavailable"); };
    }""")
    record.click()
    assert page.locator(".record-error").is_visible()
    assert save.get_attribute("href") == old_url
    page.evaluate("() => { MediaRecorder.prototype.start = window.originalStart; }")
    page.evaluate("""() => {
      window.originalURL = URL.createObjectURL;
      URL.createObjectURL = () => { throw new Error("out of memory"); };
    }""")
    record.click()
    page.wait_for_timeout(300)
    record.click()
    page.wait_for_function("document.querySelector('.record-error').textContent.includes('prepare')")
    assert save.get_attribute("href") == old_url
    page.evaluate("() => { URL.createObjectURL = window.originalURL; }")
    page.keyboard.press("m")
    record.click()
    page.wait_for_timeout(450)
    record.press("Space")
    page.wait_for_function("url => document.querySelector('#save-clip').href !== url", arg=old_url)
    assert read_clip(page)["peak"] > .001
    record.click()
    page.wait_for_timeout(150)
    page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))")
    page.wait_for_function("radioCheck.contexts[0].state === 'suspended'")
    page.wait_for_timeout(120)
    assert not save.is_visible() and record.is_disabled()
    assert page.evaluate("radioCheck.taps.every(tap => tap.stream.getTracks().every(t => t.readyState === 'ended'))")


def check_preview(page):
    page.reload()
    power, record, preview, player, save = (
        page.locator("#" + name) for name in ["power", "record", "preview-clip", "clip-player", "save-clip"]
    )

    def take(milliseconds):
        previous = save.get_attribute("href")
        record.click()
        page.wait_for_timeout(milliseconds)
        record.click()
        page.wait_for_function("old => { const a = document.querySelector('#save-clip'); return !a.hidden && a.href !== old; }", arg=previous)

    def play(keyboard=False):
        if keyboard:
            preview.press("Space")
        else:
            preview.click()
        page.wait_for_function("document.querySelector('#clip-player').currentTime > .1 && document.querySelector('#status').textContent === 'Playing clip'")

    def stopped():
        page.wait_for_function("!document.querySelector('#clip-player').hasAttribute('src')")
        assert player.evaluate("e => e.paused")

    def download_bytes():
        with page.expect_download() as downloaded:
            save.click()
        return downloaded.value.path().read_bytes()

    assert not preview.is_visible() and not player.get_attribute("src")
    power.click()
    page.wait_for_function("radioCheck.peak() > .005")
    take(2300)
    assert preview.is_visible() and player.get_attribute("src") is None
    original = download_bytes()
    clock = page.evaluate("[...radioCheck.intervals][0]")
    for keyboard in [False, True]:
        play(keyboard)
        page.wait_for_function("radioCheck.peak() === 0")
        assert page.evaluate("[...radioCheck.intervals]") == [clock]
        assert player.evaluate("e => e.readyState >= 3 && !e.paused")
        assert download_bytes() == original
        stopped()
        page.wait_for_function("radioCheck.peak() > .005")

    play()
    page.keyboard.press("m")
    assert player.evaluate("e => e.muted")
    page.locator("#volume").focus()
    page.keyboard.press("Home")
    page.locator("#mute").click()
    assert player.evaluate("e => e.muted && e.volume === 0")
    page.locator("#volume").focus()
    page.keyboard.press("End")
    assert player.evaluate("e => !e.muted && e.volume === 1")
    page.locator("#dial").press("3")
    stopped()
    assert page.locator("#dial").get_attribute("aria-valuenow") == "3"
    assert download_bytes() == original

    play()
    power.click()
    stopped()
    page.wait_for_function("radioCheck.contexts[0].state === 'suspended'")
    at = page.evaluate("radioCheck.contexts[0].currentTime")
    play()
    assert record.is_disabled()
    assert page.evaluate("[radioCheck.contexts.length, radioCheck.contexts[0].currentTime, radioCheck.intervals.size]") == [1, at, 0]
    power.click()
    stopped()
    page.wait_for_function("radioCheck.peak() > .005")

    # A cancelled play promise must never undo a later successful audition.
    page.evaluate("""() => {
      const nativePlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function() {
        HTMLMediaElement.prototype.play = nativePlay;
        return new Promise((_, reject) => { window.rejectOldPreview = reject; });
      };
    }""")
    preview.click()
    assert preview.inner_text() == "Cancel preview"
    page.keyboard.press("2")
    play()
    page.evaluate("() => window.rejectOldPreview(new DOMException('Old request', 'NotSupportedError'))")
    assert preview.inner_text() == "Stop preview"
    old = save.get_attribute("href")
    record.click()
    stopped()
    assert preview.is_disabled()
    page.wait_for_timeout(450)
    record.click()
    page.wait_for_function("old => document.querySelector('#save-clip').href !== old", arg=old)
    assert read_clip(page)["peak"] > .005
    assert page.evaluate("[radioCheck.mediaInputs, radioCheck.tapDuringPreview]") == [0, False]

    # Denied playback is retryable. A real decoder failure must leave the download intact.
    page.evaluate("""() => {
      const nativePlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function() {
        HTMLMediaElement.prototype.play = nativePlay;
        return Promise.reject(new DOMException("Playback denied", "NotAllowedError"));
      };
    }""")
    preview.click()
    page.wait_for_function("document.querySelector('.record-error').textContent.includes('retry')")
    assert preview.is_enabled() and save.is_visible()
    play()
    preview.click()
    stopped()
    page.evaluate("""() => {
      const create = URL.createObjectURL;
      URL.createObjectURL = () => {
        URL.createObjectURL = create;
        return create(new Blob(["unsupported test audio"], {type: "audio/x-test"}));
      };
    }""")
    take(350)
    preview.click()
    page.wait_for_function("document.querySelector('.record-error').textContent.includes('format')")
    assert not preview.is_visible() and save.evaluate("a => a === document.activeElement")
    assert download_bytes() == b"unsupported test audio"
    take(600)
    play()
    page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))")
    stopped()
    assert not preview.is_visible() and not save.is_visible()
    print("Replay: repeated native playback, live isolation, mute, tuning, standby, cancellation and codec fallback passed")


def check_optional_recorder(browser, url):
    page = browser.new_page()
    page.add_init_script("""(() => {
      window.MediaRecorder = undefined;
      const resume = AudioContext.prototype.resume;
      AudioContext.prototype.resume = function() {
        AudioContext.prototype.resume = resume;
        return Promise.reject(new DOMException("Playback denied", "NotAllowedError"));
      };
    })()""")
    page.goto(url)
    assert not page.locator("#aircheck").is_visible()
    page.locator("#power").click()
    page.wait_for_function("document.querySelector('#status').textContent === 'Audio unavailable'")
    assert page.locator("#power").inner_text() == "Power on"
    page.locator("#power").click()
    page.wait_for_function("document.querySelector('#status').classList.contains('live')")
    page.close()


def check_touch(browser, url):
    with browser.new_context(has_touch=True, is_mobile=True, viewport={"width": 390, "height": 844}) as context:
        page = context.new_page()
        page.goto(url)
        dial = page.locator("#dial")
        dial.tap()
        assert dial.get_attribute("aria-valuenow") == "2"
        box = dial.bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        power, record = page.locator("#power"), page.locator("#record")
        assert power.inner_text() == "Power on"
        button = power.bounding_box()
        bx, by = button["x"] + button["width"] / 2, button["y"] + button["height"] / 2
        page.evaluate("""() => {
          window.powerClicks = [];
          document.querySelector("#power").addEventListener("click", e => powerClicks.push(e.isTrusted));
        }""")
        client = context.new_cdp_session(page)

        def touch(kind, position=None):
            points = [{"x": position[0], "y": position[1]}] if position else []
            client.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})

        # Tap power immediately after lifting from the drag, using one native touch stream.
        touch("touchStart", (x, y))
        touch("touchMove", (x + box["width"] * .7, y))
        touch("touchEnd")
        touch("touchStart", (bx, by))
        touch("touchEnd")
        page.wait_for_function("document.querySelector('#power').getAttribute('aria-pressed') === 'true'", timeout=3000)
        assert page.evaluate("powerClicks") == [True]
        assert dial.get_attribute("aria-valuenow") == "3"
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")

        # A return to the starting detent is still a drag. Releasing must keep that station.
        touch("touchStart", (x, y))
        touch("touchMove", (x - box["width"] * .7, y))
        touch("touchMove", (x, y))
        touch("touchEnd")
        assert dial.get_attribute("aria-valuenow") == "3"
        record.tap()
        page.wait_for_timeout(700)
        record.tap()
        preview = page.locator("#preview-clip")
        preview.tap()
        page.wait_for_function("document.querySelector('#clip-player').currentTime > .05")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        power.tap()
        assert page.locator("#clip-player").evaluate("e => e.paused && !e.hasAttribute('src')")
        assert page.evaluate("powerClicks") == [True, True]

        # Dragging off the native power button must leave the receiver in standby.
        touch("touchStart", (bx, by))
        touch("touchMove", (bx + button["width"], by))
        touch("touchEnd")
        page.wait_for_timeout(350)  # Include any delayed compatibility click in the assertion.
        assert power.inner_text() == "Power on" and page.evaluate("powerClicks") == [True, True]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chromium", help="Path to a system Chromium executable")
    args = parser.parse_args()
    url = (Path(__file__).resolve().parents[1] / "index.html").as_uri()
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path=args.chromium, args=["--autoplay-policy=user-gesture-required"])
        page = browser.new_page(viewport={"width": 1100, "height": 760})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script(PROBE)
        check_desktop(page, url)
        check_aircheck(page)
        check_preview(page)
        check_optional_recorder(browser, url)
        check_touch(browser, url)
        assert not errors, errors
        print(f"Chromium {browser.version}: receiver, silence, standby, reduced motion and touch passed")
        browser.close()


if __name__ == "__main__":
    main()
