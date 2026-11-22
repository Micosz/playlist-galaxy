const sdkUrl = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
let preparing;
export let music = null;

function loadSdk() {
  if (window.MusicKit) return Promise.resolve(window.MusicKit);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const finish = (error) => {
      clearTimeout(timeout);
      document.removeEventListener("musickitloaded", ready);
      script.onload = script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else resolve(window.MusicKit);
    };
    const ready = () => {
      if (window.MusicKit) finish();
    };
    const timeout = setTimeout(
      () => finish(new Error("โหลด MusicKit ไม่สำเร็จ ลองอีกครั้ง")),
      14000,
    );
    document.addEventListener("musickitloaded", ready);
    script.onload = ready;
    script.onerror = () => finish(new Error("ติดต่อ Apple Music ไม่ได้ ลองอีกครั้ง"));
    script.src = sdkUrl;
    script.async = true;
    document.head.append(script);
  });
}

export function prepareMusic() {
  if (music) return Promise.resolve(music);
  if (!preparing) {
    preparing = (async () => {
      const res = await fetch("/api/music-token", { cache: "no-store" });
      if (!res.ok || !res.headers.get("content-type")?.includes("application/json"))
        throw new Error("บริการเชื่อม Apple Music ยังไม่พร้อม เพิ่มลิงก์เพลงเก็บไว้ก่อนได้");
      const config = await res.json();
      if (!config.configured || !config.developerToken)
        throw new Error("เว็บนี้ยังไม่ได้เปิดใช้ MusicKit เพิ่มลิงก์เพลงเก็บไว้ก่อนได้");
      const kit = await loadSdk();
      await kit.configure({
        developerToken: config.developerToken,
        app: { name: "Playlist Galaxy", build: "1.0.0" },
      });
      music = kit.getInstance();
      return music;
    })().finally(() => {
      preparing = null;
    });
  }
  return preparing;
}

export function appleSongLink(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "music.apple.com" ||
    url.username ||
    url.password ||
    url.port
  )
    return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (!/^[a-z]{2}$/i.test(parts[0] || "")) return null;
  const id =
    parts[1] === "song" ? parts.at(-1) : parts[1] === "album" ? url.searchParams.get("i") : null;
  if (!/^\d+$/.test(id || "")) return null;
  return {
    catalogId: id,
    url: "https://music.apple.com/" + parts[0].toLowerCase() + "/song/" + id,
  };
}

export async function searchSongs(term) {
  if (!music?.isAuthorized) throw new Error("เชื่อมบัญชี Apple Music ก่อนค้นหา");
  const country = music.storefrontId || "us";
  const res = await music.api.music("/v1/catalog/" + encodeURIComponent(country) + "/search", {
    term,
    types: "songs",
    limit: 8,
  });
  return (res.data?.results?.songs?.data || []).map((item) => ({
    catalogId: item.id,
    title: item.attributes.name,
    artist: item.attributes.artistName || "",
    url:
      appleSongLink(item.attributes.url)?.url ||
      "https://music.apple.com/" + country + "/song/" + encodeURIComponent(item.id),
  }));
}
