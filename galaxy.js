import { openLibrary, initialWorlds, bookmark, fromFile } from "./library.js";
import { paintPlanet, drawSky, surfaces } from "./sky.js";
import { prepareMusic, music, appleSongLink, searchSongs } from "./apple.js";
import { Player } from "./player.js";

const $ = (id) => document.getElementById(id);
const make = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
let worlds = initialWorlds,
  tracks = [],
  db = null,
  current = null,
  page = 0,
  editMode = null,
  editParent = null,
  searchId = 0;
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
const slotStyles = [
  ["49%", "45%", "min(45vw,650px)", "51%", "45%", "92vw"],
  ["19%", "24%", "min(19vw,250px)", "21%", "14%", "35vw"],
  ["81%", "66%", "min(24vw,330px)", "78%", "80%", "41vw"],
];

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
    mark = bookmark(world.id);
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
function planetButton(w, idx) {
  const btn = make("button");
  btn.className = "world";
  btn.dataset.id = w.id;
  btn.setAttribute("aria-label", "เปิดดาว " + w.name);
  const values = slotStyles[idx];
  ["--x", "--y", "--w", "--mx", "--my", "--mw"].forEach((key, i) =>
    btn.style.setProperty(key, values[i]),
  );
  btn.style.setProperty("--tone", surfaces[w.surface].tone);
  const canvas = make("canvas");
  canvas.setAttribute("aria-hidden", "true");
  paintPlanet(canvas, w);
  const label = make("span");
  label.className = "world-label";
  label.append(make("span", w.name));
  btn.append(canvas, label);
  btn.onclick = () => openWorld(w.id);
  return btn;
}
function renderMap() {
  const list = children(null),
    pages = Math.max(1, Math.ceil(list.length / 3));
  page = Math.min(pages - 1, Math.max(0, page));
  const shown = list.slice(page * 3, page * 3 + 3);
  $("worlds").replaceChildren(...shown.map(planetButton));
  shown.forEach(warm);
  $("map-pages").hidden = pages < 2;
  $("prev-page").disabled = page === 0;
  $("next-page").disabled = page === pages - 1;
  $("page-number").textContent = page + 1 + " / " + pages;
  updatePlayer();
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
      [t.artist, t.kind === "local" ? "MP3" : "Apple Music"].filter(Boolean).join(" · "),
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
      blobs.delete(t.id);
      renderDetail();
    } catch {
      storageError();
    }
  };
  li.append(remove);
  return li;
}
function renderDetail() {
  const world = byId(current);
  if (!world) return;
  const parent = byId(world.parent),
    list = songs(current),
    moons = children(current);
  $("back").textContent = parent ? "← " + parent.name : "← แผนที่ดาว";
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
      const dot = make("i");
      dot.className = "moon-dot";
      dot.style.setProperty("--tone", surfaces[w.surface].tone);
      b.append(dot, document.createTextNode(w.name));
      b.onclick = () => openWorld(w.id);
      warm(w);
      return b;
    }),
  );
  updatePlayer();
}
function toMap(push = true) {
  const prev = byId(current);
  if (prev) {
    const top = topRoot(prev);
    const idx = children(null).findIndex((w) => w.id === top.id);
    if (idx >= 0) page = Math.floor(idx / 3);
  }
  current = null;
  if (push && location.hash) history.pushState(null, "", location.pathname + location.search);
  $("map").hidden = false;
  $("interior").hidden = true;
  $("new-world").hidden = false;
  renderMap();
  drawSky($("firmament"), true);
  scrollTo(0, 0);
  if (prev)
    $("worlds")
      .querySelector('[data-id="' + topRoot(prev).id + '"]')
      ?.focus({ preventScroll: true });
}
function topRoot(w) {
  while (w.parent && byId(w.parent)) w = byId(w.parent);
  return w;
}
function openWorld(id, play = true, push = true) {
  const world = byId(id);
  if (!world) {
    toMap(false);
    return;
  }
  const changed = current !== id;
  current = id;
  const hash = "#planet=" + encodeURIComponent(id);
  if (push && location.hash !== hash) history.pushState(null, "", hash);
  $("map").hidden = true;
  $("interior").hidden = false;
  $("new-world").hidden = true;
  if (changed) {
    paintPlanet($("portrait"), world);
    drawSky($("firmament"), false);
  }
  if (play) player.enter(id);
  renderDetail();
  if (changed) {
    scrollTo(0, 0);
    $("world-title").focus({ preventScroll: true });
  }
}
function route(play) {
  const id = new URLSearchParams(location.hash.slice(1)).get("planet");
  if (id && byId(id)) openWorld(id, play, false);
  else toMap(false);
}
$("home").onclick = () => toMap();
$("back").onclick = () => {
  const parent = byId(current)?.parent;
  if (parent) openWorld(parent);
  else toMap();
};
$("prev-page").onclick = () => {
  page--;
  renderMap();
};
$("next-page").onclick = () => {
  page++;
  renderMap();
};
window.addEventListener("popstate", () => route(true));
let redraw;
window.addEventListener("resize", () => {
  cancelAnimationFrame(redraw);
  redraw = requestAnimationFrame(() => drawSky($("firmament"), !current));
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) player.checkpoint();
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
function editor(mode, parent = null) {
  if (!db) {
    storageError();
    return;
  }
  editMode = mode;
  editParent = parent;
  const old = mode === "edit" ? byId(current) : null;
  $("editor-title").textContent = old ? "แก้ไขดาว" : parent ? "สร้างดาวบริวาร" : "สร้างดาว";
  $("save-world").textContent = old ? "บันทึก" : "สร้างดาว";
  $("world-name").value = old?.name || "";
  $("colors").querySelector('[value="' + (old?.surface || "ocean") + '"]').checked = true;
  $("editor").showModal();
  $("world-name").focus();
}
$("new-world").onclick = () => editor("new");
$("manage").onclick = () => $("options").showModal();
$("edit-world").onclick = () => {
  $("options").close();
  editor("edit");
};
$("new-moon").onclick = () => {
  $("options").close();
  editor("new", current);
};
$("edit-form").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("world-name").value.trim();
  if (!name) {
    $("world-name").focus();
    return;
  }
  const old = editMode === "edit" ? byId(current) : null;
  const world = {
    id: old?.id || crypto.randomUUID(),
    parent: old ? old.parent : editParent,
    order: old?.order || Date.now(),
    name,
    surface: $("colors").querySelector(":checked").value,
  };
  $("save-world").disabled = true;
  try {
    await db.putWorld(world);
    worlds = worlds.filter((w) => w.id !== world.id).concat(world);
    $("editor").close();
    if (old) {
      paintPlanet($("portrait"), world);
      renderDetail();
    } else openWorld(world.id);
  } catch {
    storageError();
  } finally {
    $("save-world").disabled = false;
  }
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
  tracks.push(...entries.map((e) => e.track));
  if (current === worldId) {
    renderDetail();
    warm(byId(worldId));
  }
}
$("add-mp3").onclick = () => {
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

try {
  db = await openLibrary();
  [worlds, tracks] = await db.load();
} catch {
  db = null;
  storageError();
}
route(false);
