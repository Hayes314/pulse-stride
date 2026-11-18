'use strict';

/* ============================== 畫面 / 尺寸管理 ============================== */
const View = {
  W: 960, H: 600, dpr: 1, cssW: 960, cssH: 600,
  laneW: 0, laneCount: 4,
  pathL: 0, pathR: 0, pathW: 0,
  sh: 600, safe: { t: 0, b: 0, l: 0, r: 0 },
  mobile: false, aspect: 1.6, scale: 1,
  hudPad: 10, fontK: 1, zoneY: 0, zoneH: 10,
  compute() {
    const vw = Math.max(1, window.innerWidth || 960);
    const vh = Math.max(1, window.innerHeight || 600);
    const aspect = vw / vh;
    let refW;
    if (aspect >= 2.0) refW = Math.round(vh * 1.9);
    else if (aspect >= 1.2) refW = Math.round(vh * 1.6);
    else if (aspect >= 0.7) refW = Math.round(vh * 1.15);
    else refW = Math.round(vh * 0.95);
    refW = Math.max(400, refW);
    const refH = Math.round(refW / aspect);
    this.W = refW; this.H = refH;
    this.dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);

    /* ---- 1) UI 縮放基準（rem）：與畫布解耦，確保任何裝置文字都讀得到 ----
       --h 直接以 px 寫入 CSS 變數，不依賴 dvh / min() 的支援度：
       舊版 iPadOS Safari 不認得 dvh，代入 font-size 後會讓整份 rem 尺寸
       退回 16px 基準，畫面就只剩一片黑。                                   */
    const uiH = clamp(Math.min(vh, vw * 1.9), 460, 1000);
    try {
      document.documentElement.style.setProperty('--h', uiH.toFixed(2) + 'px');
    } catch (e) { /* 極端情況下忽略，仍用計算值 */ }
    this.sh = uiH;

    /* ---- 2) 畫布：等比例塞進視窗（scale = 每個參考單位對應幾個 CSS px）---- */
    this.scale = Math.min(vw / refW, vh / refH);
    this.cssW = refW * this.scale;
    this.cssH = refH * this.scale;
    this.aspect = aspect;
    this.mobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    this.laneCount = Store.data && Store.data.settings ? (Store.data.settings.lanes || 4) : 4;
    this.pathW = clamp(refW * 0.42, Math.min(refW * 0.34, refW * 0.86), refW * 0.56);
    this.pathL = refW / 2 - this.pathW / 2;
    this.pathR = refW / 2 + this.pathW / 2;
    this.laneW = this.pathW / this.laneCount;
    this.hudPad = Math.max(8, refH * 0.016);
    this.fontK = refH / 650;
    this.zoneY = refH * 0.855;
    this.zoneH = Math.max(10, refH * 0.045);
  },
  laneCenter(i) { return this.pathL + this.laneW * (i + 0.5); }
};

/* ============================== 節拍圖表生成 ============================== */
/*
 * 節點 n：
 *   t      在節拍時鐘上的時間（秒）
 *   lanes  需要「穿越（對齊）」的車道
 *   hazard 附帶災厄：{ kind, lanes, delay, phantom }
 */
function generateChart(opts) {
  const world = worldById(opts.worldId);
  const diff = clamp(opts.diff | 0, 0, 4);
  const mode = modeById(opts.mode);
  const speed = opts.speed || 1;
  const lanes = opts.lanes || 4;
  const seedStr = opts.seed || (world.id + ':' + mode.id + ':' + diff + ':' + Date.now().toString(36));
  const seed = hashStr(seedStr) >>> 0;
  const rng = new Rng(seed);
  const bpm = Math.round(clamp(world.bmps[diff] * world.bpmMul * speed, 60, 300));
  const beat = 60 / bpm;
  const totalBeats = opts.beats || 40;
  const notes = [];
  let cur = rng.int(1, Math.max(1, lanes - 2));
  const maxMoves = [1, 1, 2, 2, 3][diff];
  const leadIn = 4;
  for (let b = 0; b < totalBeats; b++) {
    const sub = (diff >= 2 && b % 8 === 5 && rng.chance(0.45)) ? 2 : 1;
    for (let s = 0; s < sub; s++) {
      const want = diff >= 3 ? rng.int(1, 3) : diff >= 1 ? rng.int(1, 2) : 1;
      const noteLanes = [];
      for (let k = 0; k < want; k++) {
        noteLanes.push(cur);
        let nl = cur;
        let guard = 0;
        do {
          nl = clamp(cur + rng.int(1, maxMoves) * (rng.chance(0.5) ? 1 : -1), 0, lanes - 1);
          guard++;
        } while (nl === cur && guard < 12);
        cur = nl;
      }
      const t = (leadIn + b) * beat + s * beat * 0.5;
      notes.push({ t, lane: cur, lanes: noteLanes, judged: false, hazard: null });
    }
  }
  /* 開頭給幾拍暖身（第一拍前不生成災厄） */
  const hazardChance = [0.05, 0.18, 0.3, 0.42, 0.56];
  const hz = world.hazards.slice();
  for (let i = 2; i < notes.length - 2; i++) {
    const n = notes[i];
    if (!rng.chance(hazardChance[diff])) continue;
    const kind = hz.length ? rng.pick(hz) : 'wall';
    n.hazard = makeHazard(kind, n, lanes, rng);
  }
  notes.forEach(n => { n.laneEntities = n.lanes.map(lane => ({ lane, x: 0 })); });
  return {
    id: seedStr, seed, worldId: world.id, world, diff, mode: mode.id, bpm, beat, notes, lanes,
    speed, leadIn, len: (leadIn + totalBeats) * beat, hazardTypes: hz
  };
}

function makeHazard(kind, note, lanes, rng) {
  const l = note.lane;
  const other = () => {
    let o = l, guard = 0;
    do { o = rng.int(0, lanes - 1); guard++; } while (o === l && guard < 40);
    return o;
  };
  switch (kind) {
    case 'wall': {
      const blocked = Math.min(lanes - 1, 1 + rng.int(0, Math.floor(lanes / 3)));
      const start = rng.int(0, lanes - blocked);
      const arr = [];
      for (let i = 0; i < blocked; i++) arr.push(start + i);
      if (arr.indexOf(l) < 0) arr[arr.length - 1] = l;
      return { kind, lanes: arr, delay: 0 };
    }
    case 'twin': return { kind, lanes: [l, other()], delay: 0 };
    case 'mirror': return { kind, lanes: [lanes - 1 - l], delay: 0 };
    case 'grav': return { kind, lanes: [other()], delay: 0 };
    case 'magnet': return { kind, lanes: [other()], delay: 0 };
    case 'phantom': return { kind, lanes: [other()], delay: 0, phantom: true };
    case 'reverse': return { kind, lanes: [other()], delay: 0 };
    case 'freeze': return { kind, lanes: [other()], delay: 0.5 };
    case 'lag': return { kind, lanes: [other()], delay: 0.5 };
    case 'nova': return { kind, lanes: [l], delay: 0 };
    case 'bolt': return { kind, lanes: [other()], delay: 0 };
    default: return { kind: 'wall', lanes: [other()], delay: 0 };
  }
}

function countNotes(chart) {
  return chart && chart.notes ? chart.notes.length : 0;
}

function beatsOf(mode, diff) {
  const n = [34, 44, 56, 68, 80][diff] || 44;
  if (mode === 'clip') return 40;
  if (mode === 'survive') return 96;
  if (mode === 'challenge') return 48;
  if (mode === 'zen') return 120;
  return n;
}

/* ============================== 粒子系統 ============================== */
class Particles {
  constructor(max) { this.max = max || 900; this.list = []; }
  clear() { this.list.length = 0; }
  spawn(o) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0,
      life: o.life || 0.6, age: 0, size: o.size || 3,
      color: o.color || '#fff', grav: o.grav === undefined ? 260 : o.grav,
      drag: o.drag === undefined ? 1.6 : o.drag, shape: o.shape || 'dot', rot: 0, spin: o.spin || 0
    });
  }
  burst(x, y, n, color, power, opts) {
    opts = opts || {};
    for (let i = 0; i < n; i++) {
      const a = opts.angle !== undefined ? opts.angle + rand(-(opts.spread || Math.PI), opts.spread || Math.PI) : rand(0, TAU);
      const sp = rand(power * 0.3, power);
      this.spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.3, 0.8) * (opts.life || 1), size: rand(2, 4.5) * (opts.size || 1),
        color: Array.isArray(color) ? pick(color) : color,
        grav: opts.grav === undefined ? 120 : opts.grav, drag: 1.8, shape: opts.shape || 'dot'
      });
    }
  }
  ring(x, y, n, color, power, opts) {
    opts = opts || {};
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rand(-0.1, 0.1);
      const sp = power * rand(0.85, 1.15);
      this.spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.4, 0.9), size: rand(2, 4), color, grav: 0, drag: 2.4, shape: opts.shape || 'dot' });
    }
  }
  update(dt) {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.age += dt;
      if (p.age >= p.life) { l.splice(i, 1); continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy = p.vy * d + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
  }
  draw(ctx) {
    const l = this.list;
    ctx.save();
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      const k = 1 - p.age / p.life;
      ctx.globalAlpha = clamp01(k * 1.4);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 10 * k;
      const s = p.size * (0.4 + k * 0.8);
      if (p.shape === 'square') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-s, -s, s * 2, s * 2);
        ctx.restore();
      } else if (p.shape === 'streak') {
        ctx.strokeStyle = p.color; ctx.lineWidth = s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }
}

/* ============================== 漂浮文字 ============================== */
class FloatTexts {
  constructor(max) { this.max = max || 24; this.list = []; }
  clear() { this.list.length = 0; }
  add(x, y, text, color, size, life) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ x, y, text, color: color || '#fff', size: size || 18, age: 0, life: life || 0.8 });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.age += dt;
      f.y -= 60 * dt * (1 - f.age / f.life);
      if (f.age >= f.life) this.list.splice(i, 1);
    }
  }
  draw(ctx, fontK) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.list) {
      const k = 1 - f.age / f.life;
      ctx.globalAlpha = clamp01(k * 1.6);
      ctx.font = '900 ' + (f.size * fontK * (1 + (1 - k) * 0.15)) + 'px "Trebuchet MS", system-ui, sans-serif';
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color; ctx.shadowBlur = 14;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }
}

/* ============================== 震動 / 閃光 ============================== */
class Shake {
  constructor() { this.amp = 0; this.t = 0; this.x = 0; this.y = 0; }
  add(a) { this.amp = Math.min(26, this.amp + a); }
  update(dt) {
    this.amp *= Math.pow(0.002, dt);
    if (this.amp < 0.05) this.amp = 0;
    this.t += dt * 40;
    this.x = Math.sin(this.t * 1.3) * this.amp * Math.cos(this.t * 0.7);
    this.y = Math.cos(this.t * 1.7) * this.amp * 0.6;
  }
  reset() { this.amp = 0; this.x = 0; this.y = 0; }
}
class Flasher {
  constructor() { this.color = '#fff'; this.a = 0; }
  flash(color, a) { this.color = color; this.a = Math.max(this.a, a); }
  update(dt) { this.a = Math.max(0, this.a - dt * 3.2); }
}

/* ============================== 背景繪製 ============================== */
class Background {
  constructor() {
    this.stars = []; this.nebula = []; this.seed = 1; this.time = 0; this.pal = null;
    this.build();
  }
  build() {
    const r = mulberry32(this.seed);
    this.stars = [];
    for (let i = 0; i < 110; i++) {
      this.stars.push({ x: r(), y: r(), z: 0.2 + r() * 0.8, tw: r() * TAU, sp: 0.5 + r() * 2.5, sz: 0.5 + r() * 1.8 });
    }
    this.nebula = [];
    for (let i = 0; i < 6; i++) {
      this.nebula.push({ x: r(), y: r(), r: 0.15 + r() * 0.32, sp: 0.01 + r() * 0.04, ph: r() * TAU });
    }
  }
  setWorld(world, pal) {
    this.seed = hashStr(world.id);
    this.pal = pal;
    this.build();
  }
  draw(ctx, dt, beatPulse, intensity) {
    const W = View.W, H = View.H, p = this.pal;
    if (!p || !ctx) return;
    this.time += dt;
    const t = this.time;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mixHex(p.bg2, p.bg, 0.15));
    g.addColorStop(0.55, p.bg);
    g.addColorStop(1, darken(p.bg, 0.5));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const nb of this.nebula) {
      const cx = (nb.x + Math.sin(t * nb.sp * 2 + nb.ph) * 0.06) * W;
      const cy = (nb.y + Math.cos(t * nb.sp * 1.6 + nb.ph) * 0.05) * H;
      const rad = nb.r * Math.max(W, H) * (0.7 + beatPulse * 0.12);
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      rg.addColorStop(0, rgba(p.a, 0.09 + intensity * 0.06));
      rg.addColorStop(0.5, rgba(p.b, 0.045 + intensity * 0.03));
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
    ctx.restore();
    ctx.save();
    for (const s of this.stars) {
      const tw = 0.55 + 0.45 * Math.sin(t * s.sp * 3 + s.tw);
      ctx.globalAlpha = 0.2 + tw * 0.6 * s.z;
      ctx.fillStyle = s.z > 0.75 ? p.a : '#ffffff';
      const x = ((s.x + t * 0.004 * s.z) % 1) * W;
      ctx.fillRect(x, s.y * H, s.sz * s.z * 1.6, s.sz * s.z * 1.6);
    }
    ctx.restore();
  }
}

/* ============================== 遊戲核心 ============================== */
class Game {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.particles = new Particles(1000);
    this.floaters = new FloatTexts(26);
    this.shake = new Shake();
    this.flasher = new Flasher();
    this.bg = new Background();
    this.state = 'idle';
    this.running = false;
    this.lastTs = 0;
    this.rafId = 0;
    this.pal = buildPalette(THEMES[0]);
    this.bg.setWorld(WORLDS[0], this.pal);
    this.result = null;
    this.player = null;
    this.chart = null;
    this.state = 'idle';
    /* 待機（選單背景）就會進 render/update，所有數值狀態必須先有初值；
       否則 beatPulse 之類的 undefined 會變成 NaN 傳進 canvas API，
       WebKit 會直接丟 "The provided value is non-finite"。 */
    this.score = 0;
    this.displayScore = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.mult = 1;
    this.phaseEnergy = 100;
    this.maxPhase = 100;
    this.flow = 100;
    this.maxFlow = 100;
    this.beatPulse = 0;
    this.hitFlash = 0;
    this.slowMoLeft = 0;
    this.slowMo = 0.35;
    this.scrollMult = 1;
    this.elapsed = 0;
    this.bpmTime = 0;
    this.stage = 0;
    this.lives = 3;
    this.hazards = [];
    this.orbs = [];
    this.lastPlanned = null;
    this.nextScan = 0;
    this.nextIndex = 0;
    this.waves = [];
    this.idleT = 0;
  }
  attach(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.resize();
  }
  resize() {
    View.compute();
    if (!this.canvas || !this.ctx) return;
    const dpr = View.dpr;
    this.canvas.width = Math.max(1, Math.round(View.W * dpr));
    this.canvas.height = Math.max(1, Math.round(View.H * dpr));
    this.canvas.style.width = View.cssW + 'px';
    this.canvas.style.height = View.cssH + 'px';
  }

  setTheme(theme) {
    this.pal = buildPalette(theme);
    this.bg.pal = this.pal;
    if (this.player) this.player.color = this.pal.player;
  }

  /* --- 開始一場遊戲 --- */
  start(opts) {
    const world = worldById(opts.worldId);
    const mode = modeById(opts.mode);
    const lanes = Store.data.settings.lanes || 4;
    View.laneCount = lanes;
    View.laneW = View.pathW / lanes;
    this.resize();
    const speed = mode.fixedSpeed || mode.zen ? 1 : (opts.speed || Store.data.settings.scroll || 1);
    this.world = world;
    this.mode = mode;
    this.diff = clamp(opts.diff | 0, 0, 4);
    this.chart = generateChart({
      worldId: world.id, diff: this.diff, mode: mode.id, speed, lanes,
      seed: opts.seed, beats: beatsOf(mode.id, this.diff)
    });
    this.chart.bpm0 = this.chart.bpm;
    this.rng = new Rng(this.chart.seed ^ 0x5bd1e995);
    const generatedNotes = this.chart.notes.slice();
    this.chart.genNotes = generatedNotes;
    this.chart.segments = [];
    this.lastPlanLane = undefined;
    this.lastPlanHazard = undefined;
    this.curDensity = 'standard';
    this.setTheme(App.theme);
    this.bg.setWorld(world, this.pal);
    this.planChart();
    this.resetState();
    this.speed = speed;
    /* 保險：規劃異常（空譜面或起始拍偏移）時以原始草圖重新規劃一次 */
    if (countNotes(this.chart) < 1 || this.chart.notes[0].t > (this.chart.leadIn + 0.01) * this.chart.beat) {
      this.lastPlanLane = undefined; this.lastPlanHazard = undefined;
      this.chart.notes = generatedNotes.slice();
      this.chart.segments = [];
      this.planChart();
      this.extEndT = this.chart.len;
    }
    this.state = 'ready';
    this.countdown = 3.2;
    this.cdShown = -1;
    this.running = true;
    this.lastTs = now();
    if (!this.rafId) this.loop();
    this.showCountdown();
    Audio2.resume();
    if (Audio2.ready) {
      Music.start(world, this.chart.bpm, 0.3);
      Music.setIntensity(0.3);
    }
  }

  resetState() {
    const mid = Math.floor(View.laneCount / 2);
    this.player = {
      lane: mid, x: View.laneCenter(mid),
      dash: 0, dashCd: 0, invuln: 1.2, shield: hasSkill('shield') ? 1 : 0, warpRank: 0, visualOffset: 0,
      color: this.pal.player, trail: []
    };
    this.score = 0; this.displayScore = 0;
    this.combo = 0; this.maxCombo = 0; this.mult = 1;
    this.phaseEnergy = 100; this.maxPhase = 100;
    this.flow = 100; this.maxFlow = 100;
    this.lives = 3;
    this.perfect = 0; this.good = 0; this.miss = 0; this.clean = true;
    this.dashes = 0; this.dashClears = 0; this.flowers = 0; this.shieldSaves = 0; this.warps = 0;
    this.pendingBreak = false;
    this.waves = [];
    this.lastPlanned = null;
    this.nextScan = 0;
    this.speedDirty = false;
    this.lastBpmTime = 0;
    this.extCount = 0;
    this.extEndT = this.chart.len;
    this.curDensity = 'standard';
    this.notesHit = 0; this.totalJudged = 0; this.dodges = 0;
    this.coins = 0; this.pibs = 0;
    this.nextIndex = 0;
    this.hazards = []; this.orbs = [];
    this.beatPulse = 0;
    this.hitFlash = 0;
    this.elapsed = 0;
    this.bpmTime = 0;
    this.scrollMult = 1;
    this.slowMoLeft = 0;
    this.slowMo = 0.35;
    this.stage = 0;
    this.hazardSeen = {};
    this.particles.clear();
    this.floaters.clear();
    this.shake.reset();
    this.flasher.a = 0;
    this.hudCache = {};
    this.pibSpawned = false;
    this.lastBi = -1;
    this.idleT = this.idleT || 0;
  }

  showCountdown() {
    const cd = $('countdown');
    if (cd) cd.classList.add('show');
    this.cdShown = -1;
  }

  end(cleared, reason) {
    if (this.state === 'over') return;
    this.state = 'over';
    this.running = false;
    Music.stop(true);
    Audio2.sfx(cleared ? 'clear' : 'fail');
    this.result = this.buildResult(cleared, reason);
    App.showResult(this.result);
  }
  abort() {
    this.running = false;
    this.state = 'idle';
    this.player = null;
    Music.stop(true);
  }

  buildResult(cleared, reason) {
    const sync = this.totalJudged > 0 ? (this.perfect + this.good * 0.55) / this.totalJudged : 0;
    const r = {
      mode: this.mode.id, modeName: this.mode.name, diff: this.diff, modeId: this.mode.id, difficult: this.diff,
      worldId: this.world.id, worldName: this.world.name,
      score: Math.round(this.score), maxCombo: this.maxCombo, perfect: this.perfect, good: this.good, miss: this.miss,
      sync, time: this.elapsed, cleared: !!cleared, reason: reason || '', clean: this.clean,
      dashes: this.dashClears, flowers: this.flowers, pibs: this.pibs, coins: this.coins,
      notes: this.notesHit, phase: Math.round(this.phaseEnergy), lives: this.lives,
      seed: this.chart.id, bpm: this.chart.bpm, shieldSaves: this.shieldSaves
    };
    r.grade = computeGrade(r);
    r.xp = computeXp(r);
    return r;
  }

  /* --- 主迴圈 --- */
  loop() {
    this.rafId = requestAnimationFrame(() => this.loop());
    const t = now();
    let dt = (t - this.lastTs) / 1000;
    this.lastTs = t;
    if (!isFinite(dt) || dt < 0) dt = 0.016;
    dt = Math.min(dt, 0.05);
    this.update(dt);
    this.render(dt);
  }

  noteY(t) {
    const k = 1 - (t - this.bpmTime);
    const yTop = -View.H * 0.1;
    return yTop + k * (View.zoneY - yTop);
  }

  update(dtReal) {
    this.beatPulse = Math.max(0, this.beatPulse - dtReal * 3.2);
    this.shake.update(dtReal);
    this.flasher.update(dtReal);
    this.particles.update(dtReal);
    this.floaters.update(dtReal);
    if (this.state === 'paused') return;
    if (this.state === 'ready') {
      this.countdown -= dtReal;
      this.player.x = lerp(this.player.x, View.laneCenter(this.player.lane), Math.min(1, dtReal * 14));
      this.updateCountdownUI();
      this.bg.time += dtReal;
      if (this.countdown <= 0) {
        this.state = 'play';
        this.lastTs = now();
        const cd = $('countdown');
        if (cd) cd.classList.remove('show');
      }
      return;
    }
    if (this.state !== 'play') return;

    /* 慢動作（時空摺疊） */
    let dt = dtReal;
    if (this.slowMoLeft > 0) {
      this.slowMoLeft -= dtReal;
      this.scrollMult = lerp(this.scrollMult, this.slowMo, Math.min(1, dtReal * 10));
      dt = dtReal * this.slowMo;
    } else {
      this.scrollMult = lerp(this.scrollMult, 1, Math.min(1, dtReal * 5));
    }
    this.elapsed += dtReal;
    this.lastBpmTime = this.bpmTime;
    this.bpmTime += dt;
    /* 無盡 / 禪模式：樂譜持續延伸、流速隨時間攀升 */
    if (this.mode.id === 'endless' || this.mode.id === 'zen') this.extendChart();
    this.stage = this.mode.time ? Math.floor((1 - this.timeLeftSafe()) * 4) : Math.floor(this.notesHit / Math.max(1, this.chart.notes.length / 4));
    this.stage = clamp(this.stage, 0, 3);
    Music.setIntensity(0.3 + clamp01(this.combo / 70) * 0.5 + this.stage * 0.04);

    this.spawnUpcoming();
    this.updatePlayer(dt);
    this.resolveBeatAction();
    this.judgeHazards();
    if (this.player && this.player.dash > 0) this.resolveHazards(this.player);
    this.updateOrbs();
    this.updateEnergy(dtReal);
    this.updateMusicTiming();
    this.updateWaves(dtReal);
    this.updateHud();
    this.checkEnd();
  }

  extendChart() {
    const beat = this.chart.beat;
    if (this.extEndT - this.bpmTime > beat * 30) return;
    this.extCount = (this.extCount || 0) + 1;
    /* 每 2 個延伸段換一次密度，避免長時間單調 */
    if (this.extCount % 2 === 1) {
      const r = this.rng.next();
      this.curDensity = r < 0.2 ? 'calm' : r < 0.72 ? 'standard' : 'dense';
    }
    const startBeat = Math.round(this.extEndT / beat);
    const sketch = [];
    const cur = this.curDensity || 'standard';
    for (let i = 0; i < 32; i++) {
      sketch.push({ localBeat: i, t: 0, lane: 0, lanes: [0], judged: false, hazard: null, laneEntities: [{ lane: 0, x: 0 }] });
      if (cur === 'dense' && i % 8 === 3) {
        sketch.push({ localBeat: i + 0.5, t: 0, lane: 0, lanes: [0], judged: false, hazard: null, laneEntities: [{ lane: 0, x: 0 }], ghost: true });
      }
    }
    /* calm：改為隔拍出聲（把奇數拍的音符換成休止） */
    let filtered = sketch;
    if (cur === 'calm') {
      filtered = [];
      sketch.forEach((n, i) => { if (i % 2 === 0) filtered.push(n); });
      filtered.forEach((n, i) => { n.localBeat = i; });
      const lastLocal = filtered.length;
      /* 時間以「1 拍間隔」排列：把拍序列攤成偶數拍 */
      filtered.forEach(n => { n.localBeat = n.localBeat; });
      /* 重新以每拍 2 拍 1 音的方式計算時間 */
      filtered.forEach((n, i) => { n.localBeat = n.localBeat; });
    }
    const planned = this.planChunk(filtered, startBeat);
    this.chart.notes.push(...planned);
    this.extEndT = planned[planned.length - 1].t + beat;
    this.chart.len = this.extEndT;
    if (this.mode.id === 'endless') {
      const target = Math.min(235, Math.round(this.chart.bpm0 * (1 + this.extCount * 0.03)));
      if (target > this.chart.bpm) {
        this.chart.bpm = target;
        this.chart.beat = 60 / this.chart.bpm;
        if (Music.playing) Music.bpm = target;
      }
      this.speed = Math.min(1.22, 1 + this.extCount * 0.02);
    }
  }

  timeLeftSafe() {
    if (!this.mode.time) return 0;
    return Math.max(0, this.mode.time - this.elapsed);
  }

  updateCountdownUI() {
    const val = clamp(Math.ceil(this.countdown - 0.2), 0, 3);
    if (val === this.cdShown) return;
    this.cdShown = val;
    const cd = $('cd-num');
    const sub = $('cd-sub');
    if (cd) {
      cd.textContent = val > 0 ? String(val) : 'GO';
      cd.style.animation = 'none';
      void cd.offsetWidth;
      cd.style.animation = '';
    }
    if (sub) sub.textContent = this.mode.zen ? '禅模式 · 沒有失敗' : (val > 0 ? 'READY' : 'START');
    Audio2.sfx(val > 0 ? 'count' : 'go');
  }

  spawnUpcoming() {
    const notes = this.chart.notes;
    const PREP = 1.25;
    while (this.nextIndex < notes.length && this.bpmTime >= notes[this.nextIndex].t - PREP) {
      const n = notes[this.nextIndex];
      n.judged = false;
      n.laneEntities.forEach(e => { e.x = View.laneCenter(e.lane); });
      if (n.hazard) {
        this.hazardSeen[n.hazard.kind] = true;
        this.hazards.push({
          kind: n.hazard.kind, t: n.t + (n.hazard.delay || 0) * this.chart.beat,
          laneList: n.hazard.lanes.slice(), phantom: !!n.hazard.phantom,
          dead: false, passed: false, y: -100, id: n.t
        });
      }
      /* 隨機潮流水晶 */
      if (this.rngByte(n.t * 1000) < 0.10) {
        this.orbs.push({ kind: 'coin', lane: this.chart.lanes === 3 ? 1 : Math.floor(this.chart.lanes / 2), t: n.t + this.chart.beat * 0.5, dead: false });
      }
      /* 世界碎片：每首 1 個，且只在冒險/生存/挑戰模式 */
      if ((this.mode.id === 'adventure' || this.mode.id === 'survive' || this.mode.id === 'challenge') && !this.pibSpawned && notes.length > 20 && this.nextIndex > notes.length / 2) {
        this.pibSpawned = true;
        this.pibs = 1;
        this.orbs.push({ kind: 'pib', lane: this.diff >= 3 ? 0 : Math.floor(this.chart.lanes / 2), t: n.t + this.chart.beat, dead: false });
      }
      this.nextIndex++;
    }
  }

  rngByte(x) {
    const v = Math.sin(x * 12.9898) * 43758.5453;
    return v - Math.floor(v);
  }

  updatePlayer(dt) {
    const p = this.player;
    if (!p) return;
    if (p.dash > 0) p.dash -= dt;
    if (p.dashCd > 0) p.dashCd -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    const diffX = Math.abs(View.laneCenter(p.lane) - p.x);
    p.visualOffset = Math.sin(clamp01(1 - diffX / (View.laneW * 1.1)) * Math.PI) * View.H * 0.075;
    const target = View.laneCenter(p.lane);
    /* 移動速度隨 BPM 提升，否則高 BPM 下永遠來不及到位 */
    const speedK = clamp(0.5 / Math.max(0.12, this.chart.beat), 0.85, 1.9);
    p.x = lerp(p.x, target, clamp01(1 - Math.pow(0.00002, dt * speedK)));
    if (Math.abs(p.x - target) < 0.3) p.x = target;
    p.trail.push({ x: p.x, y: View.zoneY - (p.visualOffset || 0), a: 1 });
    if (p.trail.length > 12) p.trail.shift();
    for (const tr of p.trail) tr.a *= Math.pow(0.002, dt);
    if (Store.data.settings.motionFx && Store.data.settings.particles !== 'off' && this.fps > 40) {
      const n = Store.data.settings.particles === 'low' ? (this.fps > 55 ? 1 : 0) : 2;
      for (let i = 0; i < n; i++) {
        this.particles.spawn({
          x: p.x + rand(-7, 7), y: View.zoneY - (p.visualOffset || 0) + rand(-3, 3), vx: rand(-30, 30), vy: rand(40, 140),
          life: rand(0.25, 0.5), size: rand(1.6, 3.2), color: this.pal.player, grav: 80, drag: 1.2
        });
      }
    }
  }

  judgeHazards() {
    const zy = View.zoneY;
    if (this.speedDirty) {
      /* 流速改變後重排尚未登場的障礙物 */
      this.speedDirty = false;
      for (const h of this.hazards) if (!h.resolved && !h.phantom && h.y < -View.H * 0.15) { h.t = this.bpmTime + h.t - this.lastBpmTime; }
    }
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.y = this.noteY(h.t);
      if (h.y > View.H + 60) { this.hazards.splice(i, 1); continue; }
      if (!h.passed && h.y >= zy + View.zoneH * 0.9) h.passed = true;
      /* 撞擊以「節拍時間」判定，避免掉幀造成判定漂移 */
      if (!h.resolved && !h.phantom && this.player && h.laneList.indexOf(this.player.lane) >= 0 && this.bpmTime >= h.t + 0.42) {
        if (this.player.dash > 0) { h.resolved = true; this.onDashClear(h); }
        else { h.resolved = true; this.onHit(h, true); }
      }
    }
  }

  /**
   * 為一批「從 0 開始編拍的草圖」指派建議車道與災厄，接著平移成指定的起拍時間。
   * 車道設計維持「每一拍都值得動」的節奏感：大多一步到位、偶爾需要橫越。
   */
  planChunk(sketch, startBeat) {
    const beat = this.chart.beat;
    const lanes = this.chart.lanes;
    const rng = this.rng;
    const world = this.world;
    const hzPool = world.hazards && world.hazards.length ? world.hazards : ['wall'];
    const hzChance = [0.12, 0.26, 0.36, 0.48, 0.62][this.diff];
    let lane = this.lastPlanLane === undefined ? Math.floor(lanes / 2) : this.lastPlanLane;
    let lastHazardBeat = this.lastPlanHazard === undefined ? -99 : this.lastPlanHazard;
    const segs = this.chart.segments;
    const out = [];
    for (let i = 0; i < sketch.length; i++) {
      const n = sketch[i];
      const b = startBeat + n.localBeat;
      let best = lane, bestScore = -1e9;
      for (let l = 0; l < lanes; l++) {
        const dist = Math.abs(l - lane);
        let sc = dist * 0.65 + rng.next() * 0.7;
        if (dist === 0) sc -= 0.85;
        if (dist > 2) sc -= 0.5;
        if (sc > bestScore) { bestScore = sc; best = l; }
      }
      lane = best;
      const t = b * beat;
      n.t = t;
      n.lane = lane;
      n.lanes = [lane];
      n.judged = false;
      n.laneEntities = [{ lane, x: 0 }];
      n.hazard = null;
      if (b - lastHazardBeat > 1.5 && rng.next() < hzChance) {
        const kind = rng.pick(hzPool);
        const hz = makeHazard(kind, n, lanes, rng);
        const dashFriendly = (kind === 'wall' || kind === 'orbs' || kind === 'bolt' || kind === 'lag');
        if (hz.lanes.indexOf(lane) < 0 || (dashFriendly && rng.next() < 0.4)) {
          n.hazard = hz;
          lastHazardBeat = b;
        }
      }
      if (segs) segs.push({ b, t, lane });
      out.push(n);
    }
    this.lastPlanLane = lane;
    this.lastPlanHazard = lastHazardBeat;
    return out;
  }

  /** 全新圖表：預先規劃每一拍的建議車道與災厄安排，確保節奏流暢且永遠有解 */
  planChart() {
    const notes = this.chart.notes;
    const beat = this.chart.beat;
    const lanes = this.chart.lanes;
    const rng = this.rng;
    const world = this.world;
    const hzPool = world.hazards && world.hazards.length ? world.hazards : ['wall'];
    const hzChance = [0.1, 0.24, 0.34, 0.46, 0.6][this.diff] * (this.mode.modeScore > 1.2 ? 1.1 : 1);
    let lane = Math.floor(lanes / 2);
    const segs = [];
    let lastHazardBeat = -99;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const b = n.t / beat;
      /* 決策點：距離上一拍多久 */
      const prev = segs[segs.length - 1];
      const gap = prev ? b - prev.b : 99;
      /* 傾向產生移動，但距離太近的節拍保持不動 */
      if (gap > 0.45) {
        let best = lane, bestScore = -1e9;
        for (let l = 0; l < lanes; l++) {
          const dist = Math.abs(l - lane);
          let sc = dist * 0.6 + rng.next() * 0.8;
          if (dist === 0) sc -= 0.7;
          if (dist > 2) sc -= 0.6;
          if (l === 0 || l === lanes - 1) sc += 0.1;
          if (sc > bestScore) { bestScore = sc; best = l; }
        }
        lane = best;
      }
      n.lane = lane;
      n.lanes = [lane];
      n.laneEntities = [{ lane, x: 0 }];
      /* 災厄：允許衝刺穿越成排障礙，確保在節拍前有反應時間 */
      n.hazard = null;
      if (i > 2 && b - lastHazardBeat > 1.5 && rng.next() < hzChance) {
        const kind = rng.pick(hzPool);
        const hz = makeHazard(kind, n, lanes, rng);
        const crosses = hz.lanes.indexOf(lane) >= 0;
        const dashFriendly = (kind === 'wall' || kind === 'orbs' || kind === 'bolt' || kind === 'lag');
        if (!crosses || (dashFriendly && rng.next() < 0.4)) {
          n.hazard = hz;
          lastHazardBeat = b;
        }
      }
      segs.push({ b, t: n.t, lane });
    }
    this.chart.segments = segs;
    return segs;
  }

  updateOrbs() {
    const p = this.player;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      const y = this.noteY(o.t);
      if (p && !o.collected && Math.abs(o.lane - p.lane) === 0 && y >= View.zoneY - View.zoneH * 0.5) {
        o.collected = true;
        this.collectOrb(o);
      }
      if (y > View.H + 40 || o.collected) this.orbs.splice(i, 1);
    }
  }

  collectOrb(o) {
    const cx = View.laneCenter(o.lane);
    if (o.kind === 'pib') {
      this.pibs = Math.min(1, this.pibs || 0);
      this.score += 500 * this.mult;
      Audio2.sfx('pib');
      this.hint('★ 拾獲世界碎片', 'perfect', 1);
      this.particles.burst(cx, View.zoneY, 30, [this.pal.b, '#ffffff', this.pal.gold], 400, { grav: 0, shape: 'square' });
      this.flash(this.pal.b, 0.2);
      this.floaters.add(cx, View.zoneY - View.H * 0.08, '世界碎片', this.pal.b, View.H * 0.03);
      return;
    }
    this.coins++;
    this.score += 80 * this.mult;
    this.phaseEnergy = Math.min(this.maxPhase, this.phaseEnergy + 2);
    this.flow = Math.min(this.maxFlow, this.flow + 4);
    Audio2.sfx('pickup');
    this.particles.ring(cx, View.zoneY, 12, this.pal.gold, 220, {});
    this.floaters.add(cx, View.zoneY - View.H * 0.04, '+' + Math.round(80 * this.mult), this.pal.gold, View.H * 0.02, 0.6);
  }

  updateEnergy(dt) {
    this.displayScore = lerp(this.displayScore, this.score, Math.min(1, dt * 12));
    let drain = 1.1 + this.stage * 0.6 + clamp01(this.combo / 100) * 2.4;
    if (this.mode.zen) drain = 0;
    this.phaseEnergy = Math.max(0, this.phaseEnergy - dt * drain);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
  }

  /* 由遊戲節拍驅動 BGM 的「強度」，也驅動視覺脈衝 */
  updateMusicTiming() {
    const bi = Math.floor(this.bpmTime);
    if (bi !== this.lastBi) {
      this.lastBi = bi;
      this.beatPulse = 1;
    }
  }

  checkEnd() {
    if (this.mode.time && this.elapsed >= this.mode.time) { this.end(true, '時間到'); return; }
    if (this.mode.zen) return;
    if (this.mode.id === 'survive' && this.lives <= 0) { this.end(false, '生命耗盡'); return; }
    if (this.phaseEnergy <= 0) { this.end(false, '相位耗盡'); return; }
    const last = this.chart.notes[this.chart.notes.length - 1];
    if (this.nextIndex >= this.chart.notes.length && last && this.bpmTime > last.t + 1.4) this.end(true, '完成');
  }

  /* --- 衝擊波環（Combo 里程碑、衝刺、撞擊） --- */
  addWave(x, y, color, maxR, life) {
    if (!Store.data.settings.motionFx) return;
    if (!this.waves) this.waves = [];
    if (this.waves.length > 10) this.waves.shift();
    this.waves.push({ x, y, color, maxR: maxR || View.laneW * 2.4, age: 0, life: life || 0.55 });
  }
  updateWaves(dt) {
    if (!this.waves) return;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.age += dt;
      if (w.age >= w.life) this.waves.splice(i, 1);
    }
  }
  drawShockwaves(ctx) {
    if (!this.waves) return;
    for (const w of this.waves) {
      const k = clamp01(w.age / w.life);
      const r = w.maxR * easeOutCubic(k);
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = Math.max(1.5, (1 - k) * View.H * 0.006);
      ctx.shadowColor = w.color; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.ellipse(w.x, w.y, r, r * 0.45, 0, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  /* --- 判定事件 --- */
  judgeNote(n, perfect, silent) {
    if (!n || n.judged) return;
    n.judged = true;
    const p = this.player;
    perfect = !!perfect;
    if (perfect) this.perfect++; else this.good++;
    this.notesHit++;
    this.totalJudged++;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.mult = Math.min(10, 1 + Math.min(8, this.combo / 25) + (perfect ? 0.15 : 0) + (hasSkill('magnet') ? 0.3 : 0));
    this.score += (perfect ? 140 : 80) * this.mult * DIFFS[this.diff].mult;
    this.phaseEnergy = Math.min(this.maxPhase, this.phaseEnergy + (perfect ? 5 : 3.5));
    if (hasSkill('shield') && p.shield < 1 && this.combo % 15 === 0) {
      p.shield = 1;
      this.hint('相位護盾回復', 'perfect', 0.8);
      this.particles.ring(p.x, View.zoneY, 18, this.pal.a, 260, {});
    }
    this.flow = Math.min(this.maxFlow, this.flow + 6);
    if (!silent) {
      const col = perfect ? this.pal.gold : this.pal.a;
      const x = View.laneCenter(n.lane);
      this.particles.ring(x, View.zoneY, perfect ? 18 : 10, col, perfect ? 300 : 200, {});
      this.addWave(x, View.zoneY, col, View.laneW * (perfect ? 2.6 : 1.8), perfect ? 0.55 : 0.4);
      this.particles.burst(x, View.zoneY, perfect ? 10 : 6, [col, '#ffffff'], perfect ? 260 : 180, { shape: 'streak', grav: 0, drag: 3 });
      if (Store.data.settings.hint && this.perfect + this.good < 30) this.hint(perfect ? '✦ 完美穿越' : '穿越', perfect ? 'perfect' : '', 0.6);
      Audio2.sfx(perfect ? 'perfect' : 'good');
    }
    if (perfect) {
      if (Store.data.settings.screenShake) this.shake.add(1.2);
      if (hasSkill('warp')) {
        p.warpRank++;
        if (p.warpRank >= 2) { p.warpRank = 0; this.triggerWarp(); }
      }
    }
    this.checkComboMilestone();
  }

  /* 是否存在尚未結算、且落在預定視窗內的流星 */
  isPlanned(n) {
    const lp = this.lastPlanned;
    return !!(lp && !lp.done && Math.abs(n.t - lp.t) < 1e-3);
  }

  /**
   * 節拍動作模型（音遊的核心）
   * ------------------------------------------------------------------
   * 每一拍都有一粒「節拍流星」與一個預先寫好的建議車道：
   *   1. 在流星到達前的任何時刻移動，就等於「預告」你會在該車道上穿越。
   *   2. 對齊後抵達判定線即「穿越」；若仍差一步，流星通過後 0.42 秒內補位仍可救回（Combo +1）。
   *   3. 停留原地不動 → 迴避（Combo 保持、小幅加分，但拿不到 Combo）。
   *   4. 移動後沒到對的位置 → 漏接（Combo 歸零）。
   *   5. 撞上障礙物 → Combo 歸零（護盾可擋一次）。
   *   6. BPM ≥ 150 時自動接到下一粒流星，高速段不必每拍重按。
   * 這種設計讓「每一拍都要動」成為本能，節奏越快越想再來一次。
   */
  resolveBeatAction() {
    if (!this.player) return;
    const notes = this.chart.notes;
    const beat = this.chart.beat;
    /* 結算完成後立即挑選下一顆：節拍再快也不漏接 */
    while (this.lastPlanned && this.lastPlanned.done) this.lastPlanned = null;
    if (!this.lastPlanned) {
      while (this.nextScan < notes.length && notes[this.nextScan].judged) this.nextScan++;
      let next = null;
      for (let i = this.nextScan; i < notes.length; i++) {
        if (!notes[i].judged) { next = notes[i]; break; }
      }
      if (!next) return;
      this.lastPlanned = { t: next.t, note: next, done: false, lane: this.player.lane, moved: false, stand: true };
    }
    const lp = this.lastPlanned;
    if (lp.done) return;
    const p = this.player;
    const settleTol = View.laneW * clamp(0.3 * (0.5 / Math.max(0.12, beat)), 0.3, 0.5);
    const settled = Math.abs(View.laneCenter(p.lane) - p.x) < settleTol;
    /* 1) 即時穿越：移動後已對齊，且接近或已通過流星 */
    if (!this.pendingBreak && !lp.note.judged && lp.moved && settled && p.lane === lp.lane && this.bpmTime >= lp.t - Math.max(0.08, beat * 0.2)) {
      this.judgeNote(lp.note, Math.abs(this.bpmTime - lp.t) < Math.max(0.11, beat * 0.3), false);
      lp.done = true;
    }
    /* 高速段（BPM ≥ 150）自動接到下一粒流星：保持節奏連續，玩家只需專注一根手指的方向 */
    if (this.chart.bpm >= 150 && !lp.done && !lp.stand) {
      const nextIdx = this.nextScan;
      const nn = notes[nextIdx];
      if (nn && nn !== lp.note && nn.t - this.bpmTime < Math.max(0.1, beat * 0.25) && !nn.judged && this.bpmTime >= lp.t - 0.03) {
        const prevNote = lp.note;
        const doneIdx = this.chart.notes.indexOf(prevNote);
        if (doneIdx >= 0 && doneIdx + 1 === nextIdx) {
          lp.note = nn;
          lp.t = nn.t;
          lp.lane = this.player.lane;
          lp.moved = true;
          lp.stand = false;
          lp.done = false;
        }
      }
    }
    /* 2) 結算時間到達 */
    if (!lp.done && this.bpmTime >= lp.t + 0.42) {
      if (!this.pendingBreak && settled && lp.lane === p.lane && !lp.note.judged) {
        this.judgeNote(lp.note, this.bpmTime - lp.note.t < Math.max(0.1, beat * 0.3), false);
      } else if (!lp.note.judged) {
        if (lp.stand) this.dodgeNote(lp.note); else this.missNote(lp.note);
      }
      lp.done = true;
    }
    if (lp.done && this.pendingBreak) { this.pendingBreak = false; this.breakCombo(); }
  }

  /**
   * 玩家移動時呼叫：把「下一個未結算的流星」指派給新車道。
   * 同一粒流星若被第二次移動指向另一個車道，則補發一粒「半拍幽靈星」，
   * 讓每一下輸入都對應一顆流星 —— 節拍越密，操作越爽快。
   */
  planMove(lane) {
    if (this.state !== 'play') return;
    const lp = this.lastPlanned;
    if (!lp || lp.done) return;
    /* 第二次改道：為同一下輸入補發一粒半拍幽靈星，讓動作不落空 */
    if (lp.moved && lp.lane !== lane) {
      const ghostT = Math.min(lp.t + this.chart.beat * 0.5, lp.t + 0.32);
      if (ghostT > lp.t + 0.12 && ghostT - this.bpmTime > 0.35) {
        const idx = this.chart.notes.indexOf(lp.note);
        const ghost = { t: ghostT, lane, lanes: [lane], judged: false, hazard: null, laneEntities: [{ lane, x: 0 }], ghost: true };
        this.chart.notes.splice((idx < 0 ? this.chart.notes.length - 1 : idx) + 1, 0, ghost);
      }
    }
    lp.lane = lane;
    lp.moved = true;
    lp.stand = false;
  }

  /** 即時衝刺穿越：衝刺中碰到逼近的障礙物會直接把它「吃掉」 */
  resolveHazards(p) {
    const hz = this.hazards;
    for (let i = 0; i < hz.length; i++) {
      const h = hz[i];
      if (h.resolved || h.phantom || p.dash <= 0) continue;
      if (h.laneList.indexOf(p.lane) < 0) continue;
      const y = this.noteY(h.t);
      if (y >= View.zoneY - View.zoneH * 2.8 && y <= View.zoneY + View.zoneH * 0.9) {
        h.resolved = true;
        this.onDashClear(h);
      }
    }
  }

  dodgeNote(n) {
    n.judged = true;
    if (this.state !== 'play') return;
    this.totalJudged++;
    this.dodges++;
    this.score += 25 * this.mult * DIFFS[this.diff].mult * this.mode.modeScore;
    this.phaseEnergy = Math.min(this.maxPhase, this.phaseEnergy + 1.5);
    if (Store.data.settings.hint && this.combo >= 5 && this.combo % 5 === 0) this.hint('✦ 迴避', 'perfect', 0.45);
  }

  missNote(n) {
    n.judged = true;
    if (this.state !== 'play') return;
    this.miss++;
    this.totalJudged++;
    this.breakCombo();
    this.phaseEnergy = Math.max(0, this.phaseEnergy - 6);
    if (Store.data.settings.hint) this.hint('漏接', 'miss', 0.5);
  }

  triggerWarp() {
    if (this.warps >= 8) return;
    this.warps++;
    this.player.invuln = Math.max(this.player.invuln, 1);
    this.slowMoLeft = 0.7;
    this.flash(this.pal.b, 0.28);
    Audio2.sfx('warp');
    this.hint('時空摺疊', 'perfect', 0.9);
  }

  checkComboMilestone() {
    if (this.combo > 0 && this.combo % 10 === 0) {
      Audio2.sfx('combo');
      this.addWave(View.laneCenter(this.player.lane), View.zoneY, this.comboLabelColor(), View.laneW * 3.4, 0.7);
      const p = this.player;
      this.floaters.add(View.laneCenter(p.lane), View.zoneY - View.H * 0.22, this.combo + ' COMBO!', this.comboLabelColor(), View.H * 0.03);
      if (Store.data.settings.motionFx) this.particles.burst(View.W / 2, View.H * 0.3, 24, [this.pal.a, this.pal.b, this.pal.gold], 420, { grav: 120, shape: 'square', life: 1.2 });
      const cm = $('combo-num');
      if (cm) { cm.classList.add('hit'); setTimeout(() => cm.classList.remove('hit'), 120); }
    }
    if (this.combo > 0 && this.combo % 50 === 0) {
      this.phaseEnergy = Math.min(this.maxPhase, this.phaseEnergy + 20);
      this.flash(this.pal.gold, 0.22);
      Audio2.sfx('flower');
      this.flowers++;
    }
  }

  comboLabelColor() {
    return this.combo >= 200 ? this.pal.c : this.combo >= 100 ? this.pal.gold : this.pal.a;
  }

  onHit(h, bypass) {
    const p = this.player;
    if (!p) return;
    if (p.invuln > 0 && !bypass) return;
    this.hazardsHit = (this.hazardsHit || 0) + 1;
    if (p.shield > 0) {
      p.shield--;
      p.invuln = 1.95;
      this.shieldSaves++;
      this.phaseEnergy = Math.min(this.maxPhase, this.phaseEnergy + 18);
      this.flash('#ffffff', 0.35);
      Audio2.sfx('shield');
      this.hint('相位護盾 −1', 'perfect', 1);
      this.particles.ring(p.x, View.zoneY, 30, this.pal.a, 380, {});
      return;
    }
    this.pendingBreak = true;
    this.phaseEnergy -= 16;
    this.lives--;
    this.shieldCharge = Math.min(2, (this.shieldCharge || 0) + 1);
    p.invuln = 1.25;
    this.hitFlash = 1;
    this.shake.add(14);
    this.flash(this.pal.c, 0.4);
    this.addWave(p.x, View.zoneY, this.pal.c, Math.max(View.W, View.H) * 0.5, 0.7);
    Audio2.sfx('hit');
    this.hint('撞擊！', 'miss', 0.9);
    this.particles.burst(p.x, View.zoneY, 30, [this.pal.c, '#ffffff', this.pal.gold], 520, { grav: 200, shape: 'square', size: 1.3 });
    this.floaters.add(p.x, View.zoneY - View.H * 0.1, '-24', this.pal.c, View.H * 0.03);
  }

  breakCombo() {
    this.clean = false;
    this.combo = 0;
    this.mult = 1;
    if (this.player) this.player.warpRank = 0;
  }

  onDashClear() {
    this.dashClears++;
    if (this.player) this.addWave(View.laneCenter(this.player.lane), View.zoneY, this.pal.b, View.laneW * 3, 0.5);
    this.score += 45 * this.mult * DIFFS[this.diff].mult;
    this.phaseEnergy = Math.min(this.maxPhase, this.phaseEnergy + 4);
    this.flow = Math.min(this.maxFlow, this.flow + 4);
    if (hasSkill('blink')) {
      this.score += 45 * this.mult * DIFFS[this.diff].mult;
      this.particles.burst(View.laneCenter(this.player.lane), View.zoneY, 16, this.pal.b, 300, { grav: 0 });
    }
    this.floaters.add(View.laneCenter(this.player.lane), View.zoneY - View.H * 0.06, '穿越 +' + Math.round(45 * this.mult), this.pal.b, View.H * 0.02, 0.6);
    Audio2.sfx('dash');
  }

  /* --- 輸入 --- */
  move(d) {
    if (this.state !== 'play') return;
    const p = this.player;
    if (!p) return;
    const nl = clamp(p.lane + d, 0, View.laneCount - 1);
    if (nl === p.lane) return;
    p.lane = nl;
    this.planMove(nl);
    Audio2.sfx('move');
    if (Store.data.settings.motionFx) this.particles.burst(View.laneCenter(nl), View.zoneY + 6, 6, this.pal.player, 180, { grav: 60, life: 0.5 });
  }
  setLane(lane) {
    if (this.state !== 'play') return;
    const p = this.player;
    if (!p) return;
    lane = clamp(lane, 0, View.laneCount - 1);
    if (lane !== p.lane) { p.lane = lane; this.planMove(lane); Audio2.sfx('move'); }
  }
  dash() {
    if (this.state !== 'play') return;
    const p = this.player;
    if (!p || p.dashCd > 0) return;
    p.dash = 0.32;
    p.dashCd = 1.15;
    this.dashes++;
    this.score += 0;
    Audio2.sfx('dash');
    this.particles.burst(p.x, View.zoneY, 14, [this.pal.player, this.pal.a], 260, { grav: -30, shape: 'streak' });
  }
  flash(color, a) {
    if (!Store.data.settings.flash) return;
    this.flasher.flash(color, a);
  }
  hint(text, kind, dur) {
    const hb = $('hint-bar');
    if (!hb) return;
    hb.textContent = text;
    hb.className = 'show ' + (kind || '');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => { hb.className = ''; }, (dur || 0.7) * 1000);
  }

  /* --- HUD --- */
  updateHud() {
    const c = this.hudCache;
    const s = fmt(this.displayScore);
    if (c.score !== s) { c.score = s; setText($('hud-score'), s); }
    const m = '×' + this.mult.toFixed(1);
    if (c.mult !== m) {
      c.mult = m;
      setText($('hud-mult'), m);
      const e = $('hud-mult');
      if (e) { e.classList.add('bump'); clearTimeout(this._bumpT); this._bumpT = setTimeout(() => e.classList.remove('bump'), 150); }
    }
    const bpm = String(this.chart.bpm);
    if (c.bpm !== bpm) { c.bpm = bpm; setText($('hud-bpm'), bpm); }
    const judged = this.totalJudged;
    const sync = judged > 0 ? Math.round(((this.perfect + this.good * 0.55) / judged) * 100) + '%' : '100%';
    if (c.sync !== sync) { c.sync = sync; setText($('hud-sync'), sync); }
    if (this.mode.time) {
      const tt = this.timeLeftSafe().toFixed(1);
      if (c.timer !== tt) { c.timer = tt; setText($('hud-timer-v'), tt); }
      if (!c.timerShown) { c.timerShown = true; show($('hud-timer'), true); }
    }
    if (this.mode.id === 'survive') {
      const lv = String(Math.max(0, this.lives));
      if (c.lives !== lv) { c.lives = lv; setText($('hud-life-v'), lv); show($('hud-life'), true); }
    }
    const fills = this.phFills || (this.phFills = document.querySelectorAll('.ph-fill'));
    if (fills[0]) fills[0].style.width = clamp01(this.phaseEnergy / this.maxPhase) * 100 + '%';
    if (fills[1]) fills[1].style.width = clamp01(this.flow / this.maxFlow) * 100 + '%';
    const bars = this.phBars || (this.phBars = document.querySelectorAll('.ph-bar'));
    if (bars[0]) bars[0].classList.toggle('low', this.phaseEnergy / this.maxPhase < 0.28);
    const nums = this.phNums || (this.phNums = document.querySelectorAll('.ph-num'));
    if (nums[0]) setText(nums[0], Math.round(this.phaseEnergy) + '%');
    const pd = this.pbDone || (this.pbDone = $('pb-done'));
    if (pd) {
      const prog = this.mode.time ? clamp01(this.elapsed / this.mode.time) : clamp01((this.bpmTime - this.chart.leadIn * this.chart.beat) / (this.chart.len - this.chart.leadIn * this.chart.beat));
      pd.style.width = prog * 100 + '%';
    }
    const cm = this.comboNum || (this.comboNum = $('combo-num'));
    if (cm && c.combo !== this.combo) {
      c.combo = this.combo;
      setText(cm, this.combo);
      setText($('combo-label'), this.combo >= 200 ? 'OVERDRIVE' : this.combo >= 100 ? 'FEVER' : this.combo >= 50 ? 'FLOW' : 'COMBO');
      show($('combo-display'), this.combo >= 3);
    }
    const st = this.stage;
    if (c.stage !== st) { c.stage = st; setText($('hud-stage'), PHASE_NAMES[st] + ' · ' + this.world.name); }
  }

  /* --- 繪製 --- */
  render(dt) {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = View.W, H = View.H;
    ctx.setTransform(View.dpr, 0, 0, View.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.bg.draw(ctx, this.state === 'paused' ? 0 : dt, this.beatPulse, clamp01(this.combo / 60));
    if (this.chart && this.state !== 'idle') {
      this.drawArena(ctx);
      this.drawShockwaves(ctx);
      this.drawHazards(ctx);
      this.drawOrbs(ctx);
      this.drawNotes(ctx);
      this.particles.draw(ctx);
      this.drawPlayer(ctx);
      this.floaters.draw(ctx, View.fontK);
      if (this.slowMoLeft > 0) {
        ctx.fillStyle = rgba(this.pal.b, 0.12 * clamp01(this.slowMoLeft / 0.7));
        ctx.fillRect(0, 0, W, H);
      }
    } else {
      this.drawIdle(ctx, dt);
    }
    ctx.restore();
    if (this.flasher.a > 0) {
      ctx.globalAlpha = this.flasher.a * 0.6;
      ctx.fillStyle = this.flasher.color;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (this.hitFlash > 0) {
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, rgba(this.pal.c, this.hitFlash * 0.8));
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.state === 'play' && !this.mode.zen && this.phaseEnergy / this.maxPhase < 0.3) {
      const k = (0.3 - this.phaseEnergy / this.maxPhase) / 0.3;
      const puls = 0.5 + 0.5 * Math.sin(this.elapsed * 10);
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, rgba(this.pal.c, k * 0.45 * (0.6 + puls * 0.4)));
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* 待機畫面：菜單背景的流光跑道 */
  drawIdle(ctx, dt) {
    const W = View.W, H = View.H, p = this.pal;
    this.idleT = (this.idleT || 0) + (dt || 0);
    const t = this.idleT;
    const pathL = View.pathL, pathR = View.pathR;
    for (let i = 0; i < 7; i++) {
      const y = ((i / 7 + (t * 0.12) % (1 / 7) * 7) % 1) * H;
      const g = ctx.createLinearGradient(pathL, 0, pathR, 0);
      g.addColorStop(0, rgba(p.a, 0));
      g.addColorStop(0.5, rgba(p.a, 0.14));
      g.addColorStop(1, rgba(p.a, 0));
      ctx.fillStyle = g;
      ctx.fillRect(pathL, y, pathR - pathL, 2);
    }
    for (let i = 0; i < 26; i++) {
      const x = pathL + ((i * 97.3 + t * 60 * ((i % 3) + 1)) % (pathR - pathL));
      const y = ((i * 131.7 + t * 90 * ((i % 4) + 1)) % H);
      ctx.beginPath(); ctx.arc(x, y, 1.5 + (i % 3), 0, TAU);
      ctx.fillStyle = rgba([p.a, p.b, p.gold][i % 3], 0.5);
      ctx.fill();
    }
  }

  /** 音遊常見的下落判定圈：隨節拍收縮，流星會在收縮完成時抵達判定線 */
  drawApproachRings(ctx) {
    const notes = this.chart.notes;
    const beat = this.chart.beat;
    const lp = this.lastPlanned;
    const focus = lp && !lp.done ? lp.note : null;
    const zoneY = View.zoneY;
    const topY = -View.H * 0.1;
    ctx.save();
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.judged) continue;
      const dtime = n.t - this.bpmTime;
      if (dtime < -0.12) continue;
      const isFocus = n === focus;
      if (!isFocus && !(this.player && n.lanes.indexOf(this.player.lane) >= 0)) continue;
      if (dtime > beat * 2.2) continue;
      const k = clamp01(dtime / beat);          /* 1 → 0 */
      const y = this.noteY(n.t);
      if (y > zoneY + 40) continue;
      const col = isFocus ? this.pal.gold : this.pal.a;
      const rad = lerp(View.laneW * 0.36, View.laneW * 0.5, k);
      /* 環 + 沿路徑收斂的殘影 */
      for (let kk = 0; kk < 2; kk++) {
        const kk1 = clamp01(k + kk * 0.18);
        if (kk1 >= 1) continue;
        const yy = y - (kk1 - k) * (zoneY - topY);
        ctx.globalAlpha = (isFocus ? 0.55 : 0.3) * (1 - kk1 * 0.6);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1 + (1 - kk1) * 2;
        ctx.beginPath();
        ctx.ellipse(View.laneCenter(n.lane), yy, rad, rad * 0.32, 0, 0, TAU);
        ctx.stroke();
      }
      /* 抵達時的白色閃圈 */
      if (dtime < 0.06) {
        const f = 1 - clamp01(dtime / 0.06);
        ctx.globalAlpha = f * 0.8;
        ctx.strokeStyle = lighten(col, 0.6);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(View.laneCenter(n.lane), zoneY, View.laneW * 0.5 * (1 + (1 - f) * 0.6), View.laneW * 0.16, 0, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawArena(ctx) {
    const W = View.W, H = View.H, p = this.pal;
    const pathL = View.pathL, pathR = View.pathR, laneW = View.laneW;
    const topY = -H * 0.05, botY = H;
    const g = ctx.createLinearGradient(0, topY, 0, botY);
    g.addColorStop(0, rgba(p.a, 0.02));
    g.addColorStop(0.5, rgba(p.b, 0.06));
    g.addColorStop(1, rgba(p.a, 0.10));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(pathL + laneW * 0.12, topY);
    ctx.lineTo(pathR - laneW * 0.12, topY);
    ctx.lineTo(pathR, botY);
    ctx.lineTo(pathL, botY);
    ctx.closePath();
    ctx.fill();

    /* 隨節拍流下的水平線（每拍一條） */
    const beat = this.chart.beat;
    const b0 = Math.floor(this.bpmTime / beat) - 3;
    const b1 = b0 + Math.ceil((1.1 + View.zoneY / Math.max(1, View.zoneY - (-H * 0.1)) * 0)) + 4;
    for (let b = b0; b <= b1; b++) {
      const y = this.noteY(b * beat);
      if (y < topY || y > botY) continue;
      const inZone = Math.abs(y - View.zoneY) < View.zoneH;
      const alpha = 0.04 + 0.09 * clamp01(y / View.zoneY) * (1 - clamp01((y - View.zoneY) / (H - View.zoneY)));
      const lineG = ctx.createLinearGradient(pathL, 0, pathR, 0);
      lineG.addColorStop(0, rgba(p.a, 0));
      lineG.addColorStop(0.5, rgba(inZone ? p.gold : p.a, alpha + (inZone ? 0.18 : 0)));
      lineG.addColorStop(1, rgba(p.a, 0));
      ctx.fillStyle = lineG;
      const wob = Math.sin(b * 0.9 + this.elapsed * 2) * 0.003 * H;
      ctx.fillRect(pathL, y + wob, pathR - pathL, Math.max(1, H * 0.0016));
    }

    /* 車道波浪分隔線 */
    for (let i = 1; i < View.laneCount; i++) {
      const x0 = pathL + laneW * i;
      const topInset = laneW * 0.12;
      ctx.beginPath();
      const N = 24;
      for (let k = 0; k <= N; k++) {
        const tt = k / N;
        const y = lerp(topY, botY, tt);
        const inset = lerp(topInset, 0, tt);
        const x = x0 + (x0 < W / 2 ? inset : -inset) + Math.sin(tt * 6 + this.elapsed * 2.2 + i) * H * 0.006 * (1 - tt);
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      const lg = ctx.createLinearGradient(0, topY, 0, botY);
      lg.addColorStop(0, rgba('#ffffff', 0.0));
      lg.addColorStop(0.4, rgba('#ffffff', 0.08));
      lg.addColorStop(1, rgba('#ffffff', 0.14));
      ctx.strokeStyle = lg;
      ctx.lineWidth = Math.max(1, H * 0.0016);
      ctx.stroke();
    }
    /* 外框發光 */
    const edge = ctx.createLinearGradient(0, topY, 0, botY);
    edge.addColorStop(0, rgba(p.a, 0.0));
    edge.addColorStop(0.4, rgba(p.a, 0.35 + this.beatPulse * 0.3));
    edge.addColorStop(1, rgba(p.b, 0.6));
    ctx.strokeStyle = edge;
    ctx.lineWidth = Math.max(1.5, H * 0.0028);
    ctx.shadowColor = p.a; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.moveTo(pathL + laneW * 0.12, topY); ctx.lineTo(pathL, botY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pathR - laneW * 0.12, topY); ctx.lineTo(pathR, botY); ctx.stroke();
    ctx.shadowBlur = 0;

    /* 判定邊界 */
    const zoneY = View.zoneY;
    const pulse = this.beatPulse;
    ctx.strokeStyle = rgba(lighten(p.a, 0.4), 0.55 + pulse * 0.4);
    ctx.lineWidth = Math.max(1.5, H * 0.003 + pulse * 2);
    ctx.shadowColor = p.a; ctx.shadowBlur = 20 + pulse * 26;
    ctx.beginPath(); ctx.moveTo(pathL, zoneY); ctx.lineTo(pathR, zoneY); ctx.stroke();
    ctx.shadowBlur = 0;
    for (let i = 0; i < View.laneCount; i++) {
      const cx = View.laneCenter(i);
      const isCur = this.player && this.player.lane === i;
      const r = laneW * (isCur ? 0.2 + pulse * 0.05 : 0.15 + pulse * 0.04);
      ctx.beginPath(); ctx.arc(cx, zoneY, r, 0, TAU);
      ctx.fillStyle = rgba(p.a, isCur ? 0.16 + pulse * 0.14 : 0.06 + pulse * 0.08); ctx.fill();
      ctx.strokeStyle = rgba(p.a, isCur ? 0.85 : 0.45); ctx.lineWidth = 1.4; ctx.stroke();
    }
    /* 風險提示：障礙物前方標記 */
    this.drawRiskMarks(ctx);
    /* 側邊波光 */
    this.drawRopeWaves(ctx, pathL, 1, topY, botY, p.a);
    this.drawRopeWaves(ctx, pathR, -1, topY, botY, p.b);
    /* 下落判定圈（音遊手感） */
    this.drawApproachRings(ctx);
  }

  drawRiskMarks(ctx) {
    const zoneY = View.zoneY;
    for (const h of this.hazards) {
      if (h.phantom || h.passed) continue;
      const k = 1 - (h.t - this.bpmTime);
      if (k < 0.3 || k > 1.2) continue;
      const a = 1 - k;
      for (const l of h.laneList) {
        const cx = View.laneCenter(l);
        ctx.fillStyle = rgba(this.pal.c, 0.5 * a);
        ctx.fillRect(cx - View.laneW * 0.4, zoneY, View.laneW * 0.8, 3);
      }
    }
  }

  drawRopeWaves(ctx, xBase, dir, topY, botY, color) {
    const t = this.elapsed;
    ctx.beginPath();
    const N = 30;
    for (let k = 0; k <= N; k++) {
      const tt = k / N;
      const y = lerp(topY, botY, tt);
      const amp = View.H * 0.02 * Math.sin(tt * Math.PI);
      const x = xBase + dir * (amp * Math.sin(tt * 9 - t * 3.5) + amp * 0.4 * Math.sin(tt * 21 + t * 6));
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba(color, 0.35);
    ctx.lineWidth = Math.max(1, View.H * 0.0022);
    ctx.shadowColor = color; ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  drawNotes(ctx) {
    const p = this.pal;
    const zoneY = View.zoneY;
    const beat = this.chart.beat;
    const notes = this.chart.notes;
    const i0 = Math.max(0, this.nextIndex - this.chart.notes.length + 1);

    for (let i = this.nextIndex - 1; i >= i0; i--) {
      const n = notes[i];
      if (!n.judged && this.state === 'play' && this.player && this.isPlanned(n) && this.bpmTime >= n.t - 0.45 &&
          n.lanes.indexOf(this.player.lane) >= 0 &&
          Math.abs(View.laneCenter(this.player.lane) - this.player.x) < View.laneW * 0.3) {
        this.judgeNote(n, Math.abs(this.bpmTime - n.t) < this.chart.beat * 0.3, true);
      }
      if (n.judged) continue;
      const dtime = n.t - this.bpmTime;
      if (dtime < -0.12) continue;
      const y = this.noteY(n.t);
      if (y < -View.H * 0.12 || y > zoneY + 30) continue;
      const approaching = Math.abs(dtime) < beat * 0.35;
      const onTarget = this.player && n.lanes.indexOf(this.player.lane) >= 0;
      const col = approaching ? (onTarget ? lighten(p.gold, 0.3) : p.c) : p.a;
      const rl = View.laneW * 0.30;
      const rh = Math.max(3, View.H * 0.0075);
      /* 環與核心 */
      for (const ent of n.laneEntities) {
        ctx.save();
        ctx.shadowColor = col; ctx.shadowBlur = approaching ? 26 : 12;
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, View.H * 0.004);
        ctx.beginPath();
        ctx.ellipse(ent.x, y, rl, rh, 0, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(ent.x, y, Math.max(1.5, View.H * 0.0035), 0, TAU);
        ctx.fillStyle = approaching ? '#ffffff' : lighten(p.a, 0.5);
        ctx.fill();
        ctx.strokeStyle = rgba(col, 0.22);
        ctx.lineWidth = Math.max(1, View.H * 0.0018);
        ctx.beginPath(); ctx.moveTo(ent.x, y - rh); ctx.lineTo(ent.x, y - View.H * 0.035); ctx.stroke();
      }
      /* 提示箭頭：指引玩家移到正確位置 */
      if (this.lastPlanned && this.lastPlanned.note === n && !this.lastPlanned.done) {
        const lp = this.lastPlanned;
        const targetL = lp.lane >= 0 ? lp.lane : n.lanes[0];
        ctx.strokeStyle = rgba(p.gold, 0.85);
        ctx.lineWidth = Math.max(2, View.H * 0.003);
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(View.laneCenter(targetL), y);
        ctx.lineTo(View.laneCenter(targetL), zoneY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (Store.data.settings.hint && dtime < beat * 1.6 && dtime > -0.1) {
        const targetLane = n.lanes[0];
        const cx = View.laneCenter(targetLane);
        ctx.fillStyle = rgba(p.gold, clamp01(1 - dtime / (beat * 1.6)) * 0.9);
        ctx.beginPath();
        ctx.moveTo(cx, y - rh - View.H * 0.012);
        ctx.lineTo(cx - View.laneW * 0.06, y - rh - View.H * 0.03);
        ctx.lineTo(cx + View.laneW * 0.06, y - rh - View.H * 0.03);
        ctx.closePath(); ctx.fill();
      }
    }
  }

  drawHazards(ctx) {
    const p = this.pal;
    for (const h of this.hazards) {
      const y = h.y;
      if (y < -View.H * 0.15 || y > View.H * 1.2) continue;
      const HZ = HAZARDS[h.kind] || HAZARDS.wall;
      const col = h.phantom ? '#8a8fb0' : (h.kind === 'nova' ? p.gold : HZ.color);
      ctx.save();
      ctx.globalAlpha = h.phantom ? 0.38 : 1;
      for (const lane of h.laneList) {
        const cx = View.laneCenter(lane);
        const w = View.laneW * 0.86;
        const hgt = Math.max(6, View.H * 0.016);
        if (h.kind === 'bolt') {
          ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, View.H * 0.004);
          ctx.shadowColor = col; ctx.shadowBlur = 20;
          ctx.beginPath();
          let bx = cx - w / 2;
          ctx.moveTo(bx, y);
          for (let k = 1; k <= 5; k++) {
            bx = cx - w / 2 + (w * k) / 5;
            ctx.lineTo(bx, y + (k % 2 ? -1 : 1) * hgt * 0.7);
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
          continue;
        }
        if (h.kind === 'nova') {
          const rad = Math.max(hgt, (View.H - y) * 0.3) + w * 0.4;
          const rg = ctx.createRadialGradient(cx, y, 0, cx, y, rad);
          rg.addColorStop(0, rgba(col, 0.75)); rg.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = rg;
          ctx.beginPath(); ctx.arc(cx, y, rad, 0, TAU); ctx.fill();
          ctx.strokeStyle = rgba(col, 0.8); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, y, rad * 0.8, 0, TAU); ctx.stroke();
          continue;
        }
        const grad = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
        grad.addColorStop(0, rgba(col, 0.1));
        grad.addColorStop(0.5, rgba(col, 0.85));
        grad.addColorStop(1, rgba(col, 0.1));
        ctx.fillStyle = grad;
        ctx.shadowColor = col; ctx.shadowBlur = 18;
        ctx.fillRect(cx - w / 2, y - hgt / 2, w, hgt);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = rgba(lighten(col, 0.5), 0.8);
        ctx.lineWidth = 1.2;
        ctx.strokeRect(cx - w / 2, y - hgt / 2, w, hgt);
        this.drawHazardGlyph(ctx, h.kind, cx, y, w);
      }
      ctx.restore();
    }
  }

  drawHazardGlyph(ctx, kind, x, y, w) {
    const glyphs = { wall: '✕', twin: '❋', mirror: '◐', grav: '◎', lag: '≋', reverse: '◀', freeze: '❄', magnet: '⌁', phantom: '?' };
    const g = glyphs[kind];
    if (!g) return;
    ctx.font = '900 ' + (w * 0.22) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillText(g, x, y);
  }

  drawOrbs(ctx) {
    const p = this.pal;
    for (const o of this.orbs) {
      if (o.collected) continue;
      const y = this.noteY(o.t);
      if (y < -20 || y > View.H + 20) continue;
      const cx = View.laneCenter(o.lane);
      const r = View.laneW * 0.11 * (1 + Math.sin(this.elapsed * 8 + o.t) * 0.12);
      const col = o.kind === 'pib' ? p.b : p.gold;
      ctx.save();
      ctx.shadowColor = col; ctx.shadowBlur = 18;
      ctx.fillStyle = col;
      if (o.kind === 'pib') {
        ctx.translate(cx, y); ctx.rotate(this.elapsed * 2);
        for (let k = 0; k < 4; k++) { ctx.rotate(Math.PI / 2); ctx.fillRect(-r * 0.25, -r, r * 0.5, r * 2); }
      } else {
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + k * (TAU / 10);
          const rr = k % 2 ? r * 0.45 : r;
          ctx.lineTo(cx + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  drawPlayer(ctx) {
    const p = this.player;
    if (!p) return;
    const H = View.H;
    const zoneY = View.zoneY - (p.visualOffset || 0);
    for (let i = 0; i < p.trail.length; i++) {
      const tr = p.trail[i];
      const k = i / p.trail.length;
      ctx.beginPath();
      ctx.arc(tr.x, tr.y - i * H * 0.003, View.laneW * 0.16 * (0.4 + k * 0.6), 0, TAU);
      ctx.fillStyle = rgba(p.color, 0.25 * tr.a * k);
      ctx.fill();
    }
    const pulse = this.beatPulse;
    const flick = p.invuln > 0 && p.shield <= 0;
    const col = flick ? ((this.elapsed * 14 | 0) % 2 ? '#ffffff' : p.color) : p.color;
    ctx.save();
    ctx.globalAlpha = flick ? 0.7 : 1;
    ctx.shadowColor = col;
    ctx.shadowBlur = 26 + pulse * 20;
    const rw = View.laneW * 0.2;
    const rh = H * 0.024;
    ctx.translate(p.x, zoneY);
    ctx.rotate(Math.PI / 4);
    const pg = ctx.createLinearGradient(-rw, -rh, rw, rh);
    pg.addColorStop(0, lighten(col, 0.55));
    pg.addColorStop(0.5, col);
    pg.addColorStop(1, this.pal.a);
    ctx.fillStyle = pg;
    ctx.fillRect(-rw, -rh, rw * 2, rh * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(-rw, -rh, rw * 2, rh * 2);
    ctx.restore();
    if (p.dash > 0) {
      ctx.save();
      ctx.strokeStyle = rgba(this.pal.b, 0.6);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, zoneY, View.laneW * 0.5, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    if (p.shield > 0) {
      ctx.save();
      ctx.strokeStyle = rgba(this.pal.a, 0.55 + Math.sin(this.elapsed * 4) * 0.15);
      ctx.lineWidth = 2;
      ctx.shadowColor = this.pal.a; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(p.x, zoneY, View.laneW * 0.28, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }
}

/* 由結果計算評價 */
function computeGrade(r) {
  const sync = r.sync || 0;
  if (!r.cleared) return (r.score > 8000 && sync > 0.6) ? 'C' : 'D';
  let s = r.score * 0.5 / 1000 + sync * 120 + (r.maxCombo / 300) * 60 + (r.diff * 8);
  if (r.clean) s += 20;
  if (s >= 300) return 'SSS';
  if (s >= 250) return 'SS';
  if (s >= 210) return 'S';
  if (s >= 170) return 'A';
  if (s >= 130) return 'B';
  if (s >= 90) return 'C';
  return 'D';
}
function gradeColor(g) {
  const m = { SSS: '#ff3df2', SS: '#ffd166', S: '#38f2ff', A: '#55f0b3', B: '#7fb6ff', C: '#a0a0a0', D: '#ff3d5a' };
  return m[g] || '#fff';
}
function computeXp(r) {
  let xp = Math.round(r.score / 35) + r.maxCombo * 1.2 + 10;
  xp += { SSS: 260, SS: 200, S: 150, A: 110, B: 70, C: 40, D: 10 }[r.grade] || 0;
  if (r.cleared) xp += 40 * (1 + r.diff);
  if (r.mode === 'zen') xp = Math.round(xp * 0.5);
  return Math.max(5, Math.round(xp));
}
