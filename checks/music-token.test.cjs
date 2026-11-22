const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, verify } = require("node:crypto");
const token = require("../api/music-token.js");

test("MusicKit signs an origin-scoped ES256 developer token and handles missing settings", (t) => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const names = [
    "APPLE_MUSIC_TEAM_ID",
    "APPLE_MUSIC_KEY_ID",
    "APPLE_MUSIC_PRIVATE_KEY",
    "APPLE_MUSIC_ORIGIN",
  ];
  const before = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const key of names) delete process.env[key];
  function call(method = "GET") {
    const r = {
      headers: {},
      setHeader(n, v) {
        this.headers[n] = v;
      },
      status(n) {
        this.code = n;
        return this;
      },
      json(data) {
        this.body = data;
      },
    };
    token({ method }, r);
    return r;
  }
  assert.deepEqual(call().body, { configured: false });
  assert.equal(call("POST").code, 405);
  Object.assign(process.env, {
    APPLE_MUSIC_TEAM_ID: "TESTTEAM01",
    APPLE_MUSIC_KEY_ID: "TESTKEY001",
    APPLE_MUSIC_PRIVATE_KEY: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString()
      .replace(/\n/g, "\\n"),
  });
  const r = call();
  assert.equal(r.code, 200);
  assert.equal(r.headers["Cache-Control"], "no-store");
  const [header, claims, sig] = r.body.developerToken.split(".");
  const decode = (s) => JSON.parse(Buffer.from(s, "base64url"));
  assert.deepEqual(decode(header), { alg: "ES256", kid: "TESTKEY001" });
  assert.deepEqual(decode(claims).origin, ["https://playlist-galaxy.vercel.app"]);
  assert.equal(decode(claims).iss, "TESTTEAM01");
  assert.ok(decode(claims).exp > Math.floor(Date.now() / 1000));
  assert.ok(
    verify(
      "sha256",
      Buffer.from(header + "." + claims),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(sig, "base64url"),
    ),
  );
  process.env.APPLE_MUSIC_PRIVATE_KEY = "invalid";
  assert.equal(call().code, 503);
  assert.deepEqual(call().body, { configured: false });
});
