"""One-thumb journeys with trusted touch input, native range events, real audio and history."""
import argparse
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from camera import hit, view
from galaxy import AUDIO_PROBE, local_playing, static_server, write_tone
from navigation import touch

PROBE = """window.thumbEvents=[]; for(const type of ['pointerdown','pointerup','pointercancel','input','change','click']){
  window.addEventListener(type,e=>{
    if(e.target.id==='thumb-range'||type==='click'&&e.target.closest('#thumb-nav,.world,#moons button'))
      thumbEvents.push([type,e.isTrusted,location.hash]);
  },{capture:true,passive:true});
}"""


def phone(browser, width, height, reduced=False):
    ctx=browser.new_context(viewport={"width":width,"height":height}, device_scale_factor=1,
                            is_mobile=True, has_touch=True, reduced_motion="reduce" if reduced else "no-preference")
    ctx.add_init_script(AUDIO_PROBE)
    ctx.add_init_script(PROBE)
    return ctx


def tap(p, selector):
    hit(p,selector,True)


def settled(p):
    p.wait_for_function("!document.querySelector('.flight-body,.in-flight,.flight-context,[data-flying]')")


def choose(p, selector, name):
    tap(p,"#thumb-flight")
    expect(p.locator("#thumb-pick")).to_be_visible()
    tap(p,selector)
    expect(p.locator("#thumb-range")).to_be_visible()
    expect(p.locator("#thumb-target")).to_have_text("บินไป "+name)


def slide_point(p, value):
    r=p.locator("#thumb-range").bounding_box()
    return (r["x"]+8+(r["width"]-16)*value/100,r["y"]+r["height"]/2)


def slide(p, session, start, end, release=True):
    touch(session,"touchStart",[slide_point(p,start)])
    steps=5
    for i in range(1,steps+1):
        touch(session,"touchMove",[slide_point(p,start+(end-start)*i/steps)])
    p.wait_for_function("v=>Math.abs(document.querySelector('#thumb-range').value-v)<=2",arg=end)
    if release: touch(session,"touchEnd",[])


def safe_layout(p):
    layout=p.evaluate("""() => {
      const rect=sel=>{
        const e=document.querySelector(sel); if(!e?.getClientRects().length)return null;
        const {left,top,right,bottom,width,height}=e.getBoundingClientRect();
        return {left,top,right,bottom,width,height};};
      const names=['#scene','#map-help','#thumb-nav','#thumb-up','#thumb-range','#thumb-cancel',
                   '#thumb-flight','#transport','#toggle','#seek','#skip','#trail','.camera-tools',
                   '#map-pages','.map-caption','#new-world'];
      return Object.fromEntries(names.map(k=>[k,rect(k)]));
    }""")
    screen=p.viewport_size
    assert p.evaluate("document.documentElement.scrollWidth<=innerWidth+1 && document.documentElement.scrollHeight<=innerHeight+1")
    nav,player=layout["#thumb-nav"],layout["#transport"]
    if nav:
        assert nav["height"]>=44 and layout["#scene"]["bottom"]<=nav["top"]+1
        if layout["#map-help"]: assert layout["#map-help"]["bottom"]<=nav["top"]+1
        if player: assert nav["bottom"] <= player["top"]+1
    for key in ("#thumb-up","#thumb-range","#thumb-cancel","#thumb-flight","#toggle","#skip","#seek"):
        box=layout[key]
        if box:
            assert box["height"]>=44 and box["left"]>=0 and box["right"]<=screen["width"]+1 and box["bottom"]<=screen["height"]+1,(key,box)
    for pair in (("#trail",".camera-tools"),(".map-caption","#map-pages"),("#thumb-range","#thumb-cancel")):
        a,b=(layout[k] for k in pair)
        if a and b:
            assert min(a["right"],b["right"])-max(a["left"],b["left"])<=1 or min(a["bottom"],b["bottom"])-max(a["top"],b["top"])<=1,pair
    return layout


def switching(browser,url,width,height,files=None,evidence=None):
    ctx=phone(browser,width,height);p=ctx.new_page();cdp=ctx.new_cdp_session(p)
    errors=[]
    p.on("pageerror",lambda e: errors.append(str(e)))
    p.goto(url+"#map=midnight")
    expect(p.locator("#thumb-flight")).to_be_visible()
    names=["Afterglow","Blue Hour"]
    if files:
        for i,(world,f) in enumerate(zip(("ember","tide"),files)):
            tap(p,f'[data-id="{world}"]')
            p.locator("#files").set_input_files(f)
            p.locator("#tracks .track-main").last.tap()
            names[i]=f.stem
            local_playing(p,names[i],.05)
            tap(p,"#thumb-up");settled(p)
    tap(p,'[data-id="ember"]')
    local_playing(p,names[0],.04)
    p.locator("#seek").focus();p.keyboard.press("Home")
    for _ in range(19):p.keyboard.press("ArrowRight")
    local_playing(p,names[0],1.75)
    tap(p,"#thumb-up");settled(p)
    layout=safe_layout(p)
    hist=p.evaluate("history.length");origin=view(p)
    choose(p,'[data-id="tide"]',"Tide")
    slide(p,cdp,0,55)
    assert p.url.endswith("#map=midnight") and p.evaluate("history.length")==hist
    local_playing(p,names[0],1.75)
    shape=lambda:p.locator(".flight-body").evaluate("e=>e.getBoundingClientRect().toJSON()")
    paused=shape()
    p.wait_for_timeout(780)
    assert shape()==paused
    slide(p,cdp,55,29)
    assert abs(shape()["width"]-paused["width"])>1
    safe_layout(p)
    if evidence:p.screenshot(path=str(evidence/f"{width}-held.png"))
    tap(p,"#toggle");expect(p.locator("#toggle")).to_have_attribute("aria-label","เล่นต่อ")
    tap(p,"#toggle");local_playing(p,names[0],1.75)
    tap(p,"#thumb-cancel")
    assert p.url.endswith("#map=midnight") and p.evaluate("history.length")==hist and origin==view(p)
    local_playing(p,names[0],1.75)
    choose(p,'[data-id="tide"]',"Tide")
    slide(p,cdp,0,100,False)
    assert p.url.endswith("#map=midnight") and p.evaluate("history.length")==hist
    local_playing(p,names[0],1.75)
    # Even at 100%, retracting a still-held thumb must not change the current track.
    touch(cdp,"touchMove",[slide_point(p,70)])
    touch(cdp,"touchEnd",[])
    expect(p.locator("#thumb-range")).to_have_value("70")
    slide(p,cdp,70,100,False)
    touch(cdp,"touchEnd",[])
    p.wait_for_function("location.hash==='#planet=tide'")
    local_playing(p,names[1],.04)
    assert p.evaluate("history.length")==hist+1
    saved=p.evaluate("JSON.parse(localStorage.getItem('playlist-galaxy:position:ember')).seconds")
    tap(p,"#back");settled(p)
    choose(p,'[data-id="ember"]',"Ember")
    slide(p,cdp,0,100)
    p.wait_for_function("location.hash==='#planet=ember'")
    resume=local_playing(p,names[0],saved-.10)
    assert saved-.10<=resume<=saved+.6 and not errors,(saved,resume,errors)
    events=p.evaluate("thumbEvents")
    assert events and all(e[1] for e in events) and sum(e[0]=="input" for e in events)>=10
    print(f"{width}×{height} {'MP3' if files else 'demo'}: held 55% for 780 ms, reversed, used player, cancelled, "
          f"retracted from 100% and landed once on release. A resumed {saved:.2f}→{resume:.2f}s. "
          f"Hint ends at {layout['#map-help']['bottom']:.0f}, Back begins at {layout['#thumb-nav']['top']:.0f}, player at {layout['#transport']['top']:.0f}px.",flush=True)
    ctx.close()


def interruptions(browser,url,width,height):
    ctx=phone(browser,width,height);p=ctx.new_page();cdp=ctx.new_cdp_session(p)
    p.goto(url+"#map=my-galaxy")
    tap(p,'[data-id="midnight"]');settled(p)
    hist=p.evaluate("history.length")
    tap(p,"#thumb-flight")
    field=p.locator("#map-field").bounding_box()
    x=field["x"]+field["width"]*.5;y=field["y"]+field["height"]*.45
    initial=view(p)
    touch(cdp,"touchStart",[(x,y)])
    touch(cdp,"touchMove",[(x+35,y+8)])
    touch(cdp,"touchEnd",[]);p.wait_for_timeout(330)
    rotated=view(p)
    assert rotated!=initial
    touch(cdp,"touchStart",[(x-20,y),(x+20,y)])
    touch(cdp,"touchMove",[(x-34,y+3),(x+40,y+3)])
    touch(cdp,"touchEnd",[]);p.wait_for_timeout(350)
    assert view(p)!=rotated and p.url.endswith("#map=midnight")
    expect(p.locator("#thumb-pick")).to_be_visible()
    tap(p,"#camera-home");p.wait_for_timeout(570)
    tap(p,"[data-id=tide]")
    slide(p,cdp,0,100,False)
    touch(cdp,"touchCancel",[])
    expect(p.locator("#thumb-range")).to_be_hidden()
    assert p.url.endswith("#map=midnight") and p.evaluate("history.length")==hist
    assert p.evaluate("testAudio.length")==0
    choose(p,"[data-id=tide]","Tide")
    slide(p,cdp,0,78,False)
    p.go_back()
    expect(p.locator("#map-name")).to_have_text("My Galaxy")
    touch(cdp,"touchMove",[(x,y)])
    touch(cdp,"touchEnd",[])
    assert p.url.endswith("#map=my-galaxy") and p.evaluate("testAudio.length")==0
    p.go_forward();expect(p.locator("#map-name")).to_have_text("Midnight")
    choose(p,"[data-id=tide]","Tide")
    slide(p,cdp,0,33)
    p.keyboard.press("Escape")
    expect(p.locator("[data-id=tide]")).to_be_focused()
    assert not p.locator("[data-wheel-approach]").count()
    tap(p,"[data-id=ember]");local_playing(p,"Afterglow",.05)
    tap(p,"#thumb-up");settled(p)
    choose(p,"[data-id=tide]","Tide")
    slide(p,cdp,0,60,False)
    left=slide_point(p,60)
    touch(cdp,"touchStart",[left,(x,y)])
    touch(cdp,"touchEnd",[])
    expect(p.locator("#thumb-range")).to_be_hidden()
    assert p.url.endswith("#map=midnight")
    local_playing(p,"Afterglow",.05)
    print(f"{width}×{height}: orbit and pinch while picking, system touch cancellation, Back with a thumb still down, Forward, Escape focus and second-finger interruption passed.",flush=True)
    ctx.close()


def routes_and_dialogs(browser,url,width,height,evidence=None):
    ctx=phone(browser,width,height);p=ctx.new_page();cdp=ctx.new_cdp_session(p)
    p.goto(url)
    choose(p,'[data-id=my-galaxy]',"My Galaxy")
    slide(p,cdp,0,48)
    child_pose=view(p);p.wait_for_timeout(820);assert view(p)==child_pose
    slide(p,cdp,48,100)
    expect(p.locator("#map-name")).to_have_text("My Galaxy")
    tap(p,"#thumb-up");settled(p)
    assert not p.locator("#thumb-up").is_visible()
    # A normal modal must keep native focus and hit ownership above the navigation.
    for name in ("North Field","Summer Night"):
        tap(p,"#thumb-flight");tap(p,"#new-world")
        expect(p.locator("#editor")).to_be_visible()
        assert not p.locator("#thumb-pick").is_visible()
        assert p.locator("#editor").evaluate("el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}")
        p.locator("#world-name").fill(name);p.locator("#save-world").tap()
        expect(p.locator("#map-name")).to_have_text(name)
        tap(p,"#thumb-up");settled(p)
    expect(p.locator("#map-pages")).to_be_visible()
    safe_layout(p)
    if evidence:p.screenshot(path=str(evidence/f"{width}-pages.png"))
    tap(p,"#thumb-flight");tap(p,"#next-page")
    expect(p.locator("#thumb-pick")).to_be_visible()
    tap(p,".world")
    expect(p.locator("#thumb-range")).to_be_visible()
    tap(p,"#thumb-cancel");expect(p.locator("#page-number")).to_have_text("2 / 2")
    p.goto(url+"#planet=saturn")
    expect(p.locator("#world-title")).to_have_text("Saturn")
    assert p.evaluate("testAudio.length")==0
    # Reopening the system file picker should leave the next ordinary moon tap as a flight.
    tap(p,"#thumb-flight")
    with p.expect_file_chooser() as chooser:
        p.locator("#add-mp3").tap()
    chooser.value.set_files([])
    expect(p.locator("#thumb-flight")).to_be_visible()
    expect(p.locator("#thumb-pick")).to_be_hidden()
    # Native scrolling on a small playlist may be needed to reach its moon.
    tap(p,"#thumb-flight")
    p.locator("[data-moon=titan]").tap()
    expect(p.locator("#thumb-target")).to_have_text("บินไป Titan")
    slide(p,cdp,0,45)
    p.emulate_media(reduced_motion="reduce")
    expect(p.locator("#thumb-range")).to_be_hidden()
    assert p.url.endswith("#planet=saturn") and not p.locator(".flight-body,.flight-context,[data-flying]").count()
    expect(p.locator("#thumb-flight")).to_be_hidden()
    p.locator("[data-moon=titan]").tap()
    expect(p.locator("#world-title")).to_have_text("Titan")
    tap(p,"#thumb-up");expect(p.locator("#world-title")).to_have_text("Saturn")
    p.go_back();expect(p.locator("#world-title")).to_have_text("Titan")
    assert not p.locator(".flight-body,[data-flying]").count()
    p.emulate_media(reduced_motion="no-preference")
    tap(p,"#thumb-up");settled(p)
    p.locator("#thumb-flight").focus();p.keyboard.press("Enter")
    expect(p.locator("[data-moon=titan]")).to_be_focused()
    p.keyboard.press("Enter");expect(p.locator("#thumb-range")).to_be_focused()
    p.keyboard.press("ArrowRight");expect(p.locator("#thumb-range")).to_have_value("1")
    p.keyboard.press("End")
    p.wait_for_function("location.hash==='#planet=titan'")
    print(f"{width}×{height}: container slider, paginated map, modal hit tests, Saturn/Titan shared links, motion preference changes and native keyboard range completed.",flush=True)
    ctx.close()


def wide(browser,url):
    p=browser.new_page(viewport={"width":1280,"height":800})
    p.goto(url+"#map=midnight")
    expect(p.locator("#thumb-nav")).to_be_hidden()
    p.locator("[data-id=ember]").focus();p.keyboard.press("Enter")
    expect(p.locator("#world-title")).to_have_text("Ember")
    p.keyboard.press("Escape");expect(p.locator("#map-name")).to_have_text("Midnight")
    p.close()
    ctx=phone(browser,844,390);p=ctx.new_page();p.goto(url+"#map=midnight")
    choose(p,"[data-id=tide]","Tide")
    safe_layout(p);tap(p,"#thumb-cancel")
    ctx.close()
    print("Desktop keyboard and landscape touch layout passed.",flush=True)


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--chromium")
    ap.add_argument("--evidence",type=Path)
    args=ap.parse_args()
    if args.evidence:args.evidence.mkdir(parents=True,exist_ok=True)
    with static_server() as url,TemporaryDirectory() as tmp,sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=args.chromium,args=["--disable-webgl","--autoplay-policy=user-gesture-required"])
        files=[Path(tmp)/"Thumb A.mp3",Path(tmp)/"Thumb B.mp3"]
        for i,f in enumerate(files):write_tone(f,245+i*60)
        for width,height in ((320,568),(390,844)):
            switching(browser,url,width,height,files if width==320 else None,args.evidence)
            interruptions(browser,url,width,height)
            routes_and_dialogs(browser,url,width,height,args.evidence)
        wide(browser,url)
        print("Trusted touch tests passed in Chromium",browser.version,flush=True)
        browser.close()


if __name__=="__main__":
    main()
