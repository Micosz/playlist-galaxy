// The scene follows scroll distance. Only a completed approach changes the
// location or playlist. Wheel momentum after landing belongs to that same trip.
export class WheelTravel {
  constructor({ ready, bookmark, begin, seek, arrive, restore, reduced, changed }) {
    Object.assign(this, { ready, bookmark, begin, seek, arrive, restore, reduced, changed });
    window.addEventListener("wheel", e => this.wheel(e), {capture:true, passive:false});
    window.addEventListener("click", e => {
      if (this.ignoreDragClick && e.detail) {
        this.ignoreDragClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (!this.trip || e.target.closest("#transport,#thumb-nav,#open-finder,#first-flight")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (this.trip.method === "thumb" || e.target.closest("#back,#home,#trail button,#detail-ancestors button")) this.cancel();
      else this.finish();
    }, true);
    window.addEventListener("keydown", e => {
      this.approach = null;
      if (!this.trip || (e.key !== "Escape" &&
          (this.trip.method === "thumb" || e.target.closest("#transport,#thumb-nav,#open-finder,#first-flight")))) return;
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === "Escape") this.cancel();
        else this.finish();
      } else if (e.key === "Tab" || e.key.startsWith("Arrow")) this.cancel();
    }, true);
    window.addEventListener("pointerdown", e => {
      this.approach = this.tail = null;
      this.ignoreDragClick = false;
      if (this.trip?.method === "thumb" && e.pointerType === "touch" && !e.isPrimary) {
        this.cancel();
        return;
      }
      if (!this.trip || e.target.closest("#transport,#thumb-nav,#open-finder,#first-flight")) return;
      if (this.press || e.button !== 0) this.cancel();
      else this.press = {id:e.pointerId, x:e.clientX, y:e.clientY};
    }, true);
    window.addEventListener("pointermove", e => {
      if (!this.press || e.pointerId !== this.press.id) return;
      if (Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 6) {
        this.ignoreDragClick = true;
        this.cancel();
      }
    }, true);
    window.addEventListener("pointerup", () => { this.press = null; }, true);
    window.addEventListener("pointercancel", () => this.cancel(), true);
    window.addEventListener("resize", () => this.cancel());
    reduced.addEventListener("change", () => this.cancel());
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.cancel(); });
  }

  wheel(e) {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this.cancel();
      return;
    }
    if (!e.deltaY) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target.closest("dialog,#transport,#thumb-nav,#open-finder,#first-flight")) return;
    if (this.trip?.method === "thumb") { this.cancel(); return; }
    const inward = e.deltaY < 0;
    const tail = this.tail;
    const intercept = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    const now = performance.now();
    if (inward && tail && now - tail.at < 240 && Math.hypot(e.clientX - tail.x, e.clientY - tail.y) < 18) {
      tail.at = now;
      intercept();
      return;
    }
    this.tail = null;
    if (!this.trip) {
      const targetBody = target.closest(".world,#moons button");
      if (!inward || !targetBody) { this.approach = null; return; }
      const id = targetBody.dataset.id || targetBody.dataset.moon;
      if (this.approach?.id !== id) this.approach = { id, overview: this.bookmark() };
      if (!this.ready(targetBody)) return;
      const { overview } = this.approach;
      this.approach = null;
      intercept();
      if (this.reduced.matches) {
        this.arrive(id, overview);
        this.tail = {at:performance.now(), x:e.clientX, y:e.clientY};
        return;
      }
      this.start(id, overview, "wheel");
    } else intercept();

    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    const pixels = -e.deltaY * unit;
    const step = Math.max(-.4, Math.min(.4, pixels / 480));
    const trip = this.trip;
    trip.progress = Math.max(0, Math.min(1, trip.progress + step));
    if (trip.progress < .0001) trip.progress = 0;
    if (trip.progress > .9999) trip.progress = 1;
    trip.lastInput = {x:e.clientX, y:e.clientY};
    cancelAnimationFrame(this.frame);
    // Tiny trackpad deltas already form a continuous motion. Give a wheel
    // detent a brief glide only as far as the distance the listener requested.
    if (Math.abs(pixels) < 50) return this.display(trip.progress);
    const from = trip.displayed, since = performance.now();
    const advance = now => {
      const t = Math.max(0, Math.min(1, (now - since) / 85));
      this.display(t === 1 ? trip.progress : from + (trip.progress - from) * t * (2 - t));
      if (t < 1 && this.trip === trip) this.frame = requestAnimationFrame(advance);
    };
    this.frame = requestAnimationFrame(advance);
  }
  start(id, overview, method) {
    const { origin, duration } = this.begin(id, method);
    this.trip = { id, method, origin, overview, duration, progress:0, displayed:0 };
    this.seek(0, duration);
    document.body.dataset.wheelApproach = id;
    this.changed();
  }
  display(progress) {
    const trip = this.trip;
    trip.displayed = progress;
    this.seek(progress, trip.duration);
    document.body.style.setProperty("--wheel-progress", String(progress));
    // A thumb can move back from either endpoint until it releases the slider.
    if (trip.method === "thumb") return;
    if (progress === 0 && trip.progress === 0) this.cancel(false);
    if (progress === 1 && trip.progress === 1) {
      this.finish();
      // Start the quiet interval after rendering the destination, even if the
      // first frame took longer than a wheel tick on this device.
      this.tail = { ...trip.lastInput, at:performance.now() };
    }
  }
  clear() {
    cancelAnimationFrame(this.frame);
    this.trip = this.press = null;
    delete document.body.dataset.wheelApproach;
    document.body.style.removeProperty("--wheel-progress");
    this.changed();
  }
  cancel(restoreOverview = true) {
    this.approach = null;
    if (!this.trip) return;
    const { origin, overview, id, method } = this.trip;
    this.clear();
    this.restore(origin, restoreOverview ? overview : null, method === "thumb" ? id : null);
  }
  finish() {
    const { id, overview } = this.trip;
    this.clear();
    this.arrive(id, overview);
  }
}
