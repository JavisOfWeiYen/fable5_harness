/* game.js
 * Orchestration only: DOM/canvas setup, keyboard input, the fixed-timestep
 * main loop, rendering, HUD text, menu/overlay wiring, and Demo Race mode.
 * All simulation truth lives in physics.js/track.js/race.js/ai.js - this
 * file just reads that state and draws it, or turns key state into the
 * same input shape AI.computeInput produces.
 */
(function () {
  'use strict';

  var FOLLOW_ZOOM = 3.1;
  var MAX_FRAME_DT = 0.25;
  var DRS_TOAST_MS = 1600;
  var WORLD_TO_KMH = 3.6;

  var el = {};
  function cacheDom() {
    ['raceCanvas', 'minimapCanvas', 'hud', 'hudLap', 'hudTotalLaps', 'hudPosition', 'hudLapTime',
      'hudBestLap', 'hudGap', 'hudRaceStatus', 'hudDemoBadge', 'hudSpeed', 'hudGear', 'hudTireTemp',
      'hudTireWear', 'hudErs', 'hudDrs', 'hudFuel', 'hudPit', 'drsDenyToast', 'pitSpeedToast',
      'lightsOverlay', 'lightsCaption', 'mainMenu', 'pauseOverlay', 'resultsOverlay', 'resultsBody',
      'menuBestLap', 'difficultySelect', 'startRaceBtn', 'demoRaceBtn', 'storageWarning',
      'resumeBtn', 'restartFromPauseBtn', 'quitToMenuBtn', 'exportTelemetryBtn',
      'restartFromResultsBtn', 'resultsToMenuBtn'
    ].forEach(function (id) { el[id] = document.getElementById(id); });
  }

  var App = {
    mode: 'menu', // 'menu' | 'race'
    demoMode: false,
    difficulty: 'normal',
    cameraMode: 'follow',
    raceState: null,
    accumulatorMs: 0,
    lastFrameTs: null,
    keys: { up: false, down: false, left: false, right: false, ers: false, drs: false },
    drsToastUntil: 0,
    lastDrsHeld: false,
    trackBounds: null,
    lastLightStage: -1
  };

  // ------------------------------------------------------------------
  // Input
  // ------------------------------------------------------------------

  function isTypingTarget(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable;
  }

  function onKeyDown(e) {
    if (isTypingTarget(e.target)) return;
    switch (e.key) {
      case 'w': case 'W': case 'ArrowUp': App.keys.up = true; e.preventDefault(); break;
      case 's': case 'S': case 'ArrowDown': App.keys.down = true; e.preventDefault(); break;
      case 'a': case 'A': case 'ArrowLeft': App.keys.left = true; e.preventDefault(); break;
      case 'd': case 'D': case 'ArrowRight': App.keys.right = true; e.preventDefault(); break;
      case 'Shift': App.keys.ers = true; break;
      case 'f': case 'F': handleDrsKeyDown(); e.preventDefault(); break;
      case 'p': case 'P': togglePause(); break;
      case 'r': case 'R': restartRace(); break;
      case 'c': case 'C': toggleCamera(); break;
      default: return;
    }
  }

  function onKeyUp(e) {
    if (isTypingTarget(e.target)) return;
    switch (e.key) {
      case 'w': case 'W': case 'ArrowUp': App.keys.up = false; break;
      case 's': case 'S': case 'ArrowDown': App.keys.down = false; break;
      case 'a': case 'A': case 'ArrowLeft': App.keys.left = false; break;
      case 'd': case 'D': case 'ArrowRight': App.keys.right = false; break;
      case 'Shift': App.keys.ers = false; break;
      case 'f': case 'F': App.keys.drs = false; break;
      default: return;
    }
  }

  function handleDrsKeyDown() {
    App.keys.drs = true;
    var player = getPlayerCar();
    if (!player) return;
    var check = Race.checkDrsEligibility(player);
    if (!check.eligible && !player.drs.active) {
      showDrsDenyToast(check.reason);
    }
  }

  var DRS_DENY_TEXT = {
    'first-lap': 'DRS unavailable on lap 1',
    'not-in-zone': 'Not in a DRS zone',
    'gap-too-large': 'Gap to car ahead too large'
  };

  function showDrsDenyToast(reason) {
    el.drsDenyToast.textContent = 'DRS: ' + (DRS_DENY_TEXT[reason] || 'unavailable');
    el.drsDenyToast.classList.remove('hidden');
    App.drsToastUntil = performance.now() + DRS_TOAST_MS;
  }

  function playerInput() {
    var steer = 0;
    if (App.keys.left) steer -= 1;
    if (App.keys.right) steer += 1;
    return {
      throttle: App.keys.up ? 1 : 0,
      brake: App.keys.down ? 1 : 0,
      steer: steer,
      ers: App.keys.ers,
      drsRequest: App.keys.drs
    };
  }

  function getPlayerCar() {
    if (!App.raceState) return null;
    var found = null;
    App.raceState.cars.forEach(function (c) { if (c.isPlayer) found = c; });
    return found;
  }

  // ------------------------------------------------------------------
  // Race lifecycle
  // ------------------------------------------------------------------

  function startRace(demo) {
    App.difficulty = el.difficultySelect.value;
    GameStorage.setDifficulty(App.difficulty);
    App.demoMode = !!demo;
    App.raceState = Race.createRaceState({ aiDifficulty: App.difficulty, mode: demo ? 'demo' : 'race' });
    App.mode = 'race';
    App.lastLightStage = -1;
    el.mainMenu.classList.add('hidden');
    el.pauseOverlay.classList.add('hidden');
    el.resultsOverlay.classList.add('hidden');
    el.hud.classList.remove('hidden');
    el.hudDemoBadge.classList.toggle('hidden', !App.demoMode);
    App.accumulatorMs = 0;
  }

  function restartRace() {
    if (App.mode !== 'race' || !App.raceState) return;
    App.raceState = Race.resetRace({ aiDifficulty: App.difficulty, mode: App.demoMode ? 'demo' : 'race' });
    App.lastLightStage = -1;
    el.pauseOverlay.classList.add('hidden');
    el.resultsOverlay.classList.add('hidden');
    el.hud.classList.remove('hidden');
    App.accumulatorMs = 0;
  }

  function togglePause() {
    if (App.mode !== 'race' || !App.raceState) return;
    var phase = Race.togglePause(App.raceState);
    el.pauseOverlay.classList.toggle('hidden', phase !== 'paused');
  }

  function toggleCamera() {
    App.cameraMode = App.cameraMode === 'follow' ? 'full' : 'follow';
  }

  function quitToMenu() {
    App.mode = 'menu';
    App.raceState = null;
    el.hud.classList.add('hidden');
    el.pauseOverlay.classList.add('hidden');
    el.resultsOverlay.classList.add('hidden');
    el.mainMenu.classList.remove('hidden');
    refreshMenuBestLap();
  }

  function refreshMenuBestLap() {
    var best = GameStorage.getBestLap().value;
    el.menuBestLap.textContent = best ? formatTime(best) : '--:--.---';
  }

  // ------------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------------

  function stepPhysics(dtSeconds) {
    var state = App.raceState;
    if (!state) return;
    var inputs = {};
    state.cars.forEach(function (car) {
      if (car.isPlayer && !App.demoMode) {
        inputs[car.id] = playerInput();
      } else {
        inputs[car.id] = AI.computeInput(car, state, car.aiDifficulty || App.difficulty);
      }
    });
    Race.update(state, dtSeconds, inputs);
  }

  function frame(ts) {
    if (App.lastFrameTs === null) App.lastFrameTs = ts;
    var frameDt = Math.min((ts - App.lastFrameTs) / 1000, MAX_FRAME_DT);
    App.lastFrameTs = ts;

    if (App.mode === 'race' && App.raceState) {
      App.accumulatorMs += frameDt * 1000;
      var stepMs = Physics.FIXED_DT * 1000;
      var steps = 0;
      while (App.accumulatorMs >= stepMs && steps < Physics.MAX_STEPS_PER_FRAME) {
        stepPhysics(Physics.FIXED_DT);
        App.accumulatorMs -= stepMs;
        steps++;
      }
      if (steps === Physics.MAX_STEPS_PER_FRAME) App.accumulatorMs = 0;

      updateOverlaysForPhase();
      updateHud();
    }

    render();
    if (App.drsToastUntil && performance.now() > App.drsToastUntil) {
      el.drsDenyToast.classList.add('hidden');
      App.drsToastUntil = 0;
    }
    var player = getPlayerCar();
    el.pitSpeedToast.classList.toggle('hidden', !(player && player.pit.speedingWarning));

    requestAnimationFrame(frame);
  }

  function updateOverlaysForPhase() {
    var state = App.raceState;
    if (state.phase === 'countdown') {
      el.lightsOverlay.classList.remove('hidden');
      if (state.lights.stage !== App.lastLightStage) {
        App.lastLightStage = state.lights.stage;
        var lights = el.lightsOverlay.querySelectorAll('.light');
        lights.forEach(function (lightEl, i) {
          lightEl.classList.toggle('lit', i < state.lights.stage);
          lightEl.classList.remove('go');
        });
        el.lightsCaption.textContent = state.lights.stage >= state.lights.total ? 'GET READY' : '';
      }
    } else if (state.phase !== 'countdown' && !el.lightsOverlay.classList.contains('hidden')) {
      var lights = el.lightsOverlay.querySelectorAll('.light');
      lights.forEach(function (lightEl) { lightEl.classList.add('go'); });
      el.lightsCaption.textContent = 'GO!';
      setTimeout(function () { el.lightsOverlay.classList.add('hidden'); }, 350);
    }

    el.pauseOverlay.classList.toggle('hidden', state.phase !== 'paused');

    if (state.phase === 'finished' && el.resultsOverlay.classList.contains('hidden')) {
      showResults(state);
    }
  }

  function showResults(state) {
    el.resultsOverlay.classList.remove('hidden');
    el.resultsBody.innerHTML = '';
    state.results.standings.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.isPlayer) tr.style.fontWeight = '700';
      tr.innerHTML = '<td>' + r.position + '</td><td>' + r.name + (r.isPlayer ? ' (YOU)' : '') + '</td>' +
        '<td>' + r.team + '</td><td>' + r.laps + '</td>' +
        '<td>' + (r.bestLapMs ? formatTime(r.bestLapMs) : '--') + '</td>' +
        '<td>' + r.pitStops + '</td><td>' + (r.penaltySec > 0 ? '+' + r.penaltySec + 's' : '-') + '</td>';
      el.resultsBody.appendChild(tr);
    });
    refreshMenuBestLap();
  }

  function formatTime(ms) {
    if (ms === null || ms === undefined || !isFinite(ms)) return '--:--.---';
    var totalMs = Math.max(0, Math.round(ms));
    var m = Math.floor(totalMs / 60000);
    var s = Math.floor((totalMs % 60000) / 1000);
    var msRem = totalMs % 1000;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + '.' + (msRem < 100 ? (msRem < 10 ? '00' : '0') : '') + msRem;
  }

  function updateHud() {
    var state = App.raceState;
    var player = getPlayerCar();
    if (!player) return;

    var standings = Race.computeStandings(state);
    el.hudLap.textContent = Math.min(player.lap + 1, state.totalLaps);
    el.hudTotalLaps.textContent = state.totalLaps;
    el.hudPosition.textContent = player.position || '-';
    el.hudLapTime.textContent = formatTime(state.clockMs - player.lapStartMs);
    el.hudBestLap.textContent = formatTime(player.bestLapMs);

    var idx = standings.indexOf(player);
    if (idx === 0) {
      var behind = standings[1];
      el.hudGap.textContent = behind ? '-' + gapSeconds(player, behind).toFixed(1) + 's (lead)' : '--';
    } else {
      var ahead = standings[idx - 1];
      el.hudGap.textContent = '+' + gapSeconds(ahead, player).toFixed(1) + 's';
    }

    el.hudSpeed.textContent = Math.round(Math.hypot(player.vForward, player.vLateral) * WORLD_TO_KMH);
    el.hudGear.textContent = Physics.speedToGear(Math.hypot(player.vForward, player.vLateral));
    el.hudTireTemp.textContent = Math.round(player.tire.tempC);
    el.hudTireWear.textContent = Math.round(player.tire.wearPct);
    el.hudErs.textContent = Math.round(player.ers.pct);
    el.hudFuel.textContent = player.fuel.kg.toFixed(1);

    var drsText = 'OFF';
    if (player.drs.active) drsText = 'ON';
    else if (Race.checkDrsEligibility(player).eligible) drsText = 'READY';
    el.hudDrs.textContent = drsText;

    var pitText = '-';
    if (player.pit.inBox && !player.pit.serviced) {
      pitText = 'SERVICING ' + Math.max(0, Math.ceil((Race.CONFIG.PIT_STOP_DURATION_MS - player.pit.stopTimerMs) / 1000)) + 's';
    } else if (player.pit.inPitLane) {
      pitText = 'IN PIT LANE';
    }
    el.hudPit.textContent = pitText;

    var statusText = { countdown: 'Countdown', racing: 'Racing', paused: 'Paused', finished: 'Finished' }[state.phase] || '';
    el.hudRaceStatus.textContent = statusText;
  }

  function gapSeconds(aheadCar, behindCar) {
    var dist = Race.totalProgressOf(aheadCar) - Race.totalProgressOf(behindCar);
    var speed = Math.max(Math.hypot(behindCar.vForward, behindCar.vLateral), 5);
    return dist / speed;
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  var ctx, minimapCtx;

  function resizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    var canvas = el.raceCanvas;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
  }

  function computeTrackBounds() {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    Track.boundaries.grassOuter.concat(Track.boundaries.pitOuter).forEach(function (p) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, w: maxX - minX, h: maxY - minY };
  }

  function getCameraTransform(canvasW, canvasH) {
    var dpr = window.devicePixelRatio || 1;
    if (App.cameraMode === 'full') {
      var b = App.trackBounds;
      var zoom = Math.min(canvasW / (b.w * 1.15), canvasH / (b.h * 1.15));
      return { camX: b.minX + b.w / 2, camY: b.minY + b.h / 2, scale: zoom };
    }
    var player = getPlayerCar();
    var target = player || (App.raceState ? App.raceState.cars[0] : { x: 0, y: 0 });
    return { camX: target.x, camY: target.y, scale: FOLLOW_ZOOM * dpr };
  }

  function worldToScreen(t, x, y, canvasW, canvasH) {
    return {
      x: (x - t.camX) * t.scale + canvasW / 2,
      y: (y - t.camY) * t.scale + canvasH / 2
    };
  }

  function polyToScreenPath(ctx2, points, t, canvasW, canvasH) {
    for (var i = 0; i < points.length; i++) {
      var p = worldToScreen(t, points[i].x, points[i].y, canvasW, canvasH);
      if (i === 0) ctx2.moveTo(p.x, p.y); else ctx2.lineTo(p.x, p.y);
    }
  }

  function drawRibbon(ctx2, inner, outer, t, canvasW, canvasH, fillStyle) {
    ctx2.beginPath();
    polyToScreenPath(ctx2, outer, t, canvasW, canvasH);
    for (var i = inner.length - 1; i >= 0; i--) {
      var p = worldToScreen(t, inner[i].x, inner[i].y, canvasW, canvasH);
      ctx2.lineTo(p.x, p.y);
    }
    ctx2.closePath();
    ctx2.fillStyle = fillStyle;
    ctx2.fill();
  }

  function render() {
    var canvas = el.raceCanvas;
    resizeCanvas();
    var w = canvas.width, h = canvas.height;
    ctx = ctx || canvas.getContext('2d');

    ctx.fillStyle = '#14361f';
    ctx.fillRect(0, 0, w, h);

    if (App.mode !== 'race' || !App.raceState) return;

    var t = getCameraTransform(w, h);
    var b = Track.boundaries;

    drawRibbon(ctx, b.grassOuter, b.grassOuter, t, w, h, '#14361f');
    drawRibbon(ctx, [], b.grassOuter, t, w, h, 'rgba(255,255,255,0)');
    drawRibbon(ctx, b.outer, b.grassOuter, t, w, h, '#2f5c33');
    if (b.pitInner.length) drawRibbon(ctx, b.pitInner, b.pitOuter, t, w, h, '#4a4f57');
    drawRibbon(ctx, b.inner, b.outer, t, w, h, '#3a3f47');

    drawDrsZone(t, w, h);
    drawCheckpoints(t, w, h);
    drawStartLine(t, w, h);
    drawPitBoxes(t, w, h);
    drawCars(t, w, h);
    drawMinimap();
  }

  function drawDrsZone(t, w, h) {
    var zone = Track.drsZone;
    var samples = Track.samples;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < samples.length; i++) {
      if (!Track.isInDrsZone(samples[i].dist)) continue;
      var left = Track.getWorldPointAt(samples[i].dist, -Track.halfWidth);
      var p = worldToScreen(t, left.x, left.y, w, h);
      if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = 'rgba(80, 170, 255, 0.55)';
    ctx.lineWidth = Math.max(2, Track.halfWidth * t.scale * 2);
    ctx.stroke();
  }

  function drawCheckpoints(t, w, h) {
    Track.checkpoints.forEach(function (cp, i) {
      var a = Track.getWorldPointAt(cp.dist, -Track.halfWidth);
      var bpt = Track.getWorldPointAt(cp.dist, Track.halfWidth);
      var pa = worldToScreen(t, a.x, a.y, w, h);
      var pb = worldToScreen(t, bpt.x, bpt.y, w, h);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.strokeStyle = 'rgba(255, 210, 80, 0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  function drawStartLine(t, w, h) {
    var segments = 8;
    for (var i = 0; i < segments; i++) {
      var lat0 = -Track.halfWidth + (i / segments) * Track.halfWidth * 2;
      var lat1 = -Track.halfWidth + ((i + 1) / segments) * Track.halfWidth * 2;
      var p0 = Track.getWorldPointAt(0, lat0);
      var p1 = Track.getWorldPointAt(0.6, lat0);
      var p2 = Track.getWorldPointAt(0.6, lat1);
      var p3 = Track.getWorldPointAt(0, lat1);
      ctx.beginPath();
      [p0, p1, p2, p3].forEach(function (p, idx) {
        var sp = worldToScreen(t, p.x, p.y, w, h);
        if (idx === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
      });
      ctx.closePath();
      ctx.fillStyle = (i % 2 === 0) ? '#f2f2f2' : '#111';
      ctx.fill();
    }
  }

  function drawPitBoxes(t, w, h) {
    Track.pitLane.boxes.forEach(function (box, i) {
      var p = Track.getWorldPointAt(box.dist, box.lateral);
      var sp = worldToScreen(t, p.x, p.y, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sp.x - 8, sp.y - 8, 16, 16);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '10px sans-serif';
      ctx.fillText('P' + (i + 1), sp.x - 6, sp.y + 3);
    });
  }

  function drawCars(t, w, h) {
    App.raceState.cars.forEach(function (car) {
      var sp = worldToScreen(t, car.x, car.y, w, h);
      var len = 4.6 * t.scale, wid = 2.1 * t.scale;

      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(car.heading);

      if (car._lastStepDiag && car._lastStepDiag.isSlipping) {
        ctx.fillStyle = 'rgba(200,200,200,0.35)';
        ctx.beginPath();
        ctx.ellipse(-len * 0.6, 0, len * 0.5, wid * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (car._lastBrake > 0) {
        ctx.fillStyle = 'rgba(255,60,60,0.65)';
        ctx.beginPath();
        ctx.ellipse(-len / 2 - 3, 0, 3, wid * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = car.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(-len / 2, -wid / 2, len, wid, 2) : ctx.rect(-len / 2, -wid / 2, len, wid);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(len / 2, 0);
      ctx.lineTo(len / 2 - 4, -wid / 3);
      ctx.lineTo(len / 2 - 4, wid / 3);
      ctx.closePath();
      ctx.fill();

      if (car.drs.active) {
        ctx.fillStyle = 'rgba(90,180,255,0.9)';
        ctx.fillRect(-len / 2 - 1, -wid / 2 - 2, len, 1.6);
      }

      ctx.restore();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(car.tag, sp.x, sp.y - wid - 4);
    });
  }

  function drawMinimap() {
    var canvas = el.minimapCanvas;
    minimapCtx = minimapCtx || canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    minimapCtx.clearRect(0, 0, w, h);

    var b = App.trackBounds;
    var pad = 6;
    var zoom = Math.min((w - pad * 2) / b.w, (h - pad * 2) / b.h);
    function toMini(p) {
      return { x: pad + (p.x - b.minX) * zoom, y: pad + (p.y - b.minY) * zoom };
    }

    minimapCtx.strokeStyle = 'rgba(255,255,255,0.55)';
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    Track.boundaries.outer.forEach(function (p, i) {
      var m = toMini(p);
      if (i === 0) minimapCtx.moveTo(m.x, m.y); else minimapCtx.lineTo(m.x, m.y);
    });
    minimapCtx.closePath();
    minimapCtx.stroke();

    App.raceState.cars.forEach(function (car) {
      var m = toMini({ x: car.x, y: car.y });
      minimapCtx.beginPath();
      minimapCtx.arc(m.x, m.y, car.isPlayer ? 4 : 3, 0, Math.PI * 2);
      minimapCtx.fillStyle = car.color;
      minimapCtx.fill();
      if (car.isPlayer) {
        minimapCtx.strokeStyle = '#fff';
        minimapCtx.lineWidth = 1;
        minimapCtx.stroke();
      }
    });
  }

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------

  function init() {
    cacheDom();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', resizeCanvas);

    el.startRaceBtn.addEventListener('click', function () { startRace(false); });
    el.demoRaceBtn.addEventListener('click', function () { startRace(true); });
    el.resumeBtn.addEventListener('click', togglePause);
    el.restartFromPauseBtn.addEventListener('click', restartRace);
    el.quitToMenuBtn.addEventListener('click', quitToMenu);
    el.restartFromResultsBtn.addEventListener('click', restartRace);
    el.resultsToMenuBtn.addEventListener('click', quitToMenu);
    el.exportTelemetryBtn.addEventListener('click', function () {
      if (App.raceState) Race.exportTelemetryCSV(App.raceState);
    });

    var diffResult = GameStorage.getDifficulty();
    el.difficultySelect.value = diffResult.value;
    App.difficulty = diffResult.value;

    var settingsResult = GameStorage.getSettings();
    App.cameraMode = settingsResult.value.cameraMode || 'follow';

    var corrupted = diffResult.corrupted || settingsResult.corrupted || GameStorage.getBestLap().corrupted;
    if (corrupted) el.storageWarning.classList.remove('hidden');

    refreshMenuBestLap();
    App.trackBounds = computeTrackBounds();
    resizeCanvas();

    requestAnimationFrame(function (ts) { App.lastFrameTs = ts; requestAnimationFrame(frame); });
  }

  // Wrap Race.update so cars carry the per-tick diagnostics render needs
  // (isSlipping for tire-smoke) without physics.js/race.js needing to know
  // anything about rendering.
  var originalStepCar = Physics.stepCar;
  Physics.stepCar = function (car, input, surface, dt) {
    var diag = originalStepCar(car, input, surface, dt);
    car._lastStepDiag = diag;
    return diag;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__ApexSprintApp = App; // exposed for tests.html / debugging only
})();
