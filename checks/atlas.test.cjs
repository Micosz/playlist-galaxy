const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("catalog import retains the published systems, distinct hosts and every planet and moon", async () => {
  const { readPlanets, readGalaxies, copySystem } = await import("../atlas.js");
  const source = (name) => readFileSync(path.join(__dirname, "..", "docs", name), "utf8");
  const { systems, moons } = readPlanets(source("planetary-systems.md"));
  assert.equal(systems.length, 4857);
  assert.equal(new Set(systems.flatMap((s) => s.hosts.flatMap((h) => h.planets))).size, 6473);
  assert.equal([...moons.values()].flat().length, 456);
  assert.equal(readGalaxies(source("galaxies.md")).length, 869);
  const pair = systems.find((s) => s.name === "55 Cnc");
  assert.deepEqual(pair.hosts.map((h) => [h.name, h.planets.length]), [["55 Cnc", 5], ["55 Cnc B", 2]]);
  const root = { id: "test", kind: "system", name: "My set", parent: "my-galaxy" };
  const copy = copySystem(root, pair), secondStar = copy.find((n) => n.name === "55 Cnc B");
  assert.deepEqual(copy.filter((n) => n.parent === secondStar.id).map((n) => n.name).sort(), ["55 Cnc B b", "55 Cnc B c"]);
  assert.equal(copySystem(root, systems.find((s) => s.name === "TRAPPIST-1")).length, 8);
  assert.equal(copySystem(root, systems.find((s) => s.name === "alf Cen"))[1].name, "Proxima Cen");
});
