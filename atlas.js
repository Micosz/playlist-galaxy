// A listener's map stores containers and playable bodies in the same parent-child tree.
export const names = { galaxy: "กาแล็กซี", system: "ระบบดาว", host: "ดาวแม่", planet: "ดาว", moon: "ดาวบริวาร" };
export const isContainer = (node) => ["galaxy", "system", "host"].includes(node?.kind);
export function childKind(parent) {
  if (!parent) return "galaxy";
  if (parent.kind === "galaxy") return "system";
  if (isContainer(parent)) return "planet";
  return "moon";
}

function body(id, name, kind, parent, surface, order, extra) {
  return { id, name, kind, parent, surface, order, ...extra };
}

const solarPlanets = [
  ["mercury", "Mercury", "moon"], ["venus", "Venus", "cloud"],
  ["earth", "Earth", "terrestrial"], ["mars", "Mars", "ember"],
  ["jupiter", "Jupiter", "giant"], ["saturn", "Saturn", "ring"],
  ["uranus", "Uranus", "jade"], ["neptune", "Neptune", "ocean"],
];
const planetColors = ["ember", "moon", "jade", "ocean", "ring"];

export const initialWorlds = [
  body("my-galaxy", "My Galaxy", "galaxy", null, "ember", 1),
  body("milky-way", "ทางช้างเผือก", "galaxy", null, "ocean", 2),
  body("midnight", "Midnight", "system", "my-galaxy", "ember", 1),
  body("ember", "Ember", "planet", "midnight", "ember", 1),
  body("tide", "Tide", "planet", "midnight", "ocean", 2),
  body("solar-system", "ระบบสุริยะ", "system", "milky-way", "ember", 1),
  body("trappist-1", "TRAPPIST-1", "system", "milky-way", "ember", 2),
  ...solarPlanets.map(([id, name, surface], i) =>
    body(id, name, "planet", "solar-system", surface, i + 1, { solar: name })),
  body("luna", "Luna", "moon", "earth", "moon", 1, { designation: "Moon" }),
  body("titan", "Titan", "moon", "saturn", "ember", 1, { designation: "Titan" }),
  body("enceladus", "Enceladus", "moon", "saturn", "moon", 2, { designation: "Enceladus" }),
  ...Array.from("bcdefgh", (suffix, i) =>
    body("trappist-1-" + suffix, "TRAPPIST-1 " + suffix, "planet", "trappist-1", planetColors[i % 5], i + 1)),
];

export const demoTracks = [
  { id: "demo-afterglow", worldId: "ember", kind: "demo", title: "Afterglow", artist: "Playlist Galaxy", order: 1 },
  { id: "demo-blue-hour", worldId: "tide", kind: "demo", title: "Blue Hour", artist: "Playlist Galaxy", order: 1 },
];
export const demoAudio = { "demo-afterglow": "./audio/afterglow.mp3", "demo-blue-hour": "./audio/blue-hour.mp3" };

// Root playlists and all of their old track/bookmark IDs survive the version-one upgrade.
export function upgradeWorlds(previous) {
  const seeded = new Map(initialWorlds.map((w) => [w.id, w]));
  for (const world of previous) {
    const seed = seeded.get(world.id);
    seeded.set(world.id, {
      ...seed, ...world,
      kind: seed?.kind || (world.parent ? "moon" : "planet"),
      parent: world.parent || seed?.parent || "midnight",
      order: seed?.order ?? world.order,
    });
  }
  return [...seeded.values()];
}

// Read the checked-in astronomy snapshot only when a listener opens the catalog.
export function readPlanets(markdown) {
  const systems = [], moons = new Map(), facts = new Map(), dwarfs = [];
  let solarParent, system, host, dwarf, inDwarfs = false, inSystems = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line === '<a name="systems-01"></a>') inSystems = true;
    if (line === '<a name="sources"></a>') break;
    if (!inSystems) {
      if (line.startsWith("### ดาวเคราะห์แคระ")) inDwarfs = true;
      if (line === '<a name="exoplanets"></a>') inDwarfs = false;
      if (inDwarfs) {
        const parent = /^- \*\*([^·]+) · ([A-Za-z]+)\*\*/.exec(line);
        const moon = /^  - \x60([^\x60]+)\x60/.exec(line);
        if (parent) {
          dwarf = {name:parent[2], alias:parent[1].trim(), moons:[]};
          dwarfs.push(dwarf);
        } else if (dwarf && moon) dwarf.moons.push(moon[1]);
        continue;
      }
      const header = /^<details><summary>[^·]+ · ([A-Za-z]+) — ดวงจันทร์/.exec(line);
      if (header) {
        solarParent = header[1];
        moons.set(solarParent, []);
      } else if (line === "</details>") solarParent = null;
      else if (solarParent) {
        const moon = /^- \x60([^\x60]+)\x60/.exec(line);
        if (moon) moons.get(solarParent).push(moon[1]);
      }
      continue;
    }
    const top = /^- \*\*\x60([^\x60]+)\x60\*\*/.exec(line);
    if (top) {
      system = { name: top[1], hosts: [], count: 0 };
      systems.push(system);
      host = null;
      continue;
    }
    const star = /^  - ดาวแม่ \x60([^\x60]+)\x60/.exec(line);
    if (star && system) {
      host = { name: star[1], planets: [] };
      system.hosts.push(host);
      continue;
    }
    const planet = /^ {2,4}- \x60([^\x60]+)\x60[^|]* \|/.exec(line);
    if (planet && system) {
      if (!host) {
        host = { name: system.name, planets: [] };
        system.hosts.push(host);
      }
      host.planets.push(planet[1]);
      const [, year, method, period, radius] = line.split("|").map(part => part.trim());
      facts.set(planet[1], {year,method,period,radius});
      system.count++;
    }
  }
  if (!systems.length || !moons.size) throw new Error("Planet catalog is unavailable");
  return { systems, moons, facts, dwarfs };
}

export function readGalaxies(markdown) {
  const ids = [...markdown.matchAll(/^- \x60([^\x60]+)\x60\s*$/gm)].map((m) => m[1]);
  if (!ids.length) throw new Error("Galaxy catalog is unavailable");
  const aliases = { MESSIER031: "แอนดรอเมดา · Andromeda · M31", MESSIER033: "ไทรแองกูลัม · Triangulum · M33", LMC: "เมฆแมเจลแลนใหญ่", SMC: "เมฆแมเจลแลนเล็ก" };
  return ids.map((name) => ({ name, alias: aliases[name] || "" }));
}

const catalogs = new Map();
const catalogCacheName = "playlist-galaxy-astronomy";
async function storedCatalogs() {
  try {
    if (["http:", "https:"].includes(location.protocol)) return await caches.open(catalogCacheName);
  } catch { /* Storage can be disabled; the in-memory catalog still works. */ }
}
async function loadCatalog(path, parse) {
  let source;
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error("Catalog request failed");
    source = await response.text();
  } catch (error) {
    const cache = await storedCatalogs();
    const stored = await cache?.match(path);
    if (!stored) throw error;
    return parse(await stored.text());
  }
  const catalog = parse(source);
  // Keep only the two bundled astronomy snapshots. A search term never becomes a cache key.
  storedCatalogs().then(cache => cache?.put(path, new Response(source))).catch(() => {});
  return catalog;
}
export function fetchCatalog(kind) {
  const galaxy = kind === "galaxy";
  const path = galaxy ? "docs/galaxies.md" : "docs/planetary-systems.md";
  if (!catalogs.has(path)) {
    catalogs.set(path, loadCatalog(path, galaxy ? readGalaxies : readPlanets).catch(error => {
      catalogs.delete(path);
      throw error;
    }));
  }
  return catalogs.get(path);
}

export function copySystem(root, template) {
  const nodes = [root];
  for (const [i, host] of template.hosts.entries()) {
    let parent = root.id;
    if (template.hosts.length > 1 || host.name !== template.name) {
      parent = crypto.randomUUID();
      nodes.push(body(parent, host.name, "host", root.id, "ember", i + 1));
    }
    for (const [j, planet] of host.planets.entries()) {
      nodes.push(body(crypto.randomUUID(), planet, "planet", parent, planetColors[j % planetColors.length], j + 1));
    }
  }
  return nodes;
}
