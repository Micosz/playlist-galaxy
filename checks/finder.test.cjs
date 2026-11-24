const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("search uses current world names, distinguishes duplicate titles, and keeps Thai marks", async () => {
  const {initialWorlds,demoTracks} = await import("../atlas.js");
  const {libraryEntries,findEntries} = await import("../finder.js");
  const worlds = initialWorlds.map(w => w.id === "ember" ? {...w,name:"บ้าน"} : w);
  const tracks = [...demoTracks,{id:"private",kind:"local",worldId:"tide",title:"Afterglow",artist:"รุ่งเช้า"}];
  const rows = libraryEntries(worlds,tracks);
  const search = q => findEntries(rows,q);
  assert.equal(search("ไททัน")[0].worldId,"titan");
  assert.equal(search("บ้าน")[0].worldId,"ember");
  assert.equal(search("บาน").length,0);
  assert.equal(search("รุ่งเช้า")[0].track.id,"private");
  assert.deepEqual(search("Ａｆｔｅｒｇｌｏｗ").map(r=>r.path),["My Galaxy › Midnight › บ้าน","My Galaxy › Midnight › Tide"]);
  assert.equal(search("midnight afterglow tide")[0].track.id,"private");
  assert.equal(search("blue-hour")[0].track.id,"demo-blue-hour");
  assert.equal(search("  ").length,0);
  const cycle = {...worlds[0],id:"legacy",name:"Legacy",parent:"legacy"};
  assert.equal(findEntries(libraryEntries([...worlds,cycle],tracks),"Afterglow").length,2);
});

test("catalog-only facts and aliases come from the checked-in snapshots", async () => {
  const {readPlanets,readGalaxies} = await import("../atlas.js");
  const {findEntries,planetEntries,galaxyEntries} = await import("../finder.js");
  const source = name => readFileSync(path.join(__dirname,"..","docs",name + ".md"),"utf8");
  const parsed = readPlanets(source("planetary-systems"));
  assert.equal(parsed.facts.size,6473);
  assert.equal(parsed.dwarfs.length,5);
  const rows = planetEntries(parsed);
  const planet = findEntries(rows,"55 Cnc B b")[0];
  assert.equal(planet.name,"55 Cnc B b");
  assert.equal(planet.path,"55 Cnc › 55 Cnc B");
  assert.equal(Object.fromEntries(planet.details)["ปีค้นพบ (ค.ศ.)"],"2025");
  assert.equal(findEntries(rows,"Charon")[0].path,"ระบบสุริยะ › Pluto");
  assert.equal(findEntries(rows,"พลูโต")[0].name,"Pluto");
  assert.equal(findEntries(rows,"TRAPPIST 1 b")[0].name,"TRAPPIST-1 b");
  assert.equal(findEntries(galaxyEntries(readGalaxies(source("galaxies"))),"M31")[0].name,"MESSIER031");
});
