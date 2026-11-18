'use strict';
/**
 * test/dom.js — 真 DOM + 真 Canvas 的端到端測試
 * ---------------------------------------------------------------------------
 * 為什麼需要這個檔案：
 *   前一代的 test/sim.js 用手寫的假 DOM，其中 `element.children` 是可寫陣列、
 *   canvas 方法是完全不檢查參數的空函式。結果兩個真實缺陷（對唯讀
 *   HTMLCollection 賦值、以及 NaN 傳進 createRadialGradient）在假的環境裡
 *   全部通過，卻在 Safari 上讓整個遊戲黑屏。
 *
 * 這個 harness 改用 jsdom（真正的 DOM 語意：HTMLCollection 唯讀、屬性↔特性
 * 映射、真正的 querySelectorAll）加上 @napi-rs/canvas（真正的 2D context，
 * 會實際點像素），並在 context 外面包一層「WebKit 級」的參數檢查——因為
 * @napi-rs/canvas 對非有限值比 WebKit 寬容。
 *
 * 執行：npm run test:dom
 */

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const JS_FILES = ['js/data.js', 'js/audio.js', 'js/engine.js', 'js/ui.js'];

let failures = 0;
let checks = 0;
function check(cond, msg) {
  checks++;
  if (cond) {
    console.log('  ✓ ' + msg);
  } else {
    failures++;
    console.log('  ✗ ' + msg);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * WebKit 等級的 canvas 參數檢查
 * ------------------------------------------------------------------ */
const NUMERIC_METHODS = new Set([
  'fillRect', 'strokeRect', 'clearRect', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect',
  'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'translate', 'rotate', 'scale',
  'transform', 'setTransform', 'resetTransform', 'fillText', 'strokeText', 'drawImage',
  'setLineDash', 'createLinearGradient', 'createRadialGradient', 'createConicGradient',
  'getImageData', 'putImageData', 'createPattern', 'clip'
]);

function assertFiniteArgs(name, args, bad) {
  for (const a of args) {
    if (typeof a === 'number' && !Number.isFinite(a)) {
      bad.push(name);
      throw new TypeError('The provided value is non-finite (' + name + ')');
    }
  }
}

/** 把真正的 context 包一層：先做 WebKit 式檢查，再交給真 context 繪製 */
function strictify(ctx, onViolation) {
  const gradientCache = new WeakSet();

  function wrapGradient(g, name) {
    if (!g || typeof g !== 'object' || gradientCache.has(g)) return g;
    gradientCache.add(g);
    const add = g.addColorStop.bind(g);
    g.addColorStop = function (offset, color) {
      try {
        assertFiniteArgs(name + '.addColorStop', [offset], []);
        if (typeof color === 'string' && /NaN|Infinity|undefined/.test(color)) {
          throw new TypeError('invalid color: ' + color);
        }
      } catch (e) { onViolation(e); }
      return add(offset, color);
    };
    return g;
  }

  return new Proxy(ctx, {
    get(target, key) {
      const value = target[key];
      if (typeof value !== 'function') return value;
      if (!NUMERIC_METHODS.has(key)) return value.bind(target);
      return function () {
        try {
          assertFiniteArgs(String(key), arguments, []);
        } catch (e) {
          onViolation(e);
          throw e;
        }
        const out = value.apply(target, arguments);
        if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createConicGradient') {
          return wrapGradient(out, String(key));
        }
        return out;
      };
    },
    /* @napi-rs/canvas 的 setter 會做型別 brand check；若 receiver 是 Proxy 就失敗
       （"Failed to unwrap exclusive reference"），因此屬性一律直接寫回 target。 */
    set(target, key, value) {
      target[key] = value;
      return true;
    },
    defineProperty(target, key, descriptor) {
      Object.defineProperty(target, key, descriptor);
      return true;
    }
  });
}

/* ------------------------------------------------------------------ *
 * 啟動一個 jsdom 實例
 * ------------------------------------------------------------------ */
async function boot(opts) {
  opts = opts || {};
  const width = opts.width || 1024;
  const height = opts.height || 768;
  const errors = [];
  let booted = false;

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const m = String((e && e.message) || e);
    if (/Not implemented/.test(m)) return;      // jsdom 未實作的無關 API
    errors.push('jsdomError: ' + m);
  });
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));

  const dom = new JSDOM(html, {
    url: 'https://pulse.test/?debug=1' + (opts.selftest ? '&selftest=1' : ''),
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      try {
        Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: height, writable: true, configurable: true });
      } catch (e) { /* ignore */ }

      const proto = window.HTMLCanvasElement.prototype;
      const original = proto.getContext;
      proto.getContext = function (type, ...rest) {
        // @napi-rs/canvas 對同一張畫布只允許一個獨佔 context，因此快取起來重複使用
        if (type === '2d' && this.__psCtx2d) return this.__psCtx2d;
        const ctx = original.call(this, type, ...rest);
        if (!ctx) return ctx;
        const wrapped = strictify(ctx, (e) => errors.push('canvas: ' + e.message));
        if (type === '2d') this.__psCtx2d = wrapped;
        return wrapped;
      };
    }
  });

  const w = dom.window;
  w.addEventListener('error', (e) => {
    errors.push('window.onerror: ' + ((e && e.message) || e));
  });
  w.addEventListener('unhandledrejection', (e) => {
    errors.push('unhandledrejection: ' + ((e && e.reason && e.reason.message) || e));
  });

  // 以 <script> 注入（保留瀏覽器的 script scope 語意，不能用 eval）
  for (const file of JS_FILES) {
    const script = w.document.createElement('script');
    script.textContent = fs.readFileSync(path.join(ROOT, file), 'utf8');
    w.document.head.appendChild(script);
  }

  // 等待 boot 完成（Game.init 內有 450ms 的啟動延遲）
  for (let i = 0; i < 60; i++) {
    if (w.__PS_APP && w.__PS_APP.booted && !w.document.getElementById('boot').classList.contains('gone')) {
      // boot 面板的 .gone 由 setTimeout 加上，再等一拍
    }
    if (w.__PS_APP && w.__PS_APP.booted) { booted = true; break; }
    await sleep(50);
  }
  await sleep(600);   // 讓 450ms 的 boot 淡出計時器真的跑完

  return { dom, w, document: w.document, errors, booted, width, height };
}

/* ------------------------------------------------------------------ *
 * 測試 1：啟動
 * ------------------------------------------------------------------ */
async function testBoot() {
  console.log('D1: 啟動（真 DOM + 真 Canvas）');
  const ctx = await boot({ width: 1024, height: 768 });
  const { w, document: d, errors } = ctx;

  check(ctx.booted, 'init 完成（App.booted = true）');
  check(d.getElementById('boot').classList.contains('gone'), '啟動遮罩已淡出（#boot.gone）');
  check(String(d.getElementById('ts-level').textContent) === '1', '標題等級顯示 1');
  check(d.querySelectorAll('#mode-grid .mode').length === 6, '模式畫面 6 個模式卡');

  const hVar = d.documentElement.style.getPropertyValue('--h');
  check(/^[\d.]+px$/.test(hVar), 'CSS --h 為 px（' + hVar + '）');

  // 真正的 HTMLCollection：唯讀、有 item()
  const kids = d.getElementById('mode-grid').children;
  check(typeof kids.item === 'function', 'children 是真正的 HTMLCollection（有 item()）');
  let readonlyThrew = false;
  try { kids.length = 0; } catch (e) { readonlyThrew = true; }
  check(readonlyThrew, '對 children.length 賦值會拋錯（真 DOM 語意）');

  check(errors.length === 0, '啟動期間零錯誤' + (errors.length ? '：' + errors.slice(0, 2).join(' | ') : ''));
  ctx.dom.window.close();
  return ctx;
}

/* ------------------------------------------------------------------ *
 * 測試 2：每個畫面
 * ------------------------------------------------------------------ */
async function testScreens() {
  console.log('D2: 全部畫面切換');
  const g = await boot({ width: 1180, height: 820 });   // iPad 橫向
  const { w, document: d } = g;
  const screens = ['mode', 'growth', 'album', 'achievements', 'themes', 'title'];
  for (const s of screens) {
    try {
      w.__PS_APP.setScreen(s);
      await sleep(30);
      const active = d.querySelectorAll('.screen.active');
      check(active.length === 1 && active[0].id === 'screen-' + s, '畫面 ' + s + ' 正常顯示');
    } catch (e) {
      check(false, '畫面 ' + s + ' 切換失敗：' + e.message);
    }
  }
  // 圖鑑分頁
  let albumOk = true;
  try {
    w.__PS_APP.setScreen('album');
    for (const tab of ['hazards', 'skills', 'worlds']) {
      w.__PS_APP.albumTab = tab;
      w.__PS_APP.renderAlbum();
    }
  } catch (e) { albumOk = false; console.log('    ' + e.message); }
  check(albumOk, '圖鑑三個分頁皆可渲染');
  check(g.errors.length === 0, '畫面切換零錯誤' + (g.errors.length ? '：' + g.errors.slice(0, 2).join(' | ') : ''));
  g.dom.window.close();
}

/* ------------------------------------------------------------------ *
 * 測試 3：真的開一場並讓它跑
 * ------------------------------------------------------------------ */
async function testPlay(width, height, label) {
  const g = await boot({ width, height });
  const { w, document: d } = g;
  const App = w.__PS_APP;
  let ok = true;
  try {
    w.__PS_APP.setScreen('mode');
    App.startSelected();
    await sleep(400);
  } catch (e) { ok = false; check(false, label + ' 開局失敗：' + e.message); }

  const game = App.game;
  check(ok && !!game, label + ' 成功開局');

  // 模擬輸入：左右移動 + 衝刺 + 暫停/繼續
  const key = (k) => {
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
    w.dispatchEvent(new w.KeyboardEvent('keyup', { key: k, bubbles: true }));
  };
  // 等待 3.2 秒倒數結束
  for (let i = 0; i < 60 && game.state !== 'play'; i++) await sleep(80);

  const framesStart = game.elapsed;
  for (let i = 0; i < 40; i++) {
    key(i % 2 ? 'ArrowRight' : 'ArrowLeft');
    if (i % 7 === 0) key(' ');
    await sleep(50);
  }
  const advanced = game.elapsed - framesStart;
  check(game.state === 'play' || game.state === 'over', label + ' 遊戲推進中（state=' + game.state + '）');
  check(advanced > 0.3, label + ' 時間有推進（+' + advanced.toFixed(2) + 's）');

  // 真的畫了東西：取樣像素，確認不是單一顏色
  const cv = d.getElementById('game-canvas');
  const c2d = (game && game.ctx) || cv.getContext('2d');
  let distinct = 0;
  try {
    const img = c2d.getImageData(0, 0, cv.width, cv.height).data;
    const seen = new Set();
    for (let i = 0; i < img.length; i += 4 * 997) {
      seen.add(img[i] + ',' + img[i + 1] + ',' + img[i + 2]);
      if (seen.size > 24) break;
    }
    distinct = seen.size;
  } catch (e) {
    distinct = -1;
  }
  check(distinct === -1 ? false : distinct > 5, label + ' canvas 有實際繪製內容（' + distinct + ' 種顏色取樣）');

  const V = w.__PS_DEBUG && w.__PS_DEBUG.View;
  if (V) {
    check(V.cssW <= width + 1 && V.cssH <= height + 1,
      label + ' 畫布不溢出視窗（' + Math.round(V.cssW) + '×' + Math.round(V.cssH) + ' / ' + width + '×' + height + '）');
  } else {
    check(false, label + ' 缺少 __PS_DEBUG（供測試讀取 View）');
  }

  check(g.errors.length === 0, label + ' 執行期間零錯誤' + (g.errors.length ? '：' + g.errors.slice(0, 3).join(' | ') : ''));
  g.dom.window.close();
}

/* ------------------------------------------------------------------ *
 * 測試 4：多種 viewport
 * ------------------------------------------------------------------ */
async function testViewports() {
  console.log('D4: 多解析度');
  const sizes = [[320, 568, 'iPhone SE 直向'], [390, 844, 'iPhone 14 直向'], [844, 390, 'iPhone 橫向'], [1180, 820, 'iPad 橫向'], [1920, 1080, '桌機']];
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const [wd, ht, name] of sizes) {
    const g = await boot({ width: wd, height: ht });
    const V = g.w.__PS_DEBUG && g.w.__PS_DEBUG.View;
    const hVar = parseFloat(g.w.document.documentElement.style.getPropertyValue('--h'));
    const ok = V && V.cssW <= wd + 1 && V.cssH <= ht + 1 && hVar >= 460 && hVar <= 1000;
    check(ok, name + ' ' + wd + '×' + ht + ' → css ' + (V ? Math.round(V.cssW) + '×' + Math.round(V.cssH) : '?') + '，--h ' + hVar + 'px');
    g.dom.window.close();
  }
  void html;
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */
(async () => {
  console.log('=== test/dom.js：jsdom + @napi-rs/canvas 端到端測試 ===\n');
  try {
    await testBoot();
    await testScreens();
    await testPlay(1180, 820, 'iPad 橫向');
    await testPlay(390, 844, '手機直向');
    await testViewports();
  } catch (e) {
    failures++;
    console.log('\n✗ 測試中止：' + (e && e.stack || e));
  }
  console.log('\n' + (failures === 0 ? 'ALL DOM CHECKS PASSED（' + checks + ' 項）' : failures + ' / ' + checks + ' 項失敗'));
  process.exit(failures ? 1 : 0);
})();
