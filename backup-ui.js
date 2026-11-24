import { mediaWriteMessage } from "./library.js";
import { readBackup, writeBackup } from "./backup.js";

const size = n => n < 1024 * 1024
  ? Math.ceil(n / 1024) + " KiB" : (n / (1024 * 1024)).toFixed(1) + " MiB";

export function bindBackup({library, counts, checkpoint, refresh}) {
  const el = id => document.getElementById(id);
  const dialog = el("library-transfer"), status = el("transfer-status");
  const prepare = el("backup-export"), choose = el("backup-choose"), input = el("backup-file");
  const download = el("backup-download"), apply = el("backup-apply");
  let work, candidate, downloadUrl;
  function discard() {
    candidate = null;
    apply.hidden = download.hidden = true;
    download.removeAttribute("href");
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
    input.value = "";
  }
  function reportCounts() {
    const {worlds,tracks} = counts();
    el("transfer-count").textContent = "คลังนี้มี " + worlds + " ดาวและระบบ · " + tracks + " เพลง";
  }
  function locked(busy) {
    prepare.disabled = choose.disabled = !library() || busy;
    apply.disabled = busy;
    dialog.setAttribute("aria-busy",String(busy));
  }
  function summary(data, bytes) {
    return data.worlds.length + " ดาวและระบบ · " + data.tracks.length + " เพลง · MP3 " +
      data.media.length + " ไฟล์ · " + size(bytes);
  }
  function errorText(error) {
    if (error.name === "QuotaExceededError") return "พื้นที่ไม่พอสำหรับนำเข้า คลังเดิมยังอยู่ครบ";
    if (error instanceof Error && error.name === "Error") return error.message;
    return "อ่านหรือบันทึกไฟล์ไม่สำเร็จ คลังเดิมยังอยู่ครบ";
  }
  async function run(message, action, describeError = errorText) {
    work?.abort();
    const controller = new AbortController();
    work = controller;
    locked(true);
    status.textContent = message;
    try { await action(controller.signal); }
    catch (error) { if (!controller.signal.aborted) status.textContent = describeError(error); }
    finally { if (work === controller) { work = null; locked(false); } }
  }
  for (const opener of document.querySelectorAll("[data-open-backup]")) opener.onclick = () => {
    discard();
    reportCounts();
    status.textContent = library() ? "" : "เบราว์เซอร์นี้ยังเปิดคลังเพลงในเครื่องไม่ได้ เปิดในหน้าต่างปกติที่อนุญาตให้จัดเก็บแล้วลองอีกครั้ง";
    locked(false);
    dialog.showModal();
  };
  dialog.addEventListener("close",() => {
    work?.abort();
    work = null;
    discard();
  });
  prepare.onclick = () => run("กำลังอ่านเพลงและเตรียมไฟล์สำรอง…",async signal => {
    discard();
    checkpoint();
    const snapshot = await library().snapshot();
    const {data,file} = await writeBackup(snapshot,signal);
    signal.throwIfAborted();
    downloadUrl = URL.createObjectURL(file);
    download.href = downloadUrl;
    download.download = "Playlist Galaxy - " + new Date().toISOString().slice(0,10) + ".pgalaxy";
    download.hidden = false;
    status.textContent = summary(data,file.size) + " พร้อมดาวน์โหลด";
    download.focus();
  });
  download.onclick = () => {
    status.textContent = "ดูไฟล์ .pgalaxy ในรายการดาวน์โหลด หากไม่พบ ให้ตรวจสิทธิ์ดาวน์โหลดของเว็บนี้แล้วกดดาวน์โหลดอีกครั้ง";
  };
  choose.onclick = () => input.click();
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    run("กำลังตรวจไฟล์และเนื้อหา MP3…",async signal => {
      discard();
      const parsed = await readBackup(file,signal);
      signal.throwIfAborted();
      candidate = parsed;
      status.textContent = summary(parsed.data,file.size) +
        " · รวมเฉพาะรายการที่ขาด เก็บดาวที่คุณแก้และตำแหน่งฟังเดิมไว้ ลิงก์ Apple Music ย้ายได้เฉพาะรายการเพลง";
      apply.hidden = false;
      apply.disabled = false;
      apply.focus();
    });
  };
  apply.onclick = () => {
    if (!candidate || apply.disabled) return;
    run("กำลังรวมคลังในเครื่อง…",async signal => {
      const plan = await library().merge(candidate,signal);
      discard();
      try { await refresh(); }
      catch {
        if (!signal.aborted) status.textContent = "รวมคลังแล้ว เปิดหน้านี้อีกครั้งเพื่อดูรายการที่เพิ่ม";
        return;
      }
      if (signal.aborted) return;
      reportCounts();
      const {newWorlds,seedEdits,newTracks,positions} = plan;
      status.textContent = newWorlds.length + seedEdits.length + newTracks.length + positions.length
        ? "รวมแล้ว · เพิ่ม " + newWorlds.length + " ดาวและระบบ · ตั้งค่าดาวตั้งต้น " + seedEdits.length +
          " · เพิ่ม " + newTracks.length + " เพลง · รับตำแหน่งฟัง " + positions.length + " แห่ง"
        : "ไม่มีรายการใหม่ · ใช้ข้อมูลที่มีอยู่ในเครื่อง";
      dialog.querySelector("[data-close]").focus();
    }, error => candidate?.data.media.length && ["DataCloneError","UnknownError"].includes(error.name)
      ? mediaWriteMessage(error) : errorText(error));
  };
}
