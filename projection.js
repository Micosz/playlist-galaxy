// All distances are in fractions of the shorter side of the map. The camera
// projects art, orbit guides and background particles through the same lens.
const distance = 2.8;
const tilt = -.23;
const cs = Math.cos(tilt), sn = Math.sin(tilt);
export const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
export const homePose = () => ({ yaw: 0, pitch: 0, x: 0, y: 0, zoom: 0 });

export function lens(pose, width, height) {
  const unit = Math.min(width, height), cy = Math.cos(pose.yaw), sy = Math.sin(pose.yaw);
  const cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch), zoom = Math.exp(pose.zoom);
  return (point) => {
    const right = cy * point.x + sy * point.z;
    const depth = cy * point.z - sy * point.x;
    const down = cp * point.y - sp * depth, z = sp * point.y + cp * depth;
    const scale = zoom * distance / Math.max(.24, distance - z);
    return { x: width / 2 + (right + pose.x) * scale * unit,
      y: height / 2 + (down + pose.y) * scale * unit, scale, z, visible: z < distance - .24 };
  };
}

// Inverse projection puts the neutral view exactly at the art-directed slots.
// Orbiting bodies share one inclined plane through the star.
export function scenePoint(x, y, flat, depth) {
  if (flat) {
    const slope = Math.sqrt(1 - flat * flat) / flat;
    const plane = (y * cs - x * sn) * slope;
    depth = plane / (1 + plane / distance);
  }
  const ratio = 1 - depth / distance;
  return { x: x * ratio, y: y * ratio, z: depth };
}

export function orbitPath(point, flat) {
  const major = point.x * cs + point.y * sn;
  const minor = (point.y * cs - point.x * sn) / flat;
  const radius = Math.hypot(major, minor), rise = Math.sqrt(1 - flat * flat);
  return Array.from({length: 97}, (_, i) => {
    const angle = i / 96 * 2 * Math.PI, a = radius * Math.cos(angle), b = radius * Math.sin(angle);
    return {x: a * cs - b * flat * sn, y: a * sn + b * flat * cs, z: b * rise};
  });
}

// These unnamed points are scenery. Playlist IDs and the catalog alone supply
// selectable bodies. Seed each location so a return flight finds the same sky.
export function starField(id, kind) {
  let seed = 137;
  for (const ch of id) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const count = kind === "galaxy" ? 1560 : kind === "universe" ? 1020 : 380;
  const points = [];
  for (let i = 0; i < count; i++) {
    const r = Math.pow(rnd(), .73) * 1.9, noise = rnd() + rnd() - 1;
    const angle = kind === "galaxy" ? 2.7 * Math.log(1 + 4 * r) + (i % 3) * 2.095 + noise * (.45 + .5 * r) : rnd() * 2 * Math.PI;
    let x = r * Math.cos(angle), y = r * Math.sin(angle) * .36, z = -.8 + r * Math.sin(angle) * .88;
    if (kind === "universe") {
      // Loose concentrations, separated by relatively empty volumes.
      const band = i % 4;
      x = (rnd() + rnd() - 1) * 1.12 + [-.80, .45, .12, 1.25][band];
      y = x * -.34 + noise * (.12 + .16 * band) + [0, -.05, .43, -.35][band];
      z = -1.85 + rnd() * 1.6 + .25 * Math.sin(x * 3);
    } else if (kind !== "galaxy") {
      x *= 1.9; y = (rnd() - .5) * 2.25; z = -2.9 + rnd() * 2;
    } else {
      y += .19 * x + noise * (.03 + .07 * r);
    }
    const light = rnd();
    points.push({ x, y, z, size: .34 + light * light * 1.05,
      alpha: .18 + light * .61, color: i % 8 === 0 ? "#ecc59e" : i % 5 === 0 ? "#b9a7db" : "#b7d0ec" });
  }
  return points;
}
