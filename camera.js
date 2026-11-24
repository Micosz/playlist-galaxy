import { clamp, homePose, lens, orbitPath, scenePoint, starField } from "./projection.js";
import { paintSun } from "./sky.js";

const keys = Object.keys(homePose());
const neutral = { x: 0, y: 0, z: 0 };
const depths = [.22, -.30, -.59];
const ease = (t) => t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

export class MapCamera {
  constructor(field, layer, worlds, reduced, refine) {
    this.field = field;
    this.layer = layer;
    this.worlds = worlds;
    this.ctx = layer.getContext("2d");
    this.reduced = reduced;
    this.refine = refine;
    this.views = new Map();
    this.pose = homePose();
    this.goal = homePose();
    this.bodies = [];
    this.frame = 0;
    this.id = null;
    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(field);
    reduced.addEventListener("change", () => { if (reduced.matches) this.settle(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.settle(); });
  }

  remember() {
    if (this.id !== null) this.views.set(this.id, { ...this.goal });
  }
  leave() {
    this.remember();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.flight = null;
    this.id = null;
    this.bodies = [];
    clearTimeout(this.refinement);
    delete this.field.dataset.flying;
  }
  show(id, kind, orbit, cool) {
    if (id !== this.id) {
      this.leave();
      this.id = id;
      this.goal = { ...(this.views.get(id) || homePose()) };
      this.pose = { ...this.goal };
      this.stars = starField(id, kind);
    }
    this.orbit = orbit;
    this.cool = cool;
    this.measure();
  }
  measure() {
    const w = this.field.clientWidth, h = this.field.clientHeight;
    if (!w || !h || this.id === null) return;
    this.width = w; this.height = h; this.unit = Math.min(w, h);
    const dpr = Math.min(devicePixelRatio || 1, 1.6);
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (this.layer.width !== bw || this.layer.height !== bh) {
      this.layer.width = bw; this.layer.height = bh;
    }
    this.ctx.setTransform(bw / w, 0, 0, bh / h, 0, 0);
    const flat = this.orbit ? clamp(h / w, .56, .78) : 0;
    this.bodies = [...this.worlds.children].map((el, i) => {
      const label = (el.offsetHeight - el.firstElementChild.offsetHeight) / 2;
      const x = el.offsetLeft, y = el.offsetTop - label;
      const point = scenePoint((x - w / 2) / this.unit, (y - h / 2) / this.unit, flat, depths[i % depths.length]);
      return { el, x, y, label, point, baseScale: 2.8 / (2.8 - point.z), path: flat ? orbitPath(point, flat) : null };
    });
    this.draw();
    this.scheduleDetail();
  }
  draw() {
    if (this.id === null || !this.width) return;
    const w = this.width, h = this.height, ctx = this.ctx;
    const project = lens(this.pose, w, h);
    ctx.clearRect(0, 0, w, h);
    for (const star of this.stars) {
      const p = project(star);
      if (!p.visible || p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
      const size = clamp(star.size * p.scale, .55, 3);
      ctx.globalAlpha = star.alpha * Math.min(1, .4 + .5 * p.scale);
      ctx.fillStyle = star.color;
      ctx.fillRect(p.x, p.y, size, size);
    }
    ctx.globalAlpha = 1;
    for (const body of this.bodies) {
      if (body.path) {
        ctx.beginPath();
        let pen = false;
        for (const point of body.path) {
          const p = project(point);
          if (p.visible) {
            if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
          }
          pen = p.visible;
        }
        ctx.strokeStyle = "rgba(171,186,216,.25)";
        ctx.lineWidth = .8;
        ctx.stroke();
      }
      const p = project(body.point), scale = clamp(p.scale / body.baseScale, .42, 4);
      body.el.style.setProperty("--dx", (p.x - body.x).toFixed(2) + "px");
      body.el.style.setProperty("--dy", (p.y - body.y + body.label * (scale - 1)).toFixed(2) + "px");
      body.el.style.setProperty("--scale", scale.toFixed(4));
      body.el.style.zIndex = String(clamp(Math.round(50 + p.z * 14), 1, 90));
      body.el.style.visibility = p.visible ? "" : "hidden";
    }
    if (this.orbit) {
      const p = project(neutral);
      paintSun(ctx, p.x, p.y, clamp(w * .023, 8, 20) * p.scale, this.cool);
    }
  }
  settle() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.flight = null;
    this.pose = { ...this.goal };
    delete this.field.dataset.flying;
    this.draw();
    this.scheduleDetail();
  }
  scheduleDetail() {
    clearTimeout(this.refinement);
    if (this.id === null || !this.orbit || document.hidden || this.frame) return;
    // Refine one visible, magnified thumbnail at a time after the camera rests.
    // Navigation or another gesture discards the old queue.
    this.refinement = setTimeout(() => {
      if (this.frame || this.field.classList.contains("dragging")) return;
      const field = this.field.getBoundingClientRect();
      for (const {el} of this.bodies) {
        const art = el.firstElementChild;
        if (art.width !== 260) continue;
        const box = art.getBoundingClientRect();
        if (box.width * Math.min(devicePixelRatio, 1.6) <= 292 ||
            box.right < field.left || box.left > field.right || box.bottom < field.top || box.top > field.bottom) continue;
        this.refine(el);
        this.scheduleDetail();
        break;
      }
    }, 90);
  }
  wake() {
    if (this.reduced.matches) return this.settle();
    if (!this.frame) {
      this.last = performance.now();
      this.frame = requestAnimationFrame((now) => this.step(now));
    }
  }
  step(now) {
    this.frame = 0;
    if (this.id === null) return;
    if (this.flight) {
      const t = clamp((now - this.flight.at) / this.flight.duration, 0, 1);
      if (t >= 1) return this.settle();
      const k = ease(t);
      for (const key of keys) this.pose[key] = this.flight.from[key] + (this.goal[key] - this.flight.from[key]) * k;
    } else {
      const k = 1 - Math.exp(-Math.max(1, now - this.last) / 56);
      for (const key of keys) this.pose[key] += (this.goal[key] - this.pose[key]) * k;
      if (keys.every(key => Math.abs(this.goal[key] - this.pose[key]) < .00015)) return this.settle();
    }
    this.last = now;
    this.draw();
    this.frame = requestAnimationFrame((time) => this.step(time));
  }
  takeControl() {
    if (!this.flight) return;
    this.flight = null;
    this.goal = { ...this.pose };
    delete this.field.dataset.flying;
  }
  fly(outward, screenOrigin, returnId, duration) {
    if (this.reduced.matches || this.id === null || !this.width) return;
    const from = { ...this.goal, zoom: this.goal.zoom + Math.log(outward ? 1.95 : .46) };
    const rect = this.field.getBoundingClientRect();
    const origin = screenOrigin || { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const anchor = outward ? this.bodies.find(b => b.el.dataset.id === returnId)?.point : neutral;
    const p = lens(from, this.width, this.height)(anchor || neutral);
    from.x += (origin.x - rect.left - p.x) / (this.unit * p.scale);
    from.y += (origin.y - rect.top - p.y) / (this.unit * p.scale);
    this.pose = from;
    this.flight = { from: { ...from }, at: performance.now(), duration };
    this.field.dataset.flying = "";
    this.draw();
    this.wake();
  }
  orbitBy(dx, dy) {
    this.takeControl();
    this.goal.yaw += dx * 3.5 / this.unit;
    this.goal.pitch = clamp(this.goal.pitch - dy * 2.9 / this.unit, -1.24, 1.24);
    this.wake();
  }
  panBy(dx, dy) {
    this.takeControl();
    const unit = this.unit * Math.exp(this.goal.zoom);
    this.goal.x = clamp(this.goal.x + dx / unit, -1.75, 1.75);
    this.goal.y = clamp(this.goal.y + dy / unit, -1.75, 1.75);
    this.wake();
  }
  zoomBy(amount, screen) {
    this.takeControl();
    const old = Math.exp(this.goal.zoom);
    this.goal.zoom = clamp(this.goal.zoom + amount, -.77, 1.28);
    // Keep the focus plane under the cursor or the pinch midpoint.
    if (screen) {
      const rect = this.field.getBoundingClientRect(), delta = (1 / Math.exp(this.goal.zoom) - 1 / old) / this.unit;
      this.goal.x = clamp(this.goal.x + (screen.x - rect.left - rect.width / 2) * delta, -1.75, 1.75);
      this.goal.y = clamp(this.goal.y + (screen.y - rect.top - rect.height / 2) * delta, -1.75, 1.75);
    }
    this.wake();
  }
  reset() {
    this.takeControl();
    // Take the short way home even after a full turn.
    this.pose.yaw = Math.atan2(Math.sin(this.pose.yaw), Math.cos(this.pose.yaw));
    this.goal = homePose();
    this.wake();
  }
  reveal(el) {
    const body = this.bodies.find(b => b.el === el);
    if (!body || this.flight) return;
    const p = lens(this.pose, this.width, this.height)(body.point);
    if (!p.visible || p.x < 22 || p.y < 22 || p.x > this.width - 22 || p.y > this.height - 22) {
      this.goal = homePose();
      this.settle();
    }
  }
}
