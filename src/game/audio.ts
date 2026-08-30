// ============================================================
//  AudioManager — полностью процедурный звук (Web Audio API)
//  ветры, море, генератор, помехи, огонь, сердцебиение, Морзе
// ============================================================

export type Surface = "wood" | "dirt" | "metal" | "stone";

export class AudioManager {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private brownBuf!: AudioBuffer;

  private windGain!: GainNode;
  private seaGain!: GainNode;
  private genGain!: GainNode;
  private genOscs: OscillatorNode[] = [];
  private staticGain!: GainNode;
  private fireGain!: GainNode;
  private droneGain!: GainNode;
  private heartTimer = 0;
  private breathTimer = 0;
  private crackleTimer = 0;
  private fireOn = false;
  private heartIntensity = 0;
  private breathIntensity = 0;
  volume = 0.8;

  /** create context + graphs; call from a user gesture */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume * 0.9;
    this.master.connect(this.ctx.destination);

    // noise buffers
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
    this.brownBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const bd = this.brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      bd[i] = last * 3.2;
    }

    // --- wind: white noise -> LP, slow LFO ---
    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = this.noiseBuf; windSrc.loop = true;
    const windLP = this.ctx.createBiquadFilter();
    windLP.type = "lowpass"; windLP.frequency.value = 320; windLP.Q.value = 0.6;
    this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0;
    windSrc.connect(windLP).connect(this.windGain).connect(this.master);
    windSrc.start();
    const windLfo = this.ctx.createOscillator();
    windLfo.frequency.value = 0.09;
    const windLfoAmt = this.ctx.createGain(); windLfoAmt.gain.value = 140;
    windLfo.connect(windLfoAmt).connect(windLP.frequency);
    windLfo.start();

    // --- sea: brown noise -> LP, wave LFO ---
    const seaSrc = this.ctx.createBufferSource();
    seaSrc.buffer = this.brownBuf; seaSrc.loop = true; seaSrc.playbackRate.value = 0.7;
    const seaLP = this.ctx.createBiquadFilter();
    seaLP.type = "lowpass"; seaLP.frequency.value = 260;
    this.seaGain = this.ctx.createGain(); this.seaGain.gain.value = 0;
    seaSrc.connect(seaLP).connect(this.seaGain).connect(this.master);
    seaSrc.start();
    const seaLfo = this.ctx.createOscillator();
    seaLfo.frequency.value = 0.13;
    const seaLfoAmt = this.ctx.createGain(); seaLfoAmt.gain.value = 0.5;
    seaLfo.connect(seaLfoAmt).connect(this.seaGain.gain);
    seaLfo.start();

    // --- generator hum: 52Hz + harmonics ---
    this.genGain = this.ctx.createGain(); this.genGain.gain.value = 0;
    this.genGain.connect(this.master);
    [52, 104, 157].forEach((f, i) => {
      const o = this.ctx!.createOscillator();
      o.type = i === 0 ? "sine" : "triangle";
      o.frequency.value = f;
      const g = this.ctx!.createGain();
      g.gain.value = i === 0 ? 0.5 : 0.16 / i;
      o.connect(g).connect(this.genGain!);
      o.start();
      this.genOscs.push(o);
    });
    const genLfo = this.ctx.createOscillator();
    genLfo.frequency.value = 6.3;
    const genLfoAmt = this.ctx.createGain(); genLfoAmt.gain.value = 0.03;
    genLfo.connect(genLfoAmt).connect(this.genGain.gain);
    genLfo.start();

    // --- radio static: noise -> bandpass ---
    const stSrc = this.ctx.createBufferSource();
    stSrc.buffer = this.noiseBuf; stSrc.loop = true; stSrc.playbackRate.value = 1.4;
    const stBP = this.ctx.createBiquadFilter();
    stBP.type = "bandpass"; stBP.frequency.value = 1100; stBP.Q.value = 0.8;
    this.staticGain = this.ctx.createGain(); this.staticGain.gain.value = 0;
    stSrc.connect(stBP).connect(this.staticGain).connect(this.master);
    stSrc.start();

    // --- fire crackle bus ---
    this.fireGain = this.ctx.createGain(); this.fireGain.gain.value = 0;
    this.fireGain.connect(this.master);
    const fireBed = this.ctx.createBufferSource();
    fireBed.buffer = this.brownBuf; fireBed.loop = true; fireBed.playbackRate.value = 1.6;
    const fireBP = this.ctx.createBiquadFilter();
    fireBP.type = "bandpass"; fireBP.frequency.value = 500; fireBP.Q.value = 0.4;
    const fireBedG = this.ctx.createGain(); fireBedG.gain.value = 0.05;
    fireBed.connect(fireBP).connect(fireBedG).connect(this.fireGain);
    fireBed.start();

    // --- paranoia drone: detuned sub pair ---
    this.droneGain = this.ctx.createGain(); this.droneGain.gain.value = 0;
    this.droneGain.connect(this.master);
    [37, 37.8].forEach((f) => {
      const o = this.ctx!.createOscillator();
      o.type = "sine"; o.frequency.value = f;
      const g = this.ctx!.createGain(); g.gain.value = 0.5;
      o.connect(g).connect(this.droneGain!);
      o.start();
    });
  }

  resume() { this.ctx?.resume(); }
  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v * 0.9, this.ctx.currentTime, 0.1);
  }

  // ---------- continuous params ----------
  setWind(v: number) { this.ramp(this.windGain, v * 0.5); }
  setSea(v: number) { this.ramp(this.seaGain, v * 0.85); }
  setStatic(v: number) { this.ramp(this.staticGain, v * 0.32); }
  setFire(on: boolean) { this.fireOn = on; if (!on) this.ramp(this.fireGain, 0); }
  setGen(level: number) { this.ramp(this.genGain, level * 0.42); }
  setGenRough(rough: boolean) {
    this.genOscs.forEach((o, i) =>
      o.frequency.setTargetAtTime(rough ? [50, 99, 152][i] : [52, 104, 157][i], this.ctx!.currentTime, 0.3));
  }
  setDrone(v: number) { this.ramp(this.droneGain, v * 0.55); }
  setHeart(v: number) { this.heartIntensity = v; }
  setBreath(v: number) { this.breathIntensity = v; }

  private ramp(g: GainNode, target: number) {
    if (!this.ctx) return;
    g.gain.setTargetAtTime(target, this.ctx.currentTime, 0.25);
  }

  /** per-frame scheduling (crackle, heartbeat, breathing) */
  update(dt: number) {
    if (!this.ctx) return;
    if (this.fireOn) {
      this.crackleTimer -= dt;
      if (this.crackleTimer <= 0) {
        this.crackleTimer = 0.06 + Math.random() * 0.3;
        this.noiseBurst(0.03 + Math.random() * 0.05, 1800 + Math.random() * 2400, 0.09, "highpass", this.fireGain);
      }
    }
    if (this.heartIntensity > 0.02) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        const interval = 1.15 - this.heartIntensity * 0.72;
        this.heartTimer = interval;
        this.thump(0.16 * this.heartIntensity + 0.04);
        setTimeout(() => this.thump(0.1 * this.heartIntensity), 160);
      }
    }
    if (this.breathIntensity > 0.05) {
      this.breathTimer -= dt;
      if (this.breathTimer <= 0) {
        this.breathTimer = 2.4 - this.breathIntensity * 1.1;
        this.breathSwell(0.14 * this.breathIntensity);
      }
    }
  }

  // ---------- one-shots ----------
  private env(g: GainNode, t0: number, peak: number, a: number, d: number) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  private noiseBurst(dur: number, freq: number, peak: number, type: BiquadFilterType, dest?: AudioNode) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.008, dur);
    src.connect(f).connect(g).connect(dest ?? this.master);
    src.start(t); src.stop(t + dur + 0.2);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.01, dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.1);
  }

  private thump(vol: number) { this.tone("sine", 58, 34, 0.16, vol); }
  private breathSwell(vol: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = 700; f.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.5);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.3);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + 1.5);
  }

  morseBeep(dur: number, telegraph = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = telegraph ? 700 : 620;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(telegraph ? 0.16 : 0.13, t + 0.008);
    g.gain.setValueAtTime(telegraph ? 0.16 : 0.13, t + Math.max(0.01, dur - 0.012));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.012);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  footstep(surface: Surface, sprint: boolean) {
    const v = sprint ? 0.2 : 0.14;
    switch (surface) {
      case "wood": this.noiseBurst(0.07, 500, v, "lowpass"); this.tone("sine", 150, 90, 0.08, v * 0.6); break;
      case "dirt": this.noiseBurst(0.09, 320, v * 0.8, "lowpass"); break;
      case "stone": this.noiseBurst(0.06, 900, v * 0.9, "bandpass"); this.tone("sine", 200, 120, 0.06, v * 0.4); break;
      case "metal": this.noiseBurst(0.1, 1600, v * 0.8, "highpass"); this.tone("triangle", 420, 300, 0.14, v * 0.35); break;
    }
  }

  uiClick() { this.noiseBurst(0.03, 2400, 0.08, "highpass"); }
  paper() { this.noiseBurst(0.16, 3200, 0.07, "highpass"); this.noiseBurst(0.1, 2100, 0.05, "highpass"); }
  pickup() { this.tone("triangle", 300, 520, 0.12, 0.12); this.noiseBurst(0.04, 2000, 0.05, "highpass"); }
  success() { this.tone("sine", 520, 520, 0.12, 0.14); this.tone("sine", 780, 780, 0.2, 0.14, 0.13); }
  fail() { this.noiseBurst(0.4, 500, 0.24, "bandpass"); this.tone("sawtooth", 140, 70, 0.35, 0.08); }
  keyClack() { this.noiseBurst(0.025, 3200, 0.16, "highpass"); }
  dialTick() { this.noiseBurst(0.015, 4000, 0.05, "highpass"); }
  dig() { this.tone("sine", 120, 60, 0.18, 0.22); this.noiseBurst(0.16, 400, 0.2, "lowpass"); }
  creak() { this.tone("sawtooth", 170 + Math.random() * 60, 60, 0.9, 0.05); }
  thunder() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.brownBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.setValueAtTime(420, t);
    f.frequency.exponentialRampToValueAtTime(50, t + 2.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + 2.6);
  }
  whisper() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true; src.playbackRate.value = 0.5;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass"; f.Q.value = 6;
    f.frequency.setValueAtTime(900, t);
    f.frequency.linearRampToValueAtTime(1800, t + 1);
    f.frequency.linearRampToValueAtTime(600, t + 2.1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + 2.2);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + 2.4);
    this.tone("sine", 220, 196, 2.0, 0.035, 0.2);
  }
  download() { for (let i = 0; i < 6; i++) this.tone("square", 480 + i * 130, 480 + i * 130, 0.07, 0.05, i * 0.11); }
  alarm() {
    for (let i = 0; i < 3; i++) {
      this.tone("square", 880, 880, 0.12, 0.09, i * 0.42);
      this.tone("square", 660, 660, 0.12, 0.09, i * 0.42 + 0.18);
    }
  }
  breathingTower() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.brownBuf; src.loop = true; src.playbackRate.value = 0.35;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 140;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 1.4);
    g.gain.linearRampToValueAtTime(0.0001, t + 3.2);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + 3.4);
    this.creak();
  }
  staticBurst() { this.noiseBurst(0.5, 900, 0.3, "bandpass"); }
  match() { this.noiseBurst(0.08, 3000, 0.12, "highpass"); this.tone("sine", 900, 600, 0.2, 0.04, 0.05); }
  hatchOpen() { this.tone("square", 90, 55, 1.2, 0.14); this.noiseBurst(1.0, 700, 0.12, "bandpass"); }
  heartSpike() { this.thump(0.4); setTimeout(() => this.thump(0.3), 180); }
}
