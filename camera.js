import { clamp, homePose, lens, orbitDepth, orbitPath, perspective, scenePoint, starField } from "./projection.js";
import { paintSun } from "./sky.js";

const keys = Object.keys(homePose());
const neutral = { x: 0, y: 0, z: 0 };
const depths = [.22, -.30, -.59];
const ease = (t) => t * t * t * (t * (6 * t - 15) + 10);

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
    this.flat = flat;
    this.bodies = [...this.worlds.children].map((el, i) => {
      const label = (el.offsetHeight - el.firstElementChild.offsetHeight) / 2;
      const x = el.offsetLeft, y = el.offsetTop - label;
      const point = scenePoint((x - w / 2) / this.unit, (y - h / 2) / this.unit, flat, depths[i % depths.length]);
      return { el, x, y, label, point, baseScale: perspective(point.z), path: flat ? orbitPath(point, flat) : null };
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
  departure(exclude) {
    if (this.id === null || !this.width || this.reduced.matches || document.hidden) return null;
    const rect = this.field.getBoundingClientRect();
    const sample = Math.min(1, 900 / Math.max(rect.width, rect.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width * sample));
    canvas.height = Math.max(1, Math.round(rect.height * sample));
    const ctx = canvas.getContext("2d");
    ctx.scale(canvas.width / rect.width, canvas.height / rect.height);
    ctx.drawImage(this.layer, 0, 0, rect.width, rect.height);
    // Keep the outgoing sky and its neighbours, in their actual drawing order.
    // Text and hit targets belong to the live destination.
    const bodies = [...this.bodies].sort((a, b) => Number(a.el.style.zIndex) - Number(b.el.style.zIndex));
    for (const { el } of bodies) {
      const art = el.firstElementChild;
      if (art === exclude || el.style.visibility === "hidden" || art.classList.contains("in-flight")) continue;
      const r = art.getBoundingClientRect();
      if (r.right > rect.left && r.left < rect.right && r.bottom > rect.top && r.top < rect.bottom)
        ctx.drawImage(art, r.left - rect.left, r.top - rect.top, r.width, r.height);
    }
    return { canvas, rect };
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
      const { from, focus } = this.flight;
      this.pose.zoom = from.zoom + (this.goal.zoom - from.zoom) * k;
      const scale = Math.exp(this.pose.zoom);
      const a = Math.exp(from.zoom) * (1 - k), b = Math.exp(this.goal.zoom) * k;
      // The focus travels between its two screen positions while distance changes
      // geometrically. This keeps an off-axis destination on the approach path.
      for (const axis of ["x", "y"])
        this.pose[axis] = (a * (from[axis] + focus[axis]) + b * (this.goal[axis] + focus[axis])) / scale - focus[axis];
    } else {
      const k = 1 - Math.exp(-Math.max(1, now - this.last) / 56);
      // Blend magnification and projected pan together. Interpolating log zoom
      // and pan independently makes even a correctly anchored planet wander mid-frame.
      const currentScale = Math.exp(this.pose.zoom), targetScale = Math.exp(this.goal.zoom);
      const scale = currentScale + (targetScale - currentScale) * k;
      const panWeight = k * targetScale / scale;
      this.pose.x += (this.goal.x - this.pose.x) * panWeight;
      this.pose.y += (this.goal.y - this.pose.y) * panWeight;
      this.pose.zoom = Math.log(scale);
      this.pose.yaw += (this.goal.yaw - this.pose.yaw) * k;
      this.pose.pitch += (this.goal.pitch - this.pose.pitch) * k;
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
  fly(outward, origin, returnId, duration, matchSize) {
    if (this.reduced.matches || this.id === null || !this.width) return;
    const returning = outward && this.bodies.find(b => b.el.dataset.id === returnId);
    const anchor = returning ? returning.point : neutral;
    const rect = this.field.getBoundingClientRect();
    const aim = origin ? { x: origin.left + origin.width / 2, y: origin.top + origin.height / 2 }
      : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const projection = lens({ ...this.goal, x: 0, y: 0, zoom: 0 }, this.width, this.height)(anchor);
    const unit = this.unit * projection.scale;
    const focus = { x: (projection.x - this.width / 2) / unit, y: (projection.y - this.height / 2) / unit };
    const from = { ...this.goal, zoom: this.goal.zoom + Math.log(outward ? 1.95 : .43) };
    if (matchSize && returning && origin) {
      const art = returning.el.firstElementChild;
      from.zoom = Math.log(origin.width * returning.baseScale / (art.offsetWidth * projection.scale));
    }
    const scale = unit * Math.exp(from.zoom);
    from.x = (aim.x - rect.left - this.width / 2) / scale - focus.x;
    from.y = (aim.y - rect.top - this.height / 2) / scale - focus.y;
    this.pose = { ...from };
    this.flight = { from, focus, at: performance.now(), duration };
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
  fieldPoint(screen) {
    const rect = this.field.getBoundingClientRect();
    return { x: (screen.x - rect.left - rect.width / 2) / this.unit,
      y: (screen.y - rect.top - rect.height / 2) / this.unit };
  }
  anchorAt(screen, element = document.elementFromPoint(screen.x, screen.y)) {
    this.takeControl();
    // The user grabbed the image currently on screen, including during an orbit.
    this.goal.yaw = this.pose.yaw;
    this.goal.pitch = this.pose.pitch;
    const q = this.fieldPoint(screen), button = element?.closest(".world");
    const body = this.bodies.find(item => item.el === button);
    const z = body ? lens(this.pose, this.width, this.height)(body.point).z : orbitDepth(this.pose, q, this.flat);
    const depthScale = perspective(z), scale = depthScale * Math.exp(this.pose.zoom);
    return { x: q.x / scale - this.pose.x, y: q.y / scale - this.pose.y, depthScale };
  }
  zoomBy(amount, screen, anchor = screen && this.anchorAt(screen)) {
    this.takeControl();
    this.goal.zoom = clamp(this.goal.zoom + amount, -.77, 1.28);
    if (anchor) {
      const q = this.fieldPoint(screen), scale = Math.exp(this.goal.zoom) * anchor.depthScale;
      this.goal.x = clamp(q.x / scale - anchor.x, -1.75, 1.75);
      this.goal.y = clamp(q.y / scale - anchor.y, -1.75, 1.75);
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
