"use strict";

const STATIONS = Object.freeze([
  { name: "Cassini Drift", frequency: "88.3", genre: "Orbital dub", bpm: 84, color: "#ffb565" },
  { name: "Ice Choir", frequency: "96.7", genre: "Glacial ambient", bpm: 66, color: "#9de1e6" },
  { name: "Hex Static", frequency: "105.1", genre: "Polar electro", bpm: 128, color: "#d0df85" }
]);

const RadioSynth = (() => {
  const pitch = midi => 440 * 2 ** ((midi - 69) / 12);
  const pick = notes => notes[Math.floor(Math.random() * notes.length)];

  class Program {
    constructor(ctx, destination, noise, index) {
      this.ctx = ctx;
      this.noise = noise;
      this.index = index;
      this.bpm = STATIONS[index].bpm;
      this.sixteenth = 15 / this.bpm;
      this.step = 0;
      this.beats = [];
      this.riffs = [];
      this.active = true;
      this.sources = new Set();
      this.channel = ctx.createGain();
      this.channel.gain.setValueAtTime(0,ctx.currentTime);
      this.channel.gain.linearRampToValueAtTime(.76,ctx.currentTime+.04);
      this.channel.connect(destination);
      this.echo = ctx.createDelay(2);
      this.echo.delayTime.value = this.sixteenth * [3,5,3][index];
      this.returns = ctx.createGain();
      this.returns.gain.value = [.25,.40,.18][index];
      this.echoTone = ctx.createBiquadFilter();
      this.echoTone.type = "lowpass"; this.echoTone.frequency.value = [1900,3800,1600][index];
      this.echo.connect(this.echoTone).connect(this.returns);
      this.returns.connect(this.echo); this.returns.connect(this.channel);
      this.start = ctx.currentTime + .018;
      this.next = this.start;
      this.tick();
      this.timer = window.setInterval(() => this.tick(), 30);
    }

    tick() {
      const now = this.ctx.currentTime;
      if (!this.active || this.ctx.state !== "running") return;
      // Throttled or background tabs skip expired notes instead of playing a backlog.
      if (this.next < now - .05) {
        const skipped = Math.ceil((now + .015 - this.next) / this.sixteenth);
        this.next += skipped * this.sixteenth;
        this.step += skipped;
      }
      while (this.next < now + .13) {
        const n = this.step % 16, bar = Math.floor(this.step / 16);
        const swing = this.index === 0 && n % 2 ? this.sixteenth*.14 : 0;
        const t = this.next + swing;
        if (this.index === 0) this.dub(n, bar, t);
        else if (this.index === 1) this.ice(n, bar, t);
        else this.electro(n, bar, t);
        this.step++; this.next += this.sixteenth;
      }
      this.beats = this.beats.filter(t => t > now - 1.7);
    }

    voice(source, nodes, tail, t, length, attack, level, pan, wet) {
      const amp = this.ctx.createGain();
      const output = this.ctx.createStereoPanner();
      output.pan.value = pan;
      amp.gain.setValueAtTime(.0001,t);
      amp.gain.exponentialRampToValueAtTime(level,t + attack);
      amp.gain.exponentialRampToValueAtTime(.0001,t + length);
      tail.connect(amp).connect(output).connect(this.channel);
      if (wet) output.connect(this.echo);
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        for (const node of [source,...nodes,amp,output]) node.disconnect();
      };
      source.start(t); source.stop(t + length + .015);
    }

    tone(midi,t,length,shape,level,options = {}) {
      const osc = this.ctx.createOscillator();
      osc.type = shape; osc.frequency.value = pitch(midi);
      osc.detune.value = options.detune || 0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      const cutoff = options.cutoff || 3200;
      filter.Q.value = options.q || .7;
      filter.frequency.setValueAtTime(cutoff,t);
      if (options.close) filter.frequency.exponentialRampToValueAtTime(options.close,t+length*.8);
      osc.connect(filter);
      this.voice(osc,[filter],filter,t,length,options.attack || .008,level,options.pan || 0,options.wet);
    }

    drum(t, high, low, length, level) {
      const osc = this.ctx.createOscillator();
      osc.frequency.setValueAtTime(high,t);
      osc.frequency.exponentialRampToValueAtTime(low,t + length * .42);
      this.voice(osc,[],osc,t,length,.004,level,0,false);
      this.beats.push(t);
    }

    hiss(t,length,cutoff,level,pan=0) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noise; noise.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "highpass"; filter.frequency.value = cutoff;
      noise.connect(filter);
      noise.playbackRate.value = .88 + Math.random()*.24;
      this.voice(noise,[filter],filter,t,length,.003,level,pan,false);
    }

    dub(n, bar, t) {
      const root = [38,34,41,36][Math.floor(bar / 2) % 4];
      if ([0,8,12].includes(n) || (bar%4===3 && n===14)) this.drum(t,118,44,.26,.9);
      if (n===4 || n===12) this.hiss(t,.13,1300,.20,-.08);
      if (n%4===2 || (n===15 && Math.random()<.55)) this.hiss(t,n===14?.13:.065,5900,.19,.24);
      if ([0,6,10].includes(n)) {
        this.tone(root + (n===10 ? pick([0,0,7]) : 0),t,n===0?.68:.34,"sine",.67,{attack:.014});
      }
      if (n===2 || (n===11 && Math.random() < .75)) {
        const chord = [12,15,19,22];
        chord.forEach((interval,i) => this.tone(root+interval,t+.005*i,.32,"sawtooth",.098,
          { cutoff:1000+Math.random()*1600, close:450, wet:true, detune:(i-1.5)*3, pan:(i-1.5)*.23, attack:.016 }));
      }
    }

    ice(n, bar, t) {
      const root = [45,41,48,43][Math.floor(bar / 2) % 4];
      if (n===0 || n===10) this.drum(t,82,43,.78,.58);
      if (n===0 && bar%2===0) {
        [0,7,14].forEach((interval,i) => this.tone(root+interval,t,4.8,"triangle",.22,
          { attack:1.1, cutoff:810, pan:(i-1)*.43, wet:true, detune:(i-1)*4 }));
      }
      if (n===0 || n===7 || (n===12 && Math.random() < .65)) {
        const note = root + pick([12,19,22,24,26]);
        const pan = Math.random()-.5;
        this.tone(note,t,2.1,"sine",.26,{attack:.027,pan,wet:true});
        this.tone(note+19,t,.62,"sine",.065,{attack:.018,pan:-pan,wet:true,detune:8});
      }
    }

    electro(n, bar, t) {
      const root = [35,35,38,33][Math.floor(bar / 2) % 4];
      if (n===0 || !this.riffs.length) this.riffs = [0,12,7,pick([0,10,15]),0,7,pick([12,19]),10];
      if (n%4===0) this.drum(t,154,47,.19,.82);
      if (n===4 || n===12) {
        this.hiss(t,.16,1200,.31,-.12); this.hiss(t+.018,.085,1700,.17,.14);
      }
      if (n%2===0 || (bar%2===1 && n===15)) this.hiss(t,n%4===2?.105:.041,6100,.16,.25);
      if (n%2===0 || (n===13 && Math.random()<.6)) {
        this.tone(root + this.riffs[Math.floor(n/2)],t,.15,"sawtooth",.26,
          {cutoff:950+1550*(.5+.5*Math.sin((bar*16+n)*.33)),close:210,q:5,pan:-.1});
      }
      if ([3,10,15].includes(n) && (bar%2 || n===10)) {
        this.tone(root+pick([19,24,31]),t,.13,"square",.084,{cutoff:1800, close:600, pan:.38, wet:true});
      }
    }

    pulse(now) {
      let hit = -100;
      for (const t of this.beats) if (t <= now) hit = t;
      return Math.exp(-(now-hit)*[5.5,2.3,8.5][this.index]);
    }

    stop(afterFade) {
      this.active = false;
      clearInterval(this.timer);
      const now = this.ctx.currentTime;
      const gain = this.channel.gain;
      gain.cancelScheduledValues(now);
      gain.setTargetAtTime(0,now,.007);
      for (const source of this.sources) source.stop(now+.045);
      window.setTimeout(() => {
        this.channel.disconnect(); this.echo.disconnect(); this.echoTone.disconnect(); this.returns.disconnect();
        if (afterFade) afterFade();
      },70);
    }
  }

  return class ReceiverAudio {
    constructor() {
      this.version = 0;
      this.volume = .58;
      this.muted = false;
      this.program = null;
    }
    init() {
      if (this.ctx) return;
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error("Web Audio is unavailable");
      this.ctx = new Context();
      const ctx = this.ctx;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -12; limiter.ratio.value = 5;
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 256;
      this.samples = new Uint8Array(this.analyser.fftSize);
      this.mix = ctx.createGain();
      this.master = ctx.createGain();
      // Aircheck records master. Preview only turns down the live speaker path.
      this.monitor = ctx.createGain();
      this.mix.connect(limiter).connect(this.analyser).connect(this.master).connect(this.monitor).connect(ctx.destination);
      this.master.gain.value = this.muted ? 0 : this.volume ** 1.45;
      this.noise = ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.8),ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
    }
    async powerOn(currentStation) {
      this.init();
      const version = ++this.version;
      await this.ctx.resume();
      if (version !== this.version) return false;
      this.monitor.gain.setValueAtTime(1,this.ctx.currentTime);
      this.retune(currentStation());
      return true;
    }
    retune(index) {
      if (this.program) this.program.stop();
      this.program = new Program(this.ctx,this.mix,this.noise,index);
    }
    powerOff(immediate = false) {
      const version = ++this.version;
      const suspend = () => {
        if (version !== this.version || !this.ctx || this.ctx.state === "closed") return;
        // A departing document can become inactive before suspend resolves.
        this.ctx.suspend().catch(() => {});
      };
      const previous = this.program;
      this.program = null;
      if (previous) previous.stop(immediate ? undefined : suspend);
      if (!previous || immediate) suspend();
    }
    monitorLive(audible) {
      if (this.program) this.monitor.gain.setTargetAtTime(audible ? 1 : 0,this.ctx.currentTime,.004);
    }
    setLevel(volume,muted) {
      this.volume = volume; this.muted = muted;
      if (!this.master) return;
      const value = muted ? 0 : volume ** 1.45;
      const gain = this.master.gain, now = this.ctx.currentTime;
      if (this.program && this.ctx.state === "running") {
        gain.setTargetAtTime(value,now,.016);
      } else {
        // The audio clock stands still in standby. Apply the level before the next note.
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(value,now);
      }
    }
    signal() {
      if (!this.program || this.ctx.state !== "running") return {live:false,pulse:0};
      const now = this.ctx.currentTime;
      this.analyser.getByteTimeDomainData(this.samples);
      return { live:true, pulse:this.program.pulse(now), trace:this.samples, phase:now-this.program.start };
    }
  };
})();
