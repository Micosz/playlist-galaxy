const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

async function fixture() {
  const { initialWorlds, demoTracks } = await import("../atlas.js");
  const { writeBackup } = await import("../backup.js");
  const moon = {id:"mine",kind:"moon",parent:"ember",name:"Music Moon",surface:"jade",order:10};
  const track = {id:"song",worldId:"mine",kind:"local",title:"Test",artist:"",order:1};
  const duplicate = {...track,id:"song2",worldId:"tide"};
  const song = new Blob([new Uint8Array(1024 * 1024 + 7).fill(67)]);
  const snapshot = {worlds:[...initialWorlds,moon],tracks:[...demoTracks,track,duplicate],
    files:new Map([["song",song],["song2",song]]),positions:[{worldId:"mine",id:"song",seconds:3.5}]};
  return {snapshot, ...await writeBackup(snapshot)};
}
function rewrite(manifest, tail) {
  const json = Buffer.from(JSON.stringify(manifest));
  const header = Buffer.alloc(44);
  header.write("PGALAXY"); header[7] = 1; header.writeUInt32BE(json.length,8);
  createHash("sha256").update(json).digest().copy(header,12);
  return new Blob([header,json,tail]);
}

test("versioned bytes round-trip, share identical audio once and exclude unrelated metadata", async () => {
  const {readBackup} = await import("../backup.js");
  const {data,file,snapshot} = await fixture();
  assert.equal(data.media.length,1);
  assert.ok(file.size < snapshot.files.get("song").size + 8000);
  const incoming = await readBackup(file);
  assert.deepEqual(incoming.data,data);
  assert.deepEqual(Buffer.from(await incoming.files.values().next().value.arrayBuffer()),Buffer.from(await snapshot.files.get("song").arrayBuffer()));
  const secret = "fixture token should stay on the source";
  const raw = structuredClone(data);
  raw.tracks[0].unrelated = raw.worlds[0].private = secret;
  const tail = file.slice(file.size-data.media[0].size);
  assert.ok(!JSON.stringify((await readBackup(rewrite(raw,tail))).data).includes(secret));
});
test("rejects missing bytes, damaged audio/manifest, unknown versions and unreasonable sizes",async () => {
  const {readBackup,limits} = await import("../backup.js");
  const {file} = await fixture();
  const bytes = new Uint8Array(await file.arrayBuffer());
  for(const offset of [0,7,12,70,bytes.length-1]){
    const copy = bytes.slice(); copy[offset] ^= 1;
    await assert.rejects(readBackup(new Blob([copy])));
  }
  await assert.rejects(readBackup(file.slice(0,-1)));
  await assert.rejects(readBackup(new Blob([file,new Uint8Array(1)])));
  await assert.rejects(readBackup({size:limits.archive+1}),/ขีดจำกัด/);
  const controller = new AbortController();controller.abort();
  await assert.rejects(readBackup(file,controller.signal),{name:"AbortError"});
});
test("validates relationships, distinct IDs, media references and saved Apple links before any merge",async () => {
  const {readBackup} = await import("../backup.js");
  const {data,file} = await fixture();
  for(const mutate of [
    m=>m.worlds.push(m.worlds[0]), m=>m.worlds.at(-1).parent="mine",
    m=>m.tracks.at(-1).mediaKey="0".repeat(64),m=>m.positions[0].worldId="tide",
    m=>m.tracks.push({id:"apple",kind:"apple",worldId:"ember",order:5,title:"Song",artist:"",catalogId:"123",url:"https://example.com/song/123"}),
  ]){
    const raw = structuredClone(data);mutate(raw);
    await assert.rejects(readBackup(rewrite(raw,file.slice(file.size-data.media[0].size))));
  }
});
test("merging keeps local edits and positions, adopts untouched seed settings, and is idempotent",async () => {
  const {mergePlan} = await import("../backup.js");
  const {initialWorlds,demoTracks} = await import("../atlas.js");
  const {data} = await fixture();
  data.worlds.find(w=>w.id==="ember").name="My Ember";
  data.worlds.find(w=>w.id==="tide").name="Imported Tide";
  const existing = initialWorlds.map(w=>w.id==="tide"?{...w,name:"Keep Tide"}:w);
  const plan = mergePlan(data,existing,demoTracks,new Map());
  assert.deepEqual(plan.seedEdits.map(w=>w.name),["My Ember"]);
  assert.deepEqual(plan.newWorlds.map(w=>w.id),["mine"]);
  assert.equal(plan.newTracks.length,2);assert.equal(plan.positions.length,1);
  const merged = [...existing.map(w=>plan.seedEdits.find(row=>row.id===w.id)||w),...plan.newWorlds];
  assert.deepEqual(mergePlan(data,merged,[...demoTracks,...plan.newTracks],new Map([["mine",true]])),
    {newWorlds:[],seedEdits:[],newTracks:[],positions:[]});
});
