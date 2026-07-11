/* race.js
 * Race regulations layered on top of physics.js/track.js: start lights,
 * lap & checkpoint validation, standings, DRS eligibility, pit stop
 * mechanics, pause/reset, and telemetry capture.
 *
 * race.js does NOT decide what a car's inputs should be (no AI logic here)
 * - it only referees the rules given whatever inputs game.js supplies for
 * every car each tick (player input, or AI.computeInput's output).
 */
(function (global) {
  'use strict';

  var Physics = global.Physics;
  var Track = global.Track;

  var CONFIG = {
    TOTAL_LAPS: 3,
    LIGHTS_COUNT: 5,
    LIGHT_INTERVAL_MS: 900,
    LIGHTS_OUT_HOLD_MS: 650,
    PIT_STOP_DURATION_MS: 2500,
    PIT_OVERSPEED_PENALTY_PER_SEC: 2.0,
    PIT_STOP_EPS_SPEED: 0.6,
    DRS_GAP_THRESHOLD_SEC: 1.0,
    TELEMETRY_INTERVAL_MS: 200,
    FINISH_WRAP_HIGH_FRACTION: 0.75,
    FINISH_WRAP_LOW_FRACTION: 0.25
  };

  var TEAMS = [
    { name: 'Solvik Racing', driver: 'M. Solvik', tag: 'SOL', color: '#23d1b2' },
    { name: 'Kestrel GP', driver: 'K. Reyes', tag: 'REY', color: '#e5455a' },
    { name: 'Aurora Motorsport', driver: 'A. Nakata', tag: 'NAK', color: '#f2a53c' },
    { name: 'Vantage Racing', driver: 'V. Duarte', tag: 'DUA', color: '#8b6bf2' }
  ];

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function createCar(index, isPlayer, aiDifficulty) {
    var team = TEAMS[index];
    var grid = Track.getStartGridSlot(index);
    var car = Physics.createCarState(grid.x, grid.y, grid.heading);

    car.id = 'car' + index;
    car.index = index;
    car.name = team.driver;
    car.teamName = team.name;
    car.tag = team.tag;
    car.color = team.color;
    car.isPlayer = !!isPlayer;
    car.aiDifficulty = isPlayer ? null : (aiDifficulty || 'normal');

    car.lap = 0;
    car.lapStartMs = 0;
    car.lastLapMs = null;
    car.bestLapMs = null;
    car.nextCheckpointIndex = 0;
    car.checkpointsReached = [false, false, false];

    car.progress = {
      distanceAlong: grid.distanceAlong,
      prevDistanceAlong: grid.distanceAlong,
      lateralOffset: grid.lateralOffset,
      surface: 'track',
      onTrack: true,
      onGrass: false
    };

    car.drs = { active: false, eligibleNext: false, lastGapSec: null, denyReason: 'first-lap' };

    car.pit = {
      inPitLane: false,
      inBox: false,
      boxIndex: index % Track.pitLane.boxes.length,
      stopTimerMs: 0,
      serviced: false,
      speedingWarning: false,
      timePenaltySec: 0,
      stopsCompleted: 0,
      wantsToPit: false
    };

    car.finished = false;
    car.finishPosition = null;

    return car;
  }

  function createRaceState(options) {
    options = options || {};
    var aiDifficulty = options.aiDifficulty || 'normal';
    var cars = [];
    for (var i = 0; i < 4; i++) {
      cars.push(createCar(i, i === 0, aiDifficulty));
    }

    return {
      mode: options.mode || 'race', // 'race' | 'demo'
      totalLaps: options.totalLaps || CONFIG.TOTAL_LAPS,
      aiDifficulty: aiDifficulty,
      cars: cars,
      phase: 'countdown', // countdown -> racing -> paused -> finished
      pausedFromPhase: null,
      clockMs: 0,
      lights: { stage: 0, total: CONFIG.LIGHTS_COUNT, timerMs: 0, litAllAt: null },
      results: null,
      telemetry: [],
      telemetryAccumMs: 0,
      lastDrsAttemptDenyReason: null
    };
  }

  // ---------------------------------------------------------------------
  // Standings
  // ---------------------------------------------------------------------

  function totalProgressOf(car) {
    return car.lap * Track.length + car.progress.distanceAlong;
  }

  /** Sorted (descending) standings. Single source of truth for ranking. */
  function computeStandings(state) {
    var list = state.cars.slice().sort(function (a, b) {
      return totalProgressOf(b) - totalProgressOf(a);
    });
    list.forEach(function (car, i) { car.position = i + 1; });
    return list;
  }

  function carAhead(state, car) {
    var standings = computeStandings(state);
    var idx = standings.indexOf(car);
    if (idx <= 0) return null;
    return standings[idx - 1];
  }

  // ---------------------------------------------------------------------
  // DRS eligibility
  // ---------------------------------------------------------------------

  function updateDrsGapCheck(state, car) {
    var det = Track.drsZone.detectionDist;
    var prev = car.progress.prevDistanceAlong;
    var now = car.progress.distanceAlong;
    if (!(prev < det && now >= det)) return;

    var ahead = carAhead(state, car);
    if (!ahead) { car.drs.eligibleNext = false; car.drs.lastGapSec = null; return; }

    var gapDistance = totalProgressOf(ahead) - totalProgressOf(car);
    var speed = Math.max(Math.hypot(car.vForward, car.vLateral), 5);
    var gapSec = gapDistance / speed;
    car.drs.lastGapSec = gapSec;
    car.drs.eligibleNext = gapSec >= 0 && gapSec <= CONFIG.DRS_GAP_THRESHOLD_SEC;
  }

  /** Pure eligibility check - safe to call from input handling or AI without side effects. */
  function checkDrsEligibility(car) {
    if (car.lap < 1) return { eligible: false, reason: 'first-lap' };
    if (!Track.isInDrsZone(car.progress.distanceAlong)) return { eligible: false, reason: 'not-in-zone' };
    if (!car.drs.eligibleNext) return { eligible: false, reason: 'gap-too-large' };
    return { eligible: true, reason: 'ok' };
  }

  // ---------------------------------------------------------------------
  // Pit stop mechanics
  // ---------------------------------------------------------------------

  function updatePit(state, car, surfaceInfo, input, dt) {
    var inPitLane = surfaceInfo.surface === 'pitlane';
    car.pit.inPitLane = inPitLane;

    if (!inPitLane) {
      car.pit.inBox = false;
      car.pit.stopTimerMs = 0;
      car.pit.serviced = false;
      car.pit.speedingWarning = false;
      return;
    }

    var speed = Math.hypot(car.vForward, car.vLateral);
    if (speed > Track.pitLane.speedLimit) {
      car.pit.speedingWarning = true;
      car.pit.timePenaltySec += CONFIG.PIT_OVERSPEED_PENALTY_PER_SEC * dt;
    } else {
      car.pit.speedingWarning = false;
    }

    var box = Track.pitLane.boxes[car.pit.boxIndex];
    var rawDelta = Math.abs(car.progress.distanceAlong - box.dist);
    var distDelta = Math.min(rawDelta, Track.length - rawDelta);
    var lateralDelta = Math.abs(car.progress.lateralOffset - box.lateral);
    var inBoxZone = distDelta <= box.captureRadiusDist && lateralDelta <= box.captureRadiusLateral;
    car.pit.inBox = inBoxZone;

    if (inBoxZone && speed <= CONFIG.PIT_STOP_EPS_SPEED) {
      if (!car.pit.serviced) {
        car.pit.stopTimerMs += dt * 1000;
        if (car.pit.stopTimerMs >= CONFIG.PIT_STOP_DURATION_MS) {
          Physics.resetTire(car.tire);
          car.pit.serviced = true;
          car.pit.stopsCompleted += 1;
          car.pit.wantsToPit = false;
        }
      }
    } else if (!inBoxZone) {
      if (!car.pit.serviced) car.pit.stopTimerMs = 0;
    }
  }

  // ---------------------------------------------------------------------
  // Lap / checkpoint validation
  // ---------------------------------------------------------------------

  function updateLapValidation(state, car) {
    var L = Track.length;
    var prev = car.progress.prevDistanceAlong;
    var now = car.progress.distanceAlong;
    var hi = L * CONFIG.FINISH_WRAP_HIGH_FRACTION;
    var lo = L * CONFIG.FINISH_WRAP_LOW_FRACTION;

    var forwardCross = prev > hi && now < lo;
    var backwardCross = prev < lo && now > hi;

    if (car.nextCheckpointIndex < Track.checkpoints.length && !forwardCross && !backwardCross) {
      var cp = Track.checkpoints[car.nextCheckpointIndex];
      if (prev < cp.dist && now >= cp.dist) {
        car.nextCheckpointIndex += 1;
        car.checkpointsReached[cp.id] = true;
      }
    }

    if (forwardCross) {
      if (car.nextCheckpointIndex >= Track.checkpoints.length) {
        var lapTimeMs = state.clockMs - car.lapStartMs;
        car.lastLapMs = lapTimeMs;
        if (car.bestLapMs === null || lapTimeMs < car.bestLapMs) car.bestLapMs = lapTimeMs;
        car.lap += 1;
        car.lapStartMs = state.clockMs;
        car.nextCheckpointIndex = 0;
        car.checkpointsReached = [false, false, false];
      }
      // else: crossed the line without completing checkpoints in order - lap not counted.
    }
  }

  // ---------------------------------------------------------------------
  // Main per-tick update
  // ---------------------------------------------------------------------

  /**
   * inputsByCarId: { [carId]: { throttle, brake, steer, ers, drsRequest } }
   */
  function update(state, dt, inputsByCarId) {
    if (state.phase === 'countdown') {
      updateLights(state, dt);
      return;
    }
    if (state.phase !== 'racing') return;

    state.clockMs += dt * 1000;

    state.cars.forEach(function (car) {
      var input = (inputsByCarId && inputsByCarId[car.id]) || { throttle: 0, brake: 0, steer: 0, ers: false, drsRequest: false };
      car._lastThrottle = input.throttle || 0;
      car._lastBrake = input.brake || 0;
      car._lastSteer = input.steer || 0;

      var beforeProgress = Track.getProgress(car.x, car.y);
      var surface = Track.classify(beforeProgress.distanceAlong, beforeProgress.lateralOffset, beforeProgress.heading);

      updatePit(state, car, surface, input, dt);

      var drsCheck = checkDrsEligibility(car);
      var wantsDrs = !!input.drsRequest;
      if (car.drs.active) {
        if (input.brake > 0 || !Track.isInDrsZone(beforeProgress.distanceAlong) || !wantsDrs) {
          car.drs.active = false;
        }
      } else if (wantsDrs && drsCheck.eligible && input.brake === 0) {
        car.drs.active = true;
      }
      if (wantsDrs && !car.drs.active) state.lastDrsAttemptDenyReason = drsCheck.reason;

      Physics.stepCar(car, {
        throttle: input.throttle,
        brake: input.brake,
        steer: input.steer,
        ers: input.ers,
        drs: car.drs.active
      }, { onGrass: surface.onGrass, gripMultiplier: surface.gripMultiplier, dragMultiplier: surface.dragMultiplier }, dt);

      var afterProgress = Track.getProgress(car.x, car.y);
      var afterSurface = Track.classify(afterProgress.distanceAlong, afterProgress.lateralOffset, afterProgress.heading);
      if (afterSurface.wallContact) {
        Physics.resolveWallCollision(car, afterSurface.wallContact);
        afterProgress = Track.getProgress(car.x, car.y);
        afterSurface = Track.classify(afterProgress.distanceAlong, afterProgress.lateralOffset, afterProgress.heading);
      }

      car.progress.prevDistanceAlong = beforeProgress.distanceAlong;
      car.progress.distanceAlong = afterProgress.distanceAlong;
      car.progress.lateralOffset = afterProgress.lateralOffset;
      car.progress.surface = afterSurface.surface;
      car.progress.onTrack = afterSurface.surface === 'track';
      car.progress.onGrass = afterSurface.surface === 'grass';

      updateDrsGapCheck(state, car);
      updateLapValidation(state, car);
    });

    resolveCarCollisions(state.cars);

    if (state.mode !== 'demo') {
      recordTelemetryIfDue(state, dt);
    }

    checkFinishCondition(state);
  }

  function resolveCarCollisions(cars) {
    for (var i = 0; i < cars.length; i++) {
      for (var j = i + 1; j < cars.length; j++) {
        Physics.resolveCarCollision(cars[i], cars[j]);
      }
    }
  }

  function updateLights(state, dt) {
    state.lights.timerMs += dt * 1000;
    if (state.lights.stage < state.lights.total) {
      if (state.lights.timerMs >= CONFIG.LIGHT_INTERVAL_MS) {
        state.lights.timerMs -= CONFIG.LIGHT_INTERVAL_MS;
        state.lights.stage += 1;
      }
    } else if (state.lights.litAllAt === null) {
      state.lights.litAllAt = state.clockMs;
    } else if (state.lights.timerMs >= CONFIG.LIGHTS_OUT_HOLD_MS) {
      state.phase = 'racing';
      state.cars.forEach(function (car) { car.lapStartMs = 0; });
    }
  }

  function checkFinishCondition(state) {
    if (state.phase !== 'racing') return;
    var player = state.cars.filter(function (c) { return c.isPlayer; })[0];
    var leadCar = state.mode === 'demo' ? computeStandings(state)[0] : player;
    if (leadCar && leadCar.lap >= state.totalLaps) {
      finishRace(state);
    }
  }

  function finishRace(state) {
    state.phase = 'finished';
    var standings = computeStandings(state);
    state.results = {
      standings: standings.map(function (car) {
        return {
          position: car.position,
          name: car.name,
          tag: car.tag,
          team: car.teamName,
          isPlayer: car.isPlayer,
          laps: car.lap,
          bestLapMs: car.bestLapMs,
          lastLapMs: car.lastLapMs,
          pitStops: car.pit.stopsCompleted,
          penaltySec: Math.round(car.pit.timePenaltySec * 10) / 10
        };
      }),
      clockMs: state.clockMs
    };

    var player = state.cars.filter(function (c) { return c.isPlayer; })[0];
    if (player && player.bestLapMs && global.GameStorage) {
      global.GameStorage.setBestLapIfBetter(player.bestLapMs);
      global.GameStorage.setLastResult(state.results);
    }
  }

  // ---------------------------------------------------------------------
  // Pause / resume / reset
  // ---------------------------------------------------------------------

  function togglePause(state) {
    if (state.phase === 'paused') {
      state.phase = state.pausedFromPhase || 'racing';
      state.pausedFromPhase = null;
    } else if (state.phase === 'racing' || state.phase === 'countdown') {
      state.pausedFromPhase = state.phase;
      state.phase = 'paused';
    }
    return state.phase;
  }

  function resetRace(options) {
    return createRaceState(options);
  }

  // ---------------------------------------------------------------------
  // Telemetry
  // ---------------------------------------------------------------------

  function recordTelemetryIfDue(state, dt) {
    state.telemetryAccumMs += dt * 1000;
    if (state.telemetryAccumMs < CONFIG.TELEMETRY_INTERVAL_MS) return;
    state.telemetryAccumMs -= CONFIG.TELEMETRY_INTERVAL_MS;

    var player = state.cars.filter(function (c) { return c.isPlayer; })[0];
    if (!player) return;
    state.telemetry.push({
      timeMs: Math.round(state.clockMs),
      lap: player.lap + 1,
      x: player.x,
      y: player.y,
      speed: Math.hypot(player.vForward, player.vLateral),
      throttle: player._lastThrottle || 0,
      brake: player._lastBrake || 0,
      steer: player._lastSteer || 0,
      tireTempC: player.tire.tempC,
      tireWearPct: player.tire.wearPct,
      ersPct: player.ers.pct,
      drsActive: player.drs.active ? 1 : 0,
      onTrack: player.progress.onTrack ? 1 : 0
    });
  }

  function exportTelemetryCSV(state) {
    if (!global.GameStorage) return false;
    var csv = global.GameStorage.buildTelemetryCSV(state.telemetry);
    return global.GameStorage.downloadTextFile('apex-sprint-telemetry.csv', csv, 'text/csv');
  }

  global.Race = {
    CONFIG: CONFIG,
    TEAMS: TEAMS,
    createRaceState: createRaceState,
    createCar: createCar,
    computeStandings: computeStandings,
    totalProgressOf: totalProgressOf,
    checkDrsEligibility: checkDrsEligibility,
    update: update,
    togglePause: togglePause,
    resetRace: resetRace,
    exportTelemetryCSV: exportTelemetryCSV,
    finishRace: finishRace,
    // exposed for direct, no-fake-logic unit testing (tests.html drives these
    // exact functions instead of re-implementing lap/DRS/pit rules)
    updateLapValidation: updateLapValidation,
    updateDrsGapCheck: updateDrsGapCheck,
    updatePit: updatePit,
    updateLights: updateLights,
    checkFinishCondition: checkFinishCondition
  };
})(typeof window !== 'undefined' ? window : global);
