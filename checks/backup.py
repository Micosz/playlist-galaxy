"""Move a generated music library between independent, persistent Chromium profiles."""
import argparse
import hashlib
import json
from contextlib import nullcontext
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright
from galaxy import AUDIO_PROBE, choose, local_playing, static_server, write_tone

STATE = """async () => {
  const req = r => new Promise((ok,fail)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);});
  const db=await req(indexedDB.open('playlist-galaxy'));
  const tx=db.transaction(['worlds','tracks','positions','files']);
  const names=['worlds','tracks','positions'];
  const [worlds,tracks,positions,files]=await Promise.all([
    ...names.map(k=>req(tx.objectStore(k).getAll())),req(tx.objectStore('files').getAllKeys())
  ]);
  db.close();
  return {worlds,tracks,positions,files};
}"""


def profile(pw, binary, path, mobile=False):
    options = dict(executable_path=binary, accept_downloads=True, reduced_motion="reduce",
                   args=["--autoplay-policy=user-gesture-required","--disable-webgl"])
    if mobile:
        options.update(is_mobile=True, has_touch=True, viewport={"width":320,"height":568})
    ctx = pw.chromium.launch_persistent_context(str(path), **options)
    ctx.add_init_script(AUDIO_PROBE)
    return ctx


def first_page(ctx, url):
    p=ctx.pages[0]
    p.goto(url)
    expect(p.locator("#new-world")).to_be_visible()
    expect(p.get_by_role("button",name="เปิดกาแล็กซี My Galaxy",exact=True)).to_be_visible()
    return p


def tap_or_click(p, selector, touch):
    button=p.locator(selector)
    if touch: button.tap()
    else: button.click()


def origin_menu(p, mobile=False):
    tap_or_click(p,"#new-world",mobile)
    if mobile: p.locator("#root-backup").tap()
    else: p.locator("#root-backup").focus();p.keyboard.press("Enter")
    expect(p.locator("#library-transfer")).to_be_visible()


def planet_menu(p):
    p.locator("#manage").click()
    p.locator("#options [data-open-backup]").click()


def close_menus(p):
    p.keyboard.press("Escape")
    expect(p.locator("#library-transfer")).to_be_hidden()
    p.keyboard.press("Escape")
    expect(p.locator("dialog:modal")).to_have_count(0)


def create(p, name, selector):
    p.locator("#new-world").click()
    p.locator("#world-name").fill(name)
    p.locator("#save-world").click()
    expect(p.locator(selector)).to_have_text(name)


def seek(p, tenths):
    bar=p.locator("#seek")
    bar.focus();p.keyboard.press("Home")
    for _ in range(tenths): p.keyboard.press("ArrowRight")


def pick(p, path, mobile=False):
    with p.expect_file_chooser() as choosing:
        tap_or_click(p,"#backup-choose",mobile)
    choosing.value.set_files(path)


def inspect_archive(path):
    contents=path.read_bytes()
    assert contents[:8]==b"PGALAXY\x01"
    length=int.from_bytes(contents[8:12],"big")
    metadata=contents[44:44+length]
    assert hashlib.sha256(metadata).digest()==contents[12:44]
    data=json.loads(metadata)
    offset=44+length
    blobs=[]
    for m in data["media"]:
        audio=contents[offset:offset+m["size"]]
        digest=hashlib.sha256(b"".join(hashlib.sha256(audio[i:i+1048576]).digest()
                                       for i in range(0,len(audio),1048576))).hexdigest()
        assert digest==m["key"]
        blobs.append(hashlib.sha256(audio).hexdigest());offset+=len(audio)
    assert offset==len(contents)
    return data,blobs


def generated_mp3s(directory):
    a=directory/"Ari - First.mp3";b=directory/"Ari - Second.mp3"
    write_tone(a,330);write_tone(b,440)
    # Add legal ID3 padding to exercise several digest chunks and a real low-storage import.
    audio=a.read_bytes()
    assert audio[:3]==b"ID3"
    old_size=sum((audio[6+i]&127)<<(7*(3-i)) for i in range(4))
    pad=3*1024*1024
    new_size=old_size+pad
    size_bytes=bytes((new_size>>(7*(3-i)))&127 for i in range(4))
    a.write_bytes(audio[:6]+size_bytes+audio[10:10+old_size]+bytes(pad)+audio[10+old_size:])
    return [a,b]


def source(pw, binary, folder, url):
    files=generated_mp3s(folder)
    ctx=profile(pw,binary,folder/"source");p=first_page(ctx,url)
    p.locator("[data-id=my-galaxy]").click();p.locator("[data-id=midnight]").click()
    p.locator("[data-id=ember]").click();local_playing(p,"Afterglow",.1);seek(p,12)
    p.locator("#toggle").click();p.locator("#home").click()
    p.locator("[data-id=my-galaxy]").click();p.locator("#rename-map").click()
    p.locator("#world-name").fill("My original sky");p.locator("#save-world").click()
    expect(p.locator("#map-name")).to_have_text("My original sky")
    p.locator("#home").click()
    create(p,"North Garden","#map-name");create(p,"Night Bus","#map-name");create(p,"Window Seat","#world-title")
    star=p.url.split("#")[-1]
    p.locator("#files").set_input_files(files);expect(p.locator("#tracks li")).to_have_count(2)
    p.locator("#tracks .track-main").first.click();local_playing(p,"First",.1)
    p.locator("#open-apple").click();p.locator("#apple-links summary").click()
    p.locator("#song-url").fill("https://music.apple.com/th/song/12345");p.locator("#song-label").fill("Link only")
    p.locator("#link-form button").click();expect(p.locator("#apple-feedback")).to_contain_text("เพิ่ม")
    p.locator("#apple [data-close]").click()
    p.locator("#tracks .track-main").nth(1).click();local_playing(p,"Second",.1);seek(p,42)
    p.locator("#manage").click();p.locator("#new-moon").click()
    p.locator("#world-name").fill("Sleeper");p.locator("#save-world").click()
    expect(p.locator("#world-title")).to_have_text("Sleeper")
    moon=p.url.split("#")[-1]
    p.locator("#files").set_input_files(files[1]);p.locator("#tracks .track-main").click()
    local_playing(p,"Second",.1);seek(p,21);p.locator("#back").click();local_playing(p,"Second",4)
    p.locator("#toggle").click();expect(p.locator("#toggle")).to_have_attribute("aria-label","เล่นต่อ")
    planet_menu(p)
    ctx.set_offline(True)
    requests=[]
    p.on("request",lambda r: requests.append(r.url) if r.url.startswith(("https:","http:")) else None)
    p.locator("#backup-export").focus();p.keyboard.press("Enter")
    expect(p.locator("#backup-download")).to_be_focused()
    with p.expect_download() as event: p.keyboard.press("Enter")
    artifact=folder/"library.pgalaxy";event.value.save_as(artifact)
    assert event.value.suggested_filename.endswith(".pgalaxy")
    assert len(p.evaluate(STATE)["files"])==2
    data,hashes=inspect_archive(artifact)
    assert sorted(hashes)==sorted(hashlib.sha256(f.read_bytes()).hexdigest() for f in files)
    assert len([t for t in data["tracks"] if t["kind"]=="local"])==3 and len(hashes)==2
    positions={v["worldId"]:v["seconds"] for v in data["positions"]}
    assert positions[star.split("=")[1]]>=4 and positions[moon.split("=")[1]]>=2
    assert not requests,requests
    ctx.close()
    print(f"Downloaded {artifact.stat().st_size:,} B. Three local track entries shared two unique MP3 payloads that matched the source bytes; the bookmarks and the Apple link were retained. Zero HTTP requests during export.",flush=True)
    return artifact,star,moon,positions


def roundtrip(pw,binary,folder,url,source_file,star,moon,marks,evidence):
    profile_path=folder/"fresh-phone"
    ctx=profile(pw,binary,profile_path,True);p=first_page(ctx,url)
    ctx.set_offline(True)
    requests=[]
    p.on("request",lambda r: requests.append(r.url) if r.url.startswith(("http:","https:")) else None)
    original=p.evaluate(STATE);hist=p.evaluate("history.length")
    origin_menu(p,True)
    incoming=folder/"received.pgalaxy";incoming.write_bytes(source_file.read_bytes())
    pick(p,incoming,True)
    expect(p.locator("#backup-apply")).to_be_visible()
    assert p.evaluate(STATE)==original and not p.evaluate("testAudio.length")
    if evidence:p.screenshot(path=str(evidence/"mobile-review.png"))
    dialog=p.locator("#library-transfer").bounding_box()
    assert dialog["x"]>=0 and dialog["x"]+dialog["width"]<=321 and dialog["height"]<=568
    p.locator("#backup-apply").tap();expect(p.locator("#transfer-status")).to_contain_text("รวมแล้ว")
    merged=p.evaluate(STATE)
    assert len(merged["files"])==2 and len(merged["positions"])>=2 and p.evaluate("history.length")==hist
    assert any(w["name"]=="My original sky" for w in merged["worlds"])
    pick(p,incoming,True);p.locator("#backup-apply").tap()
    expect(p.locator("#transfer-status")).to_have_text("ไม่มีรายการใหม่ · ใช้ข้อมูลที่มีอยู่ในเครื่อง")
    assert p.evaluate(STATE)==merged and not p.evaluate("testAudio.length")
    close_menus(p)
    assert not requests,requests
    ctx.close()
    incoming.rename(folder/"moved-after-import.pgalaxy")
    # Start a new browser process on the recipient's profile, with no access to the original import path.
    ctx=profile(pw,binary,profile_path,True);p=ctx.pages[0];p.goto(url+"#"+star)
    expect(p.locator("#world-title")).to_have_text("Window Seat")
    assert not p.evaluate("testAudio.length")
    expect(p.locator(".catalog-link")).to_have_attribute("href","https://music.apple.com/th/song/12345")
    p.locator("#thumb-up").tap();choose(p,"ดาว","Window Seat",True)
    saved=marks[star.split("=")[1]];resumed=local_playing(p,"Second",saved-.08)
    assert resumed<saved+.75,(saved,resumed)
    ctx.set_offline(True)
    p.evaluate("window.beforeMergeAudio=testAudio.find(a=>!a.paused)")
    previous_time=p.evaluate("beforeMergeAudio.currentTime")
    p.locator("#manage").tap();p.locator("#options [data-open-backup]").tap()
    pick(p,folder/"moved-after-import.pgalaxy",True);p.locator("#backup-apply").tap()
    expect(p.locator("#transfer-status")).to_contain_text("ไม่มีรายการใหม่")
    assert p.evaluate("testAudio.filter(a=>!a.paused).length===1 && !beforeMergeAudio.paused")
    assert p.evaluate("beforeMergeAudio.currentTime")>=previous_time and p.url.endswith("#"+star)
    close_menus(p)
    p.locator("#moons button").tap()
    assert p.url.endswith("#"+moon)
    saved_moon=marks[moon.split("=")[1]];local_playing(p,"Second",saved_moon-.08)
    # Removing one reference must leave the other playlist's audio playable.
    p.once("dialog",lambda d:d.accept());p.locator(".track-remove").tap()
    expect(p.locator("#tracks li")).to_have_count(0)
    assert len(p.evaluate(STATE)["files"])==2
    p.locator("#thumb-up").tap();local_playing(p,"Second",saved-.08)
    p.once("dialog",lambda d:d.accept());p.locator(".track-remove").nth(1).tap()
    expect(p.locator("#tracks li")).to_have_count(2)
    assert len(p.evaluate(STATE)["files"])==1
    ctx.close()
    print(f"Fresh 320×568 touch profile imported offline with no requests/history/audio during review, merged twice, relaunched after moving the backup, resumed Second at {resumed:.2f}s (saved {saved:.2f}s), and played the moon bookmark. Shared audio survived until its last reference was removed.",flush=True)


def errors_and_merge(pw,binary,folder,url,archive,quota):
    ctx=profile(pw,binary,folder/"populated");p=first_page(ctx,url)
    p.locator("[data-id=my-galaxy]").click();p.locator("#rename-map").click()
    p.locator("#world-name").fill("Keep my sky");p.locator("#save-world").click()
    expect(p.locator("#map-name")).to_have_text("Keep my sky")
    p.locator("[data-id=midnight]").click();p.locator("[data-id=ember]").click()
    p.locator("#files").set_input_files(folder/"Ari - First.mp3")
    p.locator("#tracks .track-main").filter(has_text="First").click()
    local_playing(p,"First",.1)
    seek(p,20);p.locator("#toggle").click();planet_menu(p)
    ctx.set_offline(True)
    original=p.evaluate(STATE);local=p.evaluate("localStorage.getItem('playlist-galaxy:position:ember')")
    if quota:
        # Chromium caches a grant on the open IndexedDB backend. Set the override before
        # reopening the populated profile to make its next transaction hit the real quota.
        ctx.close()
        ctx=profile(pw,binary,folder/"populated");p=ctx.pages[0]
        parts=urlsplit(url);origin=parts.scheme+"://"+parts.netloc
        cdp=ctx.new_cdp_session(p)
        cdp.send("Storage.overrideQuotaForOrigin",{"origin":origin,"quotaSize":1024})
        p.goto(url+"#planet=ember");expect(p.locator("#world-title")).to_have_text("Ember")
        planet_menu(p);ctx.set_offline(True)
        assert p.evaluate(STATE)==original
    raw=archive.read_bytes()
    for label,bytes_,message in [
        ("truncated",raw[:-32],"เสียหาย"),("future",raw[:7]+bytes([17])+raw[8:],"เวอร์ชัน 17"),
        ("damaged",raw[:-1]+bytes([raw[-1]^1]),"เสียหาย")]:
        invalid=folder/(label+".pgalaxy");invalid.write_bytes(bytes_);pick(p,invalid)
        expect(p.locator("#transfer-status")).to_contain_text(message)
        expect(p.locator("#backup-apply")).to_be_hidden()
        assert p.evaluate(STATE)==original
    pick(p,archive)
    expect(p.locator("#backup-apply")).to_be_visible()
    if quota:
        p.locator("#backup-apply").click()
        expect(p.locator("#transfer-status")).to_contain_text("พื้นที่ไม่พอ",timeout=15000)
        assert p.evaluate(STATE)==original
        cdp.send("Storage.overrideQuotaForOrigin",{"origin":origin})
    # Deterministic abort after new worlds/tracks have been queued in a real readwrite transaction.
    p.evaluate("""() => { const add=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(...args){
       const result=add.apply(this,args);
       if(this.name==='files'){ IDBObjectStore.prototype.add=add; this.transaction.abort(); }
       return result;
    }; }""")
    p.locator("#backup-apply").click()
    expect(p.locator("#transfer-status")).to_contain_text("คลังเดิมยังอยู่ครบ")
    assert p.evaluate(STATE)==original and p.evaluate("localStorage.getItem('playlist-galaxy:position:ember')")==local
    # A retry of the already reviewed archive can now commit.
    p.locator("#backup-apply").focus();p.keyboard.press("Enter")
    expect(p.locator("#transfer-status")).to_contain_text("รวมแล้ว")
    final=p.evaluate(STATE)
    assert any(w["name"]=="Keep my sky" for w in final["worlds"])
    assert all(t in final["tracks"] for t in original["tracks"])
    assert len(original["files"])==1 and len(final["files"])==2
    assert p.evaluate("localStorage.getItem('playlist-galaxy:position:ember')")==local
    close_menus(p)
    if quota: p.locator("#tracks .track-main").last.click()
    else: p.locator("#toggle").click()
    local_playing(p,"First",1.9)
    ctx.close()
    print("Populated desktop profile kept local edits, tracks and playback through truncated content, a future version, a damaged MP3, "+("a real Chromium quota rejection, " if quota else "")+"a transaction abort and a successful keyboard retry.",flush=True)


def v2_and_concurrent(pw, binary, folder, url, archive):
    ctx = profile(pw, binary, folder/"version-two")
    fixture = url + "storage-fixture"
    ctx.route(fixture, lambda route: route.fulfill(content_type="text/html", body="<input id='raw' type='file'>"))
    p = ctx.pages[0]
    p.goto(fixture)
    p.locator("#raw").set_input_files(folder/"Ari - Second.mp3")
    p.evaluate("""async () => {
      const {initialWorlds,demoTracks} = await import('./atlas.js');
      const previous = indexedDB.open('playlist-galaxy',2);
      previous.onupgradeneeded = () => {
        const db=previous.result, worlds=db.createObjectStore('worlds',{keyPath:'id'});
        const tracks=db.createObjectStore('tracks',{keyPath:'id'}),files=db.createObjectStore('files');
        for(const w of initialWorlds)worlds.add(w);
        worlds.add({id:'v2-body',parent:'midnight',kind:'planet',name:'V2 keep',order:25,surface:'jade'});
        tracks.add(demoTracks[0]);
        tracks.add({id:'v2-song',kind:'local',worldId:'v2-body',title:'Original bytes',artist:'Fixture',order:12});
        files.add(document.querySelector('#raw').files[0],'v2-song');
      };
      await new Promise((ok,fail)=>{previous.onsuccess=()=>{previous.result.close();ok()};previous.onerror=()=>fail(previous.error)});
      localStorage.setItem('playlist-galaxy:position:v2-body',JSON.stringify({id:'v2-song',seconds:4.75}));
    }""")
    p.goto(url+"#planet=v2-body")
    expect(p.locator("#world-title")).to_have_text("V2 keep")
    upgraded = p.evaluate(STATE)
    assert "demo-blue-hour" not in [t["id"] for t in upgraded["tracks"]]
    assert upgraded["files"] == ["v2-song"] and not upgraded["positions"]
    p.locator("#back").click()
    choose(p,"ดาว","V2 keep")
    restored = local_playing(p,"Original bytes",4.6)
    assert restored < 5.5
    planet_menu(p)
    p.locator("#backup-export").click()
    with p.expect_download() as event:
        p.locator("#backup-download").click()
    old = folder/"legacy-export.pgalaxy"
    event.value.save_as(old)
    data,hashes = inspect_archive(old)
    assert hashes == [hashlib.sha256((folder/"Ari - Second.mp3").read_bytes()).hexdigest()]
    assert any(m["worldId"]=="v2-body" and m["seconds"]>=4.6 for m in data["positions"])
    second = ctx.new_page()
    second.goto(fixture)
    second.locator("#raw").set_input_files(archive)
    stats = second.evaluate("""async () => {
      const {openLibrary}=await import('./library.js'),{readBackup}=await import('./backup.js');
      const parsed=await readBackup(document.querySelector('#raw').files[0]);
      const connections=await Promise.all([openLibrary(),openLibrary()]);
      const results=await Promise.all(connections.map(db=>db.merge(parsed)));
      return results.map(p=>[p.newWorlds.length,p.newTracks.length,p.positions.length]).sort((a,b)=>a[0]-b[0]);
    }""")
    assert stats[0] == [0,0,0] and stats[1][0] == 4 and stats[1][1] >= 4,stats
    second.locator("#raw").set_input_files(folder/"Ari - First.mp3")
    assert second.evaluate("""async () => {
      const {openLibrary}=await import('./library.js');
      const db=await openLibrary(), file=document.querySelector('#raw').files[0];
      const track={id:'pending-song',kind:'local',worldId:'v2-body',title:'Saving now',artist:'',order:16};
      const saving=db.add([{track,file}]);
      const snapshot=await db.snapshot();
      await saving;
      return snapshot.tracks.some(t=>t.id===track.id);
    }""")
    ctx.close()
    print("A v2 profile kept its raw MP3, removed demo and 4.75s bookmark through upgrade and export. Two concurrent connections merged one archive exactly once. Export waited for a newly selected file.",flush=True)


def run(pw,binary,folder,url,evidence):
    a,star,moon,marks=source(pw,binary,folder,url)
    roundtrip(pw,binary,folder,url,a,star,moon,marks,evidence)
    served = url.startswith(("http:","https:"))
    errors_and_merge(pw,binary,folder,url,a,served)
    if served:
        v2_and_concurrent(pw,binary,folder,url,a)


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chromium");parser.add_argument("--offline-html",type=Path)
    parser.add_argument("--evidence",type=Path)
    args=parser.parse_args()
    if args.evidence:args.evidence.mkdir(exist_ok=True,parents=True)
    base=nullcontext(args.offline_html.resolve().as_uri()) if args.offline_html else static_server()
    with base as url,TemporaryDirectory() as tmp,sync_playwright() as pw:
        run(pw,args.chromium,Path(tmp),url,args.evidence)
