'use strict';

/* ============================== 應用層 ============================== */
const App = {
  screen: 'title',
  theme: THEMES[0],
  game: null,
  sel: { mode: 'adventure', diff: 1, world: 0, speed: 1 },
  albumTab: 'worlds',
  growthTab: 'quests',
  selItem: null,
  lastResult: null,
  prevBack: null,
  input: { left: false, right: false, lastLeftTap: 0, lastRightTap: 0, pointer: null },
  keys: {},
  booted: false,

  /* ---------- 啟動 ---------- */
  init() {
    Store.load();
    this.theme = themeById(Store.data.theme);
    this.applyTheme(Store.data.theme, true);
    this.bindDom();
    this.checkDaily();
    this.game = new Game();
    this.game.attach($('game-canvas'));
    this.game.setTheme(this.theme);
    this.refreshTitle();
    this.renderModeScreen();
    this.checkAchievements(null);
    this.renderAchievements();
    this.renderGrowth();
    this.booted = true;
    const boot = $('boot');
    const fill = $('boot-fill');
    if (fill) fill.style.width = '100%';
    setTimeout(() => {
      if (boot) boot.classList.add('gone');
      const g = this.game;
      if (g && !g.rafId) { g.lastTs = now(); g.loop(); }
    }, 450);
    setTimeout(() => this.tip(), 1800);
  },

  tip() {
    const tips = [
      '提示：移動時飛梭會自然升起，讓流星從身旁流過。',
      '提示：節拍領先移動、落點精準，就能打出「完美穿越」。',
      '提示：雙擊方向鍵或空白鍵可施展衝刺，穿越整排障礙。',
      '提示：撞擊會讓相位減少 16%，並中斷 Combo。',
      '提示：每 10 Combo 連擊有音效，每 50 連擊回復相位。',
      '提示：到圖鑑用碎片解鎖技能，會讓節奏更爽快。'
    ];
    if (this.screen === 'game') return;
    this.toast(pick(tips), '', 3200);
  },

  setScreen(name, back) {
    /* 畫面的顯示由 .active 控制（.screen 預設 display:none），
       show() 只切換 .hidden，兩者不可混用。 */
    document.querySelectorAll('.screen').forEach(sec => sec.classList.remove('active'));
    const target = $('screen-' + name);
    if (target) {
      target.classList.add('active');
      target.classList.remove('hidden');
    }
    hideAllOverlays();
    this.prevBack = back || null;
    this.screen = name;
    if (name === 'game') {
      this.game && this.game.resize && this.game.resize();
    } else {
      if (this.game) this.game.abort();
      if (name === 'title') this.refreshTitle();
      if (name === 'mode') this.renderModeScreen();
      if (name === 'themes') this.renderThemes();
      if (name === 'album') this.renderAlbum();
      if (name === 'achievements') this.renderAchievements();
      if (name === 'growth') this.renderGrowth();
      const first = $('screen-' + name) && $('screen-' + name).querySelector('.btn:not(:disabled)');
      if (first && name !== 'game') { try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
  },

  /* ---------- 主題 ---------- */
  applyTheme(id, silent) {
    const t = themeById(id);
    this.theme = t;
    Store.data.theme = t.id;
    const c = t.cols;
    const root = document.documentElement;
    const map = { bg: c[0], bg2: c[1], accent: c[2], accent2: c[3], accent3: c[4], gold: c[5], panel: c[6] };
    Object.keys(map).forEach(k => root.style.setProperty('--' + k, map[k]));
    root.style.setProperty('--panel', rgba(c[6], 0.82));
    root.style.setProperty('--panel2', rgba(darken(c[6], 0.25), 0.95));
    root.style.setProperty('--line', rgba(c[2], 0.22));
    root.style.setProperty('--text', mixHex('#ffffff', c[2], 0.12));
    root.style.setProperty('--dim', mixHex(c[6], c[2], 0.42));
    root.style.setProperty('--player', t.player || c[2]);
    /* 以 rgba() 預先算好強調色的半透明版本：
       舊版 Safari 不支援 color-mix()，直接給它可用的值，避免背景光暈整片消失 */
    root.style.setProperty('--accentA', rgba(c[2], 0.18));
    root.style.setProperty('--accent2A', rgba(c[3], 0.20));
    root.style.setProperty('--accent3A', rgba(c[4], 0.10));
    root.style.setProperty('--glow', rgba(c[2], 0.28));
    document.documentElement.setAttribute('data-theme', t.id);
    if (!Store.data.stats.themesUsed) Store.data.stats.themesUsed = {};
    Store.data.stats.themesUsed[t.id] = true;
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', c[0]);
    if (this.game) this.game.setTheme(t);
    Store.save();
    if (!silent) Audio2.sfx('click');
    const grid = $('theme-grid');
    if (grid) grid.querySelectorAll('.theme-card').forEach(card => card.classList.toggle('on', card.dataset.id === t.id));
    const badge = $('theme-badge');
    if (badge) badge.textContent = t.name;
  },

  randomTheme() {
    const others = THEMES.filter(t => t.id !== this.theme.id);
    this.applyTheme(pick(others).id);
    this.toast('外觀切換：' + this.theme.name);
  },

  /* ---------- 標題 ---------- */
  refreshTitle() {
    const d = Store.data;
    const lv = levelFromXp(d.xp).lv;
    setText($('ts-level'), lv);
    setText($('ts-frag'), d.frag);
    setText($('ts-maxcombo'), d.stats.maxCombo || 0);
    const best = Math.max(0, ...Object.values(d.bestScore || {}));
    setText($('ts-best'), fmt(best));
    setText($('theme-badge'), this.theme.name);
  },

  /* ---------- 模式畫面 ---------- */
  renderModeScreen() {
    const grid = $('mode-grid');
    if (!grid) return;
    const d = Store.data;
    grid.innerHTML = '';
    MODES.forEach(m => {
      const best = Math.max(0, ...(d.best[m.id] || []));
      const btn = el('button', 'mode' + (this.sel.mode === m.id ? ' selected' : ''));
      btn.style.setProperty('--mc', m.color);
      btn.dataset.mode = m.id;
      btn.innerHTML =
        '<div class="m-name"><span class="ico">' + m.icon + '</span>' + m.name + '</div>' +
        '<div class="m-desc">' + m.desc + '</div>' +
        '<div class="m-meta">' + (m.time ? '<span class="chip">' + m.time + ' 秒</span>' : '<span class="chip">時間不限</span>') +
        (m.fixedSpeed ? '<span class="chip">固定流速</span>' : '') + (m.zen ? '<span class="chip">無失敗</span>' : '') + '</div>' +
        (best > 0 ? '<div class="m-best">' + fmt(best) + '</div>' : '');
      on(btn, 'click', () => {
        this.sel.mode = m.id;
        Audio2.sfx('click');
        this.renderModeScreen();
      });
      grid.appendChild(btn);
    });
    const dg = $('diff-grid');
    dg.innerHTML = '';
    const doneWorlds = Object.keys(d.stats.worldsCleared || {}).length;
    this.prevUnlocked = typeof this.prevUnlocked === 'number' ? this.prevUnlocked : 0;
    DIFFS.forEach(df => {
      const locked = doneWorlds < df.unlock;
      const b = el('button', 'diff' + (this.sel.diff === df.id ? ' selected' : '') + (locked ? ' locked' : ''));
      b.style.setProperty('--dc', df.color);
      if (locked) {
        b.innerHTML = '<span class="d-name">🔒</span><span class="d-lv">' + df.name + '</span><span class="d-lock">' + df.note + '</span>';
        b.title = df.note;
      } else {
        b.innerHTML = '<span class="d-name">' + df.name + '</span><span class="d-lv">Lv.' + (df.id * 3 + 3) + ' · ' + df.lv + '</span>';
      }
      on(b, 'click', () => {
        if (locked) { this.toast('🔒 需要完成 ' + df.unlock + ' 個世界'); Audio2.sfx('back'); return; }
        this.sel.diff = df.id;
        Audio2.sfx('click');
        this.renderModeScreen();
      });
      dg.appendChild(b);
    });
    const ws = $('world-select');
    if (ws) {
      ws.innerHTML = '';
      WORLDS.forEach((w, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = (i + 1) + '. ' + w.name;
        ws.appendChild(o);
      });
      ws.value = String(this.sel.world);
      ws.disabled = this.sel.mode === 'challenge';
    }
    const sl = $('speed-slider');
    if (sl) {
      const max = maxSpeedMult();
      sl.max = String(max.toFixed(2));
      sl.value = String(this.sel.speed);
      sl.disabled = !!(modeById(this.sel.mode).fixedSpeed);
      setText($('speed-val'), this.sel.speed.toFixed(2) + '×');
    }
    const hint = $('mode-hint');
    if (hint) {
      const w = WORLDS[this.sel.world];
      const df = DIFFS[this.sel.diff];
      hint.textContent = '世界 ' + (this.sel.world + 1) + '／' + WORLDS.length + ' · ' + w.name + '：' + w.hint + '　｜　' + df.name + '難度：分數 ×' + df.mult.toFixed(2);
    }
    const cur = modeById(this.sel.mode);
    setText($('hud-mode'), cur.name);
    setText($('hud-diff'), DIFFS[this.sel.diff].name);
  },

  startSelected() {
    Audio2.resume();
    Audio2.sfx('click');
    const mode = modeById(this.sel.mode);
    const worldIdx = mode.id === 'challenge' ? (hashStr(todayStr()) % WORLDS.length) : this.sel.world;
    const opts = {
      mode: mode.id,
      diff: this.sel.diff,
      worldId: WORLDS[worldIdx].id,
      speed: Math.min(this.sel.speed, maxSpeedMult()),
      seed: mode.id === 'challenge' ? 'daily-' + todayStr() : undefined
    };
    this.sel.world = worldIdx;
    this.prepareGameUI(opts);
    this.setScreen('game');
    this.game.start(opts);
  },

  prepareGameUI(opts) {
    const m = modeById(opts.mode);
    setText($('hud-mode'), m.name);
    setText($('hud-diff'), DIFFS[opts.diff].name);
    /* 建立「世界階段」提示 */
    const meta = $('hud-meta');
    if (meta) {
      const old = $('hud-stage');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      const st = el('span', 'chip');
      st.id = 'hud-stage';
      st.textContent = '奔流';
      meta.appendChild(st);
    }
    show($('hud-timer'), false);
    show($('hud-life'), false);
    show($('combo-display'), false);
    const hb = $('hint-bar');
    if (hb) hb.className = '';
    const pg = $('hud-phases');
    if (pg) {
      pg.innerHTML = '<div class="ph"><span class="ph-label">相位</span><div class="ph-bar"><div class="ph-fill" style="width:100%;--c:var(--accent)"></div></div><span class="ph-num">100%</span></div>' +
        '<div class="ph"><span class="ph-label">流轉</span><div class="ph-bar"><div class="ph-fill" style="width:100%;--c:var(--accent2)"></div></div><span class="ph-num">100%</span></div>';
    }
    const marks = $('pb-marks');
    if (marks) {
      marks.innerHTML = '';
      for (let i = 0; i < PHASES_PER_WORLD; i++) marks.appendChild(document.createElement('i'));
    }
    this.game.phFills = this.game.phBars = this.game.phNums = null;
    this.game.comboNum = null;
    this.game.pbDone = null;
    const tc = $('touch-ctrl');
    if (tc) tc.style.display = (Store.data.settings.touch === 'always' || (Store.data.settings.touch === 'auto' && View.mobile)) ? 'block' : 'none';
    positionHud();
  },

  /* ---------- 結果 ---------- */
  showResult(r) {
    this.lastResult = r;
    applyResult(r);
    const lvB = levelFromXp(Store.data.xp - r.xp);
    const lvA = levelFromXp(Store.data.xp);
    const missions = this.updateMissions(r);
    const dlg = $('dlg-result');
    if (!dlg) return;
    const gc = gradeColor(r.grade);
    const isPB = Store.data.stats.lastPB;
    const unlocked = this.checkAchievements(r);
    dlg.innerHTML =
      '<div class="result-head">' +
        '<div class="result-title' + (r.cleared ? '' : ' fail') + '">' + (r.cleared ? '完 成' : '失 敗') + '</div>' +
        '<div class="result-sub">' + r.worldName + ' · ' + r.modeName + ' · ' + DIFFS[r.diff].name + (r.reason ? ' · ' + r.reason : '') + '</div>' +
      '</div>' +
      '<div class="row" style="justify-content:center;align-items:center;gap:0.03rem;">' +
        '<div class="grade-wrap"><div class="grade g-' + r.grade + '" style="color:' + gc + '">' + r.grade + '</div><div class="dim" style="font-size:.013rem;letter-spacing:.3em">GRADE</div></div>' +
        '<div class="col" style="gap:.006rem;min-width:0;">' +
          '<div class="row" style="gap:.014rem;align-items:baseline;">' +
            '<div class="mono" style="font-size:.05rem;font-weight:900;line-height:1;color:var(--text)">' + fmt(r.score) + '</div>' +
            '<span class="dim" style="font-size:.016rem">分</span>' +
          '</div>' +
          '<div class="row" style="gap:.006rem;flex-wrap:wrap;">' +
            '<span class="chip">最大 <b>' + r.maxCombo + '</b> Combo</span>' +
            '<span class="chip">同步 <b>' + Math.round(r.sync * 100) + '%</b></span>' +
            '<span class="chip">BPM <b>' + r.bpm + '</b></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      (isPB ? '<div class="pb-toast">★ 新紀錄！ ★</div>' : '') +
      '<div class="result-stats">' +
        '<div class="rs"><span class="rs-v gold">' + r.perfect + '</span><span class="rs-k">完美</span></div>' +
        '<div class="rs"><span class="rs-v">' + r.good + '</span><span class="rs-k">穿越</span></div>' +
        '<div class="rs"><span class="rs-v" style="color:var(--danger)">' + r.miss + '</span><span class="rs-k">漏接</span></div>' +
        '<div class="rs"><span class="rs-v">' + r.dashes + '</span><span class="rs-k">衝刺穿越</span></div>' +
        '<div class="rs"><span class="rs-v">' + fmtTime(r.time) + '</span><span class="rs-k">時間</span></div>' +
        '<div class="rs"><span class="rs-v accent">' + r.pibs + '</span><span class="rs-k">碎片</span></div>' +
        '<div class="rs"><span class="rs-v gold">' + r.coins + '</span><span class="rs-k">水晶</span></div>' +
        '<div class="rs"><span class="rs-v" style="color:var(--good)">' + Math.round(r.phase) + '%</span><span class="rs-k">剩餘相位</span></div>' +
      '</div>' +
      '<div class="result-lines">' +
        '<div class="result-line"><span>✦ 經驗值</span><span class="v accent">+' + r.xp + ' XP' + (lvA.lv > lvB.lv ? ' <span class="gold">→ Lv.' + lvA.lv + '</span>' : '') + '</span></div>' +
        '<div class="result-line"><span>✦ 流星碎片</span><span class="v gold">+' + r.pibs + '</span></div>' +
        (unlocked.length ? '<div class="result-line"><span>🏆 新成就</span><span class="v">' + unlocked.map(a => a.name).join('、') + '</span></div>' : '') +
        (r.shieldSaves ? '<div class="result-line"><span>🛡 護盾救援</span><span class="v">' + r.shieldSaves + ' 次</span></div>' : '') +
      '</div>' +
      (missions.length ? ('<div class="mission-list">' + missions.map(m => '<div class="mission done">✓ 任務「' + m + '」完成</div>').join('') + '</div>') : '') +
      '<div class="dlg-actions">' +
        '<button class="btn btn-ghost" data-act="home">返回標題</button>' +
        '<button class="btn" data-act="next">下一世界</button>' +
        '<button class="btn btn-primary" data-act="retry">再來一次 <span style="opacity:.6">R</span></button>' +
      '</div>';
    const ovEl = $("ov-result"); if (ovEl) { ovEl.classList.add("show"); ovEl.style.display = "flex"; }
    if (r.cleared) Audio2.sfx('level');
    /* 綁定結果畫面按鈕（以 querySelectorAll 取得，確保任何瀏覽器都一致） */
    const resultBtns = typeof dlg.querySelectorAll === 'function' ? dlg.querySelectorAll('[data-act]') : [];
    Array.prototype.forEach.call(resultBtns, b => {
      on(b, 'click', () => {
        const act = b.dataset.act;
        Audio2.sfx('click');
        hideAllOverlays();
        if (act === 'retry') this.startSelected();
        else if (act === 'next') {
          this.sel.world = Math.min(WORLDS.length - 1, this.sel.world + 1);
          this.startSelected();
        } else this.setScreen('title');
      });
    });
  },

  /* ---------- 設定 ---------- */
  openSettings(fromGame) {
    this.settingsFromGame = !!fromGame;
    const st = Store.data.settings;
    const dlg = $('dlg-settings');
    const row = (label, id, type, val, extra) => {
      if (type === 'range') {
        return '<div class="set-item"><span class="lbl">' + label + '</span><input type="range" id="set-' + id + '" min="0" max="1" step="0.05" value="' + val + '"><span class="val" id="val-' + id + '">' + Math.round(val * 100) + '%</span></div>';
      }
      if (type === 'toggle') {
        return '<div class="set-item"><span class="lbl">' + label + '</span><button class="toggle' + (val ? ' on' : '') + '" id="set-' + id + '" aria-pressed="' + !!val + '"></button></div>';
      }
      if (type === 'seg') {
        return '<div class="set-item"><span class="lbl">' + label + '</span><div class="seg" id="set-' + id + '">' +
          extra.map(o => '<button data-v="' + o[0] + '" class="' + (String(val) === String(o[0]) ? 'on' : '') + '">' + o[1] + '</button>').join('') + '</div></div>';
      }
      return '';
    };
    dlg.innerHTML =
      '<div class="dlg-title">⚙ 設定與操作' + (fromGame ? '' : '') + '<button class="btn btn-icon btn-ghost x" data-close>✕</button></div>' +
      '<div class="settings-grid">' +
        row('音樂音量', 'music', 'range', st.music) +
        row('音效音量', 'sfx', 'range', st.sfx) +
        row('車道數', 'lanes', 'seg', st.lanes, [[3, '3 車道'], [4, '4 車道'], [5, '5 車道']]) +
        row('觸控按鍵', 'touch', 'seg', st.touch, [['auto', '自動'], ['always', '顯示'], ['off', '隱藏']]) +
        row('畫面震動', 'screenShake', 'toggle', st.screenShake) +
        row('閃光效果', 'flash', 'toggle', st.flash) +
        row('粒子特效', 'particles', 'seg', st.particles, [['high', '高'], ['low', '低'], ['off', '關']]) +
        row('節拍提示', 'hint', 'toggle', st.hint) +
        row('背景動態', 'motionFx', 'toggle', st.motionFx) +
        row('流速倍率', 'scroll', 'range', (st.scroll - 0.75) / 0.6) +
      '</div>' +
      '<div class="section-title">操作說明 <span class="line"></span></div>' +
      '<div class="dlg-text">' +
        '移動：<b>← →</b> 或 <b>A D</b>／觸控左右鍵／在畫面上左右滑動<br>' +
        '衝刺：<b>空格</b>／<b>Shift</b>／<b>Z</b>／雙擊方向鍵／觸控 ⚡<br>' +
        '暫停：<b>Esc</b>／<b>P</b>；遊戲中 <b>M</b> 靜音；<b>R</b> 重試<br>' +
        '全螢幕：<b>F</b>；切換主題：<b>T</b>' +
      '</div>' +
      '<div class="row" style="justify-content:space-between;align-items:center">' +
        '<span class="dim mono" style="font-size:max(0.012rem,10px)">build ' + APP_VERSION + '</span>' +
        '<span class="dim" style="font-size:max(0.012rem,10px)">' + APP_UA_SHORT() + '</span>' +
      '</div>' +
      '<div class="dlg-actions">' +
        '<button class="btn btn-ghost btn-danger" data-act="reset">清除存檔</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-primary" data-close>完成</button>' +
      '</div>';
    const ovS = $('ov-settings'); if (ovS) { ovS.classList.add('show'); ovS.style.display = 'flex'; }
    const bind = (id, type) => {
      const n = $('set-' + id);
      if (!n) return;
      if (type === 'range') {
        const apply = () => {
          const v = parseFloat(n.value);
          if (id === 'scroll') {
            st.scroll = 0.75 + v * 0.6;
            setText($('val-' + id), st.scroll.toFixed(2) + '×');
            this.sel.speed = clamp(st.scroll, 0.75, maxSpeedMult());
            if (this.screen === 'mode') { const sl = $('speed-slider'); if (sl) sl.value = String(this.sel.speed); setText($('speed-val'), this.sel.speed.toFixed(2) + '×'); }
          } else {
            st[id] = v;
            setText($('val-' + id), Math.round(v * 100) + '%');
          }
          if (id === 'music' || id === 'sfx') Audio2.applyVolumes();
          Store.save();
        };
        on(n, 'input', apply);
        on(n, 'change', apply);
      } else if (type === 'toggle') {
        on(n, 'click', () => {
          st[id] = !st[id];
          n.classList.toggle('on', st[id]);
          n.setAttribute('aria-pressed', String(!!st[id]));
          Store.save();
          Audio2.sfx('click');
        });
      } else {
        n.querySelectorAll('button').forEach(b => on(b, 'click', () => {
          n.querySelectorAll('button').forEach(x => x.classList.remove('on'));
          b.classList.add('on');
          let v = b.dataset.v;
          if (id === 'lanes') { v = parseInt(v, 10); View.laneCount = v; if (this.game) { View.laneW = View.pathW / v; if (this.game.state !== 'idle' && this.game.player) this.game.player.lane = Math.min(this.game.player.lane, v - 1); } }
          st[id] = v;
          Store.save();
          Audio2.sfx('click');
        }));
      }
    };
    bind('music', 'range'); bind('sfx', 'range'); bind('scroll', 'range');
    bind('lanes', 'seg'); bind('touch', 'seg'); bind('particles', 'seg');
    bind('screenShake', 'toggle'); bind('flash', 'toggle'); bind('hint', 'toggle'); bind('motionFx', 'toggle');
    dlg.querySelectorAll('[data-close]').forEach(b => on(b, 'click', () => this.closeSettings()));
    const rst = dlg.querySelector('[data-act=reset]');
    if (rst) on(rst, 'click', () => {
      if (this._confirmReset) {
        Store.reset();
        this.applyTheme(Store.data.theme, true);
        this.refreshTitle();
        this.toast('存檔已清除');
        this.closeSettings();
        this.setScreen('title');
        this._confirmReset = false;
      } else {
        this._confirmReset = true;
        rst.textContent = '再按一次確認';
        setTimeout(() => { rst.textContent = '清除存檔'; this._confirmReset = false; }, 3000);
      }
    });
  },
  closeSettings() {
    const ovS = $('ov-settings'); if (ovS) { ovS.classList.remove('show'); ovS.style.display = ''; }
    if (this.screen === 'mode') this.renderModeScreen();
  },

  /* ---------- 暫停 ---------- */
  openPause() {
    const g = this.game;
    if (!g || (g.state !== 'play' && g.state !== 'ready')) return;
    g.__prevState = g.state;
    g.state = 'paused';
    Music.stop(false);
    const dlg = $('dlg-pause');
    const opts = {
      mode: g.mode.name, diff: DIFFS[g.diff].name, world: g.world.name, bpm: g.chart.bpm
    };
    dlg.innerHTML =
      '<div class="dlg-title">❚❚ 暫停中 <span class="spacer"></span><span class="chip">' + opts.world + ' · ' + opts.mode + ' · ' + opts.diff + ' · ' + opts.bpm + ' BPM</span></div>' +
      '<div class="dlg-text">分數 <b class="mono">' + fmt(g.displayScore) + '</b> · 最大連擊 <b class="mono">' + g.maxCombo + '</b> · 相位 <b class="mono">' + Math.round(g.phaseEnergy) + '%</b></div>' +
      '<div class="dlg-actions" style="justify-content:flex-start;flex-wrap:wrap">' +
        '<button class="btn btn-primary" data-act="resume">繼續 <span style="opacity:.6">ESC</span></button>' +
        '<button class="btn" data-act="restart">重新開始 <span style="opacity:.6">R</span></button>' +
        '<button class="btn" data-act="settings">⚙ 設定</button>' +
        '<button class="btn" data-act="speed">流速 ' + '<span id="pause-speed">' + (g.speed).toFixed(2) + '×</span></button>' +
        '<button class="btn btn-ghost btn-danger" data-act="quit">結束</button>' +
      '</div>' +
      '<div class="dlg-text" style="font-size:.013rem">提示：使用「流速」可即時調整譜面速度，熟練後再慢慢加快。</div>';
    const ovP = $('ov-pause'); if (ovP) { ovP.classList.add('show'); ovP.style.display = 'flex'; }
    dlg.querySelectorAll('[data-act]').forEach(b => on(b, 'click', () => {
      Audio2.sfx('click');
      const act = b.dataset.act;
      if (act === 'resume') this.resumeGame();
      else if (act === 'restart') { hideAllOverlays(); this.startSelected(); }
      else if (act === 'settings') this.openSettings(true);
      else if (act === 'speed') {
        const ns = Math.round((g.speed + 0.1) * 100) / 100;
        g.speed = ns > maxSpeedMult() ? 0.75 : ns;
        this.sel.speed = g.speed;
        setText($('pause-speed'), g.speed.toFixed(2) + '×');
        g.chart.bpm = Math.round(clamp(g.world.bmps[g.diff] * g.world.bpmMul * g.speed, 60, 300));
        g.chart.beat = 60 / g.chart.bpm;
        Music.bpm = g.chart.bpm;
        setText($('hud-bpm'), g.chart.bpm);
      } else if (act === 'quit') { hideAllOverlays(); g.abort(); this.setScreen('title'); }
    }));
  },
  resumeGame() {
    const g = this.game;
    hideAllOverlays();
    if (!g) return;
    if (g.state === 'paused') {
      g.state = g.__prevState || 'play';
      g.lastTs = now();
      if (g.state === 'play' && Audio2.ready) Music.start(g.world, g.chart.bpm, 0.4);
    }
  },

  /* ---------- 提示 ---------- */
  toast(msg, cls, dur) {
    const box = $('toasts');
    if (!box) return;
    const t = el('div', 'toast ' + (cls || ''));
    t.innerHTML = msg;
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, dur || 2600);
  },

  /* ---------- 成長 / 任務 ---------- */
  checkDaily() {
    const q = Store.data.quests;
    const today = todayStr();
    if (q.day !== today) {
      q.day = today;
      const r = new Rng(hashStr('quests-' + today));
      const pickQ = () => {
        const pool = [
          { id: 'plays', n: 3, label: '完成 3 場遊戲', rew: 40, key: 'plays' },
          { id: 'combo', n: 60, label: '單場達成 60 Combo', rew: 50, key: 'maxCombo' },
          { id: 'perfect', n: 40, label: '單場 40 次完美穿越', rew: 45, key: 'perfect' },
          { id: 'coins', n: 8, label: '拾取 8 個潮流水晶', rew: 35, key: 'coins' },
          { id: 'dash', n: 10, label: '衝刺穿越 10 次', rew: 45, key: 'dashes' },
          { id: 'clear', n: 1, label: '完成 1 個世界', rew: 60, key: 'cleared' }
        ];
        return r.shuffle(pool).map(p => Object.assign({}, p, { p: 0 }));
      };
      q.d1 = pickQ();
      q.d2 = pickQ();
      q.d3 = pickQ();
      q.claim = {};
    }
    Store.save();
  },
  updateMissions(r) {
    const done = [];
    const q = Store.data.quests;
    [q.d1, q.d2, q.d3].forEach((list, i) => {
      (list || []).forEach(m => {
        const before = m.p;
        if (m.key === 'plays') m.p += 1;
        else if (m.key === 'cleared') m.p += r.cleared ? 1 : 0;
        else if (m.key === 'maxCombo') m.p = Math.max(m.p, r.maxCombo);
        else if (m.key === 'perfect') m.p = Math.max(m.p, r.perfect);
        else if (m.key === 'coins') m.p = Math.max(m.p, (m.p || 0) + r.coins);
        else if (m.key === 'dashes') m.p += r.dashes;
        if (before < m.n && m.p >= m.n) done.push(m.label);
      });
    });
    Store.save();
    return done;
  },
  claimQuest(listIdx, mIdx) {
    const q = Store.data.quests;
    const list = [q.d1, q.d2, q.d3][listIdx];
    const m = list[mIdx];
    const key = listIdx + ':' + mIdx;
    if (!m || m.p < m.n || q.claim[key]) return;
    q.claim[key] = true;
    Store.data.xp += m.rew;
    Store.data.frag += Math.floor(m.rew / 4);
    Audio2.sfx('level');
    this.toast('任務完成：+' + m.rew + ' XP', 'gold');
    Store.save();
    this.renderGrowth();
  },
  renderGrowth() {
    const d = Store.data;
    const lv = levelFromXp(d.xp);
    setText($('gr-level'), lv.lv);
    setText($('gr-rank'), rankName(lv.lv));
    setText($('gr-xptext'), lv.into + ' / ' + lv.need + ' XP · 總 ' + d.xp);
    const xp = $('gr-xp');
    if (xp) xp.style.width = clamp01(lv.into / lv.need) * 100 + '%';
    setText($('gr-frag'), d.frag);
    setText($('gr-maxspeed'), maxSpeedMult().toFixed(2) + '×');
    const cleared = Object.keys(d.stats.worldsCleared || {}).length;
    setText($('gr-pibs'), cleared + ' / ' + WORLDS.length);
    const tabs = $('growth-tabs');
    if (tabs) tabs.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === this.growthTab));
    const body = $('growth-body');
    if (!body) return;
    body.innerHTML = '';
    if (this.growthTab === 'quests') {
      const q = Store.data.quests;
      const titles = ['每日任務一', '每日任務二', '每日任務三'];
      [q.d1, q.d2, q.d3].forEach((list, i) => {
        const t = el('div', 'section-title', titles[i] + ' <span class="line"></span>');
        body.appendChild(t);
        const wrap = el('div', 'quest-list');
        (list || []).forEach((m, j) => {
          const done = m.p >= m.n;
          const claimed = q.claim && q.claim[i + ':' + j];
          const rowEl = el('div', 'quest' + (done ? ' done' : ''));
          rowEl.innerHTML =
            '<div class="q-body"><div class="q-name">' + m.label + '</div>' +
            '<div class="q-bar"><div class="q-fill" style="width:' + clamp01(m.p / m.n) * 100 + '%"></div></div>' +
            '<div class="q-prog">' + Math.min(m.p, m.n) + ' / ' + m.n + '</div></div>' +
            '<div class="q-rew">' + m.rew + ' XP</div>' +
            '<button class="btn ' + (done && !claimed ? 'btn-primary' : '') + '"' + (done && !claimed ? '' : ' disabled') + '>' + (claimed ? '已領取' : done ? '領取' : '進行中') + '</button>';
          const btn = rowEl.querySelector('button');
          on(btn, 'click', () => this.claimQuest(i, j));
          wrap.appendChild(rowEl);
        });
        body.appendChild(wrap);
      });
    } else if (this.growthTab === 'forge') {
      const head = el('div', 'dlg-text', '使用流星碎片 ✦ 解鎖技能。碎片可透過完成世界、任務與成就獲得。');
      body.appendChild(head);
      SKILL_IDS.forEach(id => {
        const sk = SKILLS[id];
        const owned = hasSkill(id);
        const cost = sk.cost;
        const rowEl = el('div', 'quest' + (owned ? ' done' : ''));
        rowEl.innerHTML =
          '<div class="q-body"><div class="q-name">' + (owned ? '✓ ' : '') + sk.name + '</div>' +
          '<div class="dlg-text" style="font-size:.014rem">' + sk.desc + '</div></div>' +
          '<div class="q-rew">' + (cost === 0 ? '已擁有' : cost + ' ✦') + '</div>' +
          (owned ? '<span class="chip">已解鎖</span>' : '<button class="btn ' + (Store.data.frag >= cost ? 'btn-primary' : '') + '"' + (Store.data.frag >= cost ? '' : ' disabled') + '>解鎖</button>');
        const b = rowEl.querySelector('button');
        if (b) on(b, 'click', () => this.unlockSkill(id));
        body.appendChild(rowEl);
      });
      const themeRow = el('div', 'quest');
      themeRow.innerHTML = '<div class="q-body"><div class="q-name">🎲 隨機主題券</div><div class="dlg-text" style="font-size:.014rem">花費 20 ✦ 立即切換成另一種外觀主題。</div></div>' +
        '<div class="q-rew">20 ✦</div><button class="btn ' + (Store.data.frag >= 20 ? 'btn-primary' : '') + '"' + (Store.data.frag >= 20 ? '' : ' disabled') + '>切換</button>';
      on(themeRow.querySelector('button'), 'click', () => {
        if (Store.data.frag < 20) return;
        Store.data.frag -= 20;
        Store.save();
        this.randomTheme();
        this.renderGrowth();
      });
      body.appendChild(themeRow);
    } else {
      const cur = levelFromXp(d.xp);
      RANKS.forEach((name, i) => {
        const need = 100 * Math.pow(1.22, i * 4);
        const rowEl = el('div', 'quest' + (cur.lv > i * 4 ? ' done' : ''));
        rowEl.innerHTML = '<div class="q-body"><div class="q-name">' + (cur.lv > i * 4 ? '✓ ' : '') + name + '</div><div class="q-prog">Lv.' + (i * 4 + 1) + ' 解鎖</div></div>' +
          '<div class="q-rew">' + (d.xp >= need ? '已達成' : fmt(Math.round(need - d.xp)) + ' XP') + '</div>';
        body.appendChild(rowEl);
      });
      const st = el('div', 'dlg-text', '高等級會提升：流速上限（目前 ' + maxSpeedMult().toFixed(2) + '×）與部分主題的細節效果。');
      body.appendChild(st);
    }
  },
  unlockSkill(id) {
    const sk = SKILLS[id];
    if (hasSkill(id) || Store.data.frag < sk.cost) return;
    Store.data.frag -= sk.cost;
    const s = Store.data.skills;
    s[id] = typeof s[id] === 'number' ? s[id] + 1 : 1;
    Store.data.xp += 30;
    Audio2.sfx('level');
    this.toast('解鎖技能：' + sk.name, 'gold');
    Store.save();
    this.checkAchievements(null);
    this.renderGrowth();
  },

  /* ---------- 圖鑑 ---------- */
  renderAlbum() {
    const body = $('album-body');
    if (!body) return;
    const tabs = $('album-tabs');
    if (tabs) tabs.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === this.albumTab));
    const seen = Store.data.hazardSeen || {};
    setText($('album-count'), Object.keys(Store.data.hazardSeen || {}).length + ' / ' + HAZARD_LIST.length + ' 災厄');
    setText($('al-pibs'), Store.data.pibs);
    body.innerHTML = '';
    const detail = $('hz-detail');
    if (this.albumTab === 'worlds') {
      const grid = el('div', 'hz-grid');
      WORLDS.forEach((w, i) => {
        const cleared = !!Store.data.stats.worldsCleared[w.id];
        const card = el('div', 'hz' + (cleared ? '' : ' locked'));
        const cv = document.createElement('canvas');
        cv.width = 120; cv.height = 120;
        drawWorldThumb(cv, w, i);
        card.appendChild(cv);
        card.appendChild(el('div', 'hz-n', (i + 1) + ' ' + w.name));
        on(card, 'click', () => this.selectWorld(i));
        grid.appendChild(card);
      });
      body.appendChild(grid);
      const legend = el('div', 'dlg-text', '完成越多的世界，越能解鎖更高難度與更多災厄。點選世界查看資訊。');
      legend.style.marginTop = '0.008rem';
      body.appendChild(legend);
      const cur = this.selItem && this.selItem.type === 'world' ? this.selItem.idx : 0;
      this.showWorldDetail(cur, false);
    } else if (this.albumTab === 'hazards') {
      const grid = el('div', 'hz-grid');
      HAZARD_LIST.forEach((k, i) => {
        const h = HAZARDS[k];
        const isSeen = !!seen[k];
        const card = el('div', 'hz' + (isSeen ? '' : ' locked'));
        const cv = document.createElement('canvas');
        cv.width = 120; cv.height = 120;
        drawHazardThumb(cv, k, i);
        card.appendChild(cv);
        card.appendChild(el('div', 'hz-n', isSeen ? h.name : '？？？'));
        on(card, 'click', () => {
          const d2 = $('hz-detail');
          if (!d2) return;
          d2.innerHTML = '<canvas width="160" height="160"></canvas><div class="info"><h3>' + (isSeen ? h.name : '？？？') + '</h3><p>' + (isSeen ? h.desc : '尚未遭遇。完成更多世界即可記錄。') + '</p><div class="fx-tags"><span>' + (isSeen ? '已遭遇' : '未遭遇') + '</span></div></div>';
          const c2 = d2.querySelector('canvas');
          if (c2) drawHazardThumb(c2, k, i);
        });
        grid.appendChild(card);
      });
      body.appendChild(grid);
    } else {
      const grid = el('div', 'hz-grid');
      SKILL_IDS.forEach((id, i) => {
        const sk = SKILLS[id];
        const owned = hasSkill(id);
        const card = el('div', 'hz' + (owned ? '' : ' locked'));
        const cv = document.createElement('canvas');
        cv.width = 120; cv.height = 120;
        drawSkillThumb(cv, id, i, owned);
        card.appendChild(cv);
        card.appendChild(el('div', 'hz-n', sk.name));
        on(card, 'click', () => {
          const d2 = $('hz-detail');
          if (!d2) return;
          d2.innerHTML = '<canvas width="160" height="160"></canvas><div class="info"><h3>' + sk.name + '</h3><p>' + sk.desc + '</p>' +
            '<div class="fx-tags"><span>' + (owned ? '已解鎖' : '未解鎖') + '</span><span>' + (sk.cost === 0 ? '初始技能' : sk.cost + ' ✦') + '</span></div>' +
            (owned ? '' : '<div><button class="btn btn-primary" data-unlock>' + (Store.data.frag >= sk.cost ? '立即解鎖' : '碎片不足') + '</button></div>') + '</div>';
          const c2 = d2.querySelector('canvas');
          if (c2) drawSkillThumb(c2, id, i, owned);
          const ub = d2.querySelector('[data-unlock]');
          if (ub) { ub.disabled = Store.data.frag < sk.cost; on(ub, 'click', () => { this.unlockSkill(id); this.renderAlbum(); }); }
        });
        grid.appendChild(card);
      });
      body.appendChild(grid);
    }
  },
  selectWorld(i) {
    this.selItem = { type: 'world', idx: i };
    this.showWorldDetail(i, true);
  },
  showWorldDetail(i, sound) {
    const w = WORLDS[i];
    const detail = $('hz-detail');
    if (!detail) return;
    const cleared = !!Store.data.stats.worldsCleared[w.id];
    const music = w.music || {};
    detail.innerHTML = '<canvas width="200" height="200"></canvas>' +
      '<div class="info"><h3>' + (i + 1) + '. ' + w.name + ' <span class="dim" style="font-size:.014rem">' + w.nameEn + '</span></h3>' +
      '<p>' + w.hint + '</p>' +
      '<div class="fx-tags">' +
      '<span>BPM ' + w.bmps[2] + '</span>' +
      '<span>' + (music.prog || 'ionian') + '</span>' +
      '<span>難度 ' + '★'.repeat(Math.min(5, w.diff + 1)) + '</span>' +
      (w.hazards.length ? w.hazards.map(h => '<span>' + (HAZARDS[h] ? HAZARDS[h].name : h) + '</span>').join('') : '<span>無災厄</span>') +
      '<span>' + (cleared ? '✓ 已完成' : '未完成') + '</span>' +
      '</div>' +
      '<div class="row" style="margin-top:.004rem"><button class="btn btn-primary" data-play>在此遊玩</button></div></div>';
    const cv = detail.querySelector('canvas');
    if (cv) drawWorldThumb(cv, w, i);
    const pb = detail.querySelector('[data-play]');
    if (pb) on(pb, 'click', () => {
      this.sel.world = i;
      if (sound) Audio2.sfx('click');
      this.startSelected();
    });
  },

  /* ---------- 成就 ---------- */
  checkAchievements(g) {
    const newly = [];
    ACHIEVEMENTS.forEach(a => {
      if (Store.data.ach[a.id]) return;
      let ok = false;
      try { ok = !!a.test(g); } catch (e) { ok = false; }
      if (ok) {
        Store.data.ach[a.id] = true;
        Store.data.frag += a.reward;
        Store.data.xp += 25;
        newly.push(a);
        this.toast('<span class="t-ico">' + a.ico + '</span> 成就解鎖：' + a.name + ' <span class="gold">+' + a.reward + ' ✦</span>', 'gold', 3000);
      }
    });
    if (newly.length) Audio2.sfx('level');
    Store.save();
    return newly;
  },
  renderAchievements() {
    const list = $('ach-list');
    if (!list) return;
    const done = ACHIEVEMENTS.filter(a => Store.data.ach[a.id]).length;
    setText($('ach-count'), done + ' / ' + ACHIEVEMENTS.length);
    setText($('ach-claimed'), Store.data.frag);
    list.innerHTML = '';
    ACHIEVEMENTS.forEach(a => {
      const isDone = !!Store.data.ach[a.id];
      const rowEl = el('div', 'ach' + (isDone ? ' done' : ''));
      rowEl.innerHTML = '<span class="a-ico">' + a.ico + '</span><div class="a-body"><span class="a-name">' + a.name + '</span><span class="a-desc">' + a.desc + '</span></div><span class="a-rew">+' + a.reward + ' ✦</span>';
      list.appendChild(rowEl);
    });
  },

  /* ---------- 主題畫廊 ---------- */
  renderThemes() {
    const grid = $('theme-grid');
    if (!grid) return;
    grid.innerHTML = '';
    THEMES.forEach(t => {
      const card = el('button', 'theme-card' + (t.id === this.theme.id ? ' on' : ''));
      card.dataset.id = t.id;
      card.title = t.name + ' — ' + t.desc;
      const c = t.cols;
      card.style.setProperty('--tc', c[2]);
      card.innerHTML = '<div class="sw" style="background:linear-gradient(160deg,' + c[1] + ',' + c[0] + ')">' +
        '<i style="width:60%;height:60%;left:-10%;top:-10%;background:' + c[2] + '"></i>' +
        '<i style="width:55%;height:55%;right:-12%;bottom:-10%;background:' + c[3] + '"></i>' +
        '<i style="width:26%;height:26%;left:38%;top:34%;background:' + c[4] + '"></i></div>' +
        '<span class="th-dot"></span><span class="th-name">' + t.name + '</span>';
      on(card, 'click', () => this.applyTheme(t.id));
      grid.appendChild(card);
    });
  },

  /* ---------- 教學 ---------- */
  tutorial() {
    const dlg = $('dlg-tutorial');
    dlg.innerHTML =
      '<div class="dlg-title">🎓 操作教學 <button class="btn btn-icon btn-ghost x" data-close>✕</button></div>' +
      '<div class="tutorial">' +
        '<div class="tut-step"><span class="tut-key tut-key.cyan" style="color:var(--accent)">A</span><div><b>左右移動</b>：用 ← → 或 A D 在車道之間移動；觸控裝置可點按左右鍵或在畫面上滑動。</div></div>' +
        '<div class="tut-step"><span class="tut-key" style="color:var(--gold)">◎</span><div><b>穿越節拍流星</b>：每一拍的環形流星落下時，讓飛梭停在流星所在的車道，就能「穿越」得分、累積 Combo。</div></div>' +
        '<div class="tut-step"><span class="tut-key" style="color:var(--danger)">✕</span><div><b>避開障礙</b>：彩色橫條是障礙物。撞上會扣除相位與 Combo；被標記的車道會提前亮起警示。</div></div>' +
        '<div class="tut-step"><span class="tut-key tut-key.yel">SPACE</span><div><b>衝刺</b>：按空白鍵或雙擊方向鍵，短暫無敵並可穿越障礙（可穿越衝在前方即被吃掉）。</div></div>' +
        '<div class="tut-step"><span class="tut-key" style="color:var(--good)">★</span><div><b>拾取</b>：金色星星是潮流水晶（加分、回相位），藍紫色碎片是「世界碎片」，只在特定模式出現。</div></div>' +
        '<div class="tut-step"><span class="tut-key">ESC</span><div><b>暫停</b>：任何時候按 Esc / P 可暫停，在暫停畫面調整流速、設定或重試。</div></div>' +
        '<div class="tut-step"><span class="tut-key" style="color:var(--accent2)">T</span><div><b>外觀主題</b>：按 T 隨機切換主題，也可以在「外觀主題」中慢慢挑選。</div></div>' +
      '</div>' +
      '<div class="dlg-actions"><button class="btn btn-ghost" data-close>知道了</button><button class="btn btn-primary" data-go>開始練習</button></div>';
    const ovT = $('ov-tutorial'); if (ovT) { ovT.classList.add('show'); ovT.style.display = 'flex'; }
    dlg.querySelectorAll('[data-close]').forEach(b => on(b, 'click', () => { const ovT = $('ov-tutorial'); if (ovT) { ovT.classList.remove('show'); ovT.style.display = ''; } Store.data.tutorialDone = true; Store.save(); }));
    const go = dlg.querySelector('[data-go]');
    if (go) on(go, 'click', () => {
      const ovT = $('ov-tutorial'); if (ovT) { ovT.classList.remove('show'); ovT.style.display = ''; }
      Store.data.tutorialDone = true;
      this.sel.mode = 'adventure';
      this.sel.diff = 0;
      this.sel.world = 0;
      this.save();
      this.startSelected();
    });
  },

  save() { Store.save(); },

  /* 同步解鎖：依完成世界數整理難度與技能，並校正非法設定 */
  syncUnlocks(silent) {
    const d = Store.data;
    const done = Object.keys(d.stats.worldsCleared || {}).length;
    const maxDiff = DIFFS.filter(x => done >= x.unlock).pop();
    if (this.sel.diff > maxDiff.id) this.sel.diff = maxDiff.id;
    if (!d.skills) d.skills = { dash: 1 };
    if (!d.skills.dash) d.skills.dash = 1;
    if (!SKILL_IDS.some(hasSkill)) d.skills.dash = 1;
    d.settings.lanes = [3, 4, 5].indexOf(d.settings.lanes) >= 0 ? d.settings.lanes : 4;
    d.settings.scroll = clamp(Number(d.settings.scroll) || 1, 0.75, 1.35);
    this.sel.speed = clamp(this.sel.speed || d.settings.scroll, 0.75, maxSpeedMult());
    if (!silent) Store.save();
    return done;
  },

  /* ---------- 綁定 DOM ---------- */
  bindDom() {
    on($('btn-start'), 'click', () => { Audio2.sfx('click'); this.setScreen('mode', 'title'); });
    on($('btn-modes'), 'click', () => this.setScreen('mode'));
    on($('btn-growth'), 'click', () => this.setScreen('growth'));
    on($('btn-album'), 'click', () => this.setScreen('album'));
    on($('btn-themes'), 'click', () => this.setScreen('themes'));
    on($('btn-achievements'), 'click', () => this.setScreen('achievements'));
    on($('btn-settings'), 'click', () => this.openSettings(false));
    on($('btn-theme-random'), 'click', () => this.randomTheme());
    on($('btn-quicktheme'), 'click', () => this.randomTheme());
    on($('btn-mode-quicktheme'), 'click', () => this.randomTheme());
    document.querySelectorAll('[data-back]').forEach(b => on(b, 'click', () => this.goBack()));
    on($('btn-tutorial'), 'click', () => this.tutorial());
    on($('btn-go'), 'click', () => this.startSelected());
    on($('btn-random-world'), 'click', () => {
      this.sel.world = Math.floor(Math.random() * WORLDS.length);
      Audio2.sfx('click');
      this.renderModeScreen();
    });
    on($('btn-modes-settings'), 'click', () => this.openSettings(false));
    on($('btn-hud-pause'), 'click', () => this.openPause());
    const ws = $('world-select');
    if (ws) on(ws, 'change', () => { this.sel.world = clamp(parseInt(ws.value, 10) || 0, 0, WORLDS.length - 1); this.renderModeScreen(); });
    const sl = $('speed-slider');
    if (sl) {
      on(sl, 'input', () => {
        const v = parseFloat(sl.value);
        if (isFinite(v)) {
          this.sel.speed = v;
          Store.data.settings.scroll = v;
          setText($('speed-val'), v.toFixed(2) + '×');
        }
      });
      on(sl, 'change', () => Store.save());
    }
    const tabs = $('growth-tabs');
    if (tabs) tabs.querySelectorAll('.tab').forEach(t => on(t, 'click', () => { this.growthTab = t.dataset.tab; this.renderGrowth(); Audio2.sfx('click'); }));
    const at = $('album-tabs');
    if (at) at.querySelectorAll('.tab').forEach(t => on(t, 'click', () => { this.albumTab = t.dataset.tab; this.renderAlbum(); Audio2.sfx('click'); }));

    /* 觸控按鍵 */
    const bindHold = (id, dir) => {
      const b = $(id);
      if (!b) return;
      const press = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        b.classList.add('pressed');
        if (dir === 'dash') this.game && this.game.dash();
        else this.game && this.game.move(dir);
      };
      const release = () => b.classList.remove('pressed');
      on(b, 'pointerdown', press);
      on(b, 'pointerup', release);
      on(b, 'pointercancel', release);
      on(b, 'pointerleave', release);
    };
    bindHold('tc-left', -1);
    bindHold('tc-right', 1);
    bindHold('tc-dash', 'dash');

    /* 畫布手勢：按壓立即移動一格（最靈敏）、左右拖曳連續移動、快速左右滑動＝衝刺 */
    const cv = $('game-canvas');
    if (cv && cv.addEventListener) {
      let sx = 0, sy = 0, sl0 = 0, moved = false, t0 = 0, curLane = 0;
      const rectOf = () => cv.getBoundingClientRect();
      cv.addEventListener('pointerdown', (e) => {
        if (!this.game || !this.game.player || !this.game.chart) return;
        if (this.screen !== 'game') return;
        Audio2.resume();
        sx = e.clientX; sy = e.clientY; t0 = now(); moved = false;
        sl0 = this.game.player.lane; curLane = sl0;
        const rect = rectOf();
        const x = (e.clientX - rect.left) / Math.max(1, rect.width) * View.W;
        const lane = clamp(Math.floor((x - View.pathL) / View.laneW), 0, View.laneCount - 1);
        if (this.game.state === 'play') {
          if (lane !== sl0) { this.game.setLane(lane); curLane = lane; moved = true; }
        }
        this.input.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
        if (e.pointerId !== undefined && cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
      });
      cv.addEventListener('pointermove', (e) => {
        if (!this.input.pointer || !this.game || this.game.state !== 'play') return;
        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        if (!moved && Math.abs(dx) < 10 && Math.abs(dy) > 60) return;
        const laneShift = Math.round(dx / Math.max(18, View.laneW * View.scale));
        if (sl0 + laneShift !== curLane) {
          curLane = sl0 + laneShift;
          moved = true;
          this.game.setLane(curLane);
        }
      });
      const end = (e) => {
        if (!this.input.pointer) return;
        const quick = now() - t0 < 220;
        const dx = e ? e.clientX - sx : 0;
        if (quick && Math.abs(dx) > Math.max(60, View.laneW * View.scale * 1.6) && Math.abs(dx) / Math.max(1, now() - t0) > 0.6) {
          this.input.pointer = null;
          this.game && this.game.dash();
          return;
        }
        this.input.pointer = null;
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', () => { this.input.pointer = null; });
    }

    /* 鍵盤 */
    on(window, 'keydown', (e) => this.onKeyDown(e));
    on(window, 'keyup', (e) => this.onKeyUp(e));
    on(window, 'resize', () => this.onResize());
    on(window, 'orientationchange', () => setTimeout(() => this.onResize(), 200));
    if (window.visualViewport) on(window.visualViewport, 'resize', () => this.onResize());
    on(document, 'visibilitychange', () => {
      if (document.hidden && this.game && this.game.state === 'play') this.openPause();
    });
    on(window, 'blur', () => {
      this.input.left = this.input.right = false;
      if (this.game && this.game.state === 'play') this.openPause();
    });
    on(window, 'pointerdown', () => Audio2.resume(), { once: false });
  },

  onKeyDown(e) {
    const k = e.key;
    const code = e.code || '';
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) {
      if (e.target.tagName !== 'SELECT' && (k === 'Escape')) e.target.blur();
      return;
    }
    const g = this.game;
    if (this.screen === 'game') {
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
        e.preventDefault();
        if (!this.keys.left) {
          const t = now();
          if (t - this.input.lastLeftTap < 220) g && g.dash();
          this.input.lastLeftTap = t;
          this.input.repeatL = 0;
          g && g.move(-1);
        }
        this.keys.left = true;
      } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
        e.preventDefault();
        if (!this.keys.right) {
          const t = now();
          if (t - this.input.lastRightTap < 220) g && g.dash();
          this.input.lastRightTap = t;
          g && g.move(1);
        }
        this.keys.right = true;
      } else if (k === ' ' || code === 'Space' || k === 'Shift' || k === 'z' || k === 'Z' || k === 'ArrowUp' || k === 'w' || k === 'W') {
        e.preventDefault();
        if (!this.keys.dash) { g && g.dash(); this.keys.dash = true; }
      } else if (k === 'Escape' || k === 'p' || k === 'P') {
        e.preventDefault();
        if ($('ov-settings') && $('ov-settings').classList.contains('show')) this.closeSettings();
        else if ($('ov-pause') && $('ov-pause').classList.contains('show')) this.resumeGame();
        else this.openPause();
      } else if (k === 'r' || k === 'R') {
        if (g && g.running) { hideAllOverlays(); this.startSelected(); }
      } else if (k === 'm' || k === 'M') {
        Audio2.muted = !Audio2.muted;
        Audio2.applyVolumes();
        this.toast(Audio2.muted ? '🔇 已靜音' : '🔊 音效開啟');
      } else if (k === 't' || k === 'T') {
        this.randomTheme();
      } else if (k === 'f' || k === 'F') {
        this.toggleFullscreen();
      }
      return;
    }
    /* 選單操作 */
    if (k === 'Escape') {
      if (this.isOverlayOpen()) { this.closeTopOverlay(); return; }
      if (this.screen !== 'title') this.goBack();
      return;
    }
    if (k === 'Enter') {
      e.preventDefault();
      if (this.screen === 'title') this.setScreen('mode');
      else if (this.screen === 'mode') this.startSelected();
      else if (this.screen === 'result' || (this.lastResult && $('ov-result') && $('ov-result').classList.contains('show'))) { hideAllOverlays(); this.startSelected(); }
      return;
    }
    if (this.screen === 'mode') {
      if (k === 'ArrowLeft' || k === 'ArrowUp') { this.sel.diff = clamp(this.sel.diff - 1, 0, 4); this.renderModeScreen(); Audio2.sfx('click'); }
      if (k === 'ArrowRight' || k === 'ArrowDown') { this.sel.diff = clamp(this.sel.diff + 1, 0, 4); this.renderModeScreen(); Audio2.sfx('click'); }
      if (k === '[') { this.sel.world = (this.sel.world + WORLDS.length - 1) % WORLDS.length; this.renderModeScreen(); }
      if (k === ']') { this.sel.world = (this.sel.world + 1) % WORLDS.length; this.renderModeScreen(); }
    }
    if (this.screen === 'title' && (k === 't' || k === 'T')) this.randomTheme();
  },
  onKeyUp(e) {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { this.keys.left = false; this.input.left = false; }
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { this.keys.right = false; this.input.right = false; }
    if (k === ' ' || k === 'Shift' || k === 'z' || k === 'Z' || k === 'ArrowUp') this.keys.dash = false;
  },
  isOverlayOpen() {
    return !!document.querySelector('.overlay.show');
  },
  closeTopOverlay() {
    const settings = $('ov-settings');
    if (settings && settings.classList.contains('show')) { this.closeSettings(); return; }
    const pause = $('ov-pause');
    if (pause && pause.classList.contains('show')) { this.resumeGame(); return; }
    hideAllOverlays();
  },
  goBack() {
    if (this.screen === 'mode' || this.screen === 'growth' || this.screen === 'album' || this.screen === 'themes' || this.screen === 'achievements') {
      Audio2.sfx('back');
      this.setScreen('title');
    } else if (this.prevBack) this.setScreen(this.prevBack);
  },
  onResize() {
    if (this.game) this.game.resize();
    positionHud();
    if (this.screen === 'game' || this.screen === 'title') {
      const tc = $('touch-ctrl');
      if (tc) tc.style.display = (Store.data.settings.touch === 'always' || (Store.data.settings.touch === 'auto' && View.mobile)) ? 'block' : 'none';
    }
  },
  toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
        if (p && p.catch) p.catch(() => {});
      } else if (document.exitFullscreen) document.exitFullscreen();
    } catch (e) { /* ignore */ }
  }
};

/* ============================== 輔助繪圖（圖鑑縮圖） ============================== */
function drawWorldThumb(cv, w, i) {
  const ctx = cv && cv.getContext && cv.getContext('2d');
  if (!ctx) return;
  const W = cv.width, H = cv.height;
  const t = App.theme;

  const seed = hashStr(w.id);
  const r = mulberry32(seed);
  const base = t.cols;
  const accent = mixHex(base[2], base[3], (i % 5) / 4);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, base[1]);
  g.addColorStop(1, base[0]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 5; k++) {
    const rg = ctx.createRadialGradient(r() * W, r() * H, 0, W / 2, H / 2, W * 0.5);
    rg.addColorStop(0, rgba(k % 2 ? accent : base[3], 0.5));
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = 'source-over';
  for (let k = 0; k < 14; k++) {
    ctx.fillStyle = rgba('#ffffff', 0.3 + r() * 0.6);
    ctx.fillRect(r() * W, r() * H, 2, 2);
  }
  ctx.strokeStyle = rgba(accent, 0.9);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W * 0.2, 0); ctx.lineTo(W * 0.1, H);
  ctx.moveTo(W * 0.8, 0); ctx.lineTo(W * 0.9, H);
  ctx.stroke();
  ctx.fillStyle = rgba(accent, 0.85);
  ctx.font = '900 ' + Math.round(W * 0.3) + 'px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(i + 1), W / 2, H / 2);
}
function drawHazardThumb(cv, kind) {
  const ctx = cv && cv.getContext && cv.getContext('2d');
  if (!ctx) return;
  const W = cv.width, H = cv.height;
  const t = App.theme;
  const h = HAZARDS[kind];
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, t.cols[1]);
  g.addColorStop(1, t.cols[0]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.shadowColor = h.color; ctx.shadowBlur = 16;
  ctx.fillStyle = h.color;
  ctx.fillRect(W * 0.15, H * 0.42, W * 0.7, H * 0.16);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.font = '900 ' + Math.round(W * 0.2) + 'px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(kind === 'nova' ? '✦' : kind === 'bolt' ? 'ϟ' : '✕', W * 0.5, H * 0.32);
}
function drawSkillThumb(cv, id, i, owned) {
  const ctx = cv && cv.getContext && cv.getContext('2d');
  if (!ctx) return;
  const W = cv.width, H = cv.height;
  const t = App.theme;
  ctx.fillStyle = rgba(t.cols[3], 0.25);
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = owned ? t.cols[2] : 'rgba(255,255,255,0.25)';
  ctx.font = '900 ' + Math.round(W * 0.45) + 'px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  ctx.fillText(id === 'dash' ? '»' : id === 'shield' ? '◈' : String(i + 1), W / 2, H / 2);
}

/* ============================== 積分入庫 ============================== */
function applyResult(r) {
  const d = Store.data;
  d.plays++;
  d.xp += r.xp;
  d.pibs += r.pibs;
  d.frag += Math.floor(r.pibs / 2) + (r.cleared ? 2 : 0) + (r.grade === 'SSS' || r.grade === 'SS' ? 3 : 0);
  const s = d.stats;
  s.maxCombo = Math.max(s.maxCombo, r.maxCombo);
  s.totalNotes = (s.totalNotes || 0) + r.notes;
  s.good = (s.good || 0) + r.good;
  s.perfect = (s.perfect || 0) + r.perfect;
  s.flowers = (s.flowers || 0) + r.flowers;
  s.shieldSaves = (s.shieldSaves || 0) + r.shieldSaves;
  s.coins = (s.coins || 0) + r.coins;
  s.playTime = (s.playTime || 0) + r.time;
  if (r.cleared) {
    d.clears++;
    s.worldsCleared = s.worldsCleared || {};
    s.worldsCleared[r.worldId] = true;
  }
  if (!d.best[r.mode]) d.best[r.mode] = [];
  const prev = d.best[r.mode][r.diff] || 0;
  s.lastPB = r.score > prev;
  if (r.score > prev) d.best[r.mode][r.diff] = r.score;
  if (!d.bestScore) d.bestScore = {};
  const key = r.mode + ':' + r.diff;
  if (r.score > (d.bestScore[key] || 0)) d.bestScore[key] = r.score;
  if (r.mode === 'survive' && r.cleared) s.survival.push(r.maxCombo);
  if (r.mode === 'challenge' && r.cleared) s.challenge.push(r.score);
  Store.save();
}

/* 解鎖檢查：紀錄新的災厄 */


/* ============================== HUD 定位 ============================== */
function positionHud() {
  const hud = $('hud');
  if (!hud) return;
  const safe = View.safe;
  const px = View.scale;
  // 以 canvas 實際顯示大小為準
  const cw = View.cssW, ch = View.cssH;
  const vw = window.innerWidth, vh = window.innerHeight;
  const left = (vw - cw) / 2;
  const top = (vh - ch) / 2;
  const pad = Math.max(8, View.hudPad * px);
  hud.style.left = Math.max(left + pad, safe.l + pad) + 'px';
  hud.style.top = Math.max(top + pad, safe.t + pad) + 'px';
  hud.style.width = Math.min(cw - pad * 2, vw - safe.l - safe.r - pad * 2) + 'px';
  const right = $('hud-right');
  if (right) right.style.right = '0px';
}

/* ============================== 日期 / 全域工具 ============================== */
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function hideAllOverlays() {
  document.querySelectorAll('.overlay').forEach(o => { o.classList.remove('show'); o.style.display = ''; });
}

/* 由模式選擇畫面進入時，若尚未播放，讓畫布持續顯示背景動畫 */
function safeBoot() {
  try {
    App.init();
  } catch (err) {
    console.error('boot failed', err);
    if (typeof window !== 'undefined') window.__PS_BOOT_ERROR = String((err && err.stack) || err);
    if (typeof window !== 'undefined' && window.__PS_FATAL) {
      const head = err && err.name
        ? err.name + ': ' + (err.message || String(err))
        : String(err);
      const trace = err && err.stack ? '\n\n' + err.stack : '';
      window.__PS_FATAL('初始化失敗', head + trace);
    } else {
      const tip = $('boot-tip');
      if (tip) tip.textContent = '初始化失敗，請重新整理：' + (err && err.message ? err.message : err);
    }
  }
}
if (typeof window !== 'undefined') window.__PS_APP = App;

/* ------------------------------------------------------------------ *
 * 除錯與線上自我檢測
 * ------------------------------------------------------------------
 * ?debug=1     暴露 View/Store 供自動化測試讀取
 * ?selftest=1  在真瀏覽器跑一輪端到端檢查，把結果畫在畫面上
 *              （iOS 沒有 devtools，這是最快拿到失敗細節的方法）
 * ------------------------------------------------------------------ */
function hasQuery(flag) {
  try { return new RegExp('(?:^|[?&])' + flag + '(?:[=&]|$)').test(window.location.search); }
  catch (e) { return false; }
}

if (typeof window !== 'undefined' && hasQuery('debug')) {
  window.__PS_DEBUG = { View, Store };
}

function selfTestPanel() {
  let panel = $('selftest-panel');
  if (!panel) {
    panel = el('div');
    panel.id = 'selftest-panel';
    panel.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:400', 'background:#0b0710', 'color:#e8ecff',
      'font:13px/1.6 ui-monospace,Menlo,monospace', 'padding:20px', 'overflow:auto',
      'white-space:pre-wrap', 'word-break:break-word', '-webkit-overflow-scrolling:touch'
    ].join(';');
    document.body.appendChild(panel);
  }
  return panel;
}

function runSelfTest() {
  const panel = selfTestPanel();
  const lines = [];
  const title = 'PULSE STRIDE 線上自我檢測  build ' + APP_VERSION;
  const head = title + '\n' + (navigator.userAgent || '') +
    '\n畫面 ' + window.innerWidth + '×' + window.innerHeight + '  dpr ' + (window.devicePixelRatio || 1) + '\n';
  const paint = () => { panel.textContent = head + '\n' + lines.join('\n'); };
  paint();

  const results = [];
  const step = (name, fn) => {
    try {
      const ok = fn();
      results.push({ ok: ok !== false, name: name });
      lines.push((ok === false ? '✗ ' : '✓ ') + name);
    } catch (e) {
      results.push({ ok: false, name: name, err: String((e && e.stack) || e) });
      lines.push('✗ ' + name + '\n    ' + String((e && (e.name + ': ' + e.message)) || e));
    }
    paint();
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fail = () => results.filter((r) => !r.ok).length;

  (async () => {
    let fatal = null;
    const onErr = (ev) => { fatal = String((ev && ev.message) || ev); };
    window.addEventListener('error', onErr);

    step('boot 完成', () => App.booted === true);
    step('啟動遮罩已消失', () => !!$('boot') && $('boot').classList.contains('gone'));
    step('CSS 縮放單位 --h 為 px', () => /^[\d.]+px$/.test(document.documentElement.style.getPropertyValue('--h')));
    step('畫布尺寸不超出視窗', () => View.cssW <= window.innerWidth + 1 && View.cssH <= window.innerHeight + 1);
    step('模式畫面有 6 個模式', () => document.querySelectorAll('#mode-grid .mode').length === 6);

    for (const s of ['mode', 'growth', 'album', 'achievements', 'themes', 'title']) {
      App.setScreen(s);
      step('切換畫面：' + s, () => !!document.querySelector('#screen-' + s + '.active'));
    }

    try { App.setScreen('mode'); App.startSelected(); } catch (e) { lines.push('✗ 開局拋錯：' + e.message); }
    step('成功開局', () => !!App.game && !!App.game.chart && App.game.chart.notes.length > 0);

    let guard = 0;
    while (App.game && App.game.state !== 'play' && guard++ < 200) await sleep(40);
    step('倒數結束進入 play', () => App.game.state === 'play');

    const t0 = App.game ? App.game.elapsed : 0;
    const keys = ['ArrowLeft', 'ArrowRight', ' ', 'ArrowRight', 'ArrowLeft'];
    for (let i = 0; i < 24 && App.game; i++) {
      const k = keys[i % keys.length];
      try {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
        window.dispatchEvent(new KeyboardEvent('keyup', { key: k }));
      } catch (e) { /* ignore */ }
      await sleep(45);
    }
    step('節拍時間有推進', () => App.game && App.game.elapsed - t0 > 0.3);
    step('狀態仍正常（play/over）', () => App.game && (App.game.state === 'play' || App.game.state === 'over'));

    try {
      const cv = $('game-canvas');
      const c2d = cv.getContext('2d');
      const img = c2d.getImageData(0, 0, cv.width, cv.height).data;
      const seen = new Set();
      for (let i = 0; i < img.length; i += 4 * 997) {
        seen.add(img[i] + ',' + img[i + 1] + ',' + img[i + 2]);
        if (seen.size > 24) break;
      }
      step('canvas 確有繪製內容（' + seen.size + ' 色取樣）', () => seen.size > 5);
    } catch (e) {
      step('canvas 讀取像素', () => { throw e; });
    }

    step('執行期間無未捕捉錯誤' + (fatal ? '：' + fatal : ''), () => !fatal);
    window.removeEventListener('error', onErr);

    if (App.game) { try { App.game.abort(); } catch (e) { /* ignore */ } }
    if (!fail()) App.setScreen('title');

    lines.push('');
    lines.push(fail() === 0
      ? '全部通過（' + results.length + ' 項）— 把這個畫面截圖即可'
      : fail() + ' / ' + results.length + ' 項失敗 — 請截圖回報');
    paint();
  })();
}

if (typeof window !== 'undefined' && hasQuery('selftest')) {
  window.addEventListener('error', () => { /* 面板本身會顯示 */ });
}

if (typeof document !== 'undefined') {
  const boot = () => {
    safeBoot();
    if (typeof window !== 'undefined' && hasQuery('selftest')) {
      setTimeout(() => { try { runSelfTest(); } catch (e) { console.error(e); } }, 1200);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
