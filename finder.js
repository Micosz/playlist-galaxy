import { initialWorlds, isContainer, names } from "./atlas.js";

const solarNames = {
  mercury:"ดาวพุธ", venus:"ดาวศุกร์", earth:"โลก", mars:"ดาวอังคาร", jupiter:"ดาวพฤหัสบดี",
  saturn:"ดาวเสาร์", uranus:"ดาวยูเรนัส", neptune:"ดาวเนปจูน",
};
const aliases = { ...solarNames, "milky-way":"Milky Way", "solar-system":"Solar System",
  titan:"ไททัน", luna:"Moon ดวงจันทร์", enceladus:"เอนเซลาดัส" };
const join = path => path.filter(Boolean).join(" › ");

// NFKC treats full-width characters consistently while keeping Thai vowels and tone marks.
function fold(value) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu," ").trim();
}
function entry(row, aliases = "") {
  const nameKey = fold(row.name);
  const aliasKey = fold(aliases);
  return { ...row, nameKey, compact:nameKey.replaceAll(" ",""),
    aliasKey, words:[nameKey,aliasKey,fold(row.path)].filter(Boolean).join(" ") };
}
export function libraryEntries(worlds, tracks) {
  const seedNames = new Map(initialWorlds.map(w => [w.id,w.name]));
  const byId = new Map(worlds.map(w => [w.id,w]));
  const paths = new Map();
  function address(w) {
    if (!w) return "";
    if (!paths.has(w.id)) {
      paths.set(w.id,""); // A circular legacy parent must not hide the rest of the library.
      paths.set(w.id,join([address(byId.get(w.parent)),w.name]));
    }
    return paths.get(w.id);
  }
  const rows = worlds.map(w => entry({
    name:w.name, type:names[w.kind], worldId:w.id,
    path:address(byId.get(w.parent)) || "จักรวาล", container:isContainer(w),
  }, [seedNames.get(w.id),aliases[w.id],w.solar,w.designation].filter(Boolean).join(" ")));
  for (const track of tracks) {
    const world = byId.get(track.worldId);
    if (!world) continue;
    const type = track.kind === "apple" ? "Apple Music" : track.kind === "demo" ? "เพลงเดโม" : "MP3";
    rows.push(entry({name:track.title,type,worldId:world.id,track,path:address(world)},track.artist || ""));
  }
  return rows;
}

export function galaxyEntries(galaxies) {
  return galaxies.map(g => entry({name:g.name,type:"กาแล็กซี",path:"กาแล็กซีใกล้เคียง",
    source:"Updated Nearby Galaxy Catalog", details:g.alias ? [["ชื่ออื่น",g.alias]] : [["ชื่อในแค็ตตาล็อก",g.name]]},g.alias));
}
export function planetEntries({systems,moons,facts,dwarfs}) {
  const rows = [];
  const solar = (name,type,path,details,other) => rows.push(entry({
    name,type,path,details,source:"แค็ตตาล็อกระบบสุริยะของ Playlist Galaxy",
  },other));
  for (const planet of initialWorlds.filter(w => w.solar)) {
    const satellites = moons.get(planet.solar) || [];
    solar(planet.solar,"ดาวเคราะห์","ระบบสุริยะ",[["ดวงจันทร์ในรายการ",String(satellites.length)]],solarNames[planet.id]);
    for (const moon of satellites)
      solar(moon,"ดวงจันทร์",join(["ระบบสุริยะ",planet.solar]),[["ดาวเคราะห์แม่",planet.solar]]);
  }
  for (const dwarf of dwarfs) {
    solar(dwarf.name,"ดาวเคราะห์แคระ","ระบบสุริยะ",[["ชื่อไทย",dwarf.alias],["ดวงจันทร์ในรายการ",String(dwarf.moons.length)]],dwarf.alias);
    for (const moon of dwarf.moons)
      solar(moon,"ดวงจันทร์",join(["ระบบสุริยะ",dwarf.name]),[["ดาวเคราะห์แคระแม่",dwarf.name]]);
  }
  const source = "NASA Exoplanet Archive · ข้อมูลที่บันทึกในแอป";
  for (const system of systems) {
    rows.push(entry({name:system.name,type:"ระบบดาว",path:"ระบบดาวเคราะห์นอกระบบสุริยะ",source,
      details:[["ดาวแม่",system.hosts.map(h => h.name).join(", ")],["ดาวเคราะห์ในระบบ",String(system.count)]]}));
    for (const host of system.hosts) {
      const separate = host.name !== system.name || system.hosts.length > 1;
      if (separate) rows.push(entry({name:host.name,type:"ดาวแม่",path:system.name,source,
        details:[["ดาวเคราะห์ในกิ่งนี้",host.planets.join(", ")]]}));
      for (const name of host.planets) {
        const f = facts.get(name);
        const details = [["ดาวแม่",host.name]];
        if (f) {
          for (const [key,label] of [["year","ปีค้นพบ (ค.ศ.)"],["method","วิธีค้นพบ"],["period","คาบโคจร (วัน)"],["radius","รัศมี (โลก = 1)"]]) {
            if (f[key] && f[key] !== "—") details.push([label,f[key]]);
          }
        }
        rows.push(entry({name,type:"ดาวเคราะห์",path:join([system.name,host.name !== system.name ? host.name : ""]),source,details}));
      }
    }
  }
  return rows;
}

export function findEntries(rows, query) {
  const term = fold(query);
  if (!term) return [];
  const compact = term.replaceAll(" ","");
  const tokens = term.split(" ");
  const buckets = [[],[],[],[]];
  for (const row of rows) {
    let rank;
    if (row.compact === compact || row.aliasKey === term) rank = 0;
    else if (row.compact.startsWith(compact)) rank = 1;
    else if (row.compact.includes(compact) || row.aliasKey.includes(term)) rank = 2;
    else if (tokens.every(token => row.words.includes(token))) rank = 3;
    else continue;
    buckets[rank].push(row);
  }
  return buckets.flat();
}
