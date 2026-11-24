const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
function enlarged(rect, area) {
  const scale = Math.max(area.width / rect.width, area.height / rect.height) * 1.20;
  const w = rect.width * scale, h = rect.height * scale, p = center(area);
  return { left: p.x - w / 2, top: p.y - h / 2, width: w, height: h };
}

// The departure sky and travelling artwork are temporary. The destination
// already owns the player, focus and hit targets when the flight starts.
export class BodyFlight {
  constructor(reduced) {
    this.reduced = reduced;
    window.addEventListener("resize", () => this.cancel());
    // openWorld resets scroll before launch. Once the listener scrolls into a
    // playlist, fixed-position travel art should yield to the new reading position.
    window.addEventListener("scroll", () => { if (scrollX || scrollY) this.cancel(); }, {passive:true});
    reduced.addEventListener("change", () => { if (reduced.matches) this.cancel(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.cancel(); });
  }
  bounds(element) {
    if (!element || this.reduced.matches) return null;
    if (element === this.landing) return this.sprite.getBoundingClientRect();
    const r = element.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    if (!element.classList.contains("moon-dot")) return r;
    // The visible disc occupies 264 × 264 of the 520 × 340 planet illustration.
    const w = r.width * 520 / 264, h = r.height * 340 / 264;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
  }
  snapshot(canvas, rect = this.bounds(canvas)) {
    if (!rect || !canvas?.getContext) return null;
    const copy = document.createElement("canvas");
    copy.width = canvas.width; copy.height = canvas.height;
    copy.getContext("2d").drawImage(canvas, 0, 0);
    return { canvas: copy, rect };
  }
  cancel() {
    this.contextMotion?.cancel();
    this.context?.remove();
    this.context = this.contextMotion = null;
    this.animation?.cancel();
    this.sprite?.remove();
    this.landing?.classList.remove("in-flight");
    this.animation = this.sprite = this.landing = null;
  }
  depart(scene, origin, destination, outward, duration) {
    if (!scene || this.reduced.matches) return;
    const { canvas, rect } = scene;
    const from = center(origin || rect), to = center(destination);
    const dx = (to.x - from.x) * .38, dy = (to.y - from.y) * .38;
    // The old scene may slide past the header. Keep the live breadcrumb legible.
    const viewport = document.createElement("div");
    const top = Math.max(0, Math.min(rect.top, destination.top));
    viewport.className = "flight-context";
    viewport.style.top = top + "px";
    viewport.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, { left: rect.left + "px", top: (rect.top - top) + "px",
      width: rect.width + "px", height: rect.height + "px",
      transformOrigin: (from.x - rect.left) + "px " + (from.y - rect.top) + "px" });
    viewport.append(canvas);
    document.body.append(viewport);
    this.context = viewport;
    this.contextMotion = canvas.animate([
      {transform:"translate(0px, 0px) scale(1)", opacity:.94},
      {transform:"translate(" + dx + "px," + dy + "px) scale(" + (outward ? .64 : 1.72) + ")", opacity:0}
    ], {duration: duration * .78, easing:"cubic-bezier(.35,.04,.55,1)", fill:"both"});
    this.contextMotion.onfinish = () => {
      if (this.context === viewport) {
        this.contextMotion?.cancel();
        viewport.remove();
        this.context = this.contextMotion = null;
      }
    };
  }
  start(source, landing, area, duration, crossfade) {
    if (this.reduced.matches) return;
    const shot = source || this.snapshot(landing);
    if (!shot) return;
    const end = this.bounds(landing) || enlarged(shot.rect, area);
    const start = source ? shot.rect : enlarged(end, area);
    if (!end.width || !end.height) return;
    const sprite = shot.canvas;
    if (!crossfade && landing?.getContext && landing.width > sprite.width) {
      sprite.width = landing.width;
      sprite.height = landing.height;
      sprite.getContext("2d").drawImage(landing, 0, 0);
    }
    sprite.className = "flight-body";
    sprite.setAttribute("aria-hidden","true");
    document.body.append(sprite);
    this.sprite = sprite;
    this.landing = crossfade ? null : landing;
    this.landing?.classList.add("in-flight");
    const from = center(start), to = center(end);
    const frames = Array.from({length: 9}, (_, i) => {
      const t = i / 8;
      const width = start.width * (end.width / start.width) ** t;
      const height = start.height * (end.height / start.height) ** t;
      const left = from.x + (to.x - from.x) * t - width / 2;
      const top = from.y + (to.y - from.y) * t - height / 2;
      return {
        transform: "translate(" + left + "px," + top + "px) scale(" + width / sprite.width + "," + height / sprite.height + ")",
        opacity: (source ? 1 : .13) * (1 - t) + (landing && !crossfade ? 1 : 0) * t
      };
    });
    this.animation = sprite.animate(frames, {duration, easing:"cubic-bezier(.32,.04,.3,1)", fill:"both"});
    this.animation.onfinish = () => { if (this.sprite === sprite) this.cancel(); };
  }
}
