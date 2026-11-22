"use strict";

// The illustrations are computed from a projected ring plane, a cratered sphere,
// and a six-sided polar flow. Only size and station changes rebuild the plates.
const Phosphor = (() => {
  const TAU = Math.PI * 2;
  const clamp = (x, low = 0, high = 1) => Math.max(low, Math.min(high, x));
  const schemes = [
    { dark: [20, 17, 14], dim: [91, 50, 29], mid: [216, 128, 64], light: [255, 219, 154], ink: "#f3a15d" },
    { dark: [12, 23, 30], dim: [32, 69, 83], mid: [93, 170, 186], light: [221, 247, 226], ink: "#89dce2" },
    { dark: [18, 23, 13], dim: [54, 67, 30], mid: [153, 175, 65], light: [240, 235, 145], ink: "#c3d570" }
  ];

  function random(seed) {
    return () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function saturn(x, y, rho, grain) {
    const squash = .34;
    const ring = Math.hypot(x, y / squash);
    const inFront = y * 2.767 > Math.sqrt(Math.max(0, 1 - rho * rho));
    if (ring > 1.22 && ring < 2.14 && (rho >= 1 || inFront)) {
      // The shadow on the far ring is the intersection of its light ray with Saturn.
      const z = y * 2.767;
      const alongLight = -.58 * x - .48 * y + .657 * z;
      const shaded = alongLight < 0 && ring * ring - alongLight * alongLight < 1;
      const threads = .045 * Math.sin(685 * ring) + .04 * Math.cos(190 * ring) + .042 * Math.sin(92 * ring);
      let albedo = ring < 1.49 ? .25 + .12 * Math.sin(31 * ring) : ring < 1.83 ? .79 : .59;
      if ((ring > 1.81 && ring < 1.857) || (ring > 2.055 && ring < 2.065)) albedo *= .27;
      return clamp((albedo + threads + grain * .045) * (shaded ? .32 : 1));
    }
    if (rho >= 1) return -1;
    const z = Math.sqrt(1 - rho * rho);
    const latitude = y * .94 - z * .34;
    const bands = .025 * Math.sin(78 * latitude + 1.3 * Math.sin(4 * x))
      + .036 * Math.sin(33 * latitude + .8 * Math.sin(x * 4)) + .046 * Math.cos(15 * latitude);
    const broad = .07 * Math.tanh(Math.cos((latitude + .15) * 9) * 2.5);
    let light = .1 + .92 * Math.pow(Math.max(0, -.52 * x - .55 * y + .64 * z), .62);
    // The foreground rings interrupt the light along a narrow latitude band.
    if (latitude > -.05 && latitude < .13) light *= .78;
    return clamp((light + bands + broad) * (.93 + .035 * grain));
  }

  const craterSeed = random(839);
  const craters = Array.from({ length: 62 }, () => ({
    x: craterSeed() * 2 - 1, y: craterSeed() * 2 - 1, r: .016 + craterSeed() ** 2 * .12
  }));
  function ice(x, y, rho, grain) {
    if (rho >= 1) return -1;
    const z = Math.sqrt(1 - rho * rho);
    const ridge = Math.sin(14 * x + 9 * y + 4 * Math.sin(5 * y) + 1.4 * Math.sin(13 * y + 4 * z));
    const cracks = Math.max(0, 1 - Math.abs(ridge) * 7);
    let ground = .80 - .18 * cracks + .075 * Math.sin(8 * y + x * 4) + .045 * grain;
    for (const c of craters) {
      if (Math.abs(x - c.x) > c.r * 1.18 || Math.abs(y - c.y) > c.r * 1.18) continue;
      const d = Math.hypot(x - c.x, y - c.y) / c.r;
      if (d < 1.15) ground += d < .84 ? -.12 + (y - c.y) / c.r * .1 : .12 * Math.sin((1.15 - d) * 10);
    }
    return clamp(.035 + ground * Math.pow(Math.max(0, -.61 * x - .5 * y + .59 * z), .68) + .12 * (1 - z) ** 4);
  }

  function storm(x, y, rho, grain) {
    if (rho > 1.2) return -1;
    const a = Math.atan2(y, x);
    const distort = .025 * Math.sin(11 * a + rho * 5) + .013 * Math.sin(19 * a - 10 * rho);
    const twist = a + .45 * rho + .05 * Math.sin(rho * 11);
    const sector = ((twist + 9 * Math.PI) % (Math.PI / 3)) - Math.PI / 6;
    const hex = rho * Math.cos(sector) + distort * clamp(rho);
    const flow = .5 + .5 * Math.sin(74 * hex + 2.2 * Math.sin(18 * hex - 2 * a) + .6 * Math.sin(5 * a));
    const wall = Math.exp(-((hex - .72) ** 2) / .0015);
    const eye = clamp((rho - .08) * 5);
    return clamp((.17 + .42 * flow ** .8 + .23 * wall + .08 * Math.sin(27 * hex) + .08 * grain)
      * eye * clamp((1.21 - rho) * 6) * (1.04 - .25 * x - .12 * y) + .035);
  }

  function makeBody(station, radius) {
    const plate = document.createElement("canvas");
    const extent = station === 0 ? 2.22 : 1.34;
    plate.width = Math.ceil(radius * extent * 2);
    plate.height = Math.ceil(radius * (station === 0 ? 2.76 : 2.68));
    const ctx = plate.getContext("2d");
    const pixels = ctx.createImageData(plate.width, plate.height);
    const color = schemes[station];
    const ramp = [color.dark, color.dim, color.mid, color.light];
    const tilt = station === 0 ? -.32 : -.20;
    const co = Math.cos(tilt), si = Math.sin(tilt);
    const grain = random(7781 + station);
    const material = [saturn, ice, storm][station];
    for (let py = 0; py < plate.height; py++) {
      for (let px = 0; px < plate.width; px++) {
        const u = (px - plate.width / 2) / radius;
        const v = (py - plate.height / 2) / radius;
        const x = u * co + v * si, y = -u * si + v * co;
        let intensity = material(x, y, Math.hypot(x, y), grain() - .5);
        if (intensity < 0) continue;
        // At phosphor scale, grain and uneven scan lines soften digital edges.
        intensity = clamp(intensity + .019 * Math.sin(py * 2.55));
        const step = Math.min(2, Math.floor(intensity * 3)), mix = intensity * 3 - step;
        const i = (py * plate.width + px) * 4;
        for (let c = 0; c < 3; c++) pixels.data[i + c] = ramp[step][c] * (1 - mix) + ramp[step + 1][c] * mix;
        pixels.data[i + 3] = 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    return plate;
  }

  class Display {
    constructor(sky, scope) {
      this.sky = sky;
      this.scope = scope;
      this.station = 0;
      this.layers = new Map();
      this.motion = matchMedia("(prefers-reduced-motion: reduce)");
      this.sample = () => ({ live: false, pulse: 0 });
      this.frame = 0;
      this.last = 0;
      this.motion.addEventListener("change", () => this.refresh());
      new ResizeObserver(() => this.rebuild()).observe(sky);
      document.addEventListener("visibilitychange", () => this.refresh());
    }
    tune(station) { this.station = station; this.rebuild(); }
    rebuild() {
      const { width: w, height: h } = this.sky.getBoundingClientRect();
      if (!w || !h) return;
      this.w = w; this.h = h;
      this.dpr = Math.min(devicePixelRatio || 1, 1.6, 1440 / w);
      this.cx = w * (w < 480 ? .733 : .697);
      this.cy = h * .48;
      this.r = Math.min(w * (w < 480 ? .124 : .155), h * (this.station === 0 ? .38 : .335));
      const sizeKey = [w,h,this.dpr].join("/");
      if (sizeKey !== this.sizeKey) {
        this.layers.clear();
        this.sizeKey = sizeKey;
        this.sky.width = Math.round(w * this.dpr);
        this.sky.height = Math.round(h * this.dpr);
        this.scope.width = Math.round(this.scope.clientWidth * this.dpr);
        this.scope.height = Math.round(this.scope.clientHeight * this.dpr);
      }
      const cached = this.layers.get(this.station);
      if (cached) {
        this.plate = cached.plate; this.base = cached.base;
        this.refresh(); return;
      }
      this.plate = makeBody(this.station, this.r * this.dpr);
      this.base = document.createElement("canvas");
      this.base.width = this.sky.width; this.base.height = this.sky.height;
      const g = this.base.getContext("2d"); g.scale(this.dpr, this.dpr);
      const scheme = schemes[this.station];
      const rgb = scheme.dark;
      const halo = g.createRadialGradient(this.cx, this.cy, this.r * .3, this.cx, this.cy, w * .73);
      halo.addColorStop(0, "rgb(" + rgb.map(n => n * 2.15).join(",") + ")");
      halo.addColorStop(.62, "rgb(" + rgb.join(",") + ")"); halo.addColorStop(1,"#121511");
      g.fillStyle = halo; g.fillRect(0, 0, w, h);
      const prng = random(7723 + this.station);
      g.fillStyle = scheme.ink;
      for (let i = 0; i < w * h / 245; i++) {
        const x = prng() * w, y = prng() * h;
        g.globalAlpha = (.07 + prng() ** 3 * .7) * (x < w * .36 ? .42 : 1);
        const size = .35 + prng() ** 5 * 1.35;
        g.fillRect(x, y, size, size);
        if (size > 1.52) { g.globalAlpha *= .6; g.fillRect(x - 2, y + .4,5,.5); g.fillRect(x + .5,y - 2,.5,5); }
      }
      g.strokeStyle = scheme.ink; g.lineWidth = .65; g.globalAlpha = .15;
      for (const k of [1.6, 2.7]) {
        g.setLineDash([2,7]); g.beginPath(); g.ellipse(this.cx, this.cy, this.r*k, this.r*k*.57, -.34, 0, TAU); g.stroke();
      }
      g.setLineDash([]); g.fillStyle = scheme.ink; g.globalAlpha = .45;
      for (const [x,y] of [[.42,.22],[.92,.68],[.51,.73]]) {
        g.fillRect(w*x-3,h*y,7,.75); g.fillRect(w*x,h*y-3,.75,7);
      }
      if (this.station === 1) {
        for (let i = 0; i < 150; i++) {
          const spread = prng(), length = .2 + prng() * 1.6;
          g.globalAlpha = .04 + prng() * .09; g.beginPath();
          g.moveTo(this.cx + this.r * .44, this.cy + this.r * .75);
          g.quadraticCurveTo(this.cx + this.r * (.8 + length * .2), this.cy + this.r * (.9 + spread * .5),
            this.cx + this.r * (1 + length), this.cy + this.r * (.8 + spread * 1.05));
          g.stroke();
        }
      }
      this.layers.set(this.station,{ plate:this.plate, base:this.base });
      this.refresh();
    }
    refresh() {
      cancelAnimationFrame(this.frame); this.frame = 0;
      if (!this.base || document.hidden || !this.paint()) return;
      const loop = time => {
        if (time - this.last >= 32) {
          this.last = time;
          if (!this.paint()) return;
        }
        this.frame = requestAnimationFrame(loop);
      };
      this.frame = requestAnimationFrame(loop);
    }
    paint() {
      const { w, h, dpr, cx, cy, r, station } = this;
      const signal = this.motion.matches ? {live:false,pulse:0} : this.sample();
      const pulse = signal.pulse;
      const g = this.sky.getContext("2d");
      g.setTransform(1,0,0,1,0,0); g.drawImage(this.base,0,0);
      g.scale(dpr,dpr);
      g.save(); g.translate(cx,cy);
      const phase = signal.phase || 0;
      if (station === 2) g.rotate(Math.sin(phase * .12) * .035);
      const scale = 1 + [.014,.019,.025][station] * pulse;
      g.scale(scale,scale);
      const bw = this.plate.width/dpr, bh = this.plate.height/dpr;
      g.drawImage(this.plate,-bw/2,-bh/2,bw,bh);
      if (pulse > .012) {
        g.strokeStyle = schemes[station].ink; g.lineWidth = .8;
        g.globalAlpha = pulse * .67;
        g.beginPath();
        if (station === 0) g.ellipse(0,0,r*(2.16+.10*(1-pulse)),r*(.73+.07*(1-pulse)),-.32,0,TAU);
        if (station === 1) g.arc(0,0,r*(1.04 + .18*(1-pulse)),.04,2.3);
        if (station === 2) {
          for (let j=0;j<6;j++) {
            const a = TAU*j/6-.02, rad = r*(.78+.19*(1-pulse));
            if (j===0) g.moveTo(rad*Math.cos(a),rad*Math.sin(a)); else g.lineTo(rad*Math.cos(a),rad*Math.sin(a));
          }
          g.closePath();
        }
        g.stroke();
      }
      g.restore();
      const s = this.scope.getContext("2d"), sw = this.scope.width, sh = this.scope.height;
      s.clearRect(0,0,sw,sh); s.strokeStyle = schemes[station].ink; s.lineWidth = dpr;
      s.beginPath();
      const trace = signal.trace;
      for (let x=0;x<sw;x++) {
        const y = trace ? sh * (.5 - (trace[Math.floor(x / sw * trace.length)] - 128) / 170) : sh * .5;
        if (x===0) s.moveTo(x,y); else s.lineTo(x,y);
      }
      s.stroke();
      return signal.live;
    }
  }
  return Display;
})();
