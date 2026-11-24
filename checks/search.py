"""Exercise local search through the application UI, optionally using the self-contained offline HTML."""
import argparse
from contextlib import nullcontext
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from backup import close_menus, origin_menu, pick, seek, source
from galaxy import AUDIO_PROBE, local_playing, static_server, write_tone
from thumb_navigation import choose as choose_flight, slide

PROBE = """
window.searchProbe={opens:0,tx:0,catalogs:[],touches:0};
const openDb=IDBFactory.prototype.open, transaction=IDBDatabase.prototype.transaction, nativeFetch=window.fetch;
IDBFactory.prototype.open=function(...args){searchProbe.opens++;return openDb.apply(this,args)};
IDBDatabase.prototype.transaction=function(...args){searchProbe.tx++;return transaction.apply(this,args)};
window.fetch=function(input,...args){searchProbe.catalogs.push(String(input));return nativeFetch.call(this,input,...args)};
window.addEventListener('pointerdown',e=>{if(e.isTrusted&&e.pointerType==='touch')searchProbe.touches++},true);
"""


def action(locator, touch=False):
    if touch: locator.tap()
    else: locator.click()


def find(p, term, touch=False):
    if not p.locator("#finder").is_visible():
        action(p.locator("#open-finder"),touch)
    expect(p.locator("#finder-query")).to_be_focused()
    p.locator("#finder-query").fill(term)


def row(p, name, catalog=False):
    prefix = "#finder-catalog-list" if catalog else "#finder-library-list"
    return p.locator(prefix+" li").filter(has=p.get_by_text(name,exact=True))


def leave(p):
    p.keyboard.press("Escape")
    expect(p.locator("#finder")).to_be_hidden()
    expect(p.locator("#open-finder")).to_be_focused()


def new_page(browser, url, width, height, touch):
    ctx=browser.new_context(viewport={"width":width,"height":height},device_scale_factor=1,
          is_mobile=touch,has_touch=touch,reduced_motion="reduce" if width!=390 else "no-preference",
          offline=url.startswith("file:"))
    ctx.add_init_script(AUDIO_PROBE)
    ctx.add_init_script(PROBE)
    p=ctx.new_page()
    p.goto(url)
    expect(p.locator("[data-id=my-galaxy]")).to_be_visible()
    p.set_default_timeout(6500)
    return ctx,p


def layout(p):
    boxes=[p.locator(s).bounding_box() for s in ["#home","#open-finder","#new-world"]]
    assert boxes[0]["x"]+boxes[0]["width"]<=boxes[1]["x"]+1
    assert boxes[1]["width"]>=44 and boxes[1]["height"]>=44
    assert boxes[1]["x"]+boxes[1]["width"]<=boxes[2]["x"]+1
    assert boxes[2]["x"]+boxes[2]["width"]<=p.viewport_size["width"]
    assert p.evaluate("document.documentElement.scrollWidth===innerWidth")
    assert p.locator(".brand span").evaluate("e=>e.offsetHeight<30")


def search_flow(browser,url,width,height,touch,evidence):
    ctx,p=new_page(browser,url,width,height,touch)
    errors=[];requests=[]
    p.on("pageerror",lambda error: errors.append(str(error)))
    p.on("request",lambda r: requests.append(r.url) if r.url.startswith(("http:","https:")) else None)
    layout(p)
    probe=lambda:p.evaluate("({...searchProbe})")
    start=probe()
    if touch: p.locator("#open-finder").tap()
    else: p.keyboard.press("/")
    expect(p.locator("#finder-query")).to_be_focused()
    p.locator("#finder-query").fill("  ");p.wait_for_timeout(220)
    assert probe()["catalogs"]==start["catalogs"] and not p.evaluate("testAudio.length")
    find(p,"ไททัน",touch)
    expect(row(p,"Titan")).to_contain_text("ทางช้างเผือก › ระบบสุริยะ › Saturn")
    find(p,"Titan",touch)
    expect(row(p,"Titan",True)).to_be_visible()
    assert probe()["opens"]==start["opens"] and probe()["tx"]==start["tx"]
    if not url.startswith("file:"):
        assert sorted(urlsplit(r).path for r in requests)==["/docs/galaxies.md","/docs/planetary-systems.md"],requests
        assert not any(urlsplit(r).query for r in requests)
    if evidence:
        p.screenshot(path=str(evidence/f"search-{width}.png"))
    p.keyboard.press("ArrowDown");expect(row(p,"Titan").locator("button")).to_be_focused()
    p.keyboard.press("Enter")
    expect(p.locator("#world-title")).to_have_text("Titan");expect(p.locator("#world-title")).to_be_focused()
    assert p.url.endswith("#planet=titan") and not p.evaluate("testAudio.length")
    p.go_back();expect(p.locator("#map-name")).to_have_text("My universe")
    expect(p.locator("#open-finder")).to_be_focused()
    p.go_forward();expect(p.locator("#world-title")).to_have_text("Titan")
    action(p.locator("#back"),touch);expect(p.locator("#world-title")).to_have_text("Saturn")
    assert not p.evaluate("testAudio.length")
    find(p,"Blue Hour",touch)
    before=p.url
    p.keyboard.press("Enter")
    expect(p.locator("#world-title")).to_have_text("Tide")
    expect(p.locator("[data-track=demo-blue-hour]")).to_be_focused()
    assert not p.evaluate("testAudio.length")
    p.go_back();expect(p).to_have_url(before)
    assert not p.evaluate("testAudio.length")
    find(p,"55 Cnc B b",touch)
    details=row(p,"55 Cnc B b",True).locator("button")
    action(details,touch)
    expect(p.locator("#finder-object")).to_be_focused()
    expect(p.locator("#finder-address")).to_contain_text("55 Cnc › 55 Cnc B")
    expect(p.locator("#finder-facts")).to_contain_text("2025")
    p.keyboard.press("Escape");expect(details).to_be_focused()
    leave(p)
    find(p,"zz-for-private-search-9048",touch)
    expect(p.locator("#finder-status")).to_have_text("ไม่พบผลค้นหา")
    p.keyboard.press("Enter");expect(p.locator("#finder")).to_be_visible()
    leave(p)
    assert not any("private" in r for r in requests) and not p.evaluate("testAudio.length")
    find(p,"Afterglow",touch);action(row(p,"Afterglow").locator(".finder-play"),touch)
    local_playing(p,"Afterglow",.1);seek(p,18)
    previous=p.evaluate("testAudio.find(a=>!a.paused).currentTime")
    p.evaluate("window.original=testAudio.find(a=>!a.paused)")
    find(p,"Titan",touch);action(row(p,"Titan").locator(".finder-row"),touch)
    assert p.evaluate("!original.paused && testAudio.filter(a=>!a.paused).length===1")
    p.go_back();expect(p.locator("#world-title")).to_have_text("Saturn")
    find(p,"Afterglow",touch);action(row(p,"Afterglow").locator(".finder-play"),touch)
    assert p.evaluate("!original.paused && testAudio.length===1")
    find(p,"Blue Hour",touch);action(row(p,"Blue Hour").locator(".finder-play"),touch)
    local_playing(p,"Blue Hour",.1);expect(p.locator("#world-title")).to_have_text("Saturn")
    find(p,"Afterglow",touch);action(row(p,"Afterglow").locator(".finder-play"),touch)
    local_playing(p,"Afterglow",previous-.1)
    # Finding a destination must cancel an uncommitted one-thumb flight without starting its song.
    if touch:
        find(p,"Midnight",True);action(row(p,"Midnight").locator(".finder-row"),True)
        if width==390:
            choose_flight(p,"[data-id=tide]","Tide")
            slide(p,ctx.new_cdp_session(p),0,50)
            find(p,"Afterglow",True)
            leave(p);expect(p.locator("#map-name")).to_have_text("Midnight")
            assert not p.locator("#thumb-range").is_visible() and p.url.endswith("#map=midnight")
            local_playing(p,"Afterglow",previous-.1)
        assert probe()["touches"]>5
    if width==1200:
        # A search jump has one history entry even from the second page of a custom map.
        p.locator("#home").click()
        for name in ["Outer Ring","Long Circuit"]:
            p.locator("#new-world").click();p.locator("#world-name").fill(name);p.locator("#save-world").click()
            expect(p.locator("#map-name")).to_have_text(name);p.locator("#home").click()
        expect(p.locator("#map-pages")).to_be_visible()
        if p.locator("#prev-page").is_enabled(): p.locator("#prev-page").click()
        p.locator("#next-page").click();expect(p.locator("#page-number")).to_have_text("2 / 2")
        hist=p.evaluate("history.length")
        find(p,"Blue Hour");row(p,"Blue Hour").locator(".finder-row").click()
        expect(p.locator("#world-title")).to_have_text("Tide")
        assert p.evaluate("history.length")==hist+1
        p.go_back();expect(p.locator("#page-number")).to_have_text("2 / 2");expect(p.locator("#open-finder")).to_be_focused()
        assert not any(urlsplit(r).query for r in requests)
    assert not errors,errors
    print(f"{width}×{height}: search to Titan in one result, quiet history/Enter, catalog facts, Escape/focus, empty, unbroken playback and demo resume; "+str(probe()["touches"])+" trusted touch presses.",flush=True)
    ctx.close()


def catalog_offline(browser,url):
    ctx,p=new_page(browser,url,1200,800,False)
    if not url.startswith("file:"):
        ctx.set_offline(True)
        find(p,"Afterglow");expect(row(p,"Afterglow")).to_be_visible()
        expect(p.locator("#finder-retry")).to_be_visible()
        ctx.set_offline(False);p.locator("#finder-retry").click()
        expect(p.locator("#finder-retry")).to_be_hidden()
    find(p,"MESSIER");expect(row(p,"MESSIER031",True)).to_be_visible()
    find(p,"Kepler")
    more=p.locator("#finder-catalog-more");expect(more).to_be_visible()
    more.click();expect(p.locator("#finder-catalog-list li")).to_have_count(12)
    expect(p.locator("#finder-catalog-list .finder-row").nth(6)).to_be_focused()
    assert not p.evaluate("testAudio.length")
    if not url.startswith("file:"):
        # Reopen the app shell, then disconnect before a new search. Only public snapshot paths go in this cache.
        p.wait_for_function("""async () => (await (await caches.open('playlist-galaxy-astronomy')).keys()).length===2""")
        keys=p.evaluate("""async () => (await (await caches.open('playlist-galaxy-astronomy')).keys()).map(r=>r.url)""")
        assert sorted(urlsplit(u).path for u in keys)==["/docs/galaxies.md","/docs/planetary-systems.md"]
        p.reload();expect(p.locator("[data-id=my-galaxy]")).to_be_visible()
        ctx.set_offline(True);find(p,"Charon");expect(row(p,"Charon",True)).to_be_visible()
        expect(p.locator("#finder-retry")).to_be_hidden()
    ctx.close()


def import_flow(pw,browser,binary,folder,url):
    archive,star,_,marks=source(pw,binary,folder,url)
    ctx,p=new_page(browser,url,390,844,True)
    find(p,"Ari",True);expect(row(p,"Second")).to_have_count(0)
    expect(p.locator("#finder-status")).not_to_contain_text("กำลังอ่าน")
    leave(p)
    ctx.set_offline(True)
    requests=[]
    p.on("request",lambda r:requests.append(r.url) if r.url.startswith(("http:","https:")) else None)
    origin_menu(p,True);pick(p,archive,True);p.locator("#backup-apply").tap()
    expect(p.locator("#transfer-status")).to_contain_text("รวมแล้ว");close_menus(p)
    find(p,"Ari",True)
    hit=row(p,"Second").filter(has_text="North Garden › Night Bus › Window Seat").filter(has_not_text="Sleeper")
    expect(hit).to_be_visible()
    hit.locator(".finder-row").tap()
    expect(p.locator("#world-title")).to_have_text("Window Seat")
    assert p.url.endswith("#"+star) and not p.evaluate("testAudio.length")
    find(p,"Link only",True)
    apple=row(p,"Link only").get_by_role("link");expect(apple).to_have_attribute("href","https://music.apple.com/th/song/12345")
    expect(apple).to_have_attribute("target","_blank");expect(apple).to_have_attribute("rel","noopener noreferrer")
    find(p,"Second",True)
    hit=row(p,"Second").filter(has_not_text="Sleeper").first
    hit.locator(".finder-play").tap()
    saved=marks[star.split("=")[1]];resumed=local_playing(p,"Second",saved-.12)
    assert resumed<saved+1,(saved,resumed)
    # Index already exists: an add, rename and remove must affect it without a reload.
    fresh=folder/"June - Signal.mp3";write_tone(fresh,550)
    p.locator("#files").set_input_files(fresh)
    expect(p.locator("#tracks")).to_contain_text("Signal")
    find(p,"June",True);expect(row(p,"Signal")).to_contain_text("Window Seat")
    action(row(p,"Signal").locator(".finder-row"),True)
    p.locator("#manage").tap();p.locator("#edit-world").tap()
    p.locator("#world-name").fill("Observatory");p.locator("#save-world").tap()
    expect(p.locator("#world-title")).to_have_text("Observatory")
    find(p,"Signal",True);expect(row(p,"Signal")).to_contain_text("Night Bus › Observatory")
    row(p,"Signal").locator(".finder-row").tap()
    remove=p.get_by_role("button",name="เอา Signal ออกจากดาว");p.once("dialog",lambda d:d.accept());remove.tap()
    expect(p.locator("#tracks")).not_to_contain_text("Signal")
    find(p,"Signal",True);expect(row(p,"Signal")).to_have_count(0)
    assert not requests,requests
    print(f"Independent profile: imported MP3 and Apple link found offline; saved {saved:.2f}s, resumed {resumed:.2f}s; add/rename/remove refreshed, zero HTTP requests.",flush=True)
    ctx.close()


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--chromium")
    ap.add_argument("--offline-html",type=Path)
    ap.add_argument("--evidence",type=Path)
    ap.add_argument("--part",choices=["all","maps","import"],default="all")
    args=ap.parse_args()
    if args.evidence:args.evidence.mkdir(exist_ok=True,parents=True)
    location=nullcontext(args.offline_html.resolve().as_uri()) if args.offline_html else static_server()
    with location as url, TemporaryDirectory() as tmp, sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=args.chromium,args=["--disable-webgl","--autoplay-policy=user-gesture-required"])
        if args.part!="import":
            for width,height,touch in [(1200,800,False),(320,568,True),(390,844,True)]:
                search_flow(browser,url,width,height,touch,args.evidence)
            catalog_offline(browser,url)
        if args.part!="maps":import_flow(pw,browser,args.chromium,Path(tmp),url)
        print("Search checks passed in Chromium",browser.version,flush=True)
        browser.close()


if __name__=="__main__":main()
