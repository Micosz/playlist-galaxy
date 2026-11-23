import { initialWorlds, demoTracks, upgradeWorlds } from "./atlas.js";

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function finished(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error("Storage transaction aborted"));
  });
}
export async function openLibrary() {
  const req = indexedDB.open("playlist-galaxy", 2);
  req.onupgradeneeded = (event) => {
    const db = req.result, tx = req.transaction;
    if (event.oldVersion === 0) {
      db.createObjectStore("worlds", { keyPath: "id" });
      db.createObjectStore("tracks", { keyPath: "id" });
      db.createObjectStore("files");
    }
    const worlds = tx.objectStore("worlds");
    const previous = worlds.getAll();
    previous.onsuccess = () => {
      const all = event.oldVersion === 0 ? initialWorlds : upgradeWorlds(previous.result);
      for (const world of all) worlds.put(world);
      for (const song of demoTracks) tx.objectStore("tracks").add(song);
    };
  };
  const db = await request(req);
  db.onversionchange = () => db.close();
  return {
    load() {
      const tx = db.transaction(["worlds", "tracks"]);
      return Promise.all([
        request(tx.objectStore("worlds").getAll()),
        request(tx.objectStore("tracks").getAll()),
      ]);
    },
    addWorlds(worlds) {
      const tx = db.transaction("worlds", "readwrite");
      for (const world of worlds) tx.objectStore("worlds").add(world);
      return finished(tx);
    },
    putWorld(world) {
      const tx = db.transaction("worlds", "readwrite");
      tx.objectStore("worlds").put(world);
      return finished(tx);
    },
    add(entries) {
      const tx = db.transaction(["tracks", "files"], "readwrite");
      for (const { track, file } of entries) {
        tx.objectStore("tracks").add(track);
        if (file) tx.objectStore("files").add(file, track.id);
      }
      return finished(tx);
    },
    remove(id) {
      const tx = db.transaction(["tracks", "files"], "readwrite");
      tx.objectStore("tracks").delete(id);
      tx.objectStore("files").delete(id);
      return finished(tx);
    },
    file(id) {
      return request(db.transaction("files").objectStore("files").get(id));
    },
  };
}

const prefix = "playlist-galaxy:position:";
const memory = new Map();
export function bookmark(world) {
  if (memory.has(world)) return memory.get(world);
  try {
    return JSON.parse(localStorage.getItem(prefix + world)) || {};
  } catch {
    return {};
  }
}
export function remember(world, id, seconds) {
  const place = { id, seconds: Number.isFinite(seconds) ? Math.max(0, seconds) : 0 };
  memory.set(world, place);
  try {
    localStorage.setItem(prefix + world, JSON.stringify(place));
  } catch {}
}

export function fromFile(file, worldId) {
  const stem = file.name.replace(/\.mp3$/i, "").trim() || file.name;
  const parts = stem.split(" - ");
  const artist = parts.length > 1 ? parts.shift() : "";
  return {
    id: crypto.randomUUID(),
    kind: "local",
    worldId,
    title: parts.join(" - ").trim() || stem,
    artist,
  };
}
