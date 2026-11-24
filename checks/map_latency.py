"""Run with a clean browser context per sample. Reports click-handler and two-frame latency."""
import argparse, statistics
from playwright.sync_api import sync_playwright
from galaxy import static_server
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chromium")
    parser.add_argument("--runs",type=int,default=5)
    args=parser.parse_args()
    with static_server() as url, sync_playwright() as play:
        browser=play.chromium.launch(executable_path=args.chromium)
        for name,w,h,mobile in [("desktop",1160,760,False),("phone",390,844,True)]:
            samples=[]
            for _ in range(args.runs):
                ctx=browser.new_context(viewport={"width":w,"height":h},is_mobile=mobile,has_touch=mobile,device_scale_factor=2 if mobile else 1)
                p=ctx.new_page()
                p.goto(url+"#map=milky-way")
                button=p.locator('[data-id="solar-system"]')
                button.wait_for()
                p.evaluate("""const button=document.querySelector('[data-id="solar-system"]');
                  window.timing={};document.addEventListener('click',e=>{
                    if(button.contains(e.target))timing.start=performance.now()
                  },true);
                  window.addEventListener('click',()=>{if(!timing.start)return;
                    timing.handler=performance.now()-timing.start;
                    requestAnimationFrame(()=>requestAnimationFrame(()=>timing.paint=performance.now()-timing.start));
                  },{once:true});""")
                if mobile: button.tap()
                else: button.click()
                p.wait_for_function("timing.paint > 0")
                samples.append(p.evaluate("[timing.handler,timing.paint]"))
                ctx.close()
            med=[round(statistics.median(x[i] for x in samples),1) for i in range(2)]
            print(name, "raw handler / two-frame (ms)",[[round(a,1),round(b,1)] for a,b in samples],"median",med,flush=True)
        browser.close()
if __name__=="__main__": main()
