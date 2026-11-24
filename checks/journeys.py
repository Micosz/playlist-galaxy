"""Measure entry, arrival and return along the same two playable routes."""
import argparse
import json
import math
from pathlib import Path
from playwright.sync_api import sync_playwright
from camera import hit
from galaxy import static_server

PROBE = """() => {
  function box(el) {
    if(!el) return null;
    const r=el.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height};
  }
  const field=document.querySelector('#map-field');
  window.mapPaints=0;
  const clear=CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect=function(...args){
    if(this.canvas.id==='orbits') window.mapPaints++;
    return clear.apply(this,args);
  };
  document.addEventListener('click',e=>{
    const b=e.target.closest('button');
    if(!b) return;
    const art=b.querySelector('canvas,.moon-dot') || (b.id==='back' && document.querySelector('#portrait'));
    window.leg={trusted:e.isTrusted,flying:field.hasAttribute('data-flying'),origin:box(art),from:location.hash,start:performance.now(),frames:[]};
  },true);
  window.addEventListener('click',()=>{
    const trip=window.leg;
    if(!trip) return;
    const sprite=document.querySelector('.flight-body');
    const world=document.querySelector('[data-id=saturn] canvas');
    trip.initial=box(sprite);
    trip.handler=performance.now()-trip.start;
    trip.to=location.hash;
    let previous;
    function step(now) {
      if(window.leg!==trip) return;
      const s=document.querySelector('.flight-body'), active=field.hasAttribute('data-flying');
      const matching=trip.to==='#map=solar-system'&&trip.from==='#planet=saturn';
      const visibleBody=s || (matching && world);
      const body=box(visibleBody), target=matching?box(world):null;
      if(body || active) trip.frames.push({t:now-trip.start,dt:previous?now-previous:0,body,target,context:!!document.querySelector('.flight-context')});
      previous=now;
      if(s || active || document.querySelector('.flight-context')) requestAnimationFrame(step);
      else trip.done=true;
    }
    requestAnimationFrame(step);
  });
}"""

def journey(browser,url,mobile,out=None,measure_only=False):
    device="touch" if mobile else "desktop"
    ctx=browser.new_context(viewport={"width":390 if mobile else 1160,"height":844 if mobile else 760},
                            has_touch=mobile,is_mobile=mobile)
    p=ctx.new_page()
    p.goto(url)
    p.locator(".world").first.wait_for()
    p.evaluate(PROBE)
    def go(name, selector, early=False):
        hit(p,selector,mobile)
        if out and early:
            p.wait_for_timeout(130)
            p.screenshot(path=out/f"{device}-{name}.jpg",type="jpeg",quality=84)
        p.wait_for_function("window.leg && leg.done")
        rec=p.evaluate("leg")
        assert rec["trusted"] and rec.get("frames"),(name,rec)
        if out:
            (out/f"{device}-{name}.json").write_text(json.dumps(rec))
        return rec
    for name in ("milky-way","solar-system","saturn"):
        go(name,f'[data-id="{name}"]',True)
    moon=go("titan","#moons button",True)
    off=math.dist([moon["origin"][k] for k in ("x","y")],[moon["initial"][k] for k in ("x","y")])
    go("titan-return","#back",True)
    retreat=go("saturn-return","#back",True)
    mismatch=max(math.dist([s["body"][k] for k in ("x","y")],[s["target"][k] for k in ("x","y")])
                 for s in retreat["frames"] if s["body"] and s["target"])
    go("root","#home")
    for name in ("my-galaxy","midnight","ember"):
        go(name,f'[data-id="{name}"]',True)
    go("midnight-return","#back")
    paints=p.evaluate("mapPaints")
    p.wait_for_timeout(300)
    assert p.evaluate("mapPaints") == paints, "An idle map is still repainting"
    assert not p.locator(".flight-body,.in-flight,.flight-context,[data-flying]").count()
    go("tide",'[data-id="tide"]',True)
    if not measure_only:
        assert mismatch < 2, f"The visible return and the planet target separated by {mismatch:.2f}px"
    hit(p,"#back",mobile)
    hit(p,'[data-id="ember"]',mobile)
    assert p.url.endswith("#planet=ember") and p.evaluate("leg.trusted && leg.flying")
    print(f"{device}: Titan departure offset {off:.2f}px, peak Saturn return sprite/target gap {mismatch:.2f}px",flush=True)
    ctx.close()
    return off,mismatch

def main():
    args=argparse.ArgumentParser(description=__doc__)
    args.add_argument("--chromium")
    args.add_argument("--evidence",type=Path)
    args.add_argument("--measure-only",action="store_true",help="Also sample older revisions before the fixes")
    args=args.parse_args()
    if args.evidence: args.evidence.mkdir(parents=True,exist_ok=True)
    with static_server() as url,sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=args.chromium,args=["--disable-webgl","--autoplay-policy=user-gesture-required"])
        for mobile in (False,True): journey(browser,url,mobile,args.evidence,args.measure_only)
        browser.close()

if __name__=="__main__": main()
