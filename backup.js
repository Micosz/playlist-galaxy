import { initialWorlds, demoTracks } from "./atlas.js";
import { appleSongLink } from "./apple.js";
import { surfaces } from "./sky.js";

const MiB = 1024 * 1024;
export const limits = { worlds:4096, tracks:10000, file:128 * MiB, archive:512 * MiB, manifest:4 * MiB };
const signature = new TextEncoder().encode("PGALAXY");
const version = 1, headerSize = 44;
const seeds = new Map(initialWorlds.map(w => [w.id, w]));
const demos = new Map(demoTracks.map(t => [t.id, t]));
const parents = { galaxy:[], system:["galaxy"], host:["system"], planet:["host","system"], moon:["planet","moon"] };
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const invalid = "ข้อมูลในไฟล์สำรองไม่ครบหรือเสียหาย";
const tooLarge = "คลังเกินขีดจำกัดของไฟล์สำรอง (512 MiB ต่อคลัง และ 128 MiB ต่อ MP3)";
function check(ok, message = invalid) {
  if (!ok) throw new Error(message);
}
function list(value, max) {
  check(Array.isArray(value));
  check(value.length <= max, tooLarge);
  return value;
}
function text(value, max, empty = false) {
  check(typeof value === "string" && value.length <= max && (empty || value.trim()));
  return value;
}
function id(value) {
  check(typeof value === "string" && idPattern.test(value));
  return value;
}
function hex(bytes) {
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");
}
function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("เบราว์เซอร์นี้ตรวจไฟล์สำรองไม่ได้ กรุณาเปิดผ่าน HTTPS หรือไฟล์ออฟไลน์");
  return crypto.subtle.digest("SHA-256", bytes);
}
// Hash at most one MiB of audio at a time, including on phones.
export async function mediaDigest(blob, signal) {
  const parts = new Uint8Array(Math.ceil(blob.size / MiB) * 32);
  for (let start = 0; start < blob.size; start += MiB) {
    signal?.throwIfAborted();
    const chunk = await blob.slice(start, start + MiB).arrayBuffer();
    parts.set(new Uint8Array(await sha256(chunk)), start / MiB * 32);
  }
  return hex(await sha256(parts));
}
function keyed(records, key) {
  const map = new Map(records.map(r => [r[key], r]));
  check(map.size === records.length);
  return map;
}
function worldRecord(w) {
  check(w && Object.hasOwn(parents, w.kind) && Object.hasOwn(surfaces, w.surface));
  check(Number.isSafeInteger(w.order) && (!seeds.has(w.id) || w.kind === seeds.get(w.id).kind));
  const clean = {id:id(w.id), name:text(w.name, 512), kind:w.kind, parent:w.parent === null ? null : id(w.parent), surface:w.surface, order:w.order};
  for (const key of ["solar","designation"]) if (w[key] !== undefined) clean[key] = text(w[key],512);
  return clean;
}
function validateTree(worlds) {
  const depths = new Map();
  for (const world of worlds.values()) {
    let w = world;
    const path = [];
    while (w && !depths.has(w.id)) {
      check(path.length < 128 && !path.includes(w.id));
      path.push(w.id);
      if (w.kind === "galaxy") { check(w.parent === null); break; }
      const parent = worlds.get(w.parent);
      check(parent && parents[w.kind]?.includes(parent.kind));
      w = parent;
    }
    let depth = w && depths.get(w.id) || 0;
    while (path.length) {
      check(++depth <= 128);
      depths.set(path.pop(), depth);
    }
  }
}
function trackRecord(t, worlds) {
  check(t && ["local","demo","apple"].includes(t.kind));
  const world = worlds.get(t.worldId);
  check(world && ["moon","planet"].includes(world.kind) && Number.isSafeInteger(t.order));
  const clean = {id:id(t.id), worldId:world.id, kind:t.kind, title:text(t.title,2048), artist:text(t.artist ?? "",2048,true), order:t.order};
  const demo = demos.get(t.id);
  if (t.kind === "demo" || demo) check(t.kind === "demo" && demo?.worldId === t.worldId);
  if (t.kind === "local") {
    check(typeof t.mediaKey === "string" && digestPattern.test(t.mediaKey));
    clean.mediaKey = t.mediaKey;
  }
  if (t.kind === "apple") {
    const link = appleSongLink(text(t.url,4096));
    check(link && link.catalogId === t.catalogId);
    Object.assign(clean,link);
  }
  return clean;
}
function manifest(raw) {
  check(raw && typeof raw === "object");
  const worlds = list(raw.worlds,limits.worlds).map(worldRecord);
  const worldMap = keyed(worlds,"id");
  validateTree(worldMap);
  const tracks = list(raw.tracks,limits.tracks).map(t => trackRecord(t,worldMap));
  const trackMap = keyed(tracks,"id");
  const positions = list(raw.positions,limits.worlds).map(p => {
    check(p && trackMap.has(p.id) && trackMap.get(p.id).worldId === p.worldId &&
      Number.isFinite(p.seconds) && p.seconds >= 0);
    return {worldId:p.worldId,id:p.id,seconds:p.seconds};
  });
  keyed(positions,"worldId");
  const media = list(raw.media,limits.tracks).map(m => {
    check(m && typeof m.key === "string" && digestPattern.test(m.key) && Number.isSafeInteger(m.size) && m.size > 0);
    check(m.size <= limits.file, tooLarge);
    return {key:m.key,size:m.size};
  });
  const mediaMap = keyed(media,"key");
  const used = new Set(tracks.filter(t => t.kind === "local").map(t => t.mediaKey));
  check(used.size === mediaMap.size && [...used].every(key => mediaMap.has(key)));
  return {worlds,tracks,positions,media};
}

export function fileKey(track) {
  return track.mediaKey ? "media:" + track.mediaKey : track.id;
}

export async function writeBackup(snapshot, signal) {
  const {tracks,positions,files} = snapshot;
  const worlds = snapshot.worlds.map(w => ({...w,order:w.order ?? 0}));
  const unique = new Map(), keys = new Map(), records = [];
  let total = headerSize;
  for (const original of tracks) {
    const track = {...original,order:original.order ?? 0};
    signal?.throwIfAborted();
    if (track.kind !== "local") { records.push(track); continue; }
    const ref = fileKey(track);
    if (!keys.has(ref)) {
      const blob = files.get(ref);
      check(blob instanceof Blob && blob.size > 0, "ไม่พบไฟล์ MP3 ของเพลงในคลัง");
      check(blob.size <= limits.file, tooLarge);
      const key = await mediaDigest(blob,signal);
      keys.set(ref,key);
      if (!unique.has(key)) {
        total += blob.size;
        check(total <= limits.archive, tooLarge);
        unique.set(key,blob);
      }
    }
    records.push({...track,mediaKey:keys.get(ref)});
  }
  const media = [...unique].map(([key,blob]) => ({key,size:blob.size}));
  const data = manifest({worlds,tracks:records,positions,media});
  const json = new TextEncoder().encode(JSON.stringify(data));
  check(json.length <= limits.manifest && total + json.length <= limits.archive, tooLarge);
  const header = new Uint8Array(headerSize);
  header.set(signature);
  header[7] = version;
  new DataView(header.buffer).setUint32(8,json.length);
  header.set(new Uint8Array(await sha256(json)),12);
  signal?.throwIfAborted();
  return {data,file:new Blob([header,json,...unique.values()],{type:"application/octet-stream"})};
}

export async function readBackup(file, signal) {
  check(file.size <= limits.archive,tooLarge);
  const header = new Uint8Array(await file.slice(0,headerSize).arrayBuffer());
  check(header.length === headerSize && signature.every((n,i) => header[i] === n),"ไฟล์นี้ไม่ใช่ไฟล์สำรอง Playlist Galaxy หรือดาวน์โหลดมาไม่ครบ");
  check(header[7] === version,"ยังไม่รองรับไฟล์สำรองเวอร์ชัน " + header[7]);
  const length = new DataView(header.buffer).getUint32(8);
  check(length > 0 && length <= limits.manifest && headerSize + length <= file.size);
  const bytes = await file.slice(headerSize,headerSize + length).arrayBuffer();
  check(hex(await sha256(bytes)) === hex(header.slice(12)));
  let raw;
  try { raw = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)); }
  catch { throw new Error(invalid); }
  const data = manifest(raw);
  let offset = headerSize + length;
  check(data.media.reduce((sum,m) => sum + m.size, offset) === file.size);
  const files = new Map();
  for (const {key,size} of data.media) {
    const blob = file.slice(offset,offset + size,"audio/mpeg");
    check(await mediaDigest(blob,signal) === key);
    files.set(key,blob);
    offset += size;
  }
  signal?.throwIfAborted();
  return {data,files};
}

function factorySetting(w, seed) {
  return seed && Object.keys(seed).every(k => w[k] === seed[k]) &&
    w.solar === seed.solar && w.designation === seed.designation;
}
export function mergePlan(incoming, localWorlds, localTracks, saved) {
  const worlds = new Map(localWorlds.map(w => [w.id,w]));
  const tracks = new Map(localTracks.map(t => [t.id,t]));
  const newWorlds = [], seedEdits = [], newTracks = [], positions = [];
  for (const w of incoming.worlds) {
    const existing = worlds.get(w.id), seed = seeds.get(w.id);
    if (!existing) newWorlds.push(w);
    else if (factorySetting(existing,seed) && !factorySetting(w,seed)) seedEdits.push(w);
    else continue;
    worlds.set(w.id,w);
  }
  validateTree(worlds);
  const apple = new Map(localTracks.filter(t => t.kind === "apple").map(t => [t.worldId + ":" + t.catalogId,t.id]));
  const mapped = new Map();
  for (const t of incoming.tracks) {
    const key = t.worldId + ":" + t.catalogId;
    if (tracks.has(t.id)) continue;
    check(["planet","moon"].includes(worlds.get(t.worldId)?.kind));
    if (t.kind === "apple" && apple.has(key)) { mapped.set(t.id,apple.get(key)); continue; }
    if (t.kind === "apple") apple.set(key,t.id);
    newTracks.push(t);
    tracks.set(t.id,t);
  }
  for (const p of incoming.positions) {
    const trackId = mapped.get(p.id) || p.id;
    if (!saved.has(p.worldId) && tracks.get(trackId)?.worldId === p.worldId) positions.push({...p,id:trackId});
  }
  return {newWorlds,seedEdits,newTracks,positions};
}
