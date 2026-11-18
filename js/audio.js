'use strict';

/* ============================== 音訊引擎 ============================== */
/*
 * 全程序化合成，沒有任何外部音檔：
 *  - BGM：以步進時序器播放和弦、貝斯、鼓、琶音；節拍由同一個 bpm 驅動，
 *         與遊戲節拍共用，確保「視覺 = 聽覺」。
 *  - SFX：短小合成音效，全部走同一條壓縮器，避免破音。
 */
const Audio2 = {
  ctx: null,
  master: null, musicBus: null, sfxBus: null, comp: null,
  ready: false, muted: false, voices: 0,
  init() {
    if (this.ready) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -18;
      this.comp.knee.value = 20;
      this.comp.ratio.value = 4;
      this.comp.attack.value = 0.004;
      this.comp.release.value = 0.22;
      this.musicBus = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.musicBus.connect(this.comp);
      this.sfxBus.connect(this.comp);
      this.comp.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.ready = true;
      this.applyVolumes();
      return true;
    } catch (e) {
      return false;
    }
  },
  resume() {
    if (!this.ready) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      const p = this.ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
  },
  applyVolumes() {
    if (!this.ready) return;
    const st = Store.data.settings;
    const mv = this.muted ? 0 : st.music;
    const sv = this.muted ? 0 : st.sfx;
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(mv * 0.55, t, 0.05);
    this.sfxBus.gain.cancelScheduledValues(t);
    this.sfxBus.gain.setTargetAtTime(sv * 0.6, t, 0.05);
  },
  now() { return this.ctx ? this.ctx.currentTime : 0; },

  tone(opt) {
    if (!this.ready || this.voices > 52) return;
    const c = this.ctx;
    const t0 = opt.t === undefined ? c.currentTime : opt.t;
    const dur = opt.dur || 0.2;
    const osc = c.createOscillator();
    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(opt.freq || 440, t0);
    if (opt.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opt.to), t0 + dur);
    const g = c.createGain();
    const vol = opt.vol === undefined ? 0.2 : opt.vol;
    const atk = opt.atk === undefined ? 0.005 : opt.atk;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + Math.min(atk, dur * 0.8));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = osc;
    if (opt.filter) {
      const f = c.createBiquadFilter();
      f.type = opt.filter;
      f.frequency.setValueAtTime(opt.fq || 1200, t0);
      if (opt.fqTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, opt.fqTo), t0 + dur);
      f.Q.value = opt.q === undefined ? 1 : opt.q;
      osc.connect(f); node = f;
    }
    node.connect(g);
    g.connect(opt.bus === 'music' ? this.musicBus : this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
    this.voices++;
    osc.onended = () => { this.voices--; try { g.disconnect(); } catch (e) { /* ignore */ } };
  },
  noise(opt) {
    if (!this.ready || this.voices > 52) return;
    const c = this.ctx;
    const t0 = opt.t === undefined ? c.currentTime : opt.t;
    const dur = opt.dur || 0.15;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = opt.filter || 'highpass';
    f.frequency.setValueAtTime(opt.fq || 2000, t0);
    if (opt.fqTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, opt.fqTo), t0 + dur);
    f.Q.value = opt.q === undefined ? 0.8 : opt.q;
    const g = c.createGain();
    const vol = opt.vol === undefined ? 0.15 : opt.vol;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g);
    g.connect(opt.bus === 'music' ? this.musicBus : this.sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
    this.voices++;
    src.onended = () => { this.voices--; try { g.disconnect(); } catch (e) { /* ignore */ } };
  },

  instrument(name, freq, t, dur, vel) {
    const v = Math.max(0.02, vel);
    switch (name) {
      case 'pluck':
        this.tone({ t, freq, dur, type: 'triangle', vol: 0.18 * v, filter: 'lowpass', fq: freq * 6, fqTo: freq * 1.4, bus: 'music' });
        break;
      case 'bell':
        this.tone({ t, freq, dur: dur * 2.2, type: 'sine', vol: 0.16 * v, bus: 'music' });
        this.tone({ t, freq: freq * 2.76, dur: dur * 1.3, type: 'sine', vol: 0.05 * v, bus: 'music' });
        break;
      case 'chip':
        this.tone({ t, freq, dur: Math.min(dur, 0.11), type: 'square', vol: 0.07 * v, bus: 'music' });
        break;
      case 'glass':
        this.tone({ t, freq, dur: dur * 1.6, type: 'sine', vol: 0.13 * v, bus: 'music' });
        this.tone({ t, freq: freq * 3.01, dur: dur * 0.9, type: 'sine', vol: 0.04 * v, bus: 'music' });
        break;
      case 'organ':
        this.tone({ t, freq, dur: dur * 1.5, type: 'sine', vol: 0.09 * v, atk: 0.05, bus: 'music' });
        this.tone({ t, freq: freq * 2, dur: dur * 1.3, type: 'sine', vol: 0.045 * v, atk: 0.05, bus: 'music' });
        break;
      case 'epiano':
        this.tone({ t, freq, dur: dur * 2, type: 'sine', vol: 0.15 * v, bus: 'music' });
        this.tone({ t, freq: freq * 2, dur: dur * 0.7, type: 'triangle', vol: 0.04 * v, bus: 'music' });
        break;
      case 'pad':
        this.tone({ t, freq, dur, type: 'sawtooth', vol: 0.03 * v, atk: dur * 0.3, filter: 'lowpass', fq: 900, q: 2, bus: 'music' });
        this.tone({ t, freq: freq * 1.006, dur, type: 'sawtooth', vol: 0.026 * v, atk: dur * 0.3, filter: 'lowpass', fq: 900, q: 2, bus: 'music' });
        break;
      default:
        this.tone({ t, freq, dur, type: 'triangle', vol: 0.12 * v, bus: 'music' });
    }
  },
  drum(kind, t, vel) {
    const v = vel === undefined ? 1 : vel;
    switch (kind) {
      case 'kick':
        this.tone({ t, freq: 140, to: 42, dur: 0.22, type: 'sine', vol: 0.5 * v, bus: 'music' });
        break;
      case 'snare':
        this.noise({ t, dur: 0.16, filter: 'bandpass', fq: 1900, q: 0.7, vol: 0.2 * v, bus: 'music' });
        this.tone({ t, freq: 190, to: 120, dur: 0.1, type: 'triangle', vol: 0.1 * v, bus: 'music' });
        break;
      case 'hat':
        this.noise({ t, dur: 0.045, filter: 'highpass', fq: 7800, vol: 0.06 * v, bus: 'music' });
        break;
      case 'ohat':
        this.noise({ t, dur: 0.18, filter: 'highpass', fq: 6500, vol: 0.045 * v, bus: 'music' });
        break;
      case 'clap':
        for (let i = 0; i < 3; i++) this.noise({ t: t + i * 0.012, dur: 0.06, filter: 'bandpass', fq: 1400, q: 1.4, vol: 0.09 * v, bus: 'music' });
        break;
      case 'crash':
        this.noise({ t, dur: 0.7, filter: 'highpass', fq: 5000, vol: 0.1 * v, bus: 'music' });
        break;
      default:
        break;
    }
  },

  sfx(name) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'perfect':
        this.tone({ t, freq: 1568, dur: 0.12, type: 'sine', vol: 0.10 });
        this.tone({ t: t + 0.03, freq: 2093, dur: 0.18, type: 'sine', vol: 0.07 });
        break;
      case 'good':
        this.tone({ t, freq: 1046, dur: 0.07, type: 'triangle', vol: 0.08 });
        break;
      case 'pickup':
        this.tone({ t, freq: 880, to: 1760, dur: 0.12, type: 'sine', vol: 0.09 });
        break;
      case 'pib':
        this.tone({ t, freq: 1320, dur: 0.14, type: 'sine', vol: 0.07 });
        this.tone({ t: t + 0.05, freq: 1980, dur: 0.2, type: 'sine', vol: 0.05 });
        break;
      case 'hit':
        this.noise({ t, dur: 0.28, filter: 'lowpass', fq: 1800, vol: 0.28 });
        this.tone({ t, freq: 180, to: 40, dur: 0.3, type: 'sawtooth', vol: 0.16 });
        break;
      case 'dash':
        this.noise({ t, dur: 0.18, filter: 'bandpass', fq: 900, fqTo: 4200, q: 1.2, vol: 0.14 });
        break;
      case 'move':
        this.tone({ t, freq: 620, dur: 0.035, type: 'triangle', vol: 0.03 });
        break;
      case 'combo':
        this.tone({ t, freq: 660, dur: 0.16, type: 'square', vol: 0.04 });
        this.tone({ t: t + 0.05, freq: 880, dur: 0.16, type: 'square', vol: 0.04 });
        this.tone({ t: t + 0.1, freq: 1100, dur: 0.22, type: 'square', vol: 0.04 });
        break;
      case 'level':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone({ t: t + i * 0.07, freq: f, dur: 0.3, type: 'triangle', vol: 0.08 }));
        break;
      case 'shield':
        this.tone({ t, freq: 330, to: 660, dur: 0.35, type: 'sine', vol: 0.14 });
        break;
      case 'warp':
        this.tone({ t, freq: 900, to: 120, dur: 0.6, type: 'sine', vol: 0.12 });
        this.noise({ t, dur: 0.5, filter: 'lowpass', fq: 4000, fqTo: 200, vol: 0.08 });
        break;
      case 'flower':
        [784, 988, 1175, 1568, 1976].forEach((f, i) => this.tone({ t: t + i * 0.05, freq: f, dur: 0.5, type: 'sine', vol: 0.06 }));
        break;
      case 'click':
        this.tone({ t, freq: 880, dur: 0.04, type: 'triangle', vol: 0.05 });
        break;
      case 'back':
        this.tone({ t, freq: 660, to: 440, dur: 0.08, type: 'triangle', vol: 0.045 });
        break;
      case 'count':
        this.tone({ t, freq: 660, dur: 0.12, type: 'sine', vol: 0.1 });
        break;
      case 'go':
        this.tone({ t, freq: 1320, dur: 0.3, type: 'sine', vol: 0.11 });
        this.tone({ t, freq: 660, dur: 0.3, type: 'triangle', vol: 0.08 });
        break;
      case 'fail':
        [440, 370, 311, 220].forEach((f, i) => this.tone({ t: t + i * 0.13, freq: f, dur: 0.35, type: 'triangle', vol: 0.1 }));
        break;
      case 'clear':
        [523, 659, 784, 1046].forEach((f, i) => this.tone({ t: t + i * 0.09, freq: f, dur: 0.5, type: 'triangle', vol: 0.08 }));
        break;
      default:
        break;
    }
  }
};

/* ============================== 背景音樂時序器 ============================== */
const Music = {
  playing: false,
  bpm: 120, step: 0, nextTime: 0, lookahead: 0.18, timer: null,
  world: null, intensity: 0, inst: 'pluck', root: 60, scale: [0, 2, 4, 5, 7, 9, 11],
  prog: [0, 9, 2, 7], seed: 1, bassPattern: [],
  start(world, bpm, intensity) {
    if (!Audio2.ready) { if (!Audio2.init()) return; }
    this.stop();
    const m = world.music || {};
    this.world = world;
    this.bpm = bpm;
    this.root = m.root || 60;
    this.scale = m.scale || this.scale;
    this.prog = PROG[m.prog || 'ionian'] || this.prog;
    this.inst = pick(INSTRUMENTS);
    this.intensity = intensity === undefined ? 0.5 : intensity;
    this.seed = hashStr(world.id + '-' + Math.floor(Math.random() * 999));
    const rng = mulberry32(this.seed);
    this.bassPattern = [];
    for (let i = 0; i < 16; i++) this.bassPattern.push(rng() > 0.25 ? 1 : 0);
    this.step = 0;
    this.playing = true;
    this.failures = 0;
    this.lastError = null;
    Audio2.applyVolumes();
    this.nextTime = Audio2.now() + 0.08;
    this.timer = setInterval(() => this.pump(), 25);
    this.pump();
  },
  stop(fade) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.playing) return;
    this.playing = false;
    if (fade && Audio2.ready) {
      const t = Audio2.now();
      try {
        const g = Audio2.musicBus.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(Math.max(0.0001, g.value), t);
        g.exponentialRampToValueAtTime(0.0001, t + 0.3);
        setTimeout(() => Audio2.applyVolumes(), 380);
      } catch (e) { /* ignore */ }
    }
  },
  setIntensity(v) {
    this.intensity = clamp01(v);
    if (this.playing && Math.abs(this.bpm - 999) > 0) { /* bpm 由遊戲固定，不隨強度改變 */ }
  },
  pump() {
    if (!this.playing || !Audio2.ready) return;
    try {
      const c = Audio2.ctx;
      if (c.state === 'suspended') return;
      let guard = 0;
      while (this.nextTime < c.currentTime + this.lookahead && guard < 64) {
        this.scheduleStep(this.step, this.nextTime);
        this.nextTime += 60 / this.bpm / 2;
        this.step++;
        guard++;
      }
      this.lastError = null;
    } catch (e) {
      /* 音樂壞掉時靜音繼續，不要讓它影響遊戲或每 25ms 洗一次 console */
      this.failures = (this.failures || 0) + 1;
      this.lastError = String((e && e.message) || e);
      if (this.failures > 3) {
        this.stop(false);
        if (typeof console !== 'undefined' && console.warn) console.warn('BGM 已停用：' + this.lastError);
      }
    }
  },
  scheduleStep(s, t) {
    const bar = Math.floor(s / 8) % 8;
    const beat = Math.floor((s % 8) / 2);
    const half = s % 2;
    const ch = this.prog[(Math.floor(s / 8) % (this.prog.length / 2)) * 2];
    const I = this.intensity;
    const root = this.root;
    const sc = this.scale;
    const R = mulberry32((this.seed ^ Math.imul(s + 1, 2654435761)) >>> 0);
    const stepDur = 60 / this.bpm / 2;
    if (I > 0.05) {
      if (half === 0) Audio2.drum('kick', t, 0.75 + I * 0.25);
      else if (bar % 2 === 1 && I > 0.5) Audio2.drum('kick', t, 0.45);
      if (beat === 1 || beat === 3) Audio2.drum(bar % 4 === 3 ? 'clap' : 'snare', t, 0.45 + I * 0.55);
      if (s % 8 === 0 && bar % 4 === 0 && I > 0.45) Audio2.drum('crash', t, 0.6 * I);
    }
    if (I > 0.25) Audio2.drum(half === 0 ? 'hat' : 'ohat', t, 0.45 + 0.55 * I * R());
    else if (s % 2 === 0) Audio2.drum('hat', t, 0.3);
    if (I > 0.12 && (this.bassPattern[s % 16] || beat === 0)) {
      const n = root - 24 + (ch % 12);
      Audio2.tone({ t, freq: midiHz(n), dur: stepDur * 1.6, type: I > 0.6 ? 'sawtooth' : 'triangle', vol: 0.08 + I * 0.07, filter: 'lowpass', fq: 300 + I * 1000, bus: 'music' });
    }
    if (s % 8 === 0) {
      [0, 2, 4].map(i => root + sc[(ch + i * 2) % sc.length] + 12)
        .forEach(n => Audio2.instrument('pad', midiHz(n), t, stepDur * 7.4, 0.45 + I * 0.9));
    }
    if (R() < 0.16 + I * 0.6) {
      /* R 是 mulberry32 產生的函式，不是 Rng 物件：取樣要用 R() 自己算 */
      const DEGREES = [0, 1, 2, 3, 4, 5, 6, 7, 5, 3];
      const deg = DEGREES[Math.floor(R() * DEGREES.length) % DEGREES.length];
      const n = root + 12 + sc[(ch + deg) % sc.length] + (R() < 0.22 ? 12 : 0);
      Audio2.instrument(this.inst, midiHz(n), t, stepDur * (R() < 0.2 ? 2 : 1.2), 0.45 + I * 0.75);
    }
    if (I > 0.55 && R() < 0.1) {
      Audio2.instrument('glass', midiHz(root + 24 + sc[Math.floor(R() * sc.length) % sc.length]), t, stepDur * 3, 0.35);
    }
    if (I > 0.8 && bar % 4 === 3 && half === 1 && R() < 0.5) {
      for (let k = 0; k < 4; k++) {
        Audio2.instrument('bell', midiHz(root + 12 + sc[(k * 2) % sc.length]), t + (k * stepDur) / 4, stepDur / 2, 0.35);
      }
    }
  }
};
