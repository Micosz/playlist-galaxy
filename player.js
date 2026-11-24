import { demoAudio } from "./atlas.js";
import { bookmark, remember } from "./library.js";
import { prepareMusic } from "./apple.js";

const filePlaybackIssue = "เล่นไฟล์ MP3 นี้ไม่ได้ ตรวจอุปกรณ์เสียงแล้วแตะเล่นต่อ หรือลองไฟล์ MP3 อื่น";

export class Player {
  constructor({ tracks, file, changed, issue }) {
    this.tracks = tracks;
    this.file = file;
    this.changed = changed;
    this.issue = issue;
    this.world = null;
    this.track = null;
    this.state = "idle";
    this.generation = 0;
    this.appleJobs = Promise.resolve();
    this.seconds = 0;
    this.clockReady = false;
    this.lastWrite = 0;
    this.temporaryPosition = false;
  }

  position() {
    if (!this.clockReady) return this.seconds;
    const value = this.audio ? this.audio.currentTime : this.apple?.currentPlaybackTime;
    return Number.isFinite(value) ? value : this.seconds;
  }
  duration() {
    const d = this.audio ? this.audio.duration : this.apple?.currentPlaybackDuration;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }
  savePosition(world,id,seconds) {
    const persisted = remember(world,id,seconds);
    if (!persisted && !this.temporaryPosition)
      this.issue("จำตำแหน่งฟังได้เฉพาะแท็บนี้ หากต้องการเก็บไว้หลังปิดแท็บ ให้ตรวจพื้นที่และสิทธิ์จัดเก็บของเบราว์เซอร์");
    this.temporaryPosition = !persisted;
  }
  checkpoint() {
    if (!this.world || !this.track) return;
    this.seconds = this.position();
    this.savePosition(this.world, this.track.id, this.seconds);
    this.lastWrite = Date.now();
  }
  tick() {
    if (this.state === "playing" && Date.now() - this.lastWrite > 3000) this.checkpoint();
  }

  release() {
    this.generation++;
    this.clockReady = false;
    if (this.audio) {
      const audio = this.audio;
      this.audio = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    if (this.apple) {
      const m = this.apple;
      if (this.appleListener) m.removeEventListener("playbackStateDidChange", this.appleListener);
      this.appleListener = null;
      this.apple = null;
      try {
        Promise.resolve(m.pause()).catch(() => {});
      } catch {}
    }
  }
  idle() {
    this.checkpoint();
    this.release();
    this.track = null;
    this.world = null;
    this.seconds = 0;
    this.state = "idle";
    this.changed();
  }
  pause() {
    if (!this.track) return;
    this.checkpoint();
    this.release();
    this.state = "paused";
    this.changed();
  }
  restorePaused(world, track, seconds) {
    this.world = world;
    this.track = track;
    this.seconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    this.state = "paused";
    this.changed();
  }
  toggle() {
    if (!this.track) return;
    if (this.state === "playing" || this.state === "loading") this.pause();
    else this.start(this.world, this.track, bookmark(this.world,[this.track]).seconds ?? this.seconds);
  }
  enter(world) {
    if (
      this.world === world &&
      this.track &&
      (this.state === "playing" || this.state === "loading")
    )
      return;
    const songs = this.tracks(world);
    if (!songs.length) {
      this.idle();
      return;
    }
    const mark = bookmark(world,songs),
      saved = songs.find((t) => t.id === mark.id);
    this.start(world, saved || songs[0], saved ? mark.seconds : 0);
  }
  pick(world, track) {
    if (this.world === world && this.track?.id === track.id) {
      this.toggle();
      return;
    }
    const mark = bookmark(world,this.tracks(world));
    this.start(world, track, track.id === mark.id ? mark.seconds : 0);
  }
  next(natural = false) {
    if (!this.track) return;
    const world = this.world,
      list = this.tracks(world),
      index = list.findIndex((t) => t.id === this.track.id);
    if (!list.length) {
      this.idle();
      return;
    }
    if (natural && index === list.length - 1) {
      this.idle();
      this.savePosition(world, list[0].id, 0);
      return;
    }
    this.start(world, list[(index + 1) % list.length], 0);
  }
  seek(value) {
    if (!this.track || !Number.isFinite(value)) return;
    const time = Math.max(0, Math.min(this.duration() || value, value));
    if (this.audio && this.clockReady) {
      this.audio.currentTime = time;
      this.checkpoint();
    } else if (this.apple && this.clockReady) {
      const gen = this.generation;
      Promise.resolve(this.apple.seekToTime(time))
        .then(() => {
          if (gen === this.generation) this.checkpoint();
        })
        .catch(() => {
          if (gen === this.generation) this.issue("เลื่อนไปตำแหน่งนี้ไม่ได้");
        });
    }
  }
  async start(world, track, seconds = 0) {
    this.checkpoint();
    this.release();
    const gen = this.generation;
    this.world = world;
    this.track = track;
    this.seconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    this.savePosition(world, track.id, this.seconds);
    this.state = "loading";
    this.changed();
    try {
      if (track.kind !== "apple") await this.playFile(track, gen);
      else {
        const work = this.appleJobs.then(() => this.playApple(track, gen));
        this.appleJobs = work.catch(() => {});
        await work;
      }
    } catch (error) {
      if (gen !== this.generation) return;
      this.pause();
      this.issue(
        error.name === "NotAllowedError"
          ? "เบราว์เซอร์รอให้แตะปุ่มเล่นต่อ"
          : track.kind !== "apple"
            ? filePlaybackIssue
            : error.message || "เล่น Apple Music ไม่สำเร็จ",
      );
    }
  }
  async playFile(track, gen) {
    let src = track.kind === "demo" ? demoAudio[track.id] : null;
    if (!src) {
      const result = this.file(track.id);
      const blob = result instanceof Blob ? result : await result;
      if (gen !== this.generation) return;
      if (!blob) throw new Error("Missing file");
      src = this.objectUrl = URL.createObjectURL(blob);
    }
    const audio = new Audio();
    this.audio = audio;
    const resume = this.seconds;
    audio.preload = "auto";
    audio.src = src;
    audio.addEventListener(
      "loadedmetadata",
      () => {
        if (gen !== this.generation) return;
        if (resume > 0)
          audio.currentTime = Math.min(resume, Math.max(0, (audio.duration || resume) - 0.05));
        this.clockReady = true;
      },
      { once: true },
    );
    audio.addEventListener("ended", () => {
      if (gen === this.generation) this.next(true);
    });
    audio.addEventListener("error", () => {
      if (gen === this.generation) {
        this.pause();
        this.issue(filePlaybackIssue);
      }
    });
    await audio.play();
    if (gen === this.generation) {
      this.state = "playing";
      this.changed();
    }
  }
  async playApple(track, gen) {
    if (gen !== this.generation) return;
    const m = await prepareMusic();
    if (gen !== this.generation) return;
    if (!m.isAuthorized) throw new Error("เชื่อม Apple Music ในดาวนี้ แล้วแตะเล่นต่อ");
    this.apple = m;
    await m.setQueue({ song: track.catalogId });
    if (gen !== this.generation) return;
    await m.play();
    if (gen !== this.generation) {
      await m.pause();
      return;
    }
    if (this.seconds > 0) await m.seekToTime(this.seconds);
    if (gen !== this.generation) {
      await m.pause();
      return;
    }
    this.clockReady = true;
    this.state = "playing";
    const states = window.MusicKit.PlaybackStates || {};
    this.appleListener = (event) => {
      if (gen !== this.generation) return;
      if (
        ["ended", "completed", states.ended, states.completed].some(
          (v) => v != null && v === event.state,
        )
      )
        this.next(true);
      else if (event.state === "paused" || (states.paused != null && event.state === states.paused))
        this.pause();
    };
    m.addEventListener("playbackStateDidChange", this.appleListener);
    this.changed();
  }
}
