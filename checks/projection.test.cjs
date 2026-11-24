const assert = require("node:assert/strict");
const test = require("node:test");

test("empty orbit space retains its projected depth after rotating and panning", async () => {
  const { homePose, lens, orbitDepth, scenePoint } = await import("../projection.js");
  for (const flat of [.56, .78]) {
    for (const pose of [homePose(), { yaw: .72, pitch: -.21, x: .19, y: -.09, zoom: .73 }]) {
      const project = lens(pose, 900, 600);
      for (const [x, y] of [[.14, .21], [-.25, .03], [.09, -.16]]) {
        const point = project(scenePoint(x, y, flat));
        const screen = { x: (point.x - 450) / 600, y: (point.y - 300) / 600 };
        assert.ok(Math.abs(orbitDepth(pose, screen, flat) - point.z) < 1e-9);
      }
    }
  }
  assert.equal(orbitDepth(homePose(), { x: .3, y: -.4 }, 0), 0);
});
