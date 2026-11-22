"use strict";

// An aircheck taps the receiver's speaker mix for the lifetime of one recording.
class Aircheck {
  constructor(panel, announce, onPreview) {
    this.button = panel.querySelector("#record");
    this.preview = panel.querySelector("#preview-clip");
    this.player = panel.querySelector("audio");
    this.onPreview = onPreview;
    this.label = panel.querySelector(".record-text");
    this.save = panel.querySelector("a");
    this.error = panel.querySelector(".record-error");
    this.announce = announce;
    const Context = window.AudioContext || window.webkitAudioContext;
    panel.hidden = !(window.MediaRecorder && Context?.prototype.createMediaStreamDestination);
    this.button.addEventListener("click", () => this.take ? this.stop() : this.start());
    this.preview.addEventListener("click", () => this.previewRequest ? this.stopPreview() : this.playPreview());
    this.player.addEventListener("ended", () => { if (this.player.ended) this.stopPreview(); });
    this.player.addEventListener("pause", () => { if (this.playing && this.player.paused && !this.player.error) this.stopPreview(); });
    this.player.addEventListener("error", () => {
      if (this.player.error) this.previewFailed(this.previewRequest, this.player.error);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { this.stop(); this.stopPreview(); }
    });
  }

  setSource(source) {
    this.stopPreview();
    this.source = source;
    if (!source) this.stop();
    this.controls();
  }

  get playing() { return Boolean(this.previewRequest?.playing); }

  setLevel(volume, muted) {
    this.player.volume = volume;
    this.player.muted = muted || volume === 0;
  }

  async playPreview() {
    if (this.take || this.preview.hidden) return;
    const request = this.previewRequest = {playing: false};
    this.error.textContent = "";
    this.controls();
    try {
      this.player.src = this.save.href;
      await this.player.play();
      if (request !== this.previewRequest) return;
      request.playing = true;
      this.onPreview(true);
      this.controls();
      this.announce("Playing the latest aircheck.");
    } catch (error) {
      this.previewFailed(request, error);
    }
  }

  stopPreview() {
    const request = this.previewRequest;
    if (!request) return;
    this.previewRequest = null;
    this.player.pause();
    this.player.removeAttribute("src");
    this.player.load();
    if (request.playing) this.onPreview(false);
    this.controls();
  }

  previewFailed(request, error) {
    if (!request || request !== this.previewRequest) return;
    const unsupported = error.name === "NotSupportedError" ||
      error.code === MediaError.MEDIA_ERR_DECODE || error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
    this.stopPreview();
    if (unsupported) {
      const focused = document.activeElement === this.preview;
      this.preview.hidden = true;
      if (focused) this.save.focus({preventScroll:true});
      this.error.textContent = "Preview unavailable for this format. You can still save the clip.";
    } else {
      this.error.textContent = "Playback could not start. Choose Play clip to retry.";
    }
  }

  controls() {
    const recording = this.take?.recorder.state === "recording";
    this.preview.disabled = Boolean(this.take);
    this.preview.textContent = this.playing ? "Stop preview" : this.previewRequest ? "Cancel preview" : "Play clip";
    this.button.disabled = !this.source || Boolean(this.take && !recording);
    this.button.classList.toggle("recording", recording);
    this.label.textContent = recording ? "Stop clip" : this.take ? "Finishing…" : "Record 12 s";
    this.button.title = this.source ? "Record up to 12 seconds of receiver output" : "Power on to record";
  }

  start() {
    if (!this.source || this.take) return;
    this.stopPreview();
    const source = this.source;
    let tap;
    this.error.textContent = "";
    try {
      tap = source.context.createMediaStreamDestination();
      const recorder = new MediaRecorder(tap.stream);
      source.connect(tap);
      const take = this.take = { source, tap, recorder, parts: [], date: new Date() };
      recorder.ondataavailable = event => { if (event.data.size) take.parts.push(event.data); };
      recorder.onerror = () => { take.failed = true; };
      recorder.onstop = () => this.finish(take);
      recorder.start();
      take.timer = window.setTimeout(() => this.stop(), 12000);
      this.controls();
      this.announce("Recording an aircheck. Tune to include another station.");
    } catch {
      if (this.take) {
        this.take.failed = true;
        this.finish(this.take);
      } else {
        tap?.stream.getTracks().forEach(track => track.stop());
        this.error.textContent = "Recording unavailable.";
      }
    }
  }

  stop() {
    if (this.take?.recorder.state !== "recording") return;
    clearTimeout(this.take.timer);
    this.take.recorder.stop();
    this.controls();
  }

  finish(take) {
    if (take !== this.take) return;
    this.take = null;
    clearTimeout(take.timer);
    take.recorder.onstop = take.recorder.onerror = take.recorder.ondataavailable = null;
    take.source.disconnect(take.tap);
    take.tap.stream.getTracks().forEach(track => track.stop());
    this.controls();
    if (take.discard) return;
    if (take.failed || !take.parts.length) {
      this.error.textContent = "No clip captured. Try again.";
      return;
    }
    const type = take.parts[0].type || take.recorder.mimeType;
    const extension = /webm/i.test(type) ? ".webm" : /mp4/i.test(type) ? ".m4a" : /ogg/i.test(type) ? ".ogg" : "";
    try {
      const href = URL.createObjectURL(new Blob(take.parts, {type}));
      this.clearDownload();
      this.save.href = href;
      this.save.download = "ringband-aircheck-" + take.date.toISOString().replace(/[:.]/g, "-") + extension;
      this.save.hidden = false;
      this.preview.hidden = false;
      this.announce("Aircheck ready. Play or save the clip.");
    } catch {
      this.error.textContent = "Could not prepare this clip. Try again.";
    }
  }

  clearDownload() {
    this.stopPreview();
    this.preview.hidden = true;
    if (this.save.hasAttribute("href")) URL.revokeObjectURL(this.save.href);
    this.save.removeAttribute("href");
    this.save.download = "";
    this.save.hidden = true;
  }

  reset() {
    const take = this.take;
    if (take) {
      take.discard = true;
      this.stop();
      this.finish(take);
    }
    this.clearDownload();
    this.error.textContent = "";
  }
}
