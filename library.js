import { initialWorlds, demoTracks, upgradeWorlds } from "./atlas.js";
import { limits, mergePlan, fileKey, mediaDigest } from "./backup.js";

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function finished(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new DOMException("Storage transaction aborted","AbortError"));
  });
}

const stores = ["worlds","tracks","positions","files"];
const prefix = "playlist-galaxy:position:";
const memory = new Map();
let restored = new Map();

function places(records) {
  return new Map(records.map(p => [p.worldId,p]));
}
function localPosition(world) {
  if (memory.has(world)) return memory.get(world);
  try {
    const p = JSON.parse(localStorage.getItem(prefix + world));
    if (p && typeof p.id === "string" && Number.isFinite(p.seconds) && p.seconds >= 0) return p;
  } catch {}
}
export function bookmark(world, playlist) {
  const saved = localPosition(world);
  const fallback = restored.get(world);
  for (const mark of [saved,fallback]) {
    if (mark && (!playlist || playlist.some(t => t.id === mark.id))) return mark;
  }
  return {};
}
export function remember(world, id, seconds) {
  const place = { id, seconds: Number.isFinite(seconds) ? Math.max(0, seconds) : 0 };
  try {
    localStorage.setItem(prefix + world, JSON.stringify(place));
    memory.delete(world);
  } catch { memory.set(world,place); }
}
function records(tx, bounded = false) {
  return Promise.all(["worlds","tracks","positions"].map((name,i) => {
    const cap = i === 1 ? limits.tracks : limits.worlds;
    const store = tx.objectStore(name);
    return request(bounded ? store.getAll(null,cap + 1) : store.getAll());
  }));
}
function savedPositions(worlds, tracks, imported) {
  const valid = new Map(tracks.map(t => [t.id,t.worldId]));
  const result = new Map();
  for (const w of worlds) {
    const local = localPosition(w.id);
    const p = local && valid.get(local.id) === w.id ? local : imported.get(w.id);
    if (p && valid.get(p.id) === w.id) result.set(w.id,{worldId:w.id,id:p.id,seconds:p.seconds});
  }
  return result;
}

async function storeMedia(tx, blobs) {
  const files = tx.objectStore("files");
  await Promise.all([...blobs].map(async ([key,blob]) => {
    const ref = fileKey({mediaKey:key});
    if (await request(files.getKey(ref)) === undefined) files.add(blob,ref);
  }));
}

export async function openLibrary() {
  const req = indexedDB.open("playlist-galaxy", 3);
  req.onupgradeneeded = (event) => {
    const db = req.result, tx = req.transaction;
    if (event.oldVersion === 0) {
      db.createObjectStore("worlds", { keyPath: "id" });
      db.createObjectStore("tracks", { keyPath: "id" });
      db.createObjectStore("files");
    }
    if (event.oldVersion < 2) {
      const worlds = tx.objectStore("worlds");
      const previous = worlds.getAll();
      previous.onsuccess = () => {
        const all = event.oldVersion === 0 ? initialWorlds : upgradeWorlds(previous.result);
        for (const world of all) worlds.put(world);
        for (const song of demoTracks) tx.objectStore("tracks").add(song);
      };
    }
    db.createObjectStore("positions", {keyPath:"worldId"});
    tx.objectStore("tracks").createIndex("byMedia","mediaKey");
  };
  const db = await request(req);
  db.onversionchange = () => db.close();
  const pendingTracks = new Set();
  async function saveTracks(entries) {
    const media = new Map(), pending = [];
    for (const {track,file} of entries) {
      // Large pre-existing and newly selected files keep the original local playback path.
      if (!file || file.size > limits.file || !globalThis.crypto?.subtle) {
        pending.push({track,file});
        continue;
      }
      const mediaKey = await mediaDigest(file);
      media.set(mediaKey,file);
      pending.push({track:{...track,mediaKey}});
    }
    const tx = db.transaction(["tracks","files"],"readwrite");
    for (const {track,file} of pending) {
      tx.objectStore("tracks").add(track);
      if (file) tx.objectStore("files").add(file,track.id);
    }
    await Promise.all([storeMedia(tx,media),finished(tx)]);
  }
  return {
    async load() {
      const [worlds,tracks,positions] = await records(db.transaction(["worlds","tracks","positions"]));
      restored = places(positions);
      return [worlds,tracks];
    },
    async snapshot() {
      // Files the listener just selected may still be hashing before their write transaction.
      await Promise.all(pendingTracks);
      const tx = db.transaction(stores);
      const [worlds,tracks,marks] = await records(tx,true);
      if (worlds.length > limits.worlds || tracks.length > limits.tracks || marks.length > limits.worlds)
        throw new Error("คลังเกินขีดจำกัดของไฟล์สำรอง");
      const refs = new Set(tracks.filter(t => t.kind === "local").map(fileKey));
      const fileStore = tx.objectStore("files");
      const files = await Promise.all([...refs].map(async key => [key,await request(fileStore.get(key))]));
      return {worlds,tracks,files:new Map(files),positions:[...savedPositions(worlds,tracks,places(marks)).values()]};
    },
    async merge(archive, signal) {
      await Promise.all(pendingTracks);
      signal?.throwIfAborted();
      const tx = db.transaction(stores,"readwrite");
      const abort = () => { try { tx.abort(); } catch {} };
      signal?.addEventListener("abort",abort,{once:true});
      const apply = async () => {
        const [worlds,tracks,marks] = await records(tx);
        const saved = savedPositions(worlds,tracks,places(marks));
        const plan = mergePlan(archive.data,worlds,tracks,saved);
        const worldStore = tx.objectStore("worlds"), trackStore = tx.objectStore("tracks");
        for (const w of plan.newWorlds) worldStore.add(w);
        for (const w of plan.seedEdits) worldStore.put(w);
        for (const t of plan.newTracks) trackStore.add(t);
        const keys = new Set(plan.newTracks.filter(t => t.kind === "local").map(t => t.mediaKey));
        await storeMedia(tx,[...keys].map(key => [key,archive.files.get(key)]));
        for (const p of plan.positions) tx.objectStore("positions").put(p);
        return plan;
      };
      try {
        const [plan] = await Promise.all([apply(),finished(tx)]);
        for (const p of plan.positions) restored.set(p.worldId,p);
        return plan;
      } catch (error) {
        abort();
        throw error;
      } finally {
        signal?.removeEventListener("abort",abort);
      }
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
      const job = saveTracks(entries);
      pendingTracks.add(job);
      return job.finally(() => pendingTracks.delete(job));
    },
    async remove(id) {
      const tx = db.transaction(["tracks","files"],"readwrite");
      const tracks = tx.objectStore("tracks"), files = tx.objectStore("files");
      const remove = async () => {
        const track = await request(tracks.get(id));
        if (!track) return;
        tracks.delete(id);
        if (!track.mediaKey || await request(tracks.index("byMedia").count(track.mediaKey)) === 0)
          files.delete(fileKey(track));
      };
      await Promise.all([remove(),finished(tx)]);
    },
    async file(id) {
      const tx = db.transaction(["tracks","files"]);
      const t = await request(tx.objectStore("tracks").get(id));
      if (t) return request(tx.objectStore("files").get(fileKey(t)));
    },
  };
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
