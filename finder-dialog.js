import { fetchCatalog } from "./atlas.js";
import { appleSongLink } from "./apple.js";
import { libraryEntries, galaxyEntries, planetEntries, findEntries } from "./finder.js";

const get = id => document.getElementById(id);
function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function bindFinder({library, beforeOpen, browse, play}) {
  const dialog = get("finder"), opener = get("open-finder"), input = get("finder-query");
  const search = get("finder-search"), detail = get("finder-detail"), status = get("finder-status");
  const retry = get("finder-retry");
  const catalogs = [{kind:"galaxy", index:galaxyEntries}, {kind:"system", index:planetEntries}];
  let local = [], lastWorlds, lastTracks, timer, pending = false, attempted = false, detailButton;
  const groups = ["library","catalog"].map(id => ({
    section:get("finder-" + id), list:get("finder-" + id + "-list"), more:get("finder-" + id + "-more"), rows:[], shown:0,
  }));
  function returnToResults() {
    detail.hidden = true;
    search.hidden = false;
    (detailButton?.isConnected ? detailButton : input).focus();
  }
  function showDetails(row, button) {
    detailButton = button;
    get("finder-object").textContent = row.name;
    get("finder-address").textContent = row.type + " · " + row.path;
    get("finder-facts").replaceChildren(...row.details.flatMap(([label,value]) =>
      [element("dt",label),element("dd",value)]));
    get("finder-source").textContent = row.source;
    search.hidden = true;
    detail.hidden = false;
    get("finder-object").focus();
  }
  function result(row) {
    const item = element("li"), main = element("button");
    const name = element("strong",row.name);
    const meta = element("small",[row.type,row.track?.artist,row.path].filter(Boolean).join(" · "));
    const label = row.source ? "ดูข้อมูล" : row.container ? "เปิดแผนที่" : "ดูดาว";
    main.className = "finder-row";
    const action = element("span",label);
    action.className = "finder-action";
    main.append(name, meta, action);
    main.onclick = () => {
      if (row.source) showDetails(row,main);
      else { dialog.close(); browse(row); }
    };
    item.append(main);
    if (row.track) {
      const apple = row.track.kind === "apple";
      const link = apple && appleSongLink(row.track.url);
      if (apple && !link) return item;
      const button = element(apple ? "a" : "button", apple ? "Apple Music ↗" : "▶ เล่น");
      button.className = "finder-play";
      button.setAttribute("aria-label",apple ? "เปิด " + row.name + " ใน Apple Music" : "เล่น " + row.name);
      if (link) { button.href = link.url; button.target = "_blank"; button.rel = "noopener noreferrer"; }
      else button.onclick = () => { dialog.close(); play(row.track); };
      item.append(button);
    }
    return item;
  }
  function append(group, moveFocus) {
    const batch = group.rows.slice(group.shown,group.shown + 6).map(result);
    group.list.append(...batch);
    group.shown += batch.length;
    group.more.hidden = group.shown >= group.rows.length;
    if (moveFocus) batch[0]?.firstElementChild.focus();
  }
  function reset(group, rows) {
    group.rows = rows;
    group.shown = 0;
    group.list.replaceChildren();
    group.section.hidden = !rows.length;
    append(group,false);
  }
  groups.forEach(g => { g.more.onclick = () => append(g,true); });
  function updateStatus() {
    const q = input.value.trim(), count = groups.reduce((n,g) => n + g.rows.length,0);
    const missing = q && attempted && !pending && catalogs.some(c => !c.rows);
    retry.hidden = !missing;
    status.textContent = !q ? "" : [
      count ? "พบ " + count.toLocaleString("th") + " รายการ" : (!pending && attempted ? "ไม่พบผลค้นหา" : ""),
      pending || !attempted ? "กำลังอ่านแค็ตตาล็อก…" : missing ? "แค็ตตาล็อกบางส่วนยังไม่พร้อม" : "",
    ].filter(Boolean).join(" · ");
  }
  function catalogResults() {
    const q = input.value.trim();
    const rows = q ? findEntries(catalogRows,q) : [];
    reset(groups[1],rows);
    updateStatus();
  }
  let catalogRows = [];
  async function loadCatalogs() {
    if (pending || !dialog.open || !input.value.trim()) return;
    pending = attempted = true;
    updateStatus();
    await Promise.allSettled(catalogs.filter(c => !c.rows).map(async c => {
      c.rows = c.index(await fetchCatalog(c.kind));
    }));
    catalogRows = catalogs.flatMap(c => c.rows || []);
    pending = false;
    if (dialog.open) catalogResults();
  }
  function refreshLibrary() {
    const q = input.value.trim();
    if (!dialog.open || !q) return;
    const {worlds,tracks} = library();
    if (worlds !== lastWorlds || tracks !== lastTracks) {
      local = libraryEntries(worlds,tracks);
      lastWorlds = worlds;
      lastTracks = tracks;
    }
    reset(groups[0],findEntries(local,q));
    updateStatus();
  }
  function queryChanged() {
    clearTimeout(timer);
    if (input.value.trim()) {
      refreshLibrary();
      if (!attempted) timer = setTimeout(loadCatalogs,140);
    } else reset(groups[0],[]);
    catalogResults();
  }
  retry.onclick = () => { input.focus(); loadCatalogs(); };
  get("finder-results-back").onclick = returnToResults;
  dialog.addEventListener("keydown", e => {
    if (e.key !== "Escape" || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    if (detail.hidden) dialog.close();
    else returnToResults();
  });
  dialog.addEventListener("cancel", e => {
    if (!detail.hidden) { e.preventDefault(); returnToResults(); }
  });
  dialog.addEventListener("close", () => clearTimeout(timer));
  input.addEventListener("input",queryChanged);
  input.addEventListener("keydown", e => {
    if (e.isComposing || !["Enter","ArrowDown"].includes(e.key)) return;
    const first = groups.find(g => g.rows.length)?.list.querySelector(".finder-row");
    e.preventDefault();
    if (e.key === "Enter") first?.click();
    else first?.focus();
  });
  function open() {
    if (document.querySelector("dialog[open]")) return;
    beforeOpen();
    opener.focus({preventScroll:true});
    detail.hidden = true;
    search.hidden = false;
    dialog.showModal();
    queryChanged();
    input.focus();
    input.select();
  }
  opener.onclick = open;
  document.addEventListener("keydown", e => {
    if (e.key !== "/" || e.isComposing || e.repeat || e.ctrlKey || e.altKey || e.metaKey ||
        document.querySelector("dialog[open]") || e.target.closest("input,textarea,select,[contenteditable=true]")) return;
    e.preventDefault();
    open();
  });
  return { libraryChanged:refreshLibrary };
}
