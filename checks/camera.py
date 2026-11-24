"""Exercise the projected map with real pointer input and a decoder during flights."""
import argparse
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright
from galaxy import AUDIO_PROBE, local_playing, static_server, write_tone


def sprite(page, name):
    return page.locator(f'.world[data-id="{name}"] canvas')


def rect_center(box):
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def hit(page, selector, touch=False):
    # Moving controls are intentionally actionable. Find the current visible
    # point, verify hit testing, then send a trusted physical tap/click there.
    point = page.wait_for_function("""sel => {
      const el=document.querySelector(sel); if(!el || !el.getClientRects().length) return false;
      const r=el.getBoundingClientRect();
      for(const fy of [.48,.33,.65,.8]) for(const fx of [.5,.3,.7]) {
        const x=r.left+r.width*fx, y=r.top+r.height*fy;
        if(el.contains(document.elementFromPoint(x,y))) return {x,y};
      }
    }""",arg=selector,timeout=2500).json_value()
    action = page.touchscreen.tap if touch else page.mouse.click
    action(point["x"],point["y"])


def view(page):
    return page.locator(".world").evaluate_all("""buttons => buttons.map(b =>
      ['--dx','--dy','--scale'].map(k=>parseFloat(b.style.getPropertyValue(k))))""")


def run_gestures(browser, url, mobile):
    ctx=browser.new_context(viewport={"width":390 if mobile else 1160,"height":844 if mobile else 760},
                            has_touch=mobile,is_mobile=mobile)
    ctx.add_init_script(AUDIO_PROBE)
    p=ctx.new_page()
    p.goto(url+"#map=solar-system")
    expect(p.locator(".world")).to_have_count(8)
    before=view(p)
    x,y=rect_center(sprite(p,"earth").bounding_box())
    if mobile:
        cdp=ctx.new_cdp_session(p)
        def touch(kind, points):
            cdp.send("Input.dispatchTouchEvent",{"type":kind,"touchPoints":[
                {"id":i+1,"x":x,"y":y} for i,(x,y) in enumerate(points)]})
        touch("touchStart",[(x,y)])
        for i in range(1,9): touch("touchMove",[(x+i*7,y+i*2)])
        touch("touchEnd",[])
        p.wait_for_timeout(420)
        rotated=view(p)
        touch("touchStart",[(140,371),(218,372)])
        for i in range(1,7): touch("touchMove",[(140-i*5+8,371+2*i),(218+i*5+8,372+2*i)])
        touch("touchEnd",[])
    else:
        p.mouse.move(x,y);p.mouse.down();p.mouse.move(x+96,y+22,steps=9);p.mouse.up()
        p.wait_for_timeout(420)
        rotated=view(p)
        p.mouse.wheel(0,-210)
    p.wait_for_timeout(500)
    zoomed=view(p)
    assert max(abs(s[0]-t[0]) for s,t in zip(rotated,before))>12
    assert max(abs(s[2]-t[2]) for s,t in zip(rotated,zoomed))>.15
    assert p.url.endswith("#map=solar-system") and p.evaluate("testAudio.length")==0
    # The next tap following a completed drag or pinch must still select.
    hit(p,'[data-id="earth"]',mobile)
    expect(p.locator("#world-title")).to_have_text("Earth")
    hit(p,"#back",mobile)
    p.wait_for_function("!document.querySelector('[data-flying],.flight-body')")
    restored=view(p)
    assert all(abs(x-y)<.12 for left,right in zip(zoomed,restored) for x,y in zip(left,right)), (zoomed,restored)
    p.locator("#camera-home").click()
    p.wait_for_timeout(650)
    assert all(abs(s[2]-1)<.002 for s in view(p))
    # The overview is cheap on a cold visit, and a magnified, visible planet
    # gets the full-resolution surface once the camera has settled.
    if not mobile:
        narrow=p.locator('[data-id="mercury"] canvas')
        assert narrow.evaluate("el=>el.width")==260
        for _ in range(5): p.locator("#zoom-in").click()
        p.wait_for_function("document.querySelector('[data-id=mercury] canvas').width===520")
        p.locator("#camera-home").click()
        p.wait_for_timeout(650)
    field=p.locator("#map-field")
    field.focus();p.keyboard.press("ArrowRight");p.keyboard.press("Shift+ArrowDown");p.keyboard.press("+")
    p.wait_for_timeout(450)
    assert max(abs(s[2]-1) for s in view(p))>.15
    p.keyboard.press("0");p.wait_for_timeout(550)
    p.get_by_role("button",name="เปิดดาว Earth",exact=True).focus();p.keyboard.press("Enter")
    expect(p.locator("#world-title")).to_have_text("Earth")
    ctx.close()
    print(("Touch" if mobile else "Mouse")+" orbit, zoom, first post-drag tap, saved view and keyboard passed.",flush=True)


def check_audio_flight(browser,url,mobile,uploaded):
    ctx=browser.new_context(viewport={"width":390 if mobile else 1160,"height":844 if mobile else 760},
                            is_mobile=mobile,has_touch=mobile)
    ctx.add_init_script(AUDIO_PROBE)
    p=ctx.new_page()
    errors=[]
    p.on("pageerror",lambda error: errors.append(str(error)))
    p.goto(url+"#map=midnight")
    a,b,ta,tb="ember","tide","Afterglow","Blue Hour"
    if uploaded:
        for world,file in zip(("ember","tide"),uploaded):
            hit(p,f'[data-id="{world}"]',mobile)
            p.locator("#files").set_input_files(file)
            p.locator("#tracks .track-main").last.click()
            local_playing(p,file.stem,.03)
            hit(p,"#back",mobile)
            p.wait_for_function("!document.querySelector('[data-flying],.flight-body')")
        ta,tb=[f.stem for f in uploaded]
    # Listen, seek via the normal range control, then return while A is playing.
    hit(p,f'[data-id="{a}"]',mobile)
    local_playing(p,ta,.06)
    p.locator("#seek").focus();p.keyboard.press("Home")
    for _ in range(70): p.keyboard.press("ArrowRight")
    start=local_playing(p,ta,6.8)
    # Record trusted click state at dispatch, before the old flight can finish.
    p.evaluate("""window.flightClicks=[];document.addEventListener('click', e=>{
      const w=e.target.closest('.world');
      if(w) flightClicks.push({id:w.dataset.id,flying:!!document.querySelector('[data-flying]'),trusted:e.isTrusted})
    },true)""")
    for world,title in [(b,tb),(a,ta),(b,tb),(a,ta)]:
        hit(p,"#back",mobile)
        hit(p,f'[data-id="{world}"]',mobile)
        assert p.url.endswith("#planet="+world)
        local_playing(p,title,6.8 if world==a else .02)
    p.wait_for_function("!document.querySelector('.flight-body,.in-flight,[data-flying]')")
    finish=local_playing(p,ta,6.8)
    clicks=p.evaluate("flightClicks")
    assert [v["id"] for v in clicks]==[b,a,b,a] and all(v["flying"] and v["trusted"] for v in clicks),clicks
    assert start-.1 <= finish < start+3 and not errors, (start,finish,errors)
    assert p.evaluate("testAudio.filter(a=>a.src&&!a.paused).length")==1
    print(f"{'MP3' if uploaded else 'Demo'} {a}→{b}→{a} twice, {len(clicks)} trusted mid-flight selections, one active player; {start:.2f}s→{finish:.2f}s.",flush=True)
    ctx.close()


def reduced(browser,url):
    ctx=browser.new_context(reduced_motion="reduce")
    ctx.add_init_script(AUDIO_PROBE)
    p=ctx.new_page()
    p.goto(url+"#planet=ember")
    expect(p.locator("#world-title")).to_have_text("Ember")
    assert p.evaluate("testAudio.length")==0
    hit(p,"#back");hit(p,'[data-id="tide"]')
    local_playing(p,"Blue Hour",.06)
    assert not p.locator(".flight-body,[data-flying]").count()
    p.go_back()
    expect(p.locator("#map-name")).to_have_text("Midnight")
    p.go_forward()
    expect(p.locator("#world-title")).to_have_text("Tide")
    assert not p.locator(".flight-body,[data-flying]").count()
    ctx.close()
    print("Silent deep link, reduced motion, browser Back/Forward passed.",flush=True)


def detail_navigation(browser,url):
    ctx=browser.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True)
    ctx.add_init_script(AUDIO_PROBE)
    p=ctx.new_page()
    p.goto(url+"#map=midnight")
    hit(p,'[data-id="ember"]',True)
    local_playing(p,"Afterglow",.10)
    width=p.locator("#portrait").bounding_box()["width"]
    hit(p,"#playlist-toggle",True)
    expect(p.locator("#playlist-toggle")).to_have_attribute("aria-expanded","false")
    expect(p.locator("#playlist-body")).to_be_hidden()
    assert p.locator("#portrait").bounding_box()["width"]>width+35
    assert p.evaluate("testAudio.length")==1
    local_playing(p,"Afterglow",.12)
    p.get_by_role("navigation",name="เส้นทางกลับจากดาว").get_by_role("button",name="My Galaxy").tap()
    expect(p.locator("#map-name")).to_have_text("My Galaxy")
    local_playing(p,"Afterglow",.12)
    p.goto(url+"#planet=earth")
    hit(p,"#moons button",True)
    expect(p.locator("#detail-location")).to_have_text("Luna")
    expect(p.locator("#playlist-body")).to_be_hidden()
    hit(p,"#manage",True)
    p.keyboard.press("Escape")
    expect(p.locator("#options")).to_be_hidden()
    assert p.url.endswith("#planet=luna")
    p.keyboard.press("Escape")
    expect(p.locator("#world-title")).to_have_text("Earth")
    p.keyboard.press("Escape")
    expect(p.locator("#map-name")).to_have_text("ระบบสุริยะ")
    p.keyboard.press("Escape")
    expect(p.locator("#map-name")).to_have_text("ทางช้างเผือก")
    p.keyboard.press("Escape")
    expect(p.locator("#map-name")).to_have_text("My universe")
    p.wait_for_function("!document.querySelector('.flight-body,.in-flight,[data-flying]')")
    p.go_back()
    expect(p.locator("#map-name")).to_have_text("ทางช้างเผือก")
    assert p.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
    ctx.close()
    print("Folded playlist keeps sound and moons, direct ancestor link and four interrupted Escape flights passed.",flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    with static_server() as url, TemporaryDirectory() as tmp, sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=args.chromium,args=["--disable-webgl","--autoplay-policy=user-gesture-required"])
        with browser.new_page() as probe:
            assert not probe.evaluate("document.createElement('canvas').getContext('webgl2')")
        for mobile in (False,True): run_gestures(browser,url,mobile)
        paths=[Path(tmp)/"Orbit A.mp3",Path(tmp)/"Orbit B.mp3"]
        for i,f in enumerate(paths): write_tone(f,220+i*110)
        check_audio_flight(browser,url,False,paths)
        check_audio_flight(browser,url,True,None)
        reduced(browser,url)
        detail_navigation(browser,url)
        print("Camera checks passed with WebGL disabled in Chromium",browser.version)
        browser.close()


if __name__=="__main__": main()
