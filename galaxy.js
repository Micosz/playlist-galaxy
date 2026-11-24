import { openLibrary, bookmark, fromFile } from "./library.js";
import { initialWorlds, demoTracks, isContainer, names, childKind, copySystem, fetchCatalog } from "./atlas.js";
import { paintPlanet, paintMapBody, drawSky, surfaces } from "./sky.js";
import { prepareMusic, music, appleSongLink, searchSongs } from "./apple.js";
import { MapCamera } from "./camera.js";
import { bindCamera } from "./camera-input.js";
import { BodyFlight } from "./flight.js";
import { WheelTravel } from "./wheel-travel.js";
import { Player } from "./player.js";
import { bindFinder } from "./finder-dialog.js";
import { bindBackup } from "./backup-ui.js";

const $ = (id) => document.getElementById(id);
const thumbScreen = matchMedia("(pointer: coarse)");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const camera = new MapCamera($("map-field"), $("orbits"), $("worlds"), reduced, refinePlanet);
const bodyFlight = new BodyFlight(reduced);
const cancelMapGesture = bindCamera($("map-field"), camera, () => bodyFlight.cancel());
$("zoom-in").onclick = () => { bodyFlight.cancel(); camera.zoomBy(.25); };
$("zoom-out").onclick = () => { bodyFlight.cancel(); camera.zoomBy(-.25); };
$("camera-home").onclick = () => { bodyFlight.cancel(); camera.reset(); };
const make = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
let worlds = initialWorlds,
  tracks = demoTracks,
  db = null,
  current = null,
  mapParent = null,
  page = 0,
  editId = null,
  editParent = null,
  searchId = 0;
let browsingResult = Boolean(history.state?.galaxyBrowse);
let choosingFlight = false, rangePress = null;
let catalogVisit = 0, catalogItems = [], selectedTemplate = null;
let noteTimer,
  tickTimer,
  appleVisit = 0;
const blobs = new Map(),
  warming = new Map();
const byId = (id) => worlds.find((w) => w.id === id);
const children = (id) =>
  worlds
    .filter((w) => w.parent === id)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
const songs = (id) =>
  tracks
    .filter((t) => t.worldId === id)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
const clock = (n) =>
  Math.floor(Math.max(0, n || 0) / 60) +
  ":" +
  String(Math.floor(Math.max(0, n || 0) % 60)).padStart(2, "0");
const distantSlots = [
  [42, 49, "min(52vw,715px)", 42, 38, "80vw"],
  [77, 28, "min(30vw,390px)", 73, 73, "46vw"],
  [19, 24, "min(19vw,250px)", 21, 15, "30vw"],
];
const closeSlots = [
  [32, 48, "min(26vw,310px)", 28, 35, "45vw"],
  [71, 53, "min(24vw,290px)", 71, 65, "43vw"],
  [57, 22, "min(18vw,220px)", 69, 18, "32vw"],
];
const orbitalSlots = [
  [59, 39, 66, 46], [42, 64, 31, 52], [32, 39, 38, 29], [65, 69, 73, 65],
  [76, 27, 77, 23], [24, 73, 24, 74], [17, 20, 21, 12], [83, 79, 75, 87],
].map(([x, y, mx, my], i) => [x, y, i === 5 ? "min(14vw,175px)" : "min(10vw,118px)", mx, my, i === 5 ? "28vw" : "21vw"]);

function ancestry(id) {
  const path = [];
  for (let node = byId(id); node && !path.includes(node); node = byId(node.parent)) path.unshift(node);
  return path;
}
function orbitView(parent, list) {
  return (parent?.kind === "system" || parent?.kind === "host") && !list.some(isContainer);
}

function announce(message) {
  $("notice").textContent = message;
  clearTimeout(noteTimer);
  if (message)
    noteTimer = setTimeout(() => {
      $("notice").textContent = "";
    }, 6500);
}
function storageError() {
  announce("บันทึกในเครื่องไม่ได้ ตรวจพื้นที่ว่างและสิทธิ์จัดเก็บของเบราว์เซอร์");
}
function cachedFile(id) {
  if (blobs.has(id)) return blobs.get(id);
  if (!warming.has(id)) {
    const task = db
      .file(id)
      .then((blob) => {
        if (blob) {
          if (blobs.size >= 12) blobs.delete(blobs.keys().next().value);
          blobs.set(id, blob);
        }
        return blob;
      })
      .finally(() => warming.delete(id));
    warming.set(id, task);
  }
  return warming.get(id);
}
function warm(world) {
  const list = songs(world.id),
    mark = bookmark(world.id,list);
  const track = list.find((t) => t.id === mark.id) || list[0];
  if (db && track?.kind === "local") Promise.resolve(cachedFile(track.id)).catch(() => {});
}
const player = new Player({
  tracks: songs,
  file: cachedFile,
  changed: updatePlayer,
  issue: announce,
});

function updateClock() {
  player.tick();
  const time = player.position(),
    duration = player.duration();
  $("clock").textContent = clock(time);
  $("seek").disabled = !duration || !player.clockReady;
  $("seek").max = duration || 1;
  $("seek").value = Math.min(duration || time, time);
  $("seek").setAttribute("aria-valuetext", clock(time));
}
function updatePlayer() {
  const visible = Boolean(player.track),
    active = player.state === "playing" || player.state === "loading";
  $("transport").hidden = !visible;
  document.body.classList.toggle("playing-map", visible);
  $("now-title").textContent = player.track?.title || "";
  $("now-world").textContent = byId(player.world)?.name || "";
  $("toggle").textContent = active ? "Ⅱ" : "▶";
  $("toggle").toggleAttribute("data-playing", active);
  $("toggle").setAttribute("aria-label", active ? "หยุดชั่วคราว" : "เล่นต่อ");
  $("skip").disabled = !visible || songs(player.world).length < 2;
  for (const button of document.querySelectorAll("[data-track]")) {
    const selected = button.dataset.track === player.track?.id;
    button.setAttribute("aria-current", String(selected));
    button.querySelector(".track-no").textContent = selected && active ? "♫" : button.dataset.index;
  }
  for (const button of $("worlds").querySelectorAll(".world"))
    button.setAttribute("aria-current", String(button.dataset.id === player.world && active));
  clearInterval(tickTimer);
  if (visible && active) tickTimer = setInterval(updateClock, 450);
  if (visible) updateClock();
}
function refinePlanet(el) {
  const world = byId(el.dataset.id);
  if (world) paintPlanet(el.firstElementChild, world);
}
function planetButton(w, slot, compact) {
  const btn = make("button");
  btn.className = "world";
  btn.dataset.id = w.id;
  btn.dataset.kind = w.kind;
  btn.setAttribute("aria-label", "เปิด" + names[w.kind] + " " + w.name);
  ["--x", "--y", "--w", "--mx", "--my", "--mw"].forEach((key, i) =>
    btn.style.setProperty(key, typeof slot[i] === "number" ? slot[i] + "%" : slot[i]));
  btn.style.setProperty("--tone", surfaces[w.surface].tone);
  const canvas = make("canvas");
  canvas.setAttribute("aria-hidden", "true");
  paintMapBody(canvas, w, compact);
  const label = make("span");
  label.className = "world-label";
  label.append(make("span", w.name));
  btn.append(canvas, label);
  if (isContainer(w)) {
    const list = children(w.id);
    const kind = list[0]?.kind || childKind(w);
    btn.append(make("small", list.length + " " + names[kind]));
  }
  btn.onclick = () => selectDestination(w.id);
  return btn;
}
function renderThumbNav() {
  const world = byId(current || mapParent);
  const trip = wheelTravel.trip;
  const manual = trip?.method === "thumb";
  const canChoose = !reduced.matches && worlds.some(w => w.parent === (world?.id || null));
  $("thumb-nav").hidden = !thumbScreen.matches || (!world && !canChoose && !trip);
  $("thumb-up").hidden = !world || choosingFlight || manual;
  if (world) $("thumb-parent").textContent = "กลับ " + (byId(world.parent)?.name || "จักรวาล");
  $("thumb-flight").hidden = !canChoose || choosingFlight || Boolean(trip);
  $("thumb-pick").hidden = !choosingFlight;
  if (choosingFlight) $("thumb-pick").textContent = current ? "แตะดวงจันทร์ปลายทาง" : "แตะดาวปลายทาง";
  $("thumb-cancel").hidden = !(choosingFlight || manual);
  $("thumb-route").hidden = !manual;
  if (manual) $("thumb-target").textContent = "บินไป " + byId(trip.id).name;
  else rangePress = null;
}
function stopChoosing() {
  if (choosingFlight) {
    choosingFlight = false;
    renderThumbNav();
  }
}
function selectDestination(id) {
  if (!choosingFlight) return openWorld(id);
  choosingFlight = false;
  $("thumb-range").value = 0;
  wheelTravel.start(id, camera.bookmark(), "thumb");
  $("thumb-range").focus({preventScroll:true});
}
$("thumb-flight").onclick = e => {
  choosingFlight = true;
  renderThumbNav();
  if (!e.detail) $(current ? "moons" : "worlds").firstElementChild?.focus({preventScroll:true});
};
$("thumb-cancel").onclick = () => {
  if (wheelTravel.trip) wheelTravel.cancel();
  else { stopChoosing(); $("thumb-flight").focus({preventScroll:true}); }
};
$("thumb-up").onclick = () => {
  if (wheelTravel.trip) wheelTravel.cancel();
  else goUp(byId(current || mapParent)?.parent);
};
const range = $("thumb-range");
function commitRange() {
  if (!rangePress && range.valueAsNumber === 100 && wheelTravel.trip?.method === "thumb") wheelTravel.finish();
}
range.addEventListener("input", () => {
  if (wheelTravel.trip?.method === "thumb") wheelTravel.display(range.valueAsNumber / 100);
});
range.addEventListener("pointerdown", e => {
  if (e.isPrimary) rangePress = {id:e.pointerId, trip:wheelTravel.trip};
});
range.addEventListener("pointerup", e => {
  if (rangePress?.id !== e.pointerId) return;
  const sameTrip = rangePress.trip === wheelTravel.trip;
  rangePress = null;
  if (sameTrip) commitRange();
});
range.addEventListener("pointercancel", () => { rangePress = null; });
range.addEventListener("change", commitRange);

function updateThumbMode() {
  stopChoosing();
  if (wheelTravel.trip?.method === "thumb") wheelTravel.cancel();
  renderThumbNav();
}
thumbScreen.addEventListener("change", updateThumbMode);
reduced.addEventListener("change", updateThumbMode);
$("scene").addEventListener("scroll", () => {
  if (!$("scene").scrollTop) return;
  if (wheelTravel.trip) wheelTravel.cancel();
  else bodyFlight.cancel();
}, {passive:true});

function renderMap() {
  cancelMapGesture();
  const parent = byId(mapParent), list = children(mapParent);
  const orbit = orbitView(parent, list);
  const perPage = orbit ? orbitalSlots.length : distantSlots.length;
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  page = Math.max(0, Math.min(page, pages - 1));
  const visible = list.slice(page * perPage, (page + 1) * perPage);
  const slots = orbit ? (list.length <= 3 ? closeSlots : orbitalSlots) : distantSlots;
  const kind = childKind(parent);
  $("worlds").replaceChildren(...visible.map((w, i) => planetButton(w, slots[i], slots === orbitalSlots)));
  $("worlds").setAttribute("aria-label", "เลือก" + (list[0] ? names[list[0].kind] : names[kind]));
  $("map").classList.toggle("orbit-view", orbit);
  if (orbit) visible.forEach(warm);
  $("map-name").textContent = parent?.name || "My universe";
  $("map-title").lang = parent ? "" : "en";
  $("new-world").textContent = "＋ สร้าง" + names[kind];
  $("rename-map").hidden = !parent;
  $("map-help").textContent = !list.length ? "ยังไม่มี" + names[kind] + " · สร้าง" + names[kind] + "แรกที่นี่"
    : !parent ? "แตะกาแล็กซีเพื่อเข้า · ลากเพื่อหมุน · " + (matchMedia("(pointer: coarse)").matches ? "จีบเพื่อซูม" : "ชี้แล้วเลื่อนล้อขึ้นเพื่อบินเข้า")
    : parent.kind === "galaxy" ? "แตะระบบดาวเพื่อดูดาวในวงโคจร"
    : orbit ? (matchMedia("(pointer: coarse)").matches ? "แตะดาวเพื่อฟังเพลย์ลิสต์ของดวงนั้น" : "คลิกดาวเพื่อฟัง · ชี้แล้วเลื่อนล้อขึ้นเพื่อบินเข้า")
    : "แตะดาวแม่เพื่อดูดาวเคราะห์";
  $("trail").hidden = !parent;
  $("trail").replaceChildren();
  if (parent) {
    for (const node of [null, ...ancestry(parent.id).slice(0, -1)]) {
      const crumb = make("button", node?.name || "จักรวาล");
      crumb.onclick = () => goUp(node?.id || null);
      $("trail").append(crumb, make("span", "›"));
    }
    const here = make("span", parent.name);
    here.setAttribute("aria-current", "page");
    $("trail").append(here);
  }
  $("map-pages").hidden = pages < 2;
  $("prev-page").disabled = page === 0;
  $("next-page").disabled = page === pages - 1;
  $("page-number").textContent = page + 1 + " / " + pages;
  updatePlayer();
  camera.show(JSON.stringify([mapParent, page]), parent?.kind || "universe", orbit, parent?.surface === "ocean");
}
function trackRow(t, index) {
  const li = make("li"),
    button = make("button");
  button.className = "track-main";
  button.dataset.track = t.id;
  button.dataset.index = String(index + 1).padStart(2, "0");
  const num = make("span", button.dataset.index);
  num.className = "track-no";
  num.setAttribute("aria-hidden", "true");
  const copy = make("span");
  copy.className = "track-text";
  copy.append(
    make("strong", t.title),
    make(
      "small",
      [t.artist, t.kind === "apple" ? "Apple Music" : t.kind === "demo" ? "เพลงตัวอย่าง" : "MP3"].filter(Boolean).join(" · "),
    ),
  );
  button.append(num, copy);
  button.onclick = () => player.pick(t.worldId, t);
  li.append(button);
  if (t.kind === "apple" && appleSongLink(t.url)) {
    const link = make("a", "↗");
    link.href = t.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "catalog-link";
    link.setAttribute("aria-label", "เปิด " + t.title + " ใน Apple Music");
    li.append(link);
  }
  const remove = make("button", "×");
  remove.className = "track-remove";
  remove.setAttribute("aria-label", "เอา " + t.title + " ออกจากดาว");
  remove.onclick = async () => {
    if (!confirm("เอา “" + t.title + "” ออกจากดาวนี้?")) return;
    try {
      await db.remove(t.id);
      if (player.track?.id === t.id) player.idle();
      tracks = tracks.filter((s) => s.id !== t.id);
      finder.libraryChanged();
      blobs.delete(t.id);
      renderDetail();
    } catch {
      storageError();
    }
  };
  li.append(remove);
  return li;
}
function detailTrail(world) {
  const path = ancestry(world.id), parent = byId(world.parent);
  const prefix = $("detail-ancestors");
  prefix.replaceChildren();
  const ancestors = parent ? [null, ...path.slice(0, -2)] : [];
  for (const ancestor of ancestors) {
    const button = make("button", ancestor?.name || "จักรวาล");
    button.onclick = () => goUp(ancestor?.id || null);
    const separator = make("span", "›");
    separator.setAttribute("aria-hidden", "true");
    prefix.append(button, separator);
  }
  $("back").textContent = parent?.name || "จักรวาล";
  $("back").setAttribute("aria-label", "กลับไปที่ " + $("back").textContent);
  $("detail-location").textContent = world.name;
  const trail = $("detail-trail");
  trail.scrollLeft = trail.scrollWidth;
}
function renderDetail() {
  const world = byId(current);
  if (!world) return;
  const list = songs(current),
    moons = children(current);
  $("world-title").textContent = world.name;
  $("world-count").textContent = list.length + " เพลง";
  $("empty").hidden = Boolean(list.length);
  $("tracks").replaceChildren(...list.map(trackRow));
  $("radio-link").hidden = world.id !== "saturn";
  $("satellites").hidden = !moons.length;
  $("moons").replaceChildren(
    ...moons.map((w) => {
      const b = make("button");
      b.className = "pill";
      b.dataset.moon = w.id;
      const dot = make("i");
      dot.className = "moon-dot";
      dot.style.setProperty("--tone", surfaces[w.surface].tone);
      b.append(dot, document.createTextNode(w.name));
      b.onclick = () => selectDestination(w.id);
      warm(w);
      return b;
    }),
  );
  updatePlayer();
}
function openWorld(id, { play = true, push = true, animate = play, browse = false } = {}) {
  choosingFlight = false;
  const node = byId(id), prev = current || mapParent;
  const outward = !node || ancestry(prev).some(ancestor => ancestor.id === id);
  const travelling = animate && prev !== (node?.id || null) && !reduced.matches && !document.hidden;
  const mapBody = (worldId) => [...$("worlds").children].find(b => b.dataset.id === worldId)?.firstElementChild;
  const moonMarker = (moonId) => [...$("moons").children].find(b => b.dataset.moon === moonId)?.firstElementChild;
  const map = !node || isContainer(node);
  const moonOrigin = travelling && current && node?.parent === current ? bodyFlight.bounds(moonMarker(id)) : null;
  const sourceArt = current ? $("portrait") : mapBody(id);
  const previousArt = travelling ? bodyFlight.snapshot(sourceArt) : null;
  const sourceId = moonOrigin ? id : current || id;
  const departure = moonOrigin ? previousArt : (travelling && !current ? camera.departure(sourceArt) : null);
  bodyFlight.cancel();
  const hash = node ? (map ? "#map=" : "#planet=") + encodeURIComponent(node.id) : "";
  if (push) {
    if (location.hash !== hash) history.pushState(browse ? {galaxyBrowse:true} : null, "", location.pathname + location.search + hash);
    else if (browse !== browsingResult) history.replaceState({...history.state,galaxyBrowse:browse}, "");
    browsingResult = browse;
  }
  $("map").hidden = !map;
  $("interior").hidden = map;
  $("new-world").hidden = !map;
  if (map) {
    const parent = node?.id || null;
    const returning = ancestry(prev).find((w) => w.parent === parent);
    if (parent !== mapParent || current) {
      const list = children(parent);
      const index = returning ? list.findIndex((w) => w.id === returning.id) : 0;
      page = Math.floor(Math.max(0, index) / (orbitView(node, list) ? orbitalSlots.length : distantSlots.length));
    }
    current = null;
    mapParent = parent;
    renderMap();
    if (play) {
      const target = [...$("worlds").children].find((b) => b.dataset.id === returning?.id);
      (target || $("worlds").firstElementChild || $("new-world")).focus({ preventScroll: true });
    }
  } else {
    cancelMapGesture();
    camera.leave();
    const changed = current !== id;
    current = id;
    mapParent = ancestry(node.parent).filter(isContainer).at(-1)?.id || null;
    if (play) player.enter(id);
    if (changed) paintPlanet($("portrait"), node);
    detailTrail(node);
    renderDetail();
    if (changed && play) $("world-title").focus({ preventScroll: true });
  }
  renderThumbNav();
  $("scene").scrollTop = 0;
  scrollTo(0, 0);
  if (travelling) {
    const returning = outward && ancestry(prev).find(w => w.parent === (node?.id || null));
    const returnMarker = !map && outward && returning?.id === prev ? moonMarker(prev) : null;
    const landing = map ? (returning ? mapBody(returning.id) : null) : returnMarker || $("portrait");
    const source = moonOrigin ? bodyFlight.snapshot($("portrait"), moonOrigin) : previousArt;
    const area = (map ? $("map-field") : $("interior")).getBoundingClientRect();
    const duration = moonOrigin || returnMarker ? 720 : map && !outward ? 780 : 640;
    const landingId = map ? returning?.id : returnMarker ? prev : id;
    const returnOnMap = map && outward && landing && (!source || sourceId === landingId);
    bodyFlight.depart(departure, source?.rect, bodyFlight.bounds(landing) || area, outward, duration);
    if (!returnOnMap)
      bodyFlight.start(source, landing, area, duration, Boolean(source && landing && sourceId !== landingId));
    if (map) camera.fly(outward, source?.rect || departure?.rect, returning?.id, duration, Boolean(returnOnMap && source));
    return duration;
  }
  return 0;
}
const wheelTravel = new WheelTravel({
  reduced,
  ready: button => !button.classList.contains("world") || camera.readyForEntry(button),
  bookmark: () => camera.bookmark(),
  changed: renderThumbNav,
  begin(id, method) {
    const origin = { id: current || mapParent, page, x: scrollX, y: scrollY, sceneTop: $("scene").scrollTop };
    const duration = openWorld(id, { play:false, push:false, animate:true });
    $(current ? "world-count" : "map-help").textContent = method === "thumb" ? "ยกนิ้วเพื่อพัก · เลื่อนสุดแล้วปล่อยเพื่อเข้า" : "เลื่อนต่อหรือคลิกเพื่อเข้า · เลื่อนย้อนเพื่อกลับ";
    return { origin, duration };
  },
  seek(progress, duration) {
    camera.scrub(progress);
    bodyFlight.scrub(progress * duration);
  },
  arrive(id, overview) {
    if (camera.id !== null) camera.settle();
    openWorld(id);
    camera.remember(overview);
    if (current) $("world-title").focus({preventScroll:true});
  },
  restore(origin, overview, selected) {
    camera.remember(overview);
    openWorld(origin.id, { play:false, push:false });
    if (!current && page !== origin.page) {
      page = origin.page;
      renderMap();
    }
    $("scene").scrollTop = origin.sceneTop;
    scrollTo(origin.x, origin.y);
    if (selected) {
      const buttons = current ? $("moons").children : $("worlds").children;
      [...buttons].find(b => (b.dataset.id || b.dataset.moon) === selected)?.focus({preventScroll:true});
    }
  }
});
function focusLocation() {
  $(current ? "world-title" : "map-title").focus({preventScroll:true});
}
function goUp(id) {
  if (browsingResult) { openWorld(id,{play:false,browse:true}); focusLocation(); }
  else openWorld(id);
}
const finder = bindFinder({
  library: () => ({worlds,tracks}),
  beforeOpen() {
    wheelTravel.cancel();
    stopChoosing();
    cancelMapGesture();
    bodyFlight.cancel();
    if (camera.frame || camera.flight) camera.settle();
  },
  browse(row) {
    if ((current || mapParent) !== row.worldId) {
      const finderReturn = {page,sceneY:$("scene").scrollTop,windowY:scrollY};
      history.replaceState({...history.state,finderReturn}, "");
    }
    openWorld(row.worldId,{play:false,browse:true});
    if (row.track) {
      if ($("playlist-body").hidden) $("playlist-toggle").click();
      const target = [...$("tracks").querySelectorAll("[data-track]")].find(b => b.dataset.track === row.track.id);
      if (target) { target.focus({preventScroll:true}); target.scrollIntoView({block:"nearest"}); return; }
    }
    focusLocation();
  },
  play(track) {
    if (player.track?.id === track.id && player.world === track.worldId &&
        (player.state === "loading" || player.state === "playing")) return;
    player.pick(track.worldId,track);
  },
});
function route(play) {
  const params = new URLSearchParams(location.hash.slice(1));
  openWorld(params.get("planet") || params.get("map"), { play, push:false });
}
$("home").onclick = () => goUp(null);
$("back").onclick = () => goUp(byId(current)?.parent);
$("playlist-toggle").onclick = () => {
  bodyFlight.cancel();
  const folded = !$("playlist-body").hidden;
  $("playlist-body").hidden = folded;
  $("playlist-toggle").setAttribute("aria-expanded", String(!folded));
  $("interior").classList.toggle("list-folded", folded);
};
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || e.defaultPrevented || e.repeat || document.querySelector("dialog[open]")) return;
  if (choosingFlight) { e.preventDefault(); $("thumb-cancel").click(); return; }
  const active = byId(current || mapParent);
  if (active) { e.preventDefault(); goUp(active.parent); }
});
$("prev-page").onclick = () => { page--; renderMap(); };
$("next-page").onclick = () => { page++; renderMap(); };
window.addEventListener("popstate", e => {
  const quiet = browsingResult || e.state?.galaxyBrowse || $("finder").open;
  if ($("finder").open) $("finder").close();
  wheelTravel.cancel();
  browsingResult = Boolean(e.state?.galaxyBrowse);
  route(!quiet && navigator.userActivation?.hasBeenActive === true);
  if (!quiet) return;
  const origin = e.state?.finderReturn;
  if (origin && !current && page !== origin.page) { page = origin.page; renderMap(); }
  if (origin) { $("scene").scrollTop = origin.sceneY; scrollTo(0,origin.windowY); }
  if (origin) $("open-finder").focus({preventScroll:true});
  else focusLocation();
});
let redraw;
function redrawSky() {
  cancelAnimationFrame(redraw);
  redraw = requestAnimationFrame(() => {
    drawSky($("firmament"), false);
  });
}
window.addEventListener("resize", redrawSky);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopChoosing();
    player.checkpoint();
  }
});
window.addEventListener("pagehide", () => player.checkpoint());
$("toggle").onclick = () => player.toggle();
$("skip").onclick = () => player.next();
$("seek").addEventListener("input", () => player.seek(Number($("seek").value)));

for (const [key, s] of Object.entries(surfaces)) {
  const label = make("label");
  label.title = s.label;
  const input = make("input");
  input.type = "radio";
  input.name = "surface";
  input.value = key;
  input.setAttribute("aria-label", s.label);
  const sample = make("i");
  sample.style.setProperty("--tone", s.tone);
  label.append(input, sample);
  $("colors").append(label);
}
for (const button of document.querySelectorAll("[data-close]"))
  button.onclick = () => button.closest("dialog").close();
function renderCatalog() {
  const term = $("catalog-query").value.trim().toLowerCase();
  const matches = catalogItems.filter((item) => {
    if (!term || item.name.toLowerCase().includes(term) || item.alias?.toLowerCase().includes(term)) return true;
    return item.hosts?.some((host) => host.name.toLowerCase().includes(term) ||
      host.planets.some((p) => p.toLowerCase().includes(term)));
  });
  $("catalog-status").textContent = matches.length ? matches.length.toLocaleString("th-TH") + " รายการ" : "ไม่พบชื่อที่ตรงกัน";
  $("catalog-hits").replaceChildren(...matches.slice(0, 8).map((item) => {
    const li = make("li"), btn = make("button");
    btn.type = "button";
    btn.append(make("span", item.name));
    if (item.count || item.alias) btn.append(make("small", item.alias || item.count + " ดาวเคราะห์"));
    btn.onclick = () => {
      selectedTemplate = item;
      $("world-name").value = item.name;
      $("catalog-picker").open = false;
      $("template-note").textContent = item.count ? "จะเพิ่มระบบ " + item.name + " พร้อมดาวเคราะห์ " + item.count + " ดวง" : "ชื่อในแค็ตตาล็อก · " + item.name;
      $("template-note").hidden = false;
      $("save-world").focus();
    };
    li.append(btn);
    return li;
  }));
}
$("catalog-query").oninput = renderCatalog;
$("catalog-picker").ontoggle = async () => {
  if (!$("catalog-picker").open) return;
  const visit = catalogVisit, parent = byId(editParent), kind = childKind(parent);
  $("catalog-status").textContent = "กำลังเปิดแค็ตตาล็อก…";
  $("catalog-query").focus();
  try {
    const data = await fetchCatalog(kind);
    if (visit !== catalogVisit || !$("editor").open) return;
    if (kind === "galaxy") catalogItems = data;
    else if (kind === "system") catalogItems = data.systems;
    else {
      const existing = new Set(children(parent.id).map((w) => w.designation || w.name));
      catalogItems = (data.moons.get(parent.solar) || []).filter((n) => !existing.has(n)).map((name) => ({name}));
    }
    renderCatalog();
  } catch {
    if (visit === catalogVisit) $("catalog-status").textContent = "เปิดแค็ตตาล็อกไม่ได้ ปิดแล้วลองอีกครั้ง หรือตั้งชื่อเองได้";
  }
};
function editor(parentId, editing = null) {
  if (!db) { storageError(); return; }
  catalogVisit++;
  editParent = parentId;
  editId = editing;
  const old = byId(editId), parent = byId(parentId), kind = old?.kind || childKind(parent);
  const label = names[kind], title = (old ? "แก้ไข" : "สร้าง") + label;
  $("root-backup").hidden = Boolean(parent || old);
  $("editor-title").textContent = title;
  $("save-world").textContent = old ? "บันทึก" : title;
  $("name-label").textContent = "ชื่อ" + label;
  $("world-name").placeholder = kind === "galaxy" ? "เช่น After Hours" : kind === "system" ? "เช่น เพลงเดินทาง" : "เช่น ขับรถกลางคืน";
  $("world-name").value = old?.name || "";
  const container = ["galaxy","system","host"].includes(kind);
  $("surface-label").textContent = container ? "โทนสี" : "ลักษณะของดาว";
  for (const input of $("colors").querySelectorAll("input")) {
    input.parentElement.hidden = container && !["ember", "ocean"].includes(input.value);
    const description = container ? (input.value === "ocean" ? "โทนเย็น" : "โทนอุ่น") : surfaces[input.value].label;
    input.setAttribute("aria-label", description);
    input.parentElement.title = description;
  }
  $("colors").querySelector('[value="' + (old?.surface || (container ? "ember" : kind === "moon" ? "moon" : "ocean")) + '"]').checked = true;
  catalogItems = [];
  selectedTemplate = null;
  $("catalog-picker").open = false;
  $("catalog-picker").hidden = Boolean(old) || !(kind === "galaxy" || kind === "system" || (kind === "moon" && parent.solar));
  $("catalog-summary").textContent = kind === "galaxy" ? "เลือกชื่อจากแค็ตตาล็อกกาแล็กซี" : kind === "system" ? "ใช้ระบบดาวจาก NASA" : "เลือกดวงจันทร์ของ " + (parent?.solar || "");
  $("catalog-instruction").textContent = kind === "system" ? "ค้นชื่อระบบ ดาวแม่ หรือดาวเคราะห์" : "ค้นชื่อในแค็ตตาล็อก";
  $("catalog-query").value = "";
  $("catalog-hits").replaceChildren();
  $("template-note").hidden = true;
  $("move-field").hidden = old?.kind !== "planet";
  if (old?.kind === "planet") {
    $("move-to").replaceChildren(...worlds.filter((w) => w.kind === "system" || w.kind === "host").map((w) => {
      const opt = new Option(ancestry(w.id).map((n) => n.name).join(" › "), w.id);
      opt.selected = old.parent === w.id;
      return opt;
    }));
  }
  stopChoosing();
  $("editor").showModal();
  $("world-name").focus();
}
$("new-world").onclick = () => editor(mapParent);
$("rename-map").onclick = () => editor(byId(mapParent).parent, mapParent);
$("manage").onclick = () => { stopChoosing(); $("options").showModal(); };
$("edit-world").onclick = () => { $("options").close(); editor(byId(current).parent, current); };
$("new-moon").onclick = () => { $("options").close(); editor(current); };
$("edit-form").onsubmit = async (e) => {
  e.preventDefault();
  if ($("save-world").disabled) return;
  const name = $("world-name").value.trim();
  if (!name) { $("world-name").focus(); return; }
  const old = byId(editId);
  const world = {
    ...old, id: old?.id || crypto.randomUUID(), kind: old?.kind || childKind(byId(editParent)),
    parent: old?.kind === "planet" ? $("move-to").value : editParent,
    order: old?.order ?? Date.now(), name, surface: $("colors").querySelector(":checked").value,
  };
  if (selectedTemplate && world.kind === "moon") world.designation = selectedTemplate.name;
  const added = selectedTemplate?.hosts ? copySystem(world, selectedTemplate) : [world];
  $("save-world").disabled = true;
  try {
    if (old) await db.putWorld(world);
    else await db.addWorlds(added);
    worlds = worlds.filter((w) => w.id !== world.id).concat(added);
    finder.libraryChanged();
    $("editor").close();
    if (old && !isContainer(world)) paintPlanet($("portrait"), world);
    openWorld(world.id, { play:!old });
  } catch { storageError(); }
  finally { $("save-world").disabled = false; }
};
async function addEntries(worldId, entries) {
  if (!db) throw new Error("storage");
  const base = songs(worldId).reduce(
    (latest, track) => Math.max(latest, track.order + 1),
    Date.now(),
  );
  entries.forEach((e, i) => {
    e.track.order = base + i;
  });
  await db.add(entries);
  tracks = tracks.concat(entries.map(e => e.track));
  finder.libraryChanged();
  if (current === worldId) {
    renderDetail();
    warm(byId(worldId));
  }
}
$("add-mp3").onclick = () => {
  stopChoosing();
  if (db) $("files").click();
  else storageError();
};
$("files").onchange = async () => {
  const worldId = current,
    files = Array.from($("files").files);
  $("files").value = "";
  const valid = files.filter(
    (f) => f.size > 0 && (/\.mp3$/i.test(f.name) || /^audio\/(mpeg|mp3)$/i.test(f.type)),
  );
  if (!valid.length) {
    if (files.length) announce("เลือกไฟล์ MP3 ที่มีข้อมูลเสียง");
    return;
  }
  try {
    announce("กำลังเพิ่ม MP3 " + valid.length + " ไฟล์ลง " + byId(worldId).name + "…");
    await addEntries(
      worldId,
      valid.map((file) => ({ track: fromFile(file, worldId), file })),
    );
    announce(
      "เพิ่ม " +
        valid.length +
        " เพลงลง " +
        byId(worldId).name +
        (valid.length < files.length
          ? " · ข้าม " + (files.length - valid.length) + " ไฟล์ที่ใช้ไม่ได้"
          : ""),
    );
  } catch {
    storageError();
  }
};

function appleUi() {
  const auth = Boolean(music?.isAuthorized);
  $("apple-status").textContent = auth
    ? "เชื่อมบัญชี Apple Music แล้ว"
    : "เชื่อมบัญชีสมาชิก Apple Music เพื่อฟังเพลงเต็มบนดาวนี้";
  $("connect-apple").textContent = auth ? "ยกเลิกการเชื่อมต่อ" : "เชื่อมต่อ Apple Music";
  $("connect-apple").disabled = !music;
  $("search-form").hidden = !auth;
}
$("open-apple").onclick = async () => {
  const visit = ++appleVisit;
  searchId++;
  $("results").replaceChildren();
  $("query").value = "";
  $("apple-feedback").textContent = "";
  $("apple-links").open = false;
  stopChoosing();
  $("apple").showModal();
  appleUi();
  try {
    await prepareMusic();
    if (visit === appleVisit) appleUi();
  } catch (err) {
    if (visit === appleVisit) $("apple-status").textContent = err.message;
  }
};
$("apple").addEventListener("close", () => {
  appleVisit++;
  searchId++;
});
$("connect-apple").onclick = async () => {
  if (!music) return;
  const visit = appleVisit;
  $("connect-apple").disabled = true;
  try {
    if (music.isAuthorized) {
      if (player.track?.kind === "apple") player.pause();
      await music.unauthorize();
      searchId++;
      $("results").replaceChildren();
    } else await music.authorize();
    if (visit === appleVisit) {
      appleUi();
      $("apple-feedback").textContent = "";
    }
  } catch {
    if (visit === appleVisit) {
      appleUi();
      $("apple-feedback").textContent = "การเชื่อมต่อยังไม่สำเร็จ ลองเชื่อมอีกครั้ง";
    }
  }
};
async function addApple(worldId, song) {
  if (songs(worldId).some((t) => t.kind === "apple" && t.catalogId === song.catalogId))
    return "เพลงนี้อยู่บนดาวแล้ว";
  await addEntries(worldId, [
    { track: { ...song, worldId, kind: "apple", id: crypto.randomUUID() } },
  ]);
  return "เพิ่ม “" + song.title + "” ลง " + byId(worldId).name + " แล้ว";
}
$("search-form").onsubmit = async (e) => {
  e.preventDefault();
  const term = $("query").value.trim();
  if (!term) return;
  const seq = ++searchId,
    worldId = current;
  $("results").replaceChildren();
  $("apple-feedback").textContent = "กำลังค้นหา…";
  try {
    const found = await searchSongs(term);
    if (seq !== searchId) return;
    $("apple-feedback").textContent = found.length ? "" : "ไม่พบเพลงที่ตรงกัน";
    for (const s of found) {
      const row = make("li"),
        info = make("span");
      info.className = "track-text";
      info.append(make("strong", s.title), make("small", s.artist));
      const add = make("button", "＋");
      add.className = "icon-btn";
      add.setAttribute("aria-label", "เพิ่ม " + s.title);
      add.onclick = async () => {
        add.disabled = true;
        try {
          $("apple-feedback").textContent = await addApple(worldId, s);
        } catch {
          add.disabled = false;
          $("apple-feedback").textContent = "บันทึกเพลงไม่ได้ ลองอีกครั้ง";
        }
      };
      row.append(info, add);
      $("results").append(row);
    }
  } catch {
    if (seq === searchId) $("apple-feedback").textContent = "ค้นหาไม่ได้ ลองอีกครั้ง";
  }
};
$("link-form").onsubmit = async (e) => {
  e.preventDefault();
  const song = appleSongLink($("song-url").value),
    name = $("song-label").value.trim();
  if (!song || !name) {
    $("apple-feedback").textContent = "เลือกลิงก์เพลงจาก music.apple.com และระบุชื่อเพลง";
    return;
  }
  try {
    $("apple-feedback").textContent = await addApple(current, { ...song, title: name, artist: "" });
    $("link-form").reset();
  } catch {
    $("apple-feedback").textContent = "บันทึกเพลงไม่ได้ ลองอีกครั้ง";
  }
};

bindBackup({
  library: () => db,
  counts: () => ({ worlds:worlds.length, tracks:tracks.length }),
  checkpoint: () => player.checkpoint(),
  async refresh() {
    [worlds, tracks] = await db.load();
    finder.libraryChanged();
    if (current) { paintPlanet($("portrait"),byId(current)); detailTrail(byId(current)); renderDetail(); }
    else renderMap();
    renderThumbNav();
  },
});

try {
  db = await openLibrary();
  [worlds, tracks] = await db.load();
  finder.libraryChanged();
} catch {
  db = null;
  storageError();
}
drawSky($("firmament"), false);
route(false);
