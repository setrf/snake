(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const restartBtn = document.getElementById('restartBtn');
  const pauseBtnTop = document.getElementById('pauseBtnTop');
  const restartBtnTop = document.getElementById('restartBtnTop');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const statusEl = document.getElementById('status');
  const hintEl = document.getElementById('hint');
  const liveEl = document.getElementById('live');
  const wrapBtn = document.getElementById('wrapBtn');
  const fsBtn = document.getElementById('fsBtn');
  const leaderboardEl = document.getElementById('leaderboard');
  const onboardingOverlay = document.getElementById('onboarding-overlay');
  const onboardingCloseBtn = document.getElementById('onboarding-close');

  // HUD theme colors from CSS variables with fallbacks
  const css = getComputedStyle(document.documentElement);
  const boardBg = (css.getPropertyValue('--board-bg') || '#0b0f14').trim();
  const gridColor = (css.getPropertyValue('--grid-color') || 'rgba(0,255,198,0.08)').trim();
  const snakeHeadColor = (css.getPropertyValue('--snake-head') || '#6df2ff').trim();
  const snakeBodyColor = (css.getPropertyValue('--snake-body') || '#00ffc6').trim();
  const foodColor = (css.getPropertyValue('--danger') || '#ff6b6b').trim();
  const obstacleColor = (css.getPropertyValue('--obstacle-color') || '#4A5568').trim();

  // Preferences
  const PREF_KEY = 'snake_prefs';
  const DIFFS = {
    easy:   { tps: 6, accelEvery: 6, delta: 0.20, max: 10, obstacles: 0 },
    normal: { tps: 8, accelEvery: 5, delta: 0.25, max: 12, obstacles: 5 },
    hard:   { tps:10, accelEvery: 4, delta: 0.30, max: 14, obstacles: 10 },
  };
  function loadPrefs(){
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; }
  }
  function savePrefs(p){ localStorage.setItem(PREF_KEY, JSON.stringify(p)); }
  const prefs = loadPrefs();
  let difficulty = (prefs.difficulty && DIFFS[prefs.difficulty]) ? prefs.difficulty : 'normal';
  let wrap = !!prefs.wrap;

  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  let cols = 21; // will adapt on resize for aspect ratio
  let rows = 21;
  const TILE = 20; // desired tile size in CSS px
  let tile = TILE; // actual tile size (kept square)
  // Speed normalized by tiles-per-second (tps)
  let tps = DIFFS[difficulty].tps;
  let tickMs = Math.round(1000 / tps);
  let accelEvery = DIFFS[difficulty].accelEvery;
  const tpsDelta = DIFFS[difficulty].delta;
  const tpsMax = DIFFS[difficulty].max;
  const MAX_STEPS_PER_FRAME = 4; // avoid spiral of death on slow frames

  let rafId = null;
  let lastTime = 0;
  let accumulator = 0;

  const gameState = {
    running: false,
    paused: false,
    score: 0,
    snake: [],
    dir: null,
    nextDir: null,
    food: { x: 10, y: 10 },
    eaten: 0,
    obstacles: [],
    leaderboard: [],
  };

  const best = Number(localStorage.getItem('snake_best') || 0);
  bestEl.textContent = best;

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const opposite = (a, b) => a.x + b.x === 0 && a.y + b.y === 0;

  function getLeaderboard() {
    try {
      return JSON.parse(localStorage.getItem('snake_leaderboard_simple') || '[]');
    } catch {
      return [];
    }
  }

  function saveLeaderboard() {
    localStorage.setItem('snake_leaderboard_simple', JSON.stringify(gameState.leaderboard));
  }

  function displayLeaderboard() {
    if (!leaderboardEl) return;
    leaderboardEl.innerHTML = '<h3>Leaderboard</h3>';
    const list = document.createElement('ol');
    gameState.leaderboard.forEach(score => {
      const item = document.createElement('li');
      item.textContent = score;
      list.appendChild(item);
    });
    leaderboardEl.appendChild(list);
  }

  function resize() {
    // Fill available viewport while keeping a square board.
    const isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const headerH = Math.max(56, Math.min(80, document.querySelector('.topbar')?.offsetHeight || 64));
    const controlsEl = document.querySelector('.controls');
    const controlsH = isCoarse && controlsEl ? Math.max(120, controlsEl.offsetHeight) : 0;
    const pad = 24;
    const availW = Math.max(240, window.innerWidth - pad);
    const availH = Math.max(240, window.innerHeight - (headerH + controlsH + pad));
    const vmin = Math.max(240, Math.min(availW, availH));

    // Keep tiles a constant square size; adjust grid size to fit
    tile = TILE;
    const logical = Math.floor(vmin / tile);
    const minGrid = 18, maxGrid = 48;
    const base = Math.max(minGrid, Math.min(maxGrid, logical));
    cols = base; rows = base;

    canvas.width = cols * tile * DPR;
    canvas.height = rows * tile * DPR;
    canvas.style.width = `${cols * tile}px`;
    canvas.style.height = `${rows * tile}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    draw();
  }

  function reset() {
    gameState.score = 0; scoreEl.textContent = '0';
    // reset speed per selected difficulty
    tps = DIFFS[difficulty].tps; tickMs = Math.round(1000 / tps);
    accelEvery = DIFFS[difficulty].accelEvery;
    gameState.eaten = 0;
    gameState.nextDir = DIRS.right;
    gameState.dir = DIRS.right;
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);
    gameState.snake = [ { x: cx - 1, y: cy }, { x: cx, y: cy } ];
    placeObstacles();
    placeFood();
    gameState.leaderboard = getLeaderboard();
    displayLeaderboard();
  }

  function placeObstacles() {
    gameState.obstacles = [];
    const numObstacles = DIFFS[difficulty].obstacles;
    for (let i = 0; i < numObstacles; i++) {
      while (true) {
        const x = Math.floor(Math.random() * cols);
        const y = Math.floor(Math.random() * rows);
        if (!gameState.snake.some(s => s.x === x && s.y === y) && !gameState.obstacles.some(o => o.x === x && o.y === y)) {
          gameState.obstacles.push({ x, y });
          break;
        }
      }
    }
  }

  function placeFood() {
    while (true) {
      const x = Math.floor(Math.random() * cols);
      const y = Math.floor(Math.random() * rows);
      if (!gameState.snake.some(s => s.x === x && s.y === y) && !gameState.obstacles.some(o => o.x === x && o.y === y)) {
        gameState.food = { x, y };
        return;
      }
    }
  }

  function step() {
    if (!gameState.running) return;
    // update direction
    if (!opposite(gameState.dir, gameState.nextDir)) gameState.dir = gameState.nextDir;
    const head = gameState.snake[gameState.snake.length - 1];
    let nx = head.x + gameState.dir.x;
    let ny = head.y + gameState.dir.y;
    // walls vs wrap
    if (wrap) {
      if (nx < 0) nx = cols - 1; else if (nx >= cols) nx = 0;
      if (ny < 0) ny = rows - 1; else if (ny >= rows) ny = 0;
    } else {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) { gameOver(); return; }
    }
    // Tail-collision fix: if we are not growing this tick, the tail
    // will move away after we advance, so allow moving into it.
    const willGrow = (nx === gameState.food.x && ny === gameState.food.y);
    const bodyToCheck = willGrow ? gameState.snake : gameState.snake.slice(1);
    if (bodyToCheck.some(s => s.x === nx && s.y === ny) || gameState.obstacles.some(o => o.x === nx && o.y === ny)) {
      gameOver();
      return;
    }
    const newHead = { x: nx, y: ny };
    gameState.snake.push(newHead);
    if (willGrow) {
      gameState.score += 1; scoreEl.textContent = String(gameState.score);
      if (liveEl) liveEl.textContent = `Score ${gameState.score}.`; // SR update
      if (navigator.vibrate) navigator.vibrate(15);
      gameState.eaten += 1;
      if (gameState.eaten % accelEvery === 0) { tps = Math.min(tpsMax, tps + tpsDelta); tickMs = Math.round(1000 / tps); }
      placeFood();
    } else {
      gameState.snake.shift();
    }
  }

  function draw() {
    // clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // board background grid
    ctx.fillStyle = boardBg;
    ctx.fillRect(0, 0, cols * tile, rows * tile);
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath();
      ctx.moveTo(x * tile + 0.5, 0);
      ctx.lineTo(x * tile + 0.5, rows * tile);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * tile + 0.5);
      ctx.lineTo(cols * tile, y * tile + 0.5);
      ctx.stroke();
    }
    // obstacles
    ctx.fillStyle = obstacleColor;
    for (const o of gameState.obstacles) {
      ctx.fillRect(o.x * tile, o.y * tile, tile, tile);
    }
    // snake
    for (let i = 0; i < gameState.snake.length; i++) {
      const s = gameState.snake[i];
      const isHead = i === gameState.snake.length - 1;
      ctx.fillStyle = isHead ? snakeHeadColor : snakeBodyColor;
      roundRect(ctx, s.x * tile + 2, s.y * tile + 2, tile - 4, tile - 4, 4);
      ctx.fill();
    }
    // food
    ctx.fillStyle = foodColor;
    roundRect(ctx, gameState.food.x * tile + 3, gameState.food.y * tile + 3, tile - 6, tile - 6, 6);
    ctx.fill();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function start() {
    reset();
    gameState.running = true; gameState.paused = false;
    statusEl.textContent = '';
    overlay.classList.add('hidden');
    // restore focus to a visible pause button for keyboard users
    const pb = pauseBtnTop || pauseBtn;
    if (pb) pb.focus({ preventScroll: true });
    // reflect settings in UI
    updateSettingsUI();
    startLoop();
  }

  function startLoop() {
    cancelAnimationFrame(rafId);
    lastTime = performance.now();
    accumulator = 0;
    const loop = (ts) => {
      const dt = Math.max(0, Math.min(100, ts - lastTime)); // clamp to avoid huge jumps
      lastTime = ts;
      if (!gameState.paused) {
        accumulator += dt;
        let steps = 0;
        while (accumulator >= tickMs && steps++ < MAX_STEPS_PER_FRAME) {
          step();
          accumulator -= tickMs;
        }
        if (steps >= MAX_STEPS_PER_FRAME) {
          accumulator = Math.min(accumulator, tickMs);
        }
      }
      draw();
      if (gameState.running) rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  function pauseToggle() {
    if (!gameState.running) return;
    if (!gameState.paused) {
      gameState.paused = true;
      if (pauseBtn) pauseBtn.textContent = 'Resume';
      if (pauseBtnTop) pauseBtnTop.textContent = 'Resume';
      overlay.classList.remove('hidden');
      statusEl.textContent = 'Paused';
      startBtn.focus({ preventScroll: true });
    } else {
      resumeWithCountdown();
    }
  }

  function resumeWithCountdown() {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const setPlaying = () => {
      gameState.paused = false;
      if (pauseBtn) pauseBtn.textContent = 'Pause';
      if (pauseBtnTop) pauseBtnTop.textContent = 'Pause';
      overlay.classList.add('hidden');
      const pb = pauseBtnTop || pauseBtn; if (pb) pb.focus({ preventScroll: true });
    };
    if (reduce) { setPlaying(); return; }
    // countdown: 3 -> 2 -> 1
    let n = 3;
    overlay.classList.remove('hidden');
    const tick = () => {
      statusEl.textContent = String(n);
      if (n === 0) { setPlaying(); return; }
      n -= 1;
      setTimeout(tick, 240);
    };
    n = 3; tick();
  }

  function gameOver() {
    gameState.running = false;
    gameState.paused = false;
    cancelAnimationFrame(rafId);
    const currentBest = Number(localStorage.getItem('snake_best')) || 0;
    const newBest = Math.max(currentBest, gameState.score);
    if (newBest !== currentBest) {
      localStorage.setItem('snake_best', String(newBest));
    }
    bestEl.textContent = String(newBest);
    statusEl.textContent = `Game Over · Score ${gameState.score}`;

    const leaderboard = getLeaderboard();
    const lowestScore = leaderboard.length > 0 ? leaderboard[leaderboard.length - 1] : 0;

    if (gameState.score > lowestScore || leaderboard.length < 5) {
      leaderboard.push(gameState.score);
      leaderboard.sort((a, b) => b - a);
      gameState.leaderboard = leaderboard.slice(0, 5);
      saveLeaderboard();
      displayLeaderboard();
    }

    overlay.classList.remove('hidden');
    // haptic feedback where supported
    if (navigator.vibrate) navigator.vibrate(60);
    // announce for screen readers
    if (liveEl) liveEl.textContent = `Game over. Score ${gameState.score}. Best ${newBest}.`;
  }

  // Input: keyboard
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    // Start when idle; pause when running
    if (!gameState.running && (key === ' ' || key === 'enter')) { e.preventDefault(); start(); return; }
    if (gameState.running && (key === ' ' || key === 'escape' || key === 'k')) { e.preventDefault(); pauseToggle(); return; }
    if (key === 'r') { e.preventDefault(); start(); return; }
    if (key === 'f') { e.preventDefault(); toggleFullscreen(); return; }
    if (['arrowup','w'].includes(key)) { e.preventDefault(); setDir('up'); }
    else if (['arrowdown','s'].includes(key)) { e.preventDefault(); setDir('down'); }
    else if (['arrowleft','a'].includes(key)) { e.preventDefault(); setDir('left'); }
    else if (['arrowright','d'].includes(key)) { e.preventDefault(); setDir('right'); }
  });

  // Input: buttons (D-pad)
  document.querySelectorAll('.pad').forEach(btn => {
    const dirName = btn.dataset.dir;
    const handler = (ev) => { ev.preventDefault(); setDir(dirName); };
    btn.addEventListener('click', handler);
    btn.addEventListener('touchstart', handler, { passive: false });
  });

  if (onboardingCloseBtn) {
    onboardingCloseBtn.addEventListener('click', () => {
      onboardingOverlay.classList.add('hidden');
      localStorage.setItem('snake_onboarding', 'true');
    });
  }

  if (localStorage.getItem('snake_onboarding')) {
    onboardingOverlay.classList.add('hidden');
    overlay.classList.remove('hidden');
    statusEl.textContent = 'Press Space or Tap';
  } else {
    onboardingOverlay.classList.remove('hidden');
    overlay.classList.add('hidden');
  }

  if (pauseBtn) pauseBtn.addEventListener('click', (e) => { e.preventDefault(); pauseToggle(); });
  if (restartBtn) restartBtn.addEventListener('click', (e) => { e.preventDefault(); start(); });
  if (pauseBtnTop) pauseBtnTop.addEventListener('click', (e) => { e.preventDefault(); pauseToggle(); });
  if (restartBtnTop) restartBtnTop.addEventListener('click', (e) => { e.preventDefault(); start(); });
  startBtn.addEventListener('click', (e) => { e.preventDefault(); start(); });
  overlay.addEventListener('click', (e) => { e.preventDefault(); if (!gameState.running) start(); else if (gameState.paused) pauseToggle(); });

  // Settings: difficulty + wrap + fullscreen
  document.querySelectorAll('.opt-diff').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const d = btn.getAttribute('data-diff');
      if (!DIFFS[d]) return;
      difficulty = d;
      prefs.difficulty = d; savePrefs(prefs);
      updateSettingsUI();
      if (!gameState.running || gameState.paused) {
        // apply immediately
        tps = DIFFS[difficulty].tps; tickMs = Math.round(1000 / tps);
        accelEvery = DIFFS[difficulty].accelEvery;
      }
    });
  });
  if (wrapBtn) wrapBtn.addEventListener('click', (e) => {
    e.preventDefault();
    wrap = !wrap; prefs.wrap = wrap; savePrefs(prefs);
    updateSettingsUI();
  });
  if (fsBtn) fsBtn.addEventListener('click', (e) => { e.preventDefault(); toggleFullscreen(); });

  function updateSettingsUI(){
    document.querySelectorAll('.opt-diff').forEach(b => {
      const on = b.getAttribute('data-diff') === difficulty;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('btn-primary', on);
      b.classList.toggle('btn-outline', !on);
    });
    if (wrapBtn) {
      wrapBtn.setAttribute('aria-pressed', wrap ? 'true' : 'false');
      wrapBtn.textContent = wrap ? 'Wrap: On' : 'Wrap: Off';
    }
  }

  function toggleFullscreen(){
    const el = document.querySelector('.stage-wrap') || document.getElementById('app') || document.body;
    if (!document.fullscreenElement) { el.requestFullscreen?.(); }
    else { document.exitFullscreen?.(); }
  }

  function setDir(name) {
    const d = DIRS[name];
    if (!d) return;
    if (!opposite(gameState.dir, d)) gameState.nextDir = d;
  }

  // Input: swipe gestures on canvas
  let touchStart = null;
  const minSwipe = 16; // logical pixels
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length) {
      const t = e.touches[0];
      touchStart = { x: t.clientX, y: t.clientY };
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    // prevent scrolling when interacting with the canvas
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) > minSwipe) {
      if (ax > ay) setDir(dx > 0 ? 'right' : 'left');
      else setDir(dy > 0 ? 'down' : 'up');
    }
    touchStart = null;
  });

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && gameState.running && !gameState.paused) {
      pauseToggle();
    }
  });
  resize();
  overlay.classList.remove('hidden');
  statusEl.textContent = 'Press Space or Tap';
  // Device‑specific hinting
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (hintEl) hintEl.textContent = coarse ? 'Swipe or use the on‑screen D‑pad · R: Restart · F: Fullscreen' : 'Use Arrow keys / WASD · Space: Pause · R: Restart · F: Fullscreen';
  // Announce initial status for SR users
  if (liveEl) liveEl.textContent = 'Ready. Press Space or tap Start.';
  // Initialize settings UI state
  updateSettingsUI();
})();
