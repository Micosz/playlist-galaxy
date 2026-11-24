import { clamp } from "./projection.js";

const middle = ([a, b]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const gap = ([a, b]) => Math.hypot(a.x - b.x, a.y - b.y);

export function bindCamera(field, camera, interrupt) {
  const pointers = new Map();
  let dragged = false, swallowClick = false;
  field.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    if (!pointers.size) { dragged = false; swallowClick = false; }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, pan: e.shiftKey || e.button === 2 });
    if (pointers.size > 1) {
      dragged = true;
      interrupt();
      for (const id of pointers.keys()) field.setPointerCapture(id);
    }
    if (e.pointerType === "mouse" && !e.target.closest(".world")) field.focus({preventScroll:true});
  });
  field.addEventListener("pointermove", (e) => {
    const old = pointers.get(e.pointerId);
    if (!old) return;
    const was = [...pointers.values()];
    const point = { ...old, x: e.clientX, y: e.clientY };
    let dx = point.x - old.x, dy = point.y - old.y;
    if (!dragged) {
      dx = point.x - old.startX; dy = point.y - old.startY;
      if (Math.hypot(dx, dy) < (e.pointerType === "touch" ? 8 : 4)) return;
      dragged = true;
      interrupt();
      field.setPointerCapture(e.pointerId);
    }
    field.classList.add("dragging");
    pointers.set(e.pointerId, point);
    if (pointers.size === 2) {
      const now = [...pointers.values()], before = middle(was), after = middle(now);
      camera.zoomBy(Math.log(Math.max(2, gap(now)) / Math.max(2, gap(was))), before);
      camera.panBy(after.x - before.x, after.y - before.y);
    } else if (pointers.size === 1) {
      if (old.pan || e.shiftKey) camera.panBy(dx, dy);
      else camera.orbitBy(dx, dy);
    }
  });
  function finish(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (dragged || e.type === "pointercancel") swallowClick = true;
    if (!pointers.size) field.classList.remove("dragging");
  }
  field.addEventListener("pointerup", finish);
  field.addEventListener("pointercancel", finish);
  field.addEventListener("lostpointercapture", e => { if (e.target === field) finish(e); });
  field.addEventListener("pointerout", e => {
    if (!field.contains(e.relatedTarget) && !field.hasPointerCapture(e.pointerId) && e.pointerType === "mouse") finish(e);
  });
  field.addEventListener("click", e => {
    if (swallowClick && e.detail) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  field.addEventListener("contextmenu", e => e.preventDefault());
  field.addEventListener("wheel", e => {
    e.preventDefault();
    interrupt();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? camera.height : 1;
    camera.zoomBy(clamp(-e.deltaY * unit * .0018, -.48, .48), {x:e.clientX, y:e.clientY});
  }, {passive:false});
  field.addEventListener("keydown", e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const arrows = {ArrowLeft:[-32,0], ArrowRight:[32,0], ArrowUp:[0,-32], ArrowDown:[0,32]};
    if (!arrows[e.key] && !["+", "=", "-", "0", "Home"].includes(e.key)) return;
    e.preventDefault();
    interrupt();
    if (arrows[e.key]) {
      if (e.shiftKey) camera.panBy(...arrows[e.key]);
      else camera.orbitBy(...arrows[e.key]);
    } else if (e.key === "0" || e.key === "Home") camera.reset();
    else camera.zoomBy(e.key === "-" ? -.23 : .23);
  });
  field.addEventListener("focusin", e => {
    const target = e.target.closest(".world");
    if (target?.matches(":focus-visible")) camera.reveal(target);
  });
}
