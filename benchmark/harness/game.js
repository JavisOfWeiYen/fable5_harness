/* game.js
 * Bootstraps canvas + input + the fixed-timestep main loop + camera + HUD +
 * menu/overlay screens, wiring together CONFIG/Physics/Track/AI/Race/Storage.
 * Exposes window.Game.
 *
 * IMPORTANT: nothing here runs on load. Game.init() must be called explicitly
 * (from a guarded inline bootstrap in index.html). If the expected DOM elements
 * are absent (e.g. tests.html), init() returns quietly so this file can be
 * loaded for its helpers without crashing.
 */
(function (global) {
  'use strict';

  var CONFIG = global.CONFIG;

  // ---- Module state (populated by init) ----------------------------------
  var canvas = null, ctx = null, mini = null, mctx = null;
  var dpr = 1;
  var el = {};                 // cached HUD element references
  var running = false;         // main loop active
  var raf = 0;
  var lastTime = 0, accumulator = 0;
  var R = null;                // current race state
  var camera = 'chase';        // 'chase' | 'full'
  var resultsSaved = false;
  var settings = null;
  var storageNotice = '';

  // pressed keys -> input
  var keys = { throttle: false, brake: false, left: false, right: false, ers: false, drs: false };

  // ---------------------------------------------------------------------
  // INITIALISATION
  // ---------------------------------------------------------------------
  function init() {
    var doc = global.document;
    if (!doc) return false;
    canvas = doc.getElementById('gameCanvas');
    if (!canvas || typeof canvas.getContext !== 'function') return false; // not the game page
    ctx = canvas.getContext('2d');
    if (!ctx) return false;
    mini = doc.getElementById('miniMap');
    mctx = mini ? mini.getContext('2d') : null;

    // Load persisted settings (never throws).
    try {
      settings = global.Storage.getSettings();
      camera = settings.camera || 'chase';
      if (global.localStorage) {
        // detect corrupt settings blob to surface a one-line notice
        var raw = global.localStorage.getItem(CONFIG.storage.settings);
        if (raw != null) { try { JSON.parse(raw); } catch (e) { storageNotice = 'Saved settings were corrupt — defaults restored.'; } }
      }
    } catch (e) {
      settings = { audio: true, showMiniMap: true, camera: 'chase' };
      storageNotice = 'Storage unavailable — using defaults.';
    }

    cacheElements(doc);
    wireMenu(doc);
    wireKeyboard(doc);
    wireResize(global);
    resize();

    showMenu();
    updateBestLapLabel();
    if (storageNotice) setNotice(storageNotice);
    return true;
  }

  function cacheElements(doc) {
    ['menu', 'results', 'pauseOverlay', 'notice',
      'hudSpeed', 'hudGear', 'hudLap', 'hudPos', 'hudLapTime', 'hudBest',
      'hudGap', 'hudStatus', 'hudTireTemp', 'hudTireWear', 'hudErs',
      'hudDrs', 'hudFuel', 'hudPit', 'hudDrsMsg', 'resultsBody', 'bestLapLabel',
      'countdown', 'diffSelect']
      .forEach(function (id) { el[id] = doc.getElementById(id); });
  }

  // ---------------------------------------------------------------------
  // MENU / OVERLAYS
  // ---------------------------------------------------------------------
  function wireMenu(doc) {
    bind(doc, 'btnStartNormal', function () { startRace(false); });
    bind(doc, 'btnStartDemo', function () { startRace(true); });
    bind(doc, 'btnExport', function () { exportTelemetry(); });
    bind(doc, 'btnResultsMenu', function () { stopRace(); showMenu(); });
    bind(doc, 'btnResultsRestart', function () { restart(); });
    if (el.diffSelect) {
      el.diffSelect.value = global.Storage.getDifficulty();
      el.diffSelect.addEventListener('change', function () {
        global.Storage.saveDifficulty(el.diffSelect.value);
      });
    }
  }
  function bind(doc, id, fn) { var b = doc.getElementById(id); if (b) b.addEventListener('click', fn); }

  function showMenu() { if (el.menu) el.menu.style.display = 'flex'; if (el.results) el.results.style.display = 'none'; }
  function hideMenu() { if (el.menu) el.menu.style.display = 'none'; }
  function setNotice(msg) { if (el.notice) { el.notice.textContent = msg; el.notice.style.display = msg ? 'block' : 'none'; } }
  function updateBestLapLabel() {
    if (!el.bestLapLabel) return;
    var b = global.Storage.getBestLap();
    el.bestLapLabel.textContent = b ? ('Best lap: ' + fmtTime(b)) : 'Best lap: —';
  }

  // ---------------------------------------------------------------------
  // RACE LIFECYCLE
  // ---------------------------------------------------------------------
  function startRace(demo) {
    var diff = el.diffSelect ? el.diffSelect.value : global.Storage.getDifficulty();
    R = global.Race.createRace({ demo: !!demo, difficulty: diff, playerIndex: 0 });
    global.Storage.resetTelemetry();
    resultsSaved = false;
    hideMenu();
    if (el.results) el.results.style.display = 'none';
    if (!running) { running = true; lastTime = now(); accumulator = 0; raf = global.requestAnimationFrame(frame); }
  }

  function restart() {
    if (!R) return;
    global.Race.reset(R);
    global.Storage.resetTelemetry();
    resultsSaved = false;
    if (el.results) el.results.style.display = 'none';
    if (el.pauseOverlay) el.pauseOverlay.style.display = 'none';
    if (!running) { running = true; lastTime = now(); accumulator = 0; raf = global.requestAnimationFrame(frame); }
  }

  function stopRace() {
    running = false;
    if (raf) global.cancelAnimationFrame(raf);
    raf = 0;
  }

  function togglePause() {
    if (!R || R.phase === 'finished') return;
    var paused = global.Race.togglePause(R);
    if (el.pauseOverlay) el.pauseOverlay.style.display = paused ? 'flex' : 'none';
  }

  // ---------------------------------------------------------------------
  // INPUT
  // ---------------------------------------------------------------------
  function typingTarget() {
    var d = global.document;
    var a = d.activeElement;
    if (!a) return false;
    var tag = (a.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return true;
    if (a.isContentEditable) return true;
    return false;
  }

  function wireKeyboard(doc) {
    doc.addEventListener('keydown', function (e) {
      if (typingTarget()) return;
      if (mapKey(e, true)) e.preventDefault();
    });
    doc.addEventListener('keyup', function (e) {
      if (typingTarget()) return;
      if (mapKey(e, false)) e.preventDefault();
    });
  }

  function mapKey(e, down) {
    var k = e.key;
    switch (k) {
      case 'w': case 'W': case 'ArrowUp': keys.throttle = down; return true;
      case 's': case 'S': case 'ArrowDown': keys.brake = down; return true;
      case 'a': case 'A': case 'ArrowLeft': keys.left = down; return true;
      case 'd': case 'D': case 'ArrowRight': keys.right = down; return true;
      case 'Shift': keys.ers = down; return true;
      case 'f': case 'F': keys.drs = down; return true;
      case 'p': case 'P': if (down) togglePause(); return true;
      case 'r': case 'R': if (down) restart(); return true;
      case 'c': case 'C': if (down) toggleCamera(); return true;
      default: return false;
    }
  }

  function currentInput() {
    return {
      throttle: keys.throttle ? 1 : 0,
      brake: keys.brake ? 1 : 0,
      steer: (keys.left ? -1 : 0) + (keys.right ? 1 : 0),
      ers: keys.ers,
      drs: keys.drs
    };
  }

  function toggleCamera() {
    camera = (camera === 'chase') ? 'full' : 'chase';
    if (settings) { settings.camera = camera; global.Storage.saveSettings(settings); }
  }

  // ---------------------------------------------------------------------
  // MAIN LOOP (fixed timestep with clamp)
  // ---------------------------------------------------------------------
  function now() { return (global.performance && global.performance.now) ? global.performance.now() : Date.now(); }

  function frame(t) {
    if (!running) return;
    raf = global.requestAnimationFrame(frame);
    var dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt < 0) dt = 0;
    accumulator += dt;
    var maxAccum = CONFIG.maxAccumSteps * CONFIG.dt;
    if (accumulator > maxAccum) accumulator = maxAccum; // clamp: no huge catch-up jump
    while (accumulator >= CONFIG.dt) {
      stepSim(CONFIG.dt);
      accumulator -= CONFIG.dt;
    }
    render();
    updateHUD();
  }

  function stepSim(dt) {
    if (!R) return;
    if (!R.demo) global.Race.setPlayerInput(R, currentInput());
    global.Race.update(R, dt);

    if (R.phase === 'racing') {
      var player = R.cars[R.playerIndex];
      var inp = player._lastInput || currentInput();
      var onTrack = global.Track.surfaceAt(player.x, player.y) !== 'grass';
      global.Storage.sampleTelemetry(R.clock, player, inp, onTrack);
    }

    if (R.phase === 'finished' && !resultsSaved) {
      persistResults();
      showResults();
      resultsSaved = true;
    }
  }

  function persistResults() {
    var player = R.cars[R.playerIndex];
    if (R.fastestLap) global.Storage.saveBestLap(R.fastestLap.time);
    var order = R.classification.map(function (c) {
      return { pos: c.position, abbr: c.abbr, name: c.name, time: c.finishTime, laps: c.lap };
    });
    global.Storage.saveLastResult({
      when: Date.now(), demo: R.demo, difficulty: R.difficulty,
      playerPos: player.position, fastest: R.fastestLap, order: order
    });
    updateBestLapLabel();
  }

  // ---------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------
  function computeTransform() {
    var vw = canvas.width / dpr, vh = canvas.height / dpr;
    if (camera === 'full' || !R) {
      var margin = 20;
      var sx = (vw - margin * 2) / CONFIG.world.width;
      var sy = (vh - margin * 2) / CONFIG.world.height;
      var s = Math.min(sx, sy);
      return { scale: s, ox: (vw - CONFIG.world.width * s) / 2, oy: (vh - CONFIG.world.height * s) / 2 };
    }
    // chase: follow the player
    var p = R.cars[R.playerIndex];
    var s2 = vw / 460; // world units visible across width
    return { scale: s2, ox: vw / 2 - p.x * s2, oy: vh / 2 - p.y * s2 };
  }

  function render() {
    if (!ctx) return;
    var vw = canvas.width / dpr, vh = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.fillStyle = '#0d1b12';
    ctx.fillRect(0, 0, vw, vh);

    var tf = computeTransform();
    ctx.save();
    ctx.translate(tf.ox, tf.oy);
    ctx.scale(tf.scale, tf.scale);

    global.Track.draw(ctx);
    if (R) {
      for (var i = 0; i < R.cars.length; i++) drawCar(ctx, R.cars[i], i === R.playerIndex && !R.demo);
      drawStartLights(ctx);
    }
    ctx.restore();

    drawMiniMap();
  }

  function drawCar(ctx, car, isPlayer) {
    var P = CONFIG.physics;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading);

    // slide/skid marks
    if (car.slide > 4) {
      ctx.fillStyle = 'rgba(20,20,20,0.35)';
      ctx.fillRect(-P.carLength / 2, -P.carWidth / 2 - 1, P.carLength * 0.6, 1.5);
      ctx.fillRect(-P.carLength / 2, P.carWidth / 2 - 0.5, P.carLength * 0.6, 1.5);
    }

    // body
    ctx.fillStyle = car.color;
    roundRect(ctx, -P.carLength / 2, -P.carWidth / 2, P.carLength, P.carWidth, 2);
    ctx.fill();
    // front wing
    ctx.fillStyle = car.accent;
    ctx.fillRect(P.carLength / 2 - 2, -P.carWidth / 2 - 1, 2, P.carWidth + 2);
    // rear wing (opens with DRS)
    ctx.fillStyle = car.drsOpen ? '#7CFC9A' : '#222';
    ctx.fillRect(-P.carLength / 2, -P.carWidth / 2 - 1, 2, P.carWidth + 2);
    // wheels
    ctx.fillStyle = '#111';
    ctx.fillRect(-P.carLength / 2 + 1, -P.carWidth / 2 - 1.5, 3, 1.6);
    ctx.fillRect(-P.carLength / 2 + 1, P.carWidth / 2 - 0.1, 3, 1.6);
    ctx.fillRect(P.carLength / 2 - 4, -P.carWidth / 2 - 1.5, 3, 1.6);
    ctx.fillRect(P.carLength / 2 - 4, P.carWidth / 2 - 0.1, 3, 1.6);

    // brake glow
    var inp = car._lastInput;
    if (inp && inp.brake > 0.2) {
      ctx.fillStyle = 'rgba(255,60,40,0.9)';
      ctx.fillRect(-P.carLength / 2 - 1, -P.carWidth / 2 + 1, 1.5, P.carWidth - 2);
    }
    ctx.restore();

    // driver abbreviation label (screen-upright)
    ctx.save();
    ctx.translate(car.x, car.y - 10);
    ctx.fillStyle = isPlayer ? '#fff' : 'rgba(255,255,255,0.85)';
    ctx.font = '6px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(car.abbr, 0, 0);
    ctx.restore();
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

  function drawStartLights(ctx) {
    if (!R || R.phase !== 'countdown') return;
    var w = global.Track.worldAtProgress(0.001);
    var n = CONFIG.race.lightCount;
    ctx.save();
    ctx.translate(w.x, w.y - 55);
    for (var i = 0; i < n; i++) {
      ctx.fillStyle = i < R.lightsOn ? '#ff2222' : '#3a0d0d';
      ctx.beginPath();
      ctx.arc((i - (n - 1) / 2) * 10, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMiniMap() {
    if (!mctx || !settings || !settings.showMiniMap) return;
    var w = mini.width, h = mini.height;
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = 'rgba(10,20,14,0.8)';
    mctx.fillRect(0, 0, w, h);
    var pad = 6;
    var s = Math.min((w - pad * 2) / CONFIG.world.width, (h - pad * 2) / CONFIG.world.height);
    var ox = pad, oy = pad;
    function mx(x) { return ox + x * s; }
    function my(y) { return oy + y * s; }
    // centreline
    var pts = global.Track.points();
    mctx.strokeStyle = '#889'; mctx.lineWidth = 2;
    mctx.beginPath();
    for (var i = 0; i <= pts.length; i++) {
      var p = pts[i % pts.length];
      if (i === 0) mctx.moveTo(mx(p.x), my(p.y)); else mctx.lineTo(mx(p.x), my(p.y));
    }
    mctx.stroke();
    if (!R) return;
    for (var c = 0; c < R.cars.length; c++) {
      var car = R.cars[c];
      mctx.fillStyle = car.color;
      mctx.beginPath();
      mctx.arc(mx(car.x), my(car.y), (c === R.playerIndex && !R.demo) ? 3.5 : 2.5, 0, Math.PI * 2);
      mctx.fill();
    }
  }

  // ---------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------
  function gearFor(car) {
    if (car.fVel < -0.5) return 'R';
    if (car.speed < 1) return 'N';
    var g = Math.floor(car.speed / (CONFIG.physics.maxSpeed / 8)) + 1;
    return String(Math.max(1, Math.min(8, g)));
  }

  function updateHUD() {
    if (!R) return;
    var player = R.cars[R.playerIndex];
    set('hudSpeed', Math.round(player.speed * 3.6) + ' km/h');
    set('hudGear', gearFor(player));
    set('hudLap', Math.min(R.laps, player.lap + 1) + ' / ' + R.laps);
    set('hudPos', 'P' + player.position + ' / ' + R.cars.length);
    var lapT = R.phase === 'racing' ? (R.clock - player.lapStart) : 0;
    set('hudLapTime', fmtTime(lapT));
    set('hudBest', R.fastestLap ? fmtTime(R.fastestLap.time) : '—');
    var gap = global.Race.gapToAhead(R, player);
    set('hudGap', player.position === 1 ? 'Leader' : (gap != null ? ('+' + gap.toFixed(0) + ' m') : '—'));
    set('hudStatus', statusText());
    set('hudTireTemp', Math.round(player.tire.temp) + ' °C');
    set('hudTireWear', Math.round(player.tire.wear) + ' %');
    set('hudErs', Math.round(player.ers) + ' %');
    set('hudDrs', player.drsOpen ? 'OPEN' : (global.Race.isDrsEligible(player, R).ok ? 'READY' : 'off'));
    set('hudFuel', Math.round(player.fuel) + ' %');
    set('hudPit', player.pitStatus || (player._inPit ? 'IN PIT' : '—'));
    set('hudDrsMsg', R.drsMessage || '');
    if (el.countdown) {
      el.countdown.style.display = R.phase === 'countdown' ? 'block' : 'none';
      if (R.phase === 'countdown') el.countdown.textContent = R.lightsOn >= CONFIG.race.lightCount ? 'GET READY' : ('LIGHTS: ' + R.lightsOn);
    }
    // bar widths
    setBar('hudErs', player.ers);
    setBar('hudFuel', player.fuel);
    setBar('hudTireWear', player.tire.wear);
  }

  function statusText() {
    if (R.paused) return 'PAUSED';
    if (R.phase === 'countdown') return R.lightsOut ? 'GO!' : 'FORMATION';
    if (R.phase === 'finished') return 'FINISHED';
    return R.demo ? 'DEMO RACE' : 'RACING';
  }

  function set(id, v) { if (el[id]) el[id].textContent = v; }
  function setBar(id, pct) {
    var barEl = global.document.getElementById(id + 'Bar');
    if (barEl) barEl.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function fmtTime(t) {
    if (t == null || !isFinite(t) || t < 0) return '—';
    var m = Math.floor(t / 60), s = t - m * 60;
    if (m > 0) return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
    return s.toFixed(2) + 's';
  }

  // ---------------------------------------------------------------------
  // RESULTS
  // ---------------------------------------------------------------------
  function showResults() {
    if (!el.results) return;
    el.results.style.display = 'flex';
    if (el.resultsBody) {
      var rows = R.classification.map(function (c) {
        return '<tr><td>' + c.position + '</td><td>' + c.abbr + '</td><td>' + c.name +
          '</td><td>' + fmtTime(c.finishTime) + '</td><td>' + c.lap + '</td></tr>';
      }).join('');
      var fastest = R.fastestLap ? (teamAbbr(R.fastestLap.carId) + ' ' + fmtTime(R.fastestLap.time)) : '—';
      el.resultsBody.innerHTML =
        '<table><thead><tr><th>Pos</th><th>Drv</th><th>Team</th><th>Time</th><th>Laps</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        '<p class="fastest">Fastest lap: ' + fastest + '</p>';
    }
  }
  function teamAbbr(id) { var c = R.cars[id]; return c ? c.abbr : '?'; }

  // ---------------------------------------------------------------------
  // TELEMETRY EXPORT
  // ---------------------------------------------------------------------
  function exportTelemetry() {
    var ok = global.Storage.downloadTelemetry('apex_sprint_telemetry.csv');
    if (!ok) setNotice('Telemetry export failed in this browser context.');
    else setNotice('Telemetry CSV exported (' + global.Storage.getTelemetry().length + ' samples).');
  }

  // ---------------------------------------------------------------------
  // RESIZE
  // ---------------------------------------------------------------------
  function wireResize(g) { g.addEventListener('resize', resize); }
  function resize() {
    if (!canvas) return;
    dpr = global.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var cssW = rect.width || canvas.clientWidth || 960;
    var cssH = rect.height || canvas.clientHeight || 600;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    if (mini) { mini.width = mini.clientWidth || 180; mini.height = mini.clientHeight || 120; }
  }

  global.Game = {
    init: init,
    startRace: startRace,
    restart: restart,
    stopRace: stopRace,
    togglePause: togglePause,
    toggleCamera: toggleCamera,
    exportTelemetry: exportTelemetry,
    // exposed for tests / debugging
    _currentInput: currentInput,
    _fmtTime: fmtTime,
    _gearFor: gearFor,
    getRace: function () { return R; }
  };
})(typeof window !== 'undefined' ? window : this);
