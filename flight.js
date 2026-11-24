export const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
function enlarged(rect, area) {
  const scale = Math.max(area.width / rect.width, area.height / rect.height) * 1.20;
  const w = rect.width * scale, h = rect.height * scale, p = center(area);
  return { left: p.x - w / 2, top: p.y - h / 2, width: w, height: h };
}

// Only this sprite is temporary. Navigation, player activation, focus and hit
// testing stay on the live destination from the instant of the user's click.
export class BodyFlight {
  constructor(reduced) {
    this.reduced = reduced;
    reduced.addEventListener("change", () => { if (reduced.matches) this.cancel(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.cancel(); });
  }
  snapshot(canvas) {
    if (!canvas || this.reduced.matches) return null;
    const rect = (canvas === this.landing ? this.sprite : canvas).getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const copy = document.createElement("canvas");
    copy.width = canvas.width; copy.height = canvas.height;
    copy.getContext("2d").drawImage(canvas, 0, 0);
    return { canvas: copy, rect };
  }
  cancel() {
    this.animation?.cancel();
    this.sprite?.remove();
    this.landing?.classList.remove("in-flight");
    this.animation = this.sprite = this.landing = null;
  }
  start(source, landing, area, duration, crossfade) {
    if (this.reduced.matches) return;
    const shot = source || this.snapshot(landing);
    if (!shot) return;
    const end = landing?.getBoundingClientRect() || enlarged(shot.rect, area);
    const start = source ? shot.rect : enlarged(end, area);
    if (!end.width || !end.height) return;
    const sprite = shot.canvas;
    sprite.className = "flight-body";
    sprite.setAttribute("aria-hidden","true");
    document.body.append(sprite);
    this.sprite = sprite;
    this.landing = crossfade ? null : landing;
    this.landing?.classList.add("in-flight");
    const transform = r => "translate(" + r.left + "px," + r.top + "px) scale(" + r.width / sprite.width + "," + r.height / sprite.height + ")";
    this.animation = sprite.animate([
      {transform:transform(start), opacity:source ? 1 : .13},
      {transform:transform(end), opacity:landing && !crossfade ? 1 : 0},
    ], {duration, easing:"cubic-bezier(.35,.02,.18,1)",fill:"both"});
    this.animation.onfinish = () => { if (this.sprite === sprite) this.cancel(); };
  }
}
