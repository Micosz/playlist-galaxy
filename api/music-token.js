const { createPrivateKey, sign } = require("node:crypto");

module.exports = function musicToken(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ configured: false });
  }
  const env = process.env,
    team = env.APPLE_MUSIC_TEAM_ID,
    keyId = env.APPLE_MUSIC_KEY_ID,
    secret = env.APPLE_MUSIC_PRIVATE_KEY;
  if (!team || !keyId || !secret) return res.status(200).json({ configured: false });
  try {
    const origin = new URL(env.APPLE_MUSIC_ORIGIN || "https://playlist-galaxy.vercel.app").origin;
    const now = Math.floor(Date.now() / 1000);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const header = encode({ alg: "ES256", kid: keyId });
    const body = encode({ iss: team, iat: now, exp: now + 86400, origin: [origin] });
    const input = header + "." + body;
    const key = createPrivateKey(secret.replace(/\\n/g, "\n"));
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1")
      return res.status(503).json({ configured: false });
    const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
    return res
      .status(200)
      .json({ configured: true, developerToken: input + "." + signature.toString("base64url") });
  } catch {
    return res.status(503).json({ configured: false });
  }
};
