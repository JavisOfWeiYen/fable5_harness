/* race.js
 * Race rules & state machine: 5-light start, fixed-timestep race clock,
 * per-car checkpoint-gated lap counting, ranking by (laps, then track
 * progress), DRS eligibility, pit-stop enforcement, pause/resume, and full
 * reset. Exposes window.Race.
 *
 * Uses window.Physics, window.Track and window.AI at runtime.
 */
(function (global) {
  'use strict';

  var CONFIG = global.CONFIG;
  var NEUTRAL = { throttle: 0, brake: 0, steer: 0, ers: false, drs: false };

  function Track() { return global.Track; }
  function Physics() { return global.Physics; }
  function AI() { return global.AI; }

  // ---- Race construction -------------------------------------------------

  // opts: { demo:bool, difficulty:'Normal'|'Hard', playerIndex:0 }
  function createRace(opts) {
    opts = opts || {};
    var R = {
      demo: !!opts.demo,
      difficulty: opts.difficulty || 'Normal',
      playerIndex: opts.playerIndex != null ? opts.playerIndex : 0,
      laps: CONFIG.race.laps,
      phase: 'countdown',     // 'countdown' | 'racing' | 'finished'
      paused: false,
      clock: 0,
      cars: [],
      ai: {},
      // start lights
      lightTimer: 0,
      lightsOn: 0,
      lightsOut: false,
      lightsOutDelay: 0,
      fastestLap: null,       // { time, carId }
      classification: [],
      playerInput: cloneInput(NEUTRAL),
      drsMessage: '',
      warning: ''
    };
    initCars(R);
    return R;
  }

  function cloneInput(i) { return { throttle: i.throttle, brake: i.brake, steer: i.steer, ers: i.ers, drs: i.drs }; }

  function initCars(R) {
    var T = Track();
    var slots = T.gridSlots(4);
    R.cars = [];
    R.ai = {};
    for (var i = 0; i < 4; i++) {
      var s = slots[i];
      var car = Physics().createCar({
        id: i, team: i, x: s.x, y: s.y, heading: s.heading,
        isAI: R.demo || i !== R.playerIndex
      });
      car.penaltyTime = 0;
      car.lapStart = 0;
      car.laps = [];
      car.lastLap = 0;
      car.progress = T.progressAt(car.x, car.y);
      car._prevProgress = car.progress;
      car.totalProgress = car.lap + car.progress;
      car.offset = 0;
      car.pitStatus = '';
      car._pitTimer = 0;
      car._pitDone = false;
      car._inPit = false;
      car._pitPenaltyApplied = false;
      car._drsEligible = false;
      car._lapJustCompleted = false;
      R.cars.push(car);
      R.ai[i] = { profile: R.difficulty, stuck: 0, prevX: car.x, prevY: car.y, wantPit: false };
      car.aiRef = R.ai[i];
    }
    // deterministic lights-out delay window
    R.lightsOutDelay = CONFIG.race.lightCount * CONFIG.race.lightInterval +
      CONFIG.race.lightsOutMin +
      (CONFIG.race.lightsOutMax - CONFIG.race.lightsOutMin) * 0.5;
    computeRankings(R.cars);
    R.classification = R.cars.slice();
  }

  // ---- Reset: restore exact initial state --------------------------------
  function reset(R) {
    R.phase = 'countdown';
    R.paused = false;
    R.clock = 0;
    R.lightTimer = 0;
    R.lightsOn = 0;
    R.lightsOut = false;
    R.fastestLap = null;
    R.classification = [];
    R.playerInput = cloneInput(NEUTRAL);
    R.drsMessage = '';
    R.warning = '';
    initCars(R);
    return R;
  }

  function togglePause(R) { R.paused = !R.paused; return R.paused; }
  function setPaused(R, v) { R.paused = !!v; }
  function setPlayerInput(R, input) { R.playerInput = cloneInput(input); }

  // ---- Countdown ---------------------------------------------------------
  function updateCountdown(R, dt) {
    R.lightTimer += dt;
    R.lightsOn = Math.min(CONFIG.race.lightCount,
      Math.floor(R.lightTimer / CONFIG.race.lightInterval));
    if (R.lightTimer >= R.lightsOutDelay) {
      R.lightsOut = true;
      R.phase = 'racing';
      R.clock = 0;
      for (var i = 0; i < R.cars.length; i++) R.cars[i].lapStart = 0;
    }
  }

  // ---- Lap / checkpoint logic (pure, per car) ----------------------------
  // Advances checkpoints only in order, and increments lap only when the
  // finish line is crossed FORWARD with every checkpoint already passed.
  // Crossing the line backward never increments the lap.
  function applyLapLogic(car, newProgress, laps) {
    var cps = Track().checkpoints;
    var n = cps.length;
    var prev = car._prevProgress;
    var delta = newProgress - prev;

    // forward checkpoint crossings (non-wrap region)
    while (car.nextCp < n) {
      var cp = cps[car.nextCp].progress;
      if (prev < cp && newProgress >= cp && delta > 0 && delta < 0.5) {
        car.nextCp++;
      } else {
        break;
      }
    }

    var crossedForward = delta < -0.5;   // wrapped high->low: forward over the line
    var crossedBackward = delta > 0.5;    // wrapped low->high: backward over the line

    car._lapJustCompleted = false;
    if (crossedForward) {
      if (car.nextCp >= n) {
        car.lap++;
        car.nextCp = 0;
        car._lapJustCompleted = true;
      } else {
        // cut the course: no lap credit, restart checkpoint tracking
        car.nextCp = 0;
      }
    }
    if (crossedBackward) {
      // driving backward across the line: never counts, invalidate checkpoints
      car.nextCp = 0;
    }

    car._prevProgress = newProgress;
    car.progress = newProgress;
    car.totalProgress = car.lap + newProgress;
    return car;
  }

  function recordLap(R, car) {
    var t = R.clock - car.lapStart;
    car.lapStart = R.clock;
    car.lastLap = t;
    car.laps.push(t);
    if (!R.fastestLap || t < R.fastestLap.time) {
      R.fastestLap = { time: t, carId: car.id };
    }
  }

  // ---- Ranking -----------------------------------------------------------
  // Finished cars first (by finish time), everyone else by (lap + progress).
  function computeRankings(cars) {
    var arr = cars.slice();
    arr.sort(function (a, b) {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return (b.lap + b.progress) - (a.lap + a.progress);
    });
    for (var i = 0; i < arr.length; i++) arr[i].position = i + 1;
    return arr;
  }

  // ---- DRS ---------------------------------------------------------------
  function isDrsEligible(car, R) {
    if (car.lap < 1) return { ok: false, reason: 'DRS disabled on lap 1' };
    if (!Track().inDrsZone(car.progress)) return { ok: false, reason: 'Not in the DRS zone' };
    if (!car._drsEligible) return { ok: false, reason: 'Not within range of the car ahead at detection' };
    return { ok: true, reason: '' };
  }

  // Player pressing F.
  function tryOpenDrs(car, R) {
    var e = isDrsEligible(car, R);
    if (e.ok) { car.drsOpen = true; return { ok: true, reason: '' }; }
    car.drsOpen = false;
    return { ok: false, reason: e.reason };
  }

  // Auto-close on braking or leaving the zone.
  function updateDrsState(car, R, braking) {
    if (car.drsOpen && (!Track().inDrsZone(car.progress) || braking)) {
      car.drsOpen = false;
    }
  }

  function handleDrs(R, car, input) {
    updateDrsState(car, R, input.brake > 0.2);
    if (input.drs) {
      var e = isDrsEligible(car, R);
      if (e.ok && input.brake <= 0.2) {
        car.drsOpen = true;
      } else {
        car.drsOpen = false;
        if (!car.isAI) R.drsMessage = e.ok ? '' : e.reason;
      }
    }
  }

  function carAhead(cars, car) {
    var best = null, bestGap = Infinity;
    for (var i = 0; i < cars.length; i++) {
      var o = cars[i];
      if (o === car) continue;
      var gap = (o.lap + o.progress) - (car.lap + car.progress);
      if (gap > 0 && gap < bestGap) { bestGap = gap; best = o; }
    }
    return best ? { car: best, gapMetres: bestGap * Track().totalLength() } : null;
  }

  function updateDrsEligibility(R, car, prevProgress) {
    var det = Track().drsZone.detection;
    var end = Track().drsZone.end;
    var delta = car.progress - prevProgress;
    if (prevProgress < det && car.progress >= det && delta > 0 && delta < 0.5) {
      var ah = carAhead(R.cars, car);
      car._drsEligible = !!(ah && ah.gapMetres < CONFIG.race.drsGapMetres) && car.lap >= 1;
    }
    if (prevProgress <= end && car.progress > end && delta > 0 && delta < 0.5) {
      car._drsEligible = false;
    }
  }

  // ---- Pit stop ----------------------------------------------------------
  function checkPitSpeeding(R, car, surface) {
    if (surface === 'pit') {
      car._inPit = true;
      if (car.speed > CONFIG.race.pitSpeedLimit + 0.5 && !car._pitPenaltyApplied) {
        car.penaltyTime += CONFIG.race.pitSpeedPenalty;
        car._pitPenaltyApplied = true;
        car.pitStatus = 'SPEEDING +' + CONFIG.race.pitSpeedPenalty + 's';
        if (!car.isAI) R.warning = 'Pit lane speeding! +' + CONFIG.race.pitSpeedPenalty + 's penalty';
      }
    } else if (car._inPit) {
      car._inPit = false;
      car._pitPenaltyApplied = false;
      if (car.pitStatus && car.pitStatus.indexOf('SERVIC') < 0 && car.pitStatus.indexOf('DONE') < 0) {
        car.pitStatus = '';
      }
    }
  }

  // Service the car when stopped inside the pit box for the dwell time.
  function updatePit(R, car, dt) {
    var T = Track();
    var atBox = Math.hypot(car.x - T.pitBox.x, car.y - T.pitBox.y) < CONFIG.race.pitBoxRadius;
    var stopped = car.speed < 1.2;
    if (atBox && stopped) {
      car._pitTimer += dt;
      var remain = Math.max(0, CONFIG.race.pitDwell - car._pitTimer);
      car.pitStatus = 'SERVICING ' + remain.toFixed(1) + 's';
      if (car._pitTimer >= CONFIG.race.pitDwell) {
        car.tire.wear = CONFIG.physics.tire.pitResetWear;
        car.tire.temp = CONFIG.physics.tire.pitResetTemp;
        car.tire.grip = Physics().computeGrip(car.tire);
        car._pitDone = true;
        car._pitTimer = 0;
        car.pitStatus = 'PIT DONE';
        if (car.aiRef) car.aiRef.wantPit = false;
      }
    } else {
      if (car._pitTimer > 0 && car.pitStatus.indexOf('SERVICING') === 0) car.pitStatus = '';
      car._pitTimer = 0;
    }
  }

  // ---- Main update -------------------------------------------------------
  function update(R, dt) {
    if (R.paused) return;
    if (R.phase === 'countdown') { updateCountdown(R, dt); return; }
    if (R.phase === 'finished') { return; }

    R.clock += dt;   // fixed-timestep race clock (only advances while racing)

    var T = Track(), P = Physics();
    var cars = R.cars;
    R.drsMessage = '';

    for (var i = 0; i < cars.length; i++) {
      var car = cars[i];
      if (car.finished) {
        P.stepCar(car, { throttle: 0, brake: 0.5, steer: 0, ers: false, drs: false },
          dt, { surface: T.surfaceAt(car.x, car.y) });
        var nrf = T.nearest(car.x, car.y);
        P.resolveWalls(car, T.boundaryAt(car.x, car.y));
        car.progress = nrf.progress; car.totalProgress = car.lap + nrf.progress;
        continue;
      }

      var prevProgress = car.progress;
      var input;
      if (car.isAI) {
        input = AI().computeInput(car, R.ai[car.id], T, cars, R, dt);
      } else {
        input = R.playerInput || NEUTRAL;
      }

      car._lastInput = input;
      handleDrs(R, car, input);
      var surface = T.surfaceAt(car.x, car.y);
      checkPitSpeeding(R, car, surface);

      P.stepCar(car, input, dt, { surface: surface });
      P.resolveWalls(car, T.boundaryAt(car.x, car.y));

      var nr = T.nearest(car.x, car.y);
      car.offset = nr.offset;
      applyLapLogic(car, nr.progress, R.laps);
      if (car._lapJustCompleted) recordLap(R, car);

      updatePit(R, car, dt);
      updateDrsEligibility(R, car, prevProgress);

      if (car.lap >= R.laps && !car.finished) {
        car.finished = true;
        car.finishTime = R.clock + car.penaltyTime;
      }
    }

    // car-vs-car collisions
    for (var a = 0; a < cars.length; a++) {
      for (var b = a + 1; b < cars.length; b++) {
        P.resolveCarCollision(cars[a], cars[b]);
      }
    }

    R.classification = computeRankings(cars);

    var allDone = true;
    for (var k = 0; k < cars.length; k++) { if (!cars[k].finished) { allDone = false; break; } }
    if (allDone) finishRace(R);
  }

  function finishRace(R) {
    R.phase = 'finished';
    R.classification = computeRankings(R.cars);
  }

  // ---- Timestamp / gap helpers for the HUD -------------------------------
  function gapToAhead(R, car) {
    var ah = carAhead(R.cars, car);
    if (!ah) return null;
    return ah.gapMetres; // metres
  }

  global.Race = {
    createRace: createRace,
    reset: reset,
    update: update,
    updateCountdown: updateCountdown,
    togglePause: togglePause,
    setPaused: setPaused,
    setPlayerInput: setPlayerInput,
    applyLapLogic: applyLapLogic,
    recordLap: recordLap,
    computeRankings: computeRankings,
    isDrsEligible: isDrsEligible,
    tryOpenDrs: tryOpenDrs,
    updateDrsState: updateDrsState,
    updateDrsEligibility: updateDrsEligibility,
    handleDrs: handleDrs,
    checkPitSpeeding: checkPitSpeeding,
    updatePit: updatePit,
    carAhead: carAhead,
    gapToAhead: gapToAhead,
    finishRace: finishRace,
    _initCars: initCars
  };
})(typeof window !== 'undefined' ? window : this);
