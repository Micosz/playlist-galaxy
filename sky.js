export const surfaces = {
  ring: { label: "ดาววงแหวน", tone: "#e0bc89", base: [192, 147, 104] },
  moon: { label: "ดวงจันทร์", tone: "#c9c8d4", base: [165, 164, 178] },
  ocean: { label: "ดาวสีน้ำเงิน", tone: "#83bae1", base: [81, 134, 195] },
  jade: { label: "ดาวสีเขียว", tone: "#86c2ac", base: [91, 159, 144] },
  ember: { label: "ดาวสีอำพัน", tone: "#e89073", base: [199, 115, 86] },
};

function random(seed) {
  let n = seed >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
const rng = random(92017);
const noise = Float32Array.from({ length: 65536 }, rng);
function field(x, y) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  let fx = x - ix,
    fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const at = (a, b) => noise[((b & 255) << 8) + (a & 255)];
  return (
    (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) +
    (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy
  );
}
function terrain(x, y) {
  return (
    0.53 * field(x, y) +
    0.27 * field(x * 2.07, y * 2.07) +
    0.14 * field(x * 4.2, y * 4.2) +
    0.06 * field(x * 9, y * 9)
  );
}

const artCache = new Map();
function makePlanet(type, variation) {
  const size = 520,
    height = 340,
    canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = height;
  const ctx = canvas.getContext("2d"),
    cx = 260,
    cy = 169,
    r = type === "ring" ? 103 : 132;
  const base = surfaces[type].base,
    seed = (variation % 4093) * 0.19;
  function rings(front) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.27);
    ctx.scale(1, 0.254);
    for (let radius = r * 1.24; radius < r * 2.36; radius += 0.74) {
      const f = radius / r;
      if ((f > 1.88 && f < 1.96) || (f > 2.26 && f < 2.29)) continue;
      const band = field(radius * 0.52, seed + 17) * 0.55 + terrain(radius * 0.1, seed + 4) * 0.45;
      const a = (f < 1.45 ? 0.24 : f > 2.23 ? 0.45 : 0.92) * (0.54 + band * 0.46);
      ctx.beginPath();
      ctx.arc(0, 0, radius, front ? 0 : Math.PI, front ? Math.PI : 2 * Math.PI);
      ctx.strokeStyle =
        "rgba(" +
        [
          154 + Math.round(band * 91),
          126 + Math.round(band * 85),
          105 + Math.round(band * 77),
          a,
        ].join(",") +
        ")";
      ctx.lineWidth = 1.35;
      ctx.stroke();
    }
    ctx.restore();
  }
  if (type === "ring") rings(false);
  const disc = document.createElement("canvas"),
    d = 2 * r;
  disc.width = disc.height = d;
  const sc = disc.getContext("2d");
  const im = sc.createImageData(d, d);
  for (let iy = 0; iy < d; iy++)
    for (let ix = 0; ix < d; ix++) {
      const x = (ix + 0.5 - r) / r,
        y = (iy + 0.5 - r) / r,
        len = x * x + y * y;
      if (len >= 1) continue;
      const z = Math.sqrt(1 - len),
        lat = Math.asin(y * 0.96 + x * 0.24),
        lon = Math.atan2(x, z);
      const u = lon * 3 + seed,
        v = lat * 4 + seed * 0.17,
        drift = terrain(u * 2, v * 2);
      const clouds = terrain(u * 5 + drift * 3, v * 5),
        fine = field(ix * 1.1 + seed, iy * 1.3);
      let texture,
        hue = 0;
      if (type === "moon" || type === "ember") {
        texture =
          0.56 + 0.8 * terrain(u * 2 + 8, v * 2) + 0.26 * (clouds - 0.5) + 0.07 * (fine - 0.5);
        const pits = field(u * 13, v * 13);
        texture -= Math.max(0, pits - 0.72) * 0.55;
      } else {
        const band = field((lat + (drift - 0.5) * 0.07) * 20 + seed, 12);
        const thin = field((lat + (clouds - 0.5) * 0.016) * 112, seed + 31);
        texture = 0.7 + 0.45 * band + 0.17 * thin + 0.16 * (clouds - 0.5);
        hue = (band - 0.45) * (type === "ring" ? 34 : 19);
      }
      const light = Math.max(0, -0.57 * x - 0.47 * y + 0.48 * z);
      const shade = 0.115 + 0.95 * Math.pow(light, 0.78);
      const rim = Math.pow(1 - z, 4) * (0.22 + Math.max(0, -x * 0.63 - y * 0.4) * 0.58);
      const shadowRing =
        type === "ring" && y + x * 0.27 > 0.13 && y + x * 0.27 < 0.19 && x > 0.05 ? 0.83 : 1;
      const k = (iy * d + ix) * 4;
      for (let c = 0; c < 3; c++)
        im.data[k + c] =
          (base[c] + hue * (c === 2 ? 0.08 : 1)) * texture * shade * shadowRing +
          rim * (c === 2 ? 112 : 83) +
          [8, 9, 18][c];
      im.data[k + 3] = Math.min(255, (1 - Math.sqrt(len)) * r * 360);
    }
  sc.putImageData(im, 0, 0);
  ctx.drawImage(disc, cx - r, cy - r);
  if (type === "ring") rings(true);
  return canvas;
}
export function paintPlanet(canvas, world) {
  const variation = [...world.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 13);
  const key = world.surface + "-" + variation;
  if (!artCache.has(key)) {
    if (artCache.size >= 24) artCache.delete(artCache.keys().next().value);
    artCache.set(key, makePlanet(world.surface, variation));
  }
  canvas.width = 520;
  canvas.height = 340;
  canvas.getContext("2d").drawImage(artCache.get(key), 0, 0);
}

export function drawSky(canvas, showOrbits) {
  const w = innerWidth,
    h = innerHeight,
    dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const c = canvas.getContext("2d");
  c.scale(dpr, dpr);
  c.fillStyle = "#090c17";
  c.fillRect(0, 0, w, h);
  const cloud = document.createElement("canvas");
  cloud.width = 260;
  cloud.height = Math.max(120, Math.round((260 * h) / w));
  const g = cloud.getContext("2d"),
    dust = g.createImageData(cloud.width, cloud.height);
  for (let y = 0; y < cloud.height; y++)
    for (let x = 0; x < cloud.width; x++) {
      const u = x / cloud.width,
        v = y / cloud.height;
      const n = terrain(u * 5.3 + 11, v * 6.4 + 16),
        line = v - (0.84 - 0.63 * u + 0.13 * Math.sin(5 * u));
      const haze = Math.exp(-line * line * 15) * Math.pow(n, 2.4) * 1.9;
      const warm = Math.max(0, 1 - u * 1.7);
      const k = (y * cloud.width + x) * 4;
      dust.data[k] = 8 + (37 + 23 * warm) * haze;
      dust.data[k + 1] = 11 + (28 - 9 * warm) * haze;
      dust.data[k + 2] = 23 + (55 - 14 * warm) * haze;
      dust.data[k + 3] = 255;
    }
  g.putImageData(dust, 0, 0);
  c.drawImage(cloud, 0, 0, w, h);
  const star = random(34871);
  for (let i = 0; i < Math.min(1550, (w * h) / 960 + 130); i++) {
    const x = star() * w,
      y = star() * h,
      s = star(),
      a = 0.17 + star() * 0.64;
    c.fillStyle = "rgba(" + (i % 8 === 0 ? "246,208,175" : "209,216,243") + "," + a + ")";
    c.beginPath();
    c.arc(x, y, s > 0.988 ? 1.65 : s > 0.9 ? 1.05 : 0.35 + star() * 0.32, 0, Math.PI * 2);
    c.fill();
    if (s > 0.988) {
      c.globalAlpha = 0.34;
      c.fillRect(x - 0.45, y - 3.8, 0.9, 7.6);
      c.fillRect(x - 3.8, y - 0.45, 7.6, 0.9);
      c.globalAlpha = 1;
    }
  }
  if (showOrbits) {
    c.save();
    c.translate(w * 0.48, h * 0.47);
    c.rotate(-0.29);
    c.lineWidth = 0.8;
    for (const [i, r] of [0.18, 0.37, 0.58, 0.82].entries()) {
      c.strokeStyle = i === 1 ? "rgba(219,192,155,.20)" : "rgba(180,184,220,.15)";
      c.beginPath();
      c.ellipse(
        0,
        0,
        Math.max(w, h * 0.76) * r,
        Math.max(w * 0.31, h * 0.33) * r,
        0,
        0,
        2 * Math.PI,
      );
      c.stroke();
    }
    c.restore();
  }
}
