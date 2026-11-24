"""Playwright engine checks using generated audio, separate libraries and trusted touch."""
import argparse
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from backup import STATE, inspect_archive
from galaxy import AUDIO_PROBE, static_server, write_tone

TOUCH = """
window.fixtureEvents = [];
for (const type of ['pointerdown','input','click']) document.addEventListener(type, e => {
  if (e.isTrusted) fixtureEvents.push([type,e.pointerType,e.target.id]);
},true);
"""
DENY_SECOND_BLOB = """const add=IDBObjectStore.prototype.add;
IDBObjectStore.prototype.add=function(...args){
  if(this.name==='files' && args[0] instanceof Blob && Number.isInteger(window.fixtureMediaWrites) &&
     ++window.fixtureMediaWrites===2) throw new DOMException('Fixture Blob refusal','DataCloneError');
  return add.apply(this,args);
};"""
DENY_POSITION = """const set=Storage.prototype.setItem;
Storage.prototype.setItem=function(k,v){
  if(k.startsWith('playlist-galaxy:position:') && !window.allowPositionWrites)
    throw new DOMException('Fixture position denial','QuotaExceededError');
  return set.call(this,k,v);
};"""
DENY_STORAGE = """IDBFactory.prototype.open = () => { throw new DOMException('Test storage denial','SecurityError') }"""
DENY_PLAY = """const play = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function () {
  if (!window.allowFixtureAudio) return Promise.reject(new DOMException('Test gesture denial','NotAllowedError'));
  return play.call(this);
};"""


def profile(browser, engine, url, script="", downloads=True, directory=None, executable=None):
    options=dict(has_touch=True,is_mobile=engine!="firefox",viewport={"width":390,"height":844},
                 accept_downloads=downloads,reduced_motion="reduce")
    if directory:
        driver=browser.browser_type
        ctx=driver.launch_persistent_context(str(directory),executable_path=executable or driver.executable_path,**options)
    else:ctx=browser.new_context(**options)
    if url.startswith("file:"):
        # WebKit's offline network emulation also refuses file: navigations. Block only network.
        ctx.route("http://**/*",lambda r:r.abort())
        ctx.route("https://**/*",lambda r:r.abort())
    ctx.add_init_script(AUDIO_PROBE+"\n"+TOUCH+"\n"+script)
    p=ctx.pages[0] if ctx.pages else ctx.new_page();p.set_default_timeout(5500);p.goto(url)
    expect(p.locator("[data-id=my-galaxy]")).to_be_visible()
    return ctx,p


def tap(p,sel):
    p.locator(sel).tap()


def find(p,query):
    tap(p,"#open-finder")
    box=p.locator("#finder-query");box.fill(query)
    return p.locator("#finder-library-list li").filter(has=p.get_by_text(query,exact=True))


def start_check(p,title,minimum=.15):
    expect(p.locator("#now-title")).to_have_text(title)
    p.wait_for_function("""v=>testAudio.filter(a=>!a.paused && a.src && !a.error).length===1 &&
      testAudio.some(a=>!a.paused && a.readyState>=2 && a.currentTime>=v)""",arg=minimum,timeout=3500)
    return p.evaluate("testAudio.find(a=>!a.paused).currentTime")


def seek(p):
    bar=p.locator("#seek")
    bar.press("Home")
    for _ in range(24): bar.press("ArrowRight")
    return p.evaluate("testAudio.find(a=>!a.paused).currentTime")


def root_transfer(p):
    tap(p,"#new-world");tap(p,"#root-backup")


def file_choice(p,btn,path):
    with p.expect_file_chooser() as picker:tap(p,btn)
    picker.value.set_files(path)


def close_transfer(p):
    tap(p,"#library-transfer [data-close]")
    p.locator("dialog[open] [data-close]").tap()


def browse(p):
    row=find(p,"Titan")
    expect(row).to_contain_text("ระบบสุริยะ › Saturn")
    expect(p.locator("#finder-catalog-list")).to_contain_text("Saturn")
    row.locator(".finder-row").tap()
    expect(p.locator("#world-title")).to_have_text("Titan")
    assert p.url.endswith("#planet=titan") and p.evaluate("!testAudio.length")
    p.go_back();expect(p.locator("#map-name")).to_have_text("My universe")
    expect(p.locator("#open-finder")).to_be_focused()
    assert p.evaluate("fixtureEvents.some(e=>e[1]==='touch') && !testAudio.length")


def trip(p,url):
    p.emulate_media(reduced_motion="no-preference")
    p.goto(url+"#map=midnight")
    tap(p,"#thumb-flight");tap(p,"[data-id=tide]")
    bar=p.locator("#thumb-range");expect(bar).to_be_visible()
    rect=bar.bounding_box()
    p.touchscreen.tap(rect["x"]+rect["width"]*.55,rect["y"]+rect["height"]/2)
    value=int(bar.input_value())
    assert 30<value<75 and p.url.endswith("#map=midnight") and not p.evaluate("testAudio.length"),value
    tap(p,"#thumb-cancel");expect(p.locator("#map-name")).to_have_text("Midnight")
    tap(p,"#thumb-flight");tap(p,"[data-id=ember]")
    rect=bar.bounding_box()
    p.touchscreen.tap(rect["x"]+rect["width"]-2,rect["y"]+rect["height"]/2)
    expect(p.locator("#world-title")).to_have_text("Ember")
    assert p.url.endswith("#planet=ember") and not bar.is_visible()
    assert p.evaluate("fixtureEvents.some(e=>e[0]==='input' && e[2]==='thumb-range')")
    return f"trusted touch held at {value}% then cancelled; next tap landed once"


def demo_switch(p,url):
    p.emulate_media(reduced_motion="reduce")
    p.goto(url+"#map=midnight");tap(p,"[data-id=ember]");start_check(p,"Afterglow")
    first=p.evaluate("testAudio.find(a=>!a.paused).currentTime")
    p.wait_for_function("v=>testAudio.some(a=>!a.paused && a.currentTime>v+.15)",arg=first,timeout=3500)
    previous=seek(p);assert previous>2
    tap(p,"#thumb-up");tap(p,"[data-id=tide]");start_check(p,"Blue Hour")
    tap(p,"#thumb-up");tap(p,"[data-id=ember]");resumed=start_check(p,"Afterglow",previous-.16)
    assert resumed<previous+1
    return f"{previous:.2f}s → {resumed:.2f}s, one player"


def receive(p,archive):
    root_transfer(p);file_choice(p,"#backup-choose",archive)
    expect(p.locator("#backup-apply")).to_be_visible();tap(p,"#backup-apply")
    expect(p.locator("#transfer-status")).to_contain_text("รวมแล้ว")
    close_transfer(p);p.reload();row=find(p,"Bandpass")
    expect(row).to_contain_text("Sound Check");row.locator(".finder-row").tap()
    assert not p.evaluate("testAudio.length")


def exercise(browser,engine,url,tmp,label,executable,exchange):
    results=[]
    def run(name,action,p=None):
        try:
            detail=action()
            print(f"{engine} {label} PASS {name}"+(f" · {detail}" if detail else ""),flush=True)
            results.append(True)
            return True
        except Exception as exc:
            notice=""
            if p is not None and not p.is_closed():
                notice=p.locator("#notice").text_content(timeout=1000)+" "+p.locator("#transfer-status").text_content(timeout=1000)
            print(f"{engine} {label} FAIL {name} · {type(exc).__name__} {str(exc).splitlines()[:2]} {notice}",flush=True)
            results.append(False)
            return False

    ctx,p=profile(browser,engine,url)
    run("quiet Titan search, catalog, Back",lambda:browse(p),p)
    run("one-thumb hold, cancel and land",lambda:trip(p,url),p)
    run("demo A/B/A resume",lambda:demo_switch(p,url),p)
    def receiver():
        p.goto(url+"#planet=saturn");tap(p,"#radio-link")
        expect(p.locator("#power")).to_have_attribute("aria-pressed","false")
        tap(p,"#power");expect(p.locator("#power")).to_have_attribute("aria-pressed","true")
        tap(p,"#mute");expect(p.locator("#mute")).to_have_attribute("aria-pressed","true")
        tap(p,"#power");expect(p.locator("#power")).to_have_attribute("aria-pressed","false")
    run("Saturn receiver power, mute, standby",receiver)
    ctx.close()

    ctx,p=profile(browser,engine,url,directory=tmp/(label+"-source"),executable=executable)
    audio=tmp/"Fixture - Bandpass.mp3"
    def add_mp3():
        p.goto(url+"#map=midnight");tap(p,"#new-world");p.locator("#world-name").fill("Sound Check");tap(p,"#save-world")
        expect(p.locator("#world-title")).to_have_text("Sound Check")
        file_choice(p,"#add-mp3",audio);expect(p.locator("#tracks")).to_contain_text("Bandpass")
        p.reload();expect(p.locator("#tracks")).to_contain_text("Bandpass")
        row=find(p,"Bandpass");expect(row).to_contain_text("Midnight › Sound Check")
        row.locator(".finder-row").tap();assert not p.evaluate("testAudio.length")
    added=run("store MP3, reload, find, browse quietly",add_mp3,p)
    saved=[]
    def local_resume():
        find(p,"Bandpass").locator(".finder-play").tap();start_check(p,"Bandpass")
        saved.append(seek(p));assert saved[0]>2
        find(p,"Blue Hour").locator(".finder-play").tap();start_check(p,"Blue Hour")
        find(p,"Bandpass").locator(".finder-play").tap()
        pos=start_check(p,"Bandpass",saved[0]-.16)
        assert pos<saved[0]+1
        tap(p,"#toggle")
        return f"{saved[0]:.2f}s → {pos:.2f}s"
    if added:run("explicit MP3 play and A/B/A resume",local_resume,p)
    archive=(exchange or tmp)/(engine+"-"+label+".pgalaxy")
    def export():
        p.goto(url);expect(p.locator("[data-id=my-galaxy]")).to_be_visible()
        root_transfer(p);tap(p,"#backup-export");expect(p.locator("#backup-download")).to_be_visible()
        with p.expect_download(timeout=8000) as event:tap(p,"#backup-download")
        download=event.value
        assert download.suggested_filename.endswith(".pgalaxy"),download.suggested_filename
        download.save_as(archive);data,digests=inspect_archive(archive)
        assert digests==[hashlib.sha256(audio.read_bytes()).hexdigest()]
        assert any(w["name"]=="Sound Check" for w in data["worlds"])
        return f"{archive.stat().st_size} B, MP3 hash matches"
    exported=added and run("download real .pgalaxy with MP3",export,p)
    ctx.close()
    if exported:
        ctx,p=profile(browser,engine,url,directory=tmp/(label+"-recipient"),executable=executable)
        imported=run("inspect → merge → reload in fresh profile",lambda:receive(p,archive),p)
        if imported:
            def play_import():
                find(p,"Bandpass").locator(".finder-play").tap()
                pos=start_check(p,"Bandpass",(saved[0]-.16) if saved else .15)
                if saved:assert pos<saved[0]+1
                return f"{pos:.2f}s"
            run("imported MP3 playback and position",play_import,p)
        ctx.close()

    if exported and engine=="webkit":
        ctx,p=profile(browser,engine,url)
        def temporary_library():
            before=p.evaluate(STATE)
            root_transfer(p);file_choice(p,"#backup-choose",archive)
            expect(p.locator("#backup-apply")).to_be_visible();tap(p,"#backup-apply")
            p.wait_for_function("!document.querySelector('#library-transfer[aria-busy=true]')")
            status=p.locator("#transfer-status").text_content()
            close_transfer(p);p.reload();expect(p.locator("[data-id=my-galaxy]")).to_be_visible()
            after=p.evaluate(STATE)
            if "รวมแล้ว" in status:
                assert len(after["files"])==1
                return "temporary library accepted the MP3"
            assert "หน้าต่างปกติ" in status and after==before,status
            return "native Blob denial explained; all four stores retained"
        run("temporary WebKit import checks real commit or rollback",temporary_library,p)
        ctx.close()

    ctx,p=profile(browser,engine,url,DENY_SECOND_BLOB,directory=tmp/(label+"-rollback"),executable=executable)
    def atomic_files():
        p.goto(url+"#planet=ember")
        before=p.evaluate(STATE)
        other=tmp/"Fixture - Second.mp3"
        p.evaluate("window.fixtureMediaWrites=0")
        file_choice(p,"#add-mp3",[audio,other])
        expect(p.locator("#notice")).to_contain_text("คลังเดิมยังอยู่ครบ")
        p.reload();expect(p.locator("#tracks")).to_contain_text("Afterglow")
        assert p.evaluate(STATE)==before,"metadata or audio committed after a refused second file"
        file_choice(p,"#add-mp3",[audio,other])
        expect(p.locator("#tracks strong")).to_have_count(3)
        assert len(p.evaluate(STATE)["files"])==2
    run("second Blob refused: atomic rollback, reload and successful retry",atomic_files,p)
    ctx.close()

    ctx,p=profile(browser,engine,url,DENY_PLAY)
    def denied():
        find(p,"Blue Hour").locator(".finder-play").tap()
        expect(p.locator("#notice")).to_contain_text("แตะ");expect(p.locator("#toggle")).to_have_attribute("aria-label","เล่นต่อ")
        assert p.evaluate("testAudio.every(a=>a.paused)")
        p.evaluate("window.allowFixtureAudio=true");tap(p,"#toggle");start_check(p,"Blue Hour")
    run("gesture-denied playback reports paused and retries from a tap",denied,p)
    ctx.close()
    ctx,p=profile(browser,engine,url,DENY_POSITION)
    def temporary_position():
        find(p,"Afterglow").locator(".finder-play").tap()
        expect(p.locator("#notice")).to_contain_text("เฉพาะแท็บนี้")
        start_check(p,"Afterglow");previous=seek(p)
        find(p,"Blue Hour").locator(".finder-play").tap();start_check(p,"Blue Hour")
        find(p,"Afterglow").locator(".finder-play").tap();start_check(p,"Afterglow",previous-.16)
        p.evaluate("window.allowPositionWrites=true");tap(p,"#toggle")
        p.reload();find(p,"Afterglow").locator(".finder-play").tap();start_check(p,"Afterglow",previous-.16)
    run("blocked bookmark warns; tab resume works; later successful save survives reload",temporary_position,p)
    ctx.close()
    ctx,p=profile(browser,engine,url,DENY_STORAGE)
    def denied_storage():
        p.goto(url+"#planet=ember");tap(p,"#add-mp3")
        expect(p.locator("#notice")).to_contain_text("บันทึกในเครื่องไม่ได้")
        tap(p,"#manage");tap(p,"#options [data-open-backup]")
        expect(p.locator("#backup-choose")).to_be_disabled()
        expect(p.locator("#transfer-status")).to_contain_text("เปิดคลังเพลงในเครื่องไม่ได้")
    run("storage denial retains the map and reports unavailable writes",denied_storage,p)
    ctx.close()
    ctx,p=profile(browser,engine,url,downloads=False)
    def blocked_download():
        root_transfer(p);tap(p,"#backup-export")
        expect(p.locator("#backup-download")).to_be_visible()
        with p.expect_download(timeout=7000) as event: tap(p,"#backup-download")
        assert event.value.failure()
        expect(p.locator("#transfer-status")).to_contain_text("ตรวจสิทธิ์ดาวน์โหลด")
        expect(p.locator("#backup-download")).to_be_visible()
    run("download refused by the browser",blocked_download,p)
    ctx.close()
    return all(results)


def exchange_check(browser,engine,url,tmp,label,executable,archive):
    metadata,_=inspect_archive(archive)
    track=next(t for t in metadata["tracks"] if t["title"]=="Bandpass")
    expected=next(m["seconds"] for m in metadata["positions"] if m["worldId"]==track["worldId"] and m["id"]==track["id"])
    assert expected>2
    ctx,p=profile(browser,engine,url,directory=tmp/(label+"-exchange"),executable=executable)
    try:
        receive(p,archive);find(p,"Bandpass").locator(".finder-play").tap()
        pos=start_check(p,"Bandpass",expected-.16)
        assert pos<expected+1
        print(f"{archive.name} → {engine} {label}: verified imported track, {expected:.2f}s → {pos:.2f}s",flush=True)
    finally:ctx.close()


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--browser",choices=["webkit","firefox","chromium"],required=True)
    ap.add_argument("--executable",help="Override the bundled engine executable")
    ap.add_argument("--offline-html",type=Path,help="Also test this extracted HTML with all HTTP(S) blocked")
    ap.add_argument("--exchange-dir",type=Path,help="Keep generated .pgalaxy fixtures for another engine")
    ap.add_argument("--from-engine",choices=["webkit","firefox","chromium"],help="Only import fixtures from this engine")
    args=ap.parse_args()
    if args.from_engine and not args.exchange_dir:ap.error("--from-engine needs --exchange-dir")
    if args.exchange_dir:args.exchange_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw, static_server() as url, TemporaryDirectory() as tmp:
        engine=getattr(pw,args.browser);browser=engine.launch(executable_path=args.executable or engine.executable_path)
        print(args.browser,browser.version,flush=True)
        folder=Path(tmp)
        origins=[("origin",url)]
        if args.offline_html:origins.append(("file",args.offline_html.resolve().as_uri()))
        if args.from_engine:
            for label,location in origins:
                other="file" if label=="origin" and args.offline_html else "origin"
                archive=args.exchange_dir/(args.from_engine+"-"+other+".pgalaxy")
                exchange_check(browser,args.browser,location,folder,label,args.executable,archive)
        else:
            write_tone(folder/"Fixture - Bandpass.mp3",330);write_tone(folder/"Fixture - Second.mp3",480)
            results=[exercise(browser,args.browser,location,folder,label,args.executable,args.exchange_dir) for label,location in origins]
            if not all(results):raise SystemExit(1)
        browser.close()


if __name__=="__main__":main()
