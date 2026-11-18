<script>
'use strict';
/* ==========================================================================
 *  節拍流星 Pulse Stride
 *  ------------------------------------------------------------------------
 *  一款「節奏 × 躲避 × 成長」的 HTML5 音遊風躲避遊戲。
 *
 *  設計要點
 *  - 不用固定步進的物理，而是「以節拍為時間軸」：每個音符是一個事件，
 *    事件在準備時間內從畫面上方流下，玩家必須配合節拍把角色移動到對應車道。
 *  - 每個節拍都會誕生一顆「節拍流星」。完美躲開不必移動、但風險極高；
 *    完美穿越讓分數倍率提升、恢復相位、拉大潮汐流轉，是高分與爽感的來源。
 *  - 所有尺寸以畫面高度為基準（--h），canvas 以「適配模式」繪製，
 *    任何螢幕比例（手機直向、橫向、平板、超寬、方屏）都能完整遊玩。
 *  - 進度、解鎖、主題、成就、任務全部儲存在 localStorage。
 * ========================================================================== */

/* ============================== 工具函式 ============================== */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = v => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = t => 1 - Math.pow(1 - clamp01(t), 3);
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const sign = v => (v < 0 ? -1 : 1);
const fmt = n => Math.round(n).toLocaleString('en-US');
const pad2 = n => (n < 10 ? '0' : '') + n;
const fmtTime = s => Math.floor(s / 60) + ':' + pad2(Math.floor(s % 60));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/* --- Xorshift32 偽隨機（可重現的圖表生成） --- */
function Rng(seed) {
  this.s = (seed >>> 0) || 0x9e3779b9;
}
Rng.prototype.next = function () {
  let x = this.s;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5; x >>>= 0;
  this.s = x || 0x6d2b79f5;
  return this.s / 4294967296;
};
Rng.prototype.int = function (a, b) { return a + Math.floor(this.next() * (b - a + 1)); };
Rng.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };
Rng.prototype.shuffle = function (arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(this.next() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
};
Rng.prototype.chance = function (p) { return this.next() < p; };

/* --- 雜湊 --- */
function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --- 顏色 --- */
function hexToRgb(hex) {
  let h = String(hex || '#ffffff').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const r = Math.round(lerp(A.r, B.r, t)), g = Math.round(lerp(A.g, B.g, t)), bl = Math.round(lerp(A.b, B.b, t));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
}
function rgba(hex, a) {
  const c = hexToRgb(hex);
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
}
function lighten(hex, t) { return mixHex(hex, '#ffffff', t); }
function darken(hex, t) { return mixHex(hex, '#000000', t); }

/* --- 儲存 --- */
const Store = {
  KEY: 'pulse_stride_save_v1',
  data: null,
  load() {
    let raw = null;
    try { raw = window.localStorage.getItem(this.KEY); } catch (e) { raw = null; }
    let obj = null;
    if (raw) { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    this.data = this.migrate(obj || {});
    return this.data;
  },
  migrate(o) {
    const d = {
      v: 1,
      theme: 'aurora',
      settings: {
        music: 0.75, sfx: 0.85, motionFx: true, flash: true, screenShake: true,
        lanes: 4, scroll: 1, hint: true, particles: 'high', ghostOrb: true, touch: 'auto', fpsShow: false
      },
      xp: 0, frag: 0, pibs: 0,
      worlds: {}, hazardSeen: {}, skills: { dash: true },
      best: {}, bestScore: {}, plays: 0, clears: 0,
      stats: {
        maxCombo: 0, totalNotes: 0, good: 0, perfect: 0, flawless: 0, flowers: 0,
        shieldSaves: 0, dashWidth: 0, survival: [], challenge: [], playTime: 0, coins: 0,
        worldsCleared: {}, hazardsDodged: 0, themesUsed: {}
      },
      ach: {}, achClaimed: {},
      quests: { day: 0, d1: [], d2: [], d3: [], claim: {} },
      unlocked: {}, dayDeals: [], tutorialDone: false
    };
    if (o && typeof o === 'object') {
      if (o.settings) Object.keys(d.settings).forEach(k => { if (o.settings[k] !== undefined) d.settings[k] = o.settings[k]; });
      ['theme', 'xp', 'frag', 'pibs', 'worlds', 'hazardSeen', 'best', 'plays', 'clears',
        'stats', 'ach', 'achClaimed', 'quests', 'unlocked', 'dayDeals', 'tutorialDone', 'skills'].forEach(k => {
        if (o[k] !== undefined) d[k] = o[k];
      });
      if (o.stats && typeof o.stats === 'object') Object.keys(d.stats).forEach(k => { if (o.stats[k] !== undefined) d.stats[k] = o.stats[k]; });
    }
    /* 設定值即便存檔損壞或不合法，也要修正到可玩範圍 */
    const s = d.settings;
    s.music = isFinite(s.music) ? clamp(s.music, 0, 1) : 0.75;
    s.sfx = isFinite(s.sfx) ? clamp(s.sfx, 0, 1) : 0.85;
    s.lanes = [3, 4, 5].indexOf(s.lanes) >= 0 ? s.lanes : 4;
    s.scroll = isFinite(s.scroll) ? clamp(s.scroll, 0.75, 1.35) : 1;
    s.touch = ['auto', 'always', 'off'].indexOf(s.touch) >= 0 ? s.touch : 'auto';
    s.particles = ['high', 'low', 'off'].indexOf(s.particles) >= 0 ? s.particles : 'high';
    ['motionFx', 'flash', 'screenShake', 'hint', 'ghostOrb', 'fpsShow'].forEach(b => { if (typeof s[b] !== 'boolean') s[b] = b !== 'fpsShow'; });
    if (!d.skills || typeof d.skills !== 'object') d.skills = { dash: 1 };
    d.skills.dash = d.skills.dash || 1;
    d.xp = isFinite(d.xp) ? Math.max(0, d.xp) : 0;
    d.frag = isFinite(d.frag) ? Math.max(0, d.frag) : 0;
    d.plays = isFinite(d.plays) ? d.plays : 0;
    return d;
  },
  save() {
    try { window.localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* 私密模式或 quota 不足時忽略 */ }
  },
  reset() {
    try { window.localStorage.removeItem(this.KEY); } catch (e) { /* ignore */ }
    this.data = this.migrate({});
    this.save();
  }
};

/* --- DOM 小工具 --- */
const $ = id => document.getElementById(id);
function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}
function on(node, ev, fn, opts) { if (node) node.addEventListener(ev, fn, opts); }
function setText(node, t) { if (node && node.textContent !== String(t)) node.textContent = t; }
function show(node, v) { if (node) node.classList.toggle('hidden', !v); }

/* ============================== 遊戲資料：主題 ============================== */
/*
 * theme.cols 順序：bg, bg2, accent, accent2, accent3, gold, panel
 */
const THEMES = [
  { id: 'aurora', name: '極光', cols: ['#070b1c', '#0e2040', '#38f2ff', '#b54bff', '#ff3d81', '#ffd166', '#101a34'],
    style: 'aurora', player: '#46f0ff', desc: '極地的極光在黑夜中流動，冰藍與紫色的交纏。' },
  { id: 'neon', name: '霓虹街', cols: ['#0d0614', '#240a33', '#ff3df2', '#18f0ff', '#ffe94a', '#ffe94a', '#1e0b2b'],
    style: 'neon', player: '#18f0ff', desc: '賽博都市的霓虹倒影，粉紅與青色的撞色衝擊。' },
  { id: 'synth', name: '合成日落', cols: ['#1a0620', '#4c1046', '#ff6b4a', '#ffd166', '#2ad1ff', '#ffe27a', '#33103a'],
    style: 'synth', player: '#ffe27a', desc: '八十年代的合成器日落，海岸線永遠在某個盡頭。' },
  { id: 'matrix', name: '矩陣', cols: ['#010704', '#03210f', '#3dffa0', '#b8ff6b', '#19c2ff', '#e8ffb0', '#04210f'],
    style: 'matrix', player: '#3dffa0', desc: '綠色程式碼如瀑布落下，你在系統的心跳之中奔跑。' },
  { id: 'sakura', name: '櫻花', cols: ['#170910', '#33121f', '#ff9ec7', '#c8a2ff', '#ffd6a5', '#ffe3a3', '#2a0f1a'],
    style: 'sakura', player: '#ff9ec7', desc: '春日飛舞的花瓣，柔和的粉與淡紫。' },
  { id: 'ocean', name: '深海', cols: ['#020b12', '#04222f', '#3ddbd9', '#7fb6ff', '#ffb86b', '#ffe3a3', '#06232f'],
    style: 'ocean', player: '#7fe8ff', desc: '深海伏流與發光的水母，安靜卻洶湧。' },
  { id: 'ember', name: '熔岩', cols: ['#120503', '#2b0904', '#ff8b2c', '#ff3d2e', '#ffdd57', '#ffe07a', '#2a0b05'],
    style: 'ember', player: '#ffb347', desc: '火山熔岩的灼熱，灰燼與火花的飛揚。' },
  { id: 'mono', name: '單色', cols: ['#0a0a0a', '#1d1d1d', '#f4f4f4', '#a0a0a0', '#686868', '#ffffff', '#181818'],
    style: 'mono', player: '#ffffff', desc: '純粹的黑白對比，節奏本身即是色彩。' },
  { id: 'gold', name: '黃金', cols: ['#100c02', '#241a05', '#ffd166', '#ffb02e', '#fff3c4', '#ffe9a8', '#241a05'],
    style: 'gold', player: '#ffe9a8', desc: '王者的厚重與榮耀，讓每一次穿越都鑲上金邊。' },
  { id: 'forest', name: '螢光森林', cols: ['#04100a', '#0b2317', '#8dff9a', '#38f2ff', '#f2ff6b', '#f2ff6b', '#0b2317'],
    style: 'forest', player: '#8dff9a', desc: '螢火蟲與古老的樹林，生命的綠意在夜裡呼吸。' },
  { id: 'ice', name: '冰晶', cols: ['#06101e', '#0d2544', '#bde8ff', '#7cc8ff', '#e8fbff', '#ffffff', '#0d2544'],
    style: 'ice', player: '#e8fbff', desc: '極寒的冰晶折射出冷冽的光，寂靜而清脆。' },
  { id: 'retro', name: '復古掌機', cols: ['#0b160c', '#14280f', '#c8e65a', '#f0ff9a', '#8bd450', '#f0ff9a', '#14280f'],
    style: 'retro', player: '#c8e65a', desc: '像素時代的綠色螢幕，懷舊而純粹。' },
  { id: 'storm', name: '雷暴', cols: ['#0a0d16', '#1a1f33', '#c8d4ff', '#7a8cff', '#ffe066', '#ffe066', '#161b2b'],
    style: 'storm', player: '#c8d4ff', desc: '雷鳴與閃電的夜空，藍白雷電劃破天際。' },
  { id: 'candy', name: '糖果', cols: ['#24101f', '#4a1636', '#ff8fd8', '#7af5c8', '#ffd86b', '#ffd86b', '#3a1229'],
    style: 'candy', player: '#7af5c8', desc: '水果軟糖般的繽紛，甜到發膩的高潮。' },
  { id: 'cosmos', name: '宇宙', cols: ['#04030c', '#120a2e', '#a48bff', '#58e0ff', '#ff7ab8', '#ffd166', '#120a2e'],
    style: 'cosmos', player: '#a48bff', desc: '星雲與深空的呼吸，你在光年之間穿梭。' },
  { id: 'nightfall', name: '夜幕', cols: ['#0b0b12', '#1d1a2b', '#ffcf7a', '#ff8a5c', '#7ad7ff', '#ffcf7a', '#1d1a2b'],
    style: 'night', player: '#ffcf7a', desc: '城市入夜後的燈火，溫暖而遼闊。' }
];
const themeById = id => THEMES.find(t => t.id === id) || THEMES[0];

/* 主題在 canvas 的「活動調色盤」（會被世界 override 一部分顏色） */
function buildPalette(theme) {
  const c = theme.cols;
  return {
    id: theme.id, style: theme.style, name: theme.name,
    bg: c[0], bg2: c[1], a: c[2], b: c[3], c: c[4], gold: c[5], panel: c[6],
    player: theme.player || c[2]
  };
}

/* ============================== 音樂調式 ============================== */
const PROG = {
  ionian: [0, 5, 7, 9, 2, 7, 4, 9],
  aeolian: [0, 8, 3, 10, 5, 8, 7, 10],
  dorian: [0, 3, 5, 7, 10, 7, 5, 3],
  lydian: [0, 4, 7, 11, 6, 2, 5, 7],
  phrygian: [0, 3, 5, 1, 7, 3, 5, 1],
  mixolydian: [0, 3, 7, 5, 10, 7, 5, 3]
};
const INSTRUMENTS = ['pluck', 'bell', 'chip', 'glass', 'organ', 'epiano'];

function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

/* ============================== 世界（30 個） ============================== */
const WORLDS = [
  { id: 'dawn', name: '拂曉門廊', nameEn: 'Dawn Gate', hint: '先熟悉節拍：對齊車道、安心穿越。', skill: 'dash', music: { scale: [0,2,4,5,7,9,11], root: 62, prog: 'ionian', bpmMul: 1, inst: 'bells' }, hazards: [], drift: 0.15, tide: 1, bmps: [100, 108, 116, 124, 132], bpmMul: 0.92, diff: 0 },
  { id: 'tide', name: '潮汐迴廊', nameEn: 'Tide Hall', hint: '潮汐流轉變快，注意換車時機。', skill: 'dash', music: { scale: [0,2,3,5,7,8,10], root: 57, prog: 'aeolian', bpmMul: 1.02, inst: 'glass' }, hazards: [], drift: 0.35, tide: 2, bmps: [104, 112, 120, 128, 136], bpmMul: 1, diff: 0 },
  { id: 'prism', name: '稜鏡山脊', nameEn: 'Prism Ridge', hint: '稜鏡偏移讓車道每兩拍翻轉。', skill: 'dash', music: { scale: [0,2,4,7,9,11,12], root: 60, prog: 'lydian', bpmMul: 1, inst: 'bells' }, hazards: ['mirror'], drift: 0.2, tide: 1, bmps: [108, 118, 126, 134, 144], bpmMul: 1.04, diff: 0 },
  { id: 'gear', name: '重力齒輪', nameEn: 'Gear Vault', hint: '重力會互相影響：成雙移動比較安全。', skill: 'dash', music: { scale: [0,2,3,5,7,10,12], root: 55, prog: 'dorian', bpmMul: 1.02, inst: 'chip' }, hazards: ['grav'], drift: 0.25, tide: 1, bmps: [110, 120, 130, 140, 150], bpmMul: 1.05, diff: 1 },
  { id: 'bloom', name: '複瓣花園', nameEn: 'Double Bloom', hint: '雙生花：同一拍出現兩道門，都需要穿越。', skill: 'dash', music: { scale: [0,2,4,5,9,11,12], root: 64, prog: 'ionian', bpmMul: 1.03, inst: 'pluck' }, hazards: ['twin'], drift: 0.2, tide: 1.5, bmps: [112, 122, 132, 142, 152], bpmMul: 1.06, diff: 1 },
  { id: 'static', name: '靜電平原', nameEn: 'Static Field', hint: '靜電脈衝會推進或拖慢潮流。', skill: 'dash', music: { scale: [0,1,5,7,8,11,12], root: 59, prog: 'phrygian', bpmMul: 1.04, inst: 'chip' }, hazards: ['bolt'], drift: 0.3, tide: 1, bmps: [116, 126, 136, 146, 158], bpmMul: 1.08, diff: 1 },
  { id: 'hollow', name: '鏡面迴廊', nameEn: 'Mirror Hollow', hint: '鏡影會複製你的車道，反向思考。', skill: 'dash', music: { scale: [0,2,3,5,7,8,10], root: 61, prog: 'aeolian', bpmMul: 1.05, inst: 'glass' }, hazards: ['phantom', 'mirror'], drift: 0.3, tide: 1.5, bmps: [118, 128, 138, 148, 160], bpmMul: 1.08, diff: 1 },
  { id: 'magnet', name: '磁極迷宮', nameEn: 'Magnet Maze', hint: '磁暴會偷偷拉動潮流，注意障礙物。', skill: 'shield', music: { scale: [0,2,5,7,9,12,14], root: 63, prog: 'mixolydian', bpmMul: 1.05, inst: 'epiano' }, hazards: ['magnet'], drift: 0.35, tide: 1.5, bmps: [120, 130, 140, 152, 164], bpmMul: 1.1, diff: 2 },
  { id: 'core', name: '代碼核心', nameEn: 'Code Core', hint: '代碼會凍結某幾條車道，穿越時機要準。', skill: 'shield', music: { scale: [0,2,3,7,8,10,12], root: 58, prog: 'dorian', bpmMul: 1.06, inst: 'chip' }, hazards: ['freeze'], drift: 0.3, tide: 1, bmps: [122, 132, 142, 154, 166], bpmMul: 1.12, diff: 2 },
  { id: 'latency', name: '延遲深淵', nameEn: 'Latency Abyss', hint: '延遲會讓障礙物慢一步到來，別被騙了。', skill: 'shield', music: { scale: [0,3,5,7,10,12,15], root: 56, prog: 'phrygian', bpmMul: 1.06, inst: 'glass' }, hazards: ['lag'], drift: 0.35, tide: 1.5, bmps: [124, 134, 144, 156, 168], bpmMul: 1.12, diff: 2 },
  { id: 'nova', name: '新星爆發', nameEn: 'Nova Cascade', hint: '新星的光會沿車道爆開，注意下一拍。', skill: 'shield', music: { scale: [0,2,4,5,7,9,11], root: 65, prog: 'ionian', bpmMul: 1.07, inst: 'bells' }, hazards: ['nova'], drift: 0.4, tide: 1, bmps: [126, 136, 146, 158, 170], bpmMul: 1.14, diff: 2 },
  { id: 'chrono', name: '時鐘靜域', nameEn: 'Chrono Still', hint: '時鐘會倒轉一拍，練習反節拍。', skill: 'shield', music: { scale: [0,2,3,5,7,9,10], root: 60, prog: 'mixolydian', bpmMul: 1.07, inst: 'organ' }, hazards: ['reverse'], drift: 0.35, tide: 2, bmps: [128, 138, 148, 160, 174], bpmMul: 1.15, diff: 2 },
  { id: 'jelly', name: '重力水母', nameEn: 'Jelly Gravity', hint: '水母浮動：車道會慢慢漂移，微調不停。', skill: 'magnet', music: { scale: [0,2,3,7,10,12,14], root: 62, prog: 'aeolian', bpmMul: 1.08, inst: 'epiano' }, hazards: ['grav'], drift: 0.45, tide: 1.5, bmps: [130, 140, 150, 162, 176], bpmMul: 1.16, diff: 3 },
  { id: 'ember', name: '灰燼花園', nameEn: 'Ember Garden', hint: '灰燼會短暫熄滅車道，別踩空。', skill: 'magnet', music: { scale: [0,2,4,5,7,10,12], root: 57, prog: 'mixolydian', bpmMul: 1.08, inst: 'organ' }, hazards: ['freeze', 'bolt'], drift: 0.4, tide: 1.5, bmps: [130, 142, 152, 164, 178], bpmMul: 1.16, diff: 3 },
  { id: 'glass', name: '玻璃風暴', nameEn: 'Glass Storm', hint: '碎片飛濺：穿越後兩拍都可能被追上。', skill: 'magnet', music: { scale: [0,2,4,7,9,12,16], root: 66, prog: 'lydian', bpmMul: 1.08, inst: 'glass' }, hazards: ['nova', 'lag'], drift: 0.45, tide: 1.5, bmps: [132, 142, 154, 166, 180], bpmMul: 1.18, diff: 3 },
  { id: 'twin', name: '雙生之心', nameEn: 'Twin Heart', hint: '雙生心的同步複製，節奏比以往更密。', skill: 'magnet', music: { scale: [0,2,4,5,7,9,11], root: 64, prog: 'ionian', bpmMul: 1.09, inst: 'pluck' }, hazards: ['twin', 'mirror'], drift: 0.4, tide: 1.5, bmps: [134, 144, 156, 168, 182], bpmMul: 1.2, diff: 3 },
  { id: 'void', name: '虛空跳躍', nameEn: 'Void Leap', hint: '虛空裂隙會突進一拍，預判兩手準備。', skill: 'magnet', music: { scale: [0,1,3,6,8,10,12], root: 54, prog: 'phrygian', bpmMul: 1.1, inst: 'organ' }, hazards: ['lag', 'reverse'], drift: 0.5, tide: 1, bmps: [136, 146, 158, 170, 186], bpmMul: 1.22, diff: 3 },
  { id: 'melody', name: '旋律回聲', nameEn: 'Melody Echo', hint: '回聲會重複你的動作，善用節拍預判。', skill: 'blink', music: { scale: [0,2,4,7,9,11,14], root: 67, prog: 'ionian', bpmMul: 1.1, inst: 'bells' }, hazards: ['phantom'], drift: 0.4, tide: 2, bmps: [138, 148, 160, 172, 188], bpmMul: 1.22, diff: 4 },
  { id: 'mirror2', name: '鏡面都市', nameEn: 'Mirror City', hint: '鏡像的街道，左右會被調換。', skill: 'blink', music: { scale: [0,2,3,5,7,8,11], root: 59, prog: 'aeolian', bpmMul: 1.1, inst: 'chip' }, hazards: ['mirror', 'phantom'], drift: 0.5, tide: 1.5, bmps: [140, 150, 162, 174, 190], bpmMul: 1.24, diff: 4 },
  { id: 'storm', name: '雷暴之塔', nameEn: 'Storm Spire', hint: '雷暴與磁暴同時侵襲，節拍不等人。', skill: 'blink', music: { scale: [0,2,3,7,8,10,12], root: 55, prog: 'dorian', bpmMul: 1.11, inst: 'organ' }, hazards: ['bolt', 'magnet'], drift: 0.5, tide: 1.5, bmps: [142, 152, 164, 176, 192], bpmMul: 1.26, diff: 4 },
  { id: 'neon', name: '霓虹深海', nameEn: 'Neon Deep', hint: '霓虹與深海交織，潮流在暗流中轉向。', skill: 'blink', music: { scale: [0,2,3,5,7,9,10], root: 61, prog: 'mixolydian', bpmMul: 1.11, inst: 'epiano' }, hazards: ['nova', 'freeze'], drift: 0.55, tide: 2, bmps: [144, 154, 166, 178, 194], bpmMul: 1.26, diff: 4 },
  { id: 'star', name: '星環軌道', nameEn: 'Star Orbit', hint: '星環旋轉，車道順序會被打亂。', skill: 'blink', music: { scale: [0,2,4,9,11,14,16], root: 69, prog: 'lydian', bpmMul: 1.12, inst: 'bells' }, hazards: ['mirror', 'reverse'], drift: 0.55, tide: 2, bmps: [146, 156, 168, 182, 198], bpmMul: 1.28, diff: 4 },
  { id: 'lava', name: '熔岩迴旋', nameEn: 'Lava Spiral', hint: '熔岩退潮極慢，別被燙到。', skill: 'warp', music: { scale: [0,1,3,5,7,8,10], root: 52, prog: 'phrygian', bpmMul: 1.12, inst: 'organ' }, hazards: ['bolt', 'freeze'], drift: 0.6, tide: 1, bmps: [148, 158, 170, 184, 200], bpmMul: 1.3, diff: 4 },
  { id: 'echo', name: '回響之森', nameEn: 'Echo Forest', hint: '回響會產生影子，但影子是安全的。', skill: 'warp', music: { scale: [0,2,4,5,7,9,12], root: 63, prog: 'dorian', bpmMul: 1.13, inst: 'pluck' }, hazards: ['phantom', 'lag'], drift: 0.55, tide: 2, bmps: [150, 160, 172, 186, 202], bpmMul: 1.32, diff: 5 },
  { id: 'quantum', name: '量子糾纏', nameEn: 'Quantum Entangle', hint: '量子的節拍會分裂又重疊。', skill: 'warp', music: { scale: [0,2,3,6,7,10,12], root: 58, prog: 'aeolian', bpmMul: 1.13, inst: 'glass' }, hazards: ['nova', 'magnet'], drift: 0.6, tide: 2, bmps: [152, 162, 174, 188, 204], bpmMul: 1.32, diff: 5 },
  { id: 'saint', name: '聖歌聖殿', nameEn: 'Choir Sanctum', hint: '聖歌的長拍，休息就是準備。', skill: 'warp', music: { scale: [0,2,4,5,7,9,11], root: 60, prog: 'ionian', bpmMul: 1.14, inst: 'organ' }, hazards: ['reverse', 'freeze'], drift: 0.6, tide: 2, bmps: [154, 164, 176, 190, 208], bpmMul: 1.34, diff: 5 },
  { id: 'chaos', name: '混沌之心', nameEn: 'Chaos Heart', hint: '混沌會隨機召喚二到三種災厄。', skill: 'warp', music: { scale: [0,1,3,6,8,11,12], root: 53, prog: 'phrygian', bpmMul: 1.15, inst: 'chip' }, hazards: ['bolt', 'magnet', 'twin'], drift: 0.65, tide: 2, bmps: [156, 166, 180, 194, 212], bpmMul: 1.36, diff: 5 },
  { id: 'abyss', name: '終焉之海', nameEn: 'Final Abyss', hint: '最後的海洋：所有災厄、所有節拍。', skill: 'warp', music: { scale: [0,2,3,5,7,8,11], root: 56, prog: 'aeolian', bpmMul: 1.16, inst: 'organ' }, hazards: ['nova', 'lag', 'phantom'], drift: 0.7, tide: 2.5, bmps: [158, 170, 184, 198, 216], bpmMul: 1.38, diff: 5 },
  { id: 'eternity', name: '永恆迴圈', nameEn: 'Eternal Loop', hint: '永恆會重播一切：準備好最後的衝鋒。', skill: 'warp', music: { scale: [0,2,4,7,9,12,14], root: 66, prog: 'lydian', bpmMul: 1.18, inst: 'bells' }, hazards: ['mirror', 'reverse', 'twin', 'nova'], drift: 0.75, tide: 2.5, bmps: [160, 172, 186, 200, 220], bpmMul: 1.4, diff: 5 }
];
const worldById = id => WORLDS.find(w => w.id === id) || WORLDS[0];

/* 收集品：世界以內每日 3 個「世界碎片」；技能表 */
const SKILLS = {
  dash:    { name: '衝刺',     desc: '雙擊方向鍵或空白鍵向前疾衝，可穿越成排障礙；冷卻 1.2 秒。', cost: 0 },
  shield:  { name: '相位護盾', desc: '每首歌自動吸收一次致命撞擊，並立即回復 18 相位。', cost: 140 },
  magnet:  { name: '流星磁鐵', desc: '節拍流星穿越時吸附額外能量，Combo 成長速度 +35%，分數倍率上限提升。', cost: 220 },
  blink:   { name: '幻影閃現', desc: '衝刺穿過障礙時額外獲得 +45 分，且潮汐流轉 +6。', cost: 320 },
  warp:    { name: '時空摺疊', desc: '兩次完美穿越後自動展開 0.7 秒慢動作，期間所有碰撞無效。', cost: 460 }
};
const SKILL_IDS = ['dash', 'shield', 'magnet', 'blink', 'warp'];
/* 累積型技能升級（用碎片在圖鑑購買） */
const SKILL_TIERS = { shield: 3, magnet: 3, blink: 2, warp: 2 };
function skillLevel(id) {
  const s = Store.data.skills || {};
  return typeof s[id] === 'number' ? s[id] : (s[id] ? 1 : 0);
}
function hasSkill(id) { return skillLevel(id) > 0; }

/* ============================== 災厄（障礙物）種類 ============================== */
const HAZARDS = {
  wall:     { name: '障碼牆',   desc: '橫向封鎖車道的障礙，穿越或繞行。',                 color: '#ff3d5a', glyph: 'wall' },
  orbs:     { name: '彈幕',     desc: '一波彈幕幾乎封鎖全線，可被衝刺穿越。',             color: '#ff9a3d', glyph: 'orbs' },
  bolt:     { name: '閃電雷',   desc: '雷電橫貫一格，穿越或迴避。',                       color: '#ffe066', glyph: 'bolt' },
  twin:     { name: '雙生花',   desc: '同一拍從不同車道落下，需要連續穿越或繞行。',       color: '#ff8fd8', glyph: 'twin' },
  mirror:   { name: '鏡像',     desc: '複製上一拍的車道排列，反向再來一次。',             color: '#7cc8ff', glyph: 'mirror' },
  grav:     { name: '重力',     desc: '重力車道互相牽引，潮流速度隨之起伏。',             color: '#c8a2ff', glyph: 'grav' },
  phantom:  { name: '幻影',     desc: '虛影誘導：佔據車道但不造成傷害，逼迫你選擇安全車道。', color: '#9aa3c7', glyph: 'phantom' },
  magnet:   { name: '磁暴',     desc: '吸附潮流，干擾車道與障礙物的相對位置。',           color: '#ff7a4a', glyph: 'magnet' },
  freeze:   { name: '冰封',     desc: '凍結兩拍後才落下，破壞原有節奏。',                 color: '#bde8ff', glyph: 'freeze' },
  lag:      { name: '延遲',     desc: '障礙物延遲半拍到來，節拍感被拉長。',               color: '#a48bff', glyph: 'lag' },
  nova:     { name: '新星',     desc: '從中心向兩側擴散的星芒，覆蓋範圍隨時間變大。',     color: '#ffd166', glyph: 'nova' },
  reverse:  { name: '逆流',     desc: '節拍反向推進，潮流短暫回退。',                     color: '#f0ff9a', glyph: 'reverse' }
};
const HAZARD_LIST = Object.keys(HAZARDS);

/* 模式定義 */
const MODES = [
  { id: 'adventure', name: '冒險', icon: '◆', color: 'var(--accent)', desc: '每首約 15 個循環，四段世界逐段加速。', time: null, modeScore: 1 },
  { id: 'endless', name: '無盡', icon: '∞', color: 'var(--accent2)', desc: '流轉速度無上限，直到相位耗盡。', time: null, modeScore: 1.15 },
  { id: 'clip', name: '疾走 15 秒', icon: '◷', color: 'var(--accent3)', desc: '一分鐘高強度衝刺，短時間拉大 Combo。', time: 15, modeScore: 1.2 },
  { id: 'survive', name: '生存 120 秒', icon: '♥', color: 'var(--danger)', desc: '生命有限，撐到最後一刻。', time: 120, modeScore: 1.25 },
  { id: 'challenge', name: '每日挑戰', icon: '✦', color: 'var(--gold)', desc: '每天換一個專屬種子與固定流速，挑戰紀錄。', time: 30, modeScore: 1.35, fixedSpeed: true },
  { id: 'zen', name: '禪模式', icon: '☯', color: 'var(--good)', desc: '不會失敗，自由調整流速，放鬆聆聽。', time: null, modeScore: 0.8, zen: true }
];
const modeById = id => MODES.find(m => m.id === id) || MODES[0];

const DIFFS = [
  { id: 0, name: '簡單', lv: 'NOVICE', color: '#55f0b3', mult: 0.8, unlock: 0, note: '無節拍分離' },
  { id: 1, name: '正常', lv: 'ADVANCED', color: '#38f2ff', mult: 1, unlock: 0, note: '標準節拍' },
  { id: 2, name: '困難', lv: 'EXPERT', color: '#ffd166', mult: 1.22, unlock: 2, note: '需要完成 2 個世界' },
  { id: 3, name: '極限', lv: 'MASTER', color: '#ff8a5c', mult: 1.5, unlock: 4, note: '需要完成 4 個世界' },
  { id: 4, name: '虛空', lv: 'VIRTUAL', color: '#ff3df2', mult: 1.85, unlock: 6, note: '需要完成 6 個世界' }
];

const RANKS = ['見習節拍者', '拍擊學徒', '節奏行者', '潮流駕馭者', '流星獵人', '相位大師', '超越節拍者', '永恆迴圈者', '節拍之神'];
function levelFromXp(xp) {
  let lv = 1, need = 100, acc = 0;
  while (lv < 60 && xp >= acc + need) { acc += need; lv++; need = Math.round(need * 1.22); }
  return { lv, into: xp - acc, need, base: acc };
}
function rankName(lv) { return RANKS[Math.min(RANKS.length - 1, Math.floor((lv - 1) / 4))]; }
function maxSpeedMult() { return 1.3 + Math.min(0.5, levelFromXp(Store.data.xp).lv * 0.012); }

/* 成就列表 */
const ACHIEVEMENTS = [
  { id: 'first',    name: '初次啟程',   ico: '🌱', desc: '完成第一場遊戲。',                 reward: 20,  test: g => Store.data.plays >= 1 },
  { id: 'combo50',  name: '連擊五十',   ico: '🔥', desc: '單場達成 50 Combo。',              reward: 40,  test: g => g && g.maxCombo >= 50 },
  { id: 'combo150', name: '連擊潮汐',   ico: '🌀', desc: '單場達成 150 Combo。',             reward: 80,  test: g => g && g.maxCombo >= 150 },
  { id: 'combo300', name: '不可阻擋',   ico: '⚡', desc: '單場達成 300 Combo。',             reward: 130, test: g => g && g.maxCombo >= 300 },
  { id: 'score10k', name: '萬點流派',   ico: '⭐', desc: '單場分數突破 10,000。',            reward: 50,  test: g => g && g.score >= 10000 },
  { id: 'score100k',name: '十萬流星',   ico: '🌟', desc: '單場分數突破 100,000。',           reward: 150, test: g => g && g.score >= 100000 },
  { id: 'world1',   name: '穿越第一世界', ico: '🚪', desc: '完成拂曉門廊。',                  reward: 30,  test: () => !!Store.data.stats.worldsCleared.dawn },
  { id: 'world5',   name: '五界巡禮',   ico: '🗺️', desc: '完成 5 個不同世界。',              reward: 80,  test: () => Object.keys(Store.data.stats.worldsCleared).length >= 5 },
  { id: 'world10',  name: '十界漫遊',   ico: '🧭', desc: '完成 10 個不同世界。',             reward: 150, test: () => Object.keys(Store.data.stats.worldsCleared).length >= 10 },
  { id: 'world20',  name: '二十界征服', ico: '🏆', desc: '完成 20 個不同世界。',             reward: 280, test: () => Object.keys(Store.data.stats.worldsCleared).length >= 20 },
  { id: 'world30',  name: '全界制霸',   ico: '👑', desc: '完成全部 30 個世界。',             reward: 600, test: () => Object.keys(Store.data.stats.worldsCleared).length >= 30 },
  { id: 'flawless', name: '零失誤',     ico: '💎', desc: '單場不做任何錯誤動作。',           reward: 120, test: g => g && g.clean && g.maxCombo >= 20 },
  { id: 'perfect100', name: '完美百連', ico: '🎯', desc: '單場 100 次完美穿越。',            reward: 140, test: g => g && g.perfect >= 100 },
  { id: 'dash',     name: '衝刺大師',   ico: '💨', desc: '單場衝刺穿越 15 次障礙。',         reward: 100, test: g => g && g.dashes >= 15 },
  { id: 'flower',   name: '花火',       ico: '🎆', desc: '在虛空中看到一次完美綻放。',       reward: 70,  test: g => g && g.flowers >= 1 },
  { id: 'beatmatch',name: '節拍同步',   ico: '🎵', desc: '單場同步率達 98% 以上。',          reward: 90,  test: g => g && g.sync >= 0.98 && g.maxCombo >= 40 },
  { id: 'hard',     name: '困難的挑戰', ico: '🥇', desc: '以困難難度完成一首。',             reward: 160, test: g => g && g.diff >= 2 && g.cleared },
  { id: 'virtual',  name: '虛空挑戰者', ico: '🔮', desc: '以虛空難度完成一首。',             reward: 320, test: g => g && g.diff >= 4 && g.cleared },
  { id: 'survivor', name: '生存本能',   ico: '🛡️', desc: '完成生存 120 秒模式。',            reward: 110, test: g => g && g.mode === 'survive' && g.cleared },
  { id: 'challenge',name: '每日挑戰',   ico: '📅', desc: '完成任一每日挑戰。',               reward: 90,  test: g => g && g.mode === 'challenge' && g.cleared },
  { id: 'zen',      name: '心如止水',   ico: '☯', desc: '在禪模式中聆聽超過 90 秒。',       reward: 60,  test: g => g && g.mode === 'zen' && g.time >= 90 },
  { id: 'lvl5',     name: '節奏行者',   ico: '📈', desc: '達到等級 5。',                     reward: 70,  test: () => levelFromXp(Store.data.xp).lv >= 5 },
  { id: 'lvl15',    name: '潮流駕馭者', ico: '📊', desc: '達到等級 15。',                    reward: 180, test: () => levelFromXp(Store.data.xp).lv >= 15 },
  { id: 'skill3',   name: '技能收藏家', ico: '🧰', desc: '解鎖 3 項技能。',                  reward: 120, test: () => SKILL_IDS.filter(hasSkill).length >= 3 },
  { id: 'skillall', name: '全能節拍者', ico: '🧿', desc: '解鎖全部 5 項技能。',              reward: 260, test: () => SKILL_IDS.every(hasSkill) },
  { id: 'theme',    name: '換裝',       ico: '🎨', desc: '使用 5 種以上的外觀主題。',         reward: 60,  test: () => Object.keys(Store.data.stats.themesUsed || {}).length >= 5 },
  { id: 'misc1',    name: '初見流星',   ico: '☄️', desc: '收集第一片流星碎片。',             reward: 30,  test: () => Store.data.pibs >= 1 },
  { id: 'misc2',    name: '流星獵人',   ico: '✨', desc: '累積 50 片流星碎片。',             reward: 120, test: () => Store.data.pibs >= 50 },
  { id: 'misc3',    name: '潮流寵兒',   ico: '💠', desc: '撿到 10 個潮流水晶。',             reward: 80,  test: () => Store.data.stats.coins >= 10 },
  { id: 'misc4',    name: '十次飛翔',   ico: '🕊️', desc: '遊玩 10 場遊戲。',                 reward: 60,  test: () => Store.data.plays >= 10 },
  { id: 'misc5',    name: '百戰',       ico: '⚔️', desc: '遊玩 100 場遊戲。',                reward: 400, test: () => Store.data.plays >= 100 },
  { id: 'misc6',    name: '節奏史詩',   ico: '📜', desc: '累積穿越 5,000 顆節拍流星。',      reward: 220, test: () => Store.data.stats.totalNotes >= 5000 }
];

/* ============================== 潮汐節點：世界內的進度 ============================== */
const PHASES_PER_WORLD = 4;
const PHASE_NAMES = ['覺醒', '奔流', '狂潮', '終焉'];
const SESSION_PHASES = ['intro', 'verse', 'chorus', 'break', 'drop', 'verse', 'chorus', 'solo', 'drop', 'outro'];
