"use strict";

(() => {
  const byId = id => document.getElementById(id);
  const power = byId("power"), volume = byId("volume"), mute = byId("mute");
  const status = byId("status"), dial = byId("dial"), guide = byId("guide");
  if (location.hash === "#first-flight") {
    const back = document.querySelector(".wordmark");
    const destination = new URL(back.href);
    destination.hash = "planet=titan";
    back.href = destination.href;
    back.lastChild.textContent = "กลับ Titan";
    back.setAttribute("aria-label", "กลับไปยัง Titan");
    back.title = "กลับไปยัง Titan";
    let fromFlight = Boolean(history.state?.fromFirstFlight);
    try {
      const key = "playlist-galaxy:first-flight-radio";
      if (sessionStorage.getItem(key) === location.href) fromFlight = true;
      sessionStorage.removeItem(key);
    } catch {}
    const referrer = document.referrer ? new URL(document.referrer) : null;
    if (referrer?.origin === destination.origin &&
        (referrer.pathname === destination.pathname || referrer.pathname === new URL("index.html", destination).pathname))
      fromFlight = true;
    if (fromFlight && history.length > 1) {
      history.replaceState({fromFirstFlight:true}, "");
      back.onclick = e => {
        if (e.button || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        e.preventDefault();
        history.back();
      };
    }
  }
  const presets = Array.from(document.querySelectorAll(".preset"));
  const audio = new RadioSynth();
  const aircheck = new Aircheck(byId("aircheck"), announce, monitorPreview);
  const display = new Phosphor(byId("sky"),byId("scope"));
  display.sample = () => aircheck.playing ? {live:false,pulse:0} : audio.signal();
  let receiverStatus = "Standby";
  let index = 0, muted = false, powered = false, request = 0;
  let drag = null;
  const limits = n => Math.max(0, Math.min(2,n));

  function drawScale() {
    const el = byId("dial-scale"), b = el.getBoundingClientRect();
    if (!b.width || !b.height) return;
    const d = Math.min(devicePixelRatio || 1,2);
    el.width = Math.round(b.width * d); el.height = Math.round(b.height * d);
    const g = el.getContext("2d");
    g.scale(d,d);
    const centerX = b.width/2;
    const centerY = (dial.offsetTop + dial.offsetHeight/2) * b.height/el.clientHeight;
    const rad = (dial.offsetWidth/2 + 9) * b.width/el.clientWidth;
    for (let i=0;i<=32;i++) {
      const a = (-112 + i*7) * Math.PI/180;
      const major = i%8 === 0;
      const r = rad + (major ? 5 : 2.5);
      g.beginPath();
      g.moveTo(centerX+Math.sin(a)*rad,centerY-Math.cos(a)*rad);
      g.lineTo(centerX+Math.sin(a)*r,centerY-Math.cos(a)*r);
      g.lineWidth = i===index*16 ? 2.6 : major ? 1.6 : 1;
      g.strokeStyle = i===index*16 ? "#b25d30" : "#727666"; g.stroke();
    }
  }

  function announce(msg) { byId("announcement").textContent = msg; }

  function choose(next, feedback=false) {
    aircheck.stopPreview();
    next = limits(next);
    const changed = next!==index;
    index = next;
    const station = STATIONS[index];
    if (changed && powered && audio.program) audio.retune(index);
    document.documentElement.style.setProperty("--phosphor",station.color);
    dial.style.setProperty("--angle",String((index-1)*112)+"deg");
    dial.setAttribute("aria-valuenow",String(index+1));
    dial.setAttribute("aria-valuetext",station.name+", "+station.frequency+" MHz");
    const [first,last] = station.name.split(" ");
    byId("station-name").replaceChildren(document.createTextNode(first),document.createElement("br"),document.createTextNode(last));
    byId("channel").textContent = "STATION 0"+(index+1)+" / 03";
    byId("frequency").textContent = station.frequency;
    byId("genre").textContent = station.genre;
    byId("tempo").textContent = station.bpm+" BPM";
    presets.forEach((el,i) => el.setAttribute("aria-pressed",String(i===index)));
    if (changed) {
      display.tune(index);
      announce("Station "+(index+1)+", "+station.name+", "+station.frequency+" megahertz.");
      if (feedback && typeof navigator.vibrate === "function") navigator.vibrate(9);
    }
    drawScale();
  }

  function showStatus() {
    status.lastElementChild.textContent = aircheck.playing ? "Playing clip" : receiverStatus;
    status.classList.toggle("live",aircheck.playing || Boolean(audio.program));
  }

  function monitorPreview(playing) {
    audio.monitorLive(!playing);
    showStatus();
    display.refresh();
  }

  function indicate(value, live=false) {
    receiverStatus = value;
    aircheck.setSource(live ? audio.master : null);
    showStatus();
    power.setAttribute("aria-pressed",String(powered));
    byId("power-text").textContent = powered ? "Power off" : "Power on";
  }

  function stop(immediate = false) {
    request++; powered = false; audio.powerOff(immediate);
    indicate("Standby"); display.refresh();
  }

  async function togglePower() {
    if (powered) { stop(); announce("Receiver in standby."); return; }
    const current = ++request;
    powered = true; indicate("Starting");
    try {
      const started = await audio.powerOn(() => index);
      if (current !== request || !started) return;
      indicate("On air",true); display.refresh();
      announce("On air. "+STATIONS[index].name+".");
    } catch {
      if (current !== request) return;
      stop(); indicate("Audio unavailable");
      announce("Audio could not start. Try powering on again in a browser with Web Audio.");
    }
  }

  function setOutput() {
    const level = Number(volume.value);
    audio.setLevel(level/100,muted);
    aircheck.setLevel(level/100,muted);
    volume.style.setProperty("--level",level+"%");
    volume.setAttribute("aria-valuetext",level+" percent");
    mute.setAttribute("aria-pressed",String(muted));
    mute.setAttribute("aria-label",muted ? "Unmute audio" : "Mute audio");
    byId("mute-symbol").setAttribute("href",muted || level===0 ? "#silent" : "#speaker");
  }
  function toggleMute() { muted = !muted; setOutput(); announce(muted ? "Muted." : "Sound enabled."); }

  power.addEventListener("click",togglePower);
  volume.addEventListener("input",setOutput);
  mute.addEventListener("click",toggleMute);
  presets.forEach((el,i) => el.addEventListener("click",() => choose(i,true)));
  byId("guide-open").addEventListener("click",() => guide.showModal());
  byId("guide-close").addEventListener("click",() => guide.close());
  guide.addEventListener("click",e => {
    if (e.target!==guide) return;
    const b = guide.getBoundingClientRect();
    if (e.clientX<b.left || e.clientX>b.right || e.clientY<b.top || e.clientY>b.bottom) guide.close();
  });

  dial.addEventListener("pointerdown",e => {
    if (drag || e.button!==0) return;
    e.preventDefault(); dial.focus({preventScroll:true}); dial.setPointerCapture(e.pointerId);
    const b = dial.getBoundingClientRect(), cx=b.left+b.width/2, cy=b.top+b.height/2;
    drag = {id:e.pointerId,x:e.clientX,y:e.clientY,cx,cy,start:index,turned:false,
      lastAngle:Math.atan2(e.clientY-cy,e.clientX-cx),arc:0,mode:null,
      radius:b.width/2,offset:Math.hypot(e.clientX-cx,e.clientY-cy)};
    dial.querySelector(".pointer").style.transitionDuration="0s";
  });
  window.addEventListener("pointermove",e => {
    if (!drag || drag.id!==e.pointerId) return;
    const dx=e.clientX-drag.x, dy=e.clientY-drag.y;
    const angle=Math.atan2(e.clientY-drag.cy,e.clientX-drag.cx);
    const diff=angle-drag.lastAngle;
    drag.arc += Math.atan2(Math.sin(diff),Math.cos(diff)); drag.lastAngle=angle;
    if (!drag.turned && Math.hypot(dx,dy)<6) return;
    if (!drag.turned) {
      drag.turned=true;
      // Rim drags turn tangentially. Drags near the hub can travel in a straight line.
      drag.mode = drag.offset>drag.radius*.52 && Math.abs(drag.arc)*drag.offset>Math.hypot(dx,dy)*.86
        ? "rotary" : Math.abs(dx)>=Math.abs(dy) ? "across" : "vertical";
    }
    const travel = drag.mode==="rotary" ? drag.arc*180/Math.PI/112 : (drag.mode==="across" ? dx : -dy)/(drag.radius*1.18);
    const pos=limits(drag.start+travel), nearest=Math.round(pos);
    if (nearest!==index) choose(nearest,true);
    dial.style.setProperty("--angle",String((pos-1)*112)+"deg");
  });
  // A fast dial turn can be treated as a fling and swallow the next native button tap.
  dial.addEventListener("touchmove", e => {
    if (drag?.turned && e.cancelable) e.preventDefault();
  }, {passive:false});
  function release(e) {
    if (!drag || drag.id!==e.pointerId) return;
    const tap=e.type==="pointerup" && !drag.turned;
    drag=null;
    dial.querySelector(".pointer").style.removeProperty("transition-duration");
    if (tap) choose((index+1)%3,true);
    else dial.style.setProperty("--angle",String((index-1)*112)+"deg");
    if (dial.hasPointerCapture(e.pointerId)) dial.releasePointerCapture(e.pointerId);
  }
  window.addEventListener("pointerup",release);
  window.addEventListener("pointercancel",release);
  dial.addEventListener("lostpointercapture",release);

  document.addEventListener("keydown",e => {
    if (guide.open || e.ctrlKey || e.metaKey || e.altKey || e.target.matches("input,textarea,select,[contenteditable=true]")) return;
    if (["ArrowRight","ArrowUp","ArrowLeft","ArrowDown","Home","End"].includes(e.key)) {
      e.preventDefault();
      const value = e.key==="Home" ? 0 : e.key==="End" ? 2 : index+(["ArrowRight","ArrowUp"].includes(e.key)?1:-1);
      choose(value,true); return;
    }
    if (e.repeat) return;
    if (/^[1-3]$/.test(e.key)) { e.preventDefault(); choose(Number(e.key)-1,true); }
    if (e.key.toLowerCase()==="m") { e.preventDefault(); toggleMute(); }
    // Native button activation keeps Space usable for the focused control.
    if (e.code==="Space" && !e.target.closest("button,a")) { e.preventDefault(); togglePower(); }
  });
  window.addEventListener("pagehide",() => { stop(true); aircheck.reset(); });
  new ResizeObserver(drawScale).observe(byId("dial-scale"));
  choose(0); setOutput();
})();
