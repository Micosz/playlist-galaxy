"""Drive wheel flights with Chromium input, including source audio, history and a cold landing."""
import argparse
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from camera import hit, view
from galaxy import AUDIO_PROBE, local_playing, static_server, write_tone


def point_at(page, selector):
    return page.locator(selector).evaluate("""el => {
      const r = el.getBoundingClientRect();
      for (const y of [.5,.36,.68]) for (const x of [.5,.35,.65]) {
        const px = r.left + r.width*x, py = r.top + r.height*y;
        if ((el.closest('button') || el).contains(document.elementFromPoint(px,py))) return [px,py];
      }
      throw Error('Cannot reach ' + el.outerHTML.slice(0,100));
    }""")


def turn(page, amount):
    page.mouse.wheel(0, amount)
    # Chromium delivers actual wheel input asynchronously on the compositor.
    page.wait_for_timeout(145)


def begin(page, selector):
    point = point_at(page, selector)
    page.mouse.move(*point)
    for _ in range(18):
        turn(page, -72)
        if page.locator("[data-wheel-approach]").count():
            return point
    raise AssertionError(f"Did not start a flight over {selector}: {page.url}")


def progress(page):
    return page.evaluate("Number(document.body.style.getPropertyValue('--wheel-progress'))")


def geometry(page):
    return page.locator(".flight-body").evaluate("""el => {
      const {x, y, width, height} = el.getBoundingClientRect();
      return [x, y, width, height];
    }""")


def distance(a, b):
    return max(abs(x-y) for x,y in zip(a,b))


def land(page, target):
    for _ in range(20):
        turn(page, -96)
        if page.url.endswith(target):
            assert not page.locator("[data-wheel-approach]").count()
            return
    raise AssertionError(f"Expected {target}, got {page.url}")


def quiet_map(page):
    page.wait_for_function("!document.querySelector('.flight-body,.flight-context,[data-flying]')")


def scrub(browser, url, evidence=None):
    ctx = browser.new_context(viewport={"width":1160,"height":760})
    ctx.add_init_script(AUDIO_PROBE)
    ctx.add_init_script("""window.trustedWheels=0;window.addEventListener('wheel',e=>{
      if(e.isTrusted) trustedWheels++;
    },{capture:true,passive:true})""")
    p = ctx.new_page()
    p.goto(url+"#map=midnight")
    p.locator('[data-id="ember"]').wait_for()
    history = p.evaluate("history.length")
    def shot(name):
        if evidence:
            p.screenshot(path=str(evidence/(name+".png")))
    shot("overview")
    begin(p,'[data-id="ember"] canvas')
    first = progress(p)
    turn(p,-72)
    forward, frame = progress(p), geometry(p)
    assert 0 < first < forward < 1
    shot("held")
    p.wait_for_timeout(900)
    assert distance(frame,geometry(p)) < .15
    assert all(p.locator(".flight-body,.flight-context canvas").evaluate_all(
        "els=>els.flatMap(e=>e.getAnimations().map(a=>a.playState==='paused'))"))
    assert p.url.endswith("#map=midnight") and p.evaluate("history.length")==history
    assert p.evaluate("testAudio.length===0")
    turn(p,-72)
    assert geometry(p)[2] > frame[2]+2, "Ember should grow as the listener scrolls inward"
    shot("closer")
    turn(p,72)
    assert abs(progress(p)-forward)<.001 and distance(frame,geometry(p)) < .35
    shot("reversed")
    turn(p,72)
    turn(p,72)
    assert not p.locator("[data-wheel-approach]").count()
    assert p.url.endswith("#map=midnight") and p.evaluate("history.length")==history
    begin(p,'[data-id="ember"] canvas')
    land(p,"#planet=ember")
    expect(p.locator("#now-title")).to_have_text("Afterglow")
    assert p.evaluate("history.length")==history+1
    for _ in range(4): turn(p,-120)
    assert p.url.endswith("#planet=ember") and p.evaluate("history.length")==history+1
    shot("arrived")
    assert p.evaluate("trustedWheels")>=12
    print(f"Wheel: {forward:.0%} held for 900ms, reversed to the same frame, cancelled and landed once. "
          f"{p.evaluate('trustedWheels')} trusted events.",flush=True)
    ctx.close()


def cold_landing(browser,url):
    # Playwright's page.evaluate can itself grant user activation in Chromium.
    # Observe this fresh document through CDP without manufacturing a gesture.
    ctx=browser.new_context(viewport={"width":1160,"height":760})
    ctx.add_init_script(AUDIO_PROBE)
    p=ctx.new_page()
    session=ctx.new_cdp_session(p)
    def read(js):
        result=session.send("Runtime.evaluate",{"expression":js,"returnByValue":True,"userGesture":False})
        assert "exceptionDetails" not in result, result
        return result["result"].get("value")
    p.goto(url+"#map=midnight")
    for _ in range(60):
        point=read("""(()=>{const el=document.querySelector('[data-id=ember] canvas');
          if(!el)return null;const r=el.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()""")
        if point: break
        p.wait_for_timeout(50)
    assert point and not read("navigator.userActivation.hasBeenActive")
    p.mouse.move(*point)
    for _ in range(24):
        turn(p,-96)
        if read("location.hash")=="#planet=ember": break
    assert read("location.hash")=="#planet=ember" and not read("navigator.userActivation.hasBeenActive")
    for _ in range(40):
        if read("document.querySelector('#toggle').getAttribute('aria-label')")== "เล่นต่อ": break
        p.wait_for_timeout(30)
    assert read("document.querySelector('#now-title').textContent")=="Afterglow"
    assert read("testAudio.length>0 && testAudio.every(a=>a.paused)")
    assert read("document.querySelector('#toggle').getAttribute('aria-label')")== "เล่นต่อ"
    p.locator("#toggle").click()
    local_playing(p,"Afterglow",.08)
    print("Fresh wheel-only visit stayed unactivated and silent after landing. One click on Play started the selected song.",flush=True)
    ctx.close()


def switching(browser,url,files=None):
    ctx=browser.new_context(viewport={"width":1160,"height":760})
    ctx.add_init_script(AUDIO_PROBE)
    p=ctx.new_page()
    errors=[]
    p.on("pageerror",lambda error:errors.append(str(error)))
    p.goto(url+"#map=midnight")
    titles=["Afterglow","Blue Hour"]
    if files:
        for i,(world,file) in enumerate(zip(("ember","tide"),files)):
            hit(p,f'[data-id="{world}"]')
            p.locator("#files").set_input_files(file)
            p.locator("#tracks .track-main").last.click()
            titles[i]=file.stem
            local_playing(p,titles[i],.03)
            hit(p,"#back")
            quiet_map(p)
    hit(p,'[data-id="ember"]')
    local_playing(p,titles[0],.06)
    p.locator("#seek").focus()
    p.keyboard.press("Home")
    for _ in range(31): p.keyboard.press("ArrowRight")
    local_playing(p,titles[0],3)
    hit(p,"#back")
    quiet_map(p)
    origin=view(p)
    history=p.evaluate("history.length")
    begin(p,'[data-id="tide"] canvas')
    p.wait_for_timeout(750)
    before=local_playing(p,titles[0],3)
    assert p.url.endswith("#map=midnight") and p.evaluate("history.length")==history
    assert p.evaluate("testAudio.filter(a=>a.src&&!a.paused).length")==1
    land(p,"#planet=tide")
    local_playing(p,titles[1],.04)
    saved=p.evaluate("JSON.parse(localStorage.getItem('playlist-galaxy:position:ember')).seconds")
    assert saved>=before-.05
    assert p.evaluate("history.length")==history+1
    hit(p,"#back")
    quiet_map(p)
    assert max(distance(a,b) for a,b in zip(view(p),origin))<.12, (origin,view(p))
    pt=begin(p,'[data-id="ember"] canvas')
    local_playing(p,titles[1],.04)
    if files:
        land(p,"#planet=ember")
    else:
        assert p.locator("body").get_attribute("data-wheel-approach")=="ember"
        p.mouse.click(*pt)
    p.wait_for_function("location.hash==='#planet=ember'",timeout=2500)
    expect(p.locator("#world-title")).to_have_text("Ember")
    resumed=local_playing(p,titles[0],saved-.10)
    assert saved-.10<=resumed<saved+.65 and not errors, (saved,resumed,errors)
    print(f"{'MP3' if files else 'Demo'} wheel A→B→A: hold retained A, B played on arrival, "
          f"{'wheel' if files else 'click'} completed return; "
          f"A resumed {saved:.2f}s→{resumed:.2f}s with one decoder; original map pose restored.",flush=True)
    ctx.close()


def mixed_input(browser,url):
    ctx=browser.new_context(viewport={"width":1160,"height":760})
    ctx.add_init_script(AUDIO_PROBE)
    p=ctx.new_page()
    p.goto(url+"#map=midnight")
    hit(p,'[data-id="ember"]')
    local_playing(p,"Afterglow",.06)
    hit(p,"#back")
    quiet_map(p)
    original=p.evaluate("history.length")
    overview=view(p)
    x,y=begin(p,'[data-id=tide] canvas')
    # A precision wheel stops exactly at its requested fraction.
    before=progress(p)
    turn(p,-12)
    assert abs(progress(p)-before-.025)<.001
    hit(p,"#toggle")
    expect(p.locator("#toggle")).to_have_attribute("aria-label","เล่นต่อ")
    assert p.url.endswith("#map=midnight") and p.locator("[data-wheel-approach]").count()
    hit(p,"#toggle")
    local_playing(p,"Afterglow",.06)
    p.mouse.move(x,y)
    p.mouse.down()
    p.mouse.move(x+38,y+7,steps=5)
    p.mouse.up()
    assert not p.locator("[data-wheel-approach]").count()
    assert p.url.endswith("#map=midnight") and p.evaluate("history.length")==original
    assert max(distance(a,b) for a,b in zip(view(p),overview))<.12
    local_playing(p,"Afterglow",.06)
    begin(p,'[data-id=tide] canvas')
    # Change the destination while a coarse wheel detent is still gliding.
    p.mouse.wheel(0,-120)
    p.keyboard.press("Escape")
    hit(p,'[data-id=ember]')
    local_playing(p,"Afterglow",.06)
    p.wait_for_timeout(250)
    assert p.url.endswith("#planet=ember") and not p.locator("[data-wheel-approach]").count()
    assert p.evaluate("history.length")==original+1
    print("Fine wheel 2.5% step, current song pause/play, drag cancellation and new selection during a wheel detent passed.",flush=True)
    ctx.close()


def momentum(browser,url):
    ctx=browser.new_context(viewport={"width":1160,"height":760})
    p=ctx.new_page()
    p.goto(url+"#map=my-galaxy")
    other=ctx.new_page()
    other.goto(url+"#map=midnight")
    def targets(page):
        page.locator(".world").first.wait_for()
        return {tuple(pt) for pt in page.evaluate("""() => {
          const points=[];
          for(let y=140;y<550;y+=12) for(let x=180;x<980;x+=12)
            if(document.elementFromPoint(x,y)?.closest('.world')) points.push([x,y]);
          return points;
        }""")}
    # Use a real point that belongs to a body in BOTH maps. Momentum leaking
    # across this boundary would visibly zoom or begin selecting a second body.
    common=targets(p)&targets(other)
    destination=view(other)
    assert common
    other.close()
    x,y=min(common,key=lambda pt:(pt[0]-580)**2+(pt[1]-320)**2)
    history=p.evaluate("history.length")
    # Drive a continuous high-resolution gesture across the boundary. No
    # synchronous inspection of the new page can insert an artificial pause.
    p.mouse.move(x,y)
    for _ in range(40):
        p.mouse.wheel(0,-24)
        p.wait_for_timeout(14)
    p.wait_for_timeout(110)
    assert p.url.endswith("#map=midnight") and p.evaluate("history.length")==history+1, p.url
    assert p.evaluate("pt=>!!document.elementFromPoint(...pt)?.closest('.world')",arg=[x,y])
    assert max(distance(a,b) for a,b in zip(view(p),destination))<.12
    assert not p.locator("[data-wheel-approach]").count()
    p.wait_for_timeout(270)
    begin(p,'[data-id=tide] canvas')
    p.emulate_media(reduced_motion="reduce")
    expect(p.locator("body")).not_to_have_attribute("data-wheel-approach","tide")
    assert p.url.endswith("#map=midnight") and not p.locator(".flight-body,.flight-context,[data-flying]").count()
    print("One continuous 40-event wheel gesture crossed one boundary and left the child under the pointer still. A new gesture entered and a motion preference change cancelled cleanly.",flush=True)
    ctx.close()


def routes(browser,url):
    ctx=browser.new_context(viewport={"width":1160,"height":760})
    ctx.add_init_script(AUDIO_PROBE)
    p=ctx.new_page()
    p.goto(url)
    p.locator('[data-id="my-galaxy"]').wait_for()
    history=p.evaluate("history.length")
    begin(p,'[data-id="my-galaxy"] canvas')
    pose=view(p)
    p.wait_for_timeout(850)
    assert view(p)==pose and p.evaluate("history.length")==history
    turn(p,-72)
    assert view(p)!=pose
    p.keyboard.press("Escape")
    expect(p.locator("#map-name")).to_have_text("My universe")
    assert p.evaluate("history.length")==history
    begin(p,'[data-id="my-galaxy"] canvas')
    p.keyboard.press("Enter")
    assert p.url.endswith("#map=my-galaxy") and p.evaluate("history.length")==history+1
    begin(p,'[data-id="midnight"] canvas')
    p.go_back()
    expect(p.locator("#map-name")).to_have_text("My universe")
    p.go_forward()
    expect(p.locator("#map-name")).to_have_text("My Galaxy")
    assert not p.locator("[data-wheel-approach]").count()
    p.goto(url+"#planet=saturn")
    p.locator("[data-moon=titan]").wait_for()
    begin(p,"[data-moon=titan]")
    size=geometry(p)[2]
    turn(p,-96)
    assert geometry(p)[2]>size+3 and p.url.endswith("#planet=saturn")
    turn(p,96)
    assert abs(geometry(p)[2]-size)<.35
    land(p,"#planet=titan")
    expect(p.locator("#world-title")).to_have_text("Titan")
    print("Container camera held still, Escape cancelled, Enter landed, browser Back/Forward discarded a pending flight; Saturn→Titan scrubbed both ways.",flush=True)
    ctx.close()
    ctx=browser.new_context(reduced_motion="reduce")
    ctx.add_init_script(AUDIO_PROBE)
    p=ctx.new_page()
    p.goto(url+"#map=midnight")
    p.locator('[data-id="tide"]').wait_for()
    p.mouse.move(*point_at(p,'[data-id="tide"] canvas'))
    land(p,"#planet=tide")
    for _ in range(4): turn(p,-120)
    assert not p.locator(".flight-body,.flight-context,[data-flying],[data-wheel-approach]").count()
    expect(p.locator("#world-title")).to_have_text("Tide")
    print("Reduced motion wheel arrived without flight layers or a second landing.",flush=True)
    ctx.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chromium")
    parser.add_argument("--evidence",type=Path)
    args=parser.parse_args()
    if args.evidence: args.evidence.mkdir(parents=True,exist_ok=True)
    with static_server() as url, TemporaryDirectory() as tmp, sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=args.chromium,args=["--disable-webgl","--autoplay-policy=user-gesture-required"])
        scrub(browser,url,args.evidence)
        cold_landing(browser,url)
        routes(browser,url)
        momentum(browser,url)
        mixed_input(browser,url)
        switching(browser,url)
        files=[Path(tmp)/"Wheel A.mp3",Path(tmp)/"Wheel B.mp3"]
        for i,f in enumerate(files): write_tone(f,260+i*80)
        switching(browser,url,files)
        browser.close()


if __name__=="__main__":
    main()
