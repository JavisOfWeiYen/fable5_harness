/* tests.js
 * Runs entirely against the real game modules (physics.js/track.js/race.js/
 * ai.js/storage.js) loaded by tests.html - no parallel re-implementation of
 * game rules. Each test either completes silently (PASS) or throws (FAIL,
 * message captured and shown).
 */
(function (global) {
  'use strict';

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
  }
  function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error((msg ? msg + ' - ' : '') + 'expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
    }
  }

  function idleInput() { return { throttle: 0, brake: 0, steer: 0, ers: false, drsRequest: false }; }

  // ---------------------------------------------------------------
  // 1 & 2: checkpoint ordering gates lap completion
  // ---------------------------------------------------------------
  test('1. Checkpoints skipped out of order -> lap NOT incremented', function () {
    var state = Race.createRaceState({});
    var car = state.cars[0];
    var L = Track.length;

    car.progress.prevDistanceAlong = L * 0.05;
    car.progress.distanceAlong = L * 0.90; // never touches any checkpoint
    Race.updateLapValidation(state, car);

    car.progress.prevDistanceAlong = L * 0.90;
    car.progress.distanceAlong = L * 0.01; // forward crossing of the finish line
    Race.updateLapValidation(state, car);

    assertEqual(car.lap, 0, 'lap count');
  });

  test('2. Checkpoints reached in order + finish crossing -> lap += 1', function () {
    var state = Race.createRaceState({});
    var car = state.cars[0];
    var L = Track.length;
    var cps = Track.checkpoints;
    var prev = 0;
    [cps[0].dist + 1, cps[1].dist + 1, cps[2].dist + 1, L - 1].forEach(function (d) {
      car.progress.prevDistanceAlong = prev;
      car.progress.distanceAlong = d;
      Race.updateLapValidation(state, car);
      prev = d;
    });
    car.progress.prevDistanceAlong = L - 1;
    car.progress.distanceAlong = 5; // forward crossing after all checkpoints reached
    Race.updateLapValidation(state, car);
    assertEqual(car.lap, 1, 'lap count');
    assert(car.checkpointsReached.every(function (v) { return v === false; }), 'checkpoints array reset for the new lap');
  });

  // ---------------------------------------------------------------
  // 3: reverse crossings never inflate the lap counter
  // ---------------------------------------------------------------
  test('3. Repeated reverse crossings of the finish line do not increase laps', function () {
    var state = Race.createRaceState({});
    var car = state.cars[0];
    var L = Track.length;

    car.progress.prevDistanceAlong = L * 0.99;
    car.progress.distanceAlong = 5; // forward cross w/o checkpoints -> stays at 0
    Race.updateLapValidation(state, car);
    var lapBefore = car.lap;

    for (var i = 0; i < 6; i++) {
      car.progress.prevDistanceAlong = 5;
      car.progress.distanceAlong = L * 0.99; // backward cross
      Race.updateLapValidation(state, car);
      car.progress.prevDistanceAlong = L * 0.99;
      car.progress.distanceAlong = 5; // forward cross again
      Race.updateLapValidation(state, car);
    }
    assertEqual(car.lap, lapBefore, 'lap count should not change from oscillating across the line');
  });

  // ---------------------------------------------------------------
  // 4: pause freezes race time and car position
  // ---------------------------------------------------------------
  test('4. Pausing stops race clock and car position from updating', function () {
    var state = Race.createRaceState({});
    state.phase = 'racing';
    var input = { car0: { throttle: 1, brake: 0, steer: 0, ers: false, drsRequest: false } };
    for (var i = 0; i < 30; i++) Race.update(state, Physics.FIXED_DT, input);

    var xBefore = state.cars[0].x, yBefore = state.cars[0].y, clockBefore = state.clockMs;
    assert(clockBefore > 0, 'sanity: clock should have advanced before pausing');

    Race.togglePause(state);
    assertEqual(state.phase, 'paused', 'phase after togglePause');
    for (var j = 0; j < 30; j++) Race.update(state, Physics.FIXED_DT, input);

    assertEqual(state.cars[0].x, xBefore, 'x unchanged while paused');
    assertEqual(state.cars[0].y, yBefore, 'y unchanged while paused');
    assertEqual(state.clockMs, clockBefore, 'race clock unchanged while paused');
  });

  // ---------------------------------------------------------------
  // 5 & 6: ERS bounds and depletion
  // ---------------------------------------------------------------
  test('5. ERS charge never drops below 0 or exceeds 100', function () {
    var ers = Physics.createErsState();
    for (var i = 0; i < 2000; i++) Physics.updateErs(ers, { active: true, brakeInput: 0, dt: Physics.FIXED_DT });
    assert(ers.pct >= 0 && ers.pct <= 100, 'pct in range after heavy drain, got ' + ers.pct);
    for (var j = 0; j < 2000; j++) Physics.updateErs(ers, { active: false, brakeInput: 1, dt: Physics.FIXED_DT });
    assert(ers.pct >= 0 && ers.pct <= 100, 'pct in range after heavy regen, got ' + ers.pct);
  });

  test('6. ERS provides no boost once fully depleted', function () {
    var ers = Physics.createErsState();
    for (var i = 0; i < 1000; i++) Physics.updateErs(ers, { active: true, brakeInput: 0, dt: Physics.FIXED_DT });
    assertEqual(ers.pct, 0, 'ERS should be fully drained');
    var boostActive = Physics.updateErs(ers, { active: true, brakeInput: 0, dt: Physics.FIXED_DT });
    assertEqual(boostActive, false, 'no boost should be granted at 0%');
  });

  // ---------------------------------------------------------------
  // 7 & 8: DRS zone + first-lap + auto-close rules
  // ---------------------------------------------------------------
  test('7. DRS is forbidden during lap 1 even with a clear gap in the zone', function () {
    var state = Race.createRaceState({});
    var car = state.cars[0];
    car.lap = 0;
    car.progress.distanceAlong = Track.drsZone.zoneStart + 1;
    car.drs.eligibleNext = true;
    var result = Race.checkDrsEligibility(car);
    assertEqual(result.eligible, false, 'eligible');
    assertEqual(result.reason, 'first-lap', 'reason');
  });

  test('8. DRS closes automatically once the car leaves the DRS zone', function () {
    var state = Race.createRaceState({});
    state.phase = 'racing';
    var car = state.cars[0];
    car.lap = 1;
    car.drs.active = true;
    car.drs.eligibleNext = true;

    var justInside = Track.getWorldPointAt(Track.drsZone.zoneEnd - 0.5, 0);
    car.x = justInside.x; car.y = justInside.y; car.heading = justInside.heading;
    car.vForward = 130; car.vLateral = 0;

    var inputs = {};
    state.cars.forEach(function (c) { inputs[c.id] = idleInput(); });
    inputs[car.id] = { throttle: 1, brake: 0, steer: 0, ers: false, drsRequest: true };

    Race.update(state, Physics.FIXED_DT, inputs);
    assert(!Track.isInDrsZone(car.progress.distanceAlong), 'sanity: car should now be past the DRS zone');
    assertEqual(car.drs.active, false, 'DRS must auto-close once past the zone');
  });

  // ---------------------------------------------------------------
  // 9 & 10: tire wear/grip + pit stop reset
  // ---------------------------------------------------------------
  test('9. Higher tire wear reduces the grip factor', function () {
    var idealTemp = Physics.CONFIG.TIRE_IDEAL_MIN_C + 5;
    var gripFresh = Physics.computeTireGrip(idealTemp, 0);
    var gripWorn = Physics.computeTireGrip(idealTemp, 95);
    assert(gripWorn < gripFresh, 'worn grip (' + gripWorn + ') should be less than fresh grip (' + gripFresh + ')');
  });

  test('10. Completing a pit stop resets tire wear', function () {
    var tire = Physics.createTireState();
    tire.wearPct = 88;
    tire.tempC = 132;
    Physics.resetTire(tire);
    assertEqual(tire.wearPct, 0, 'wear after reset');
    assert(tire.tempC < Physics.CONFIG.TIRE_IDEAL_MIN_C, 'fresh tires should start cooler than ideal operating temp');
  });

  // ---------------------------------------------------------------
  // 11: reset restores the full initial race state
  // ---------------------------------------------------------------
  test('11. Reset fully restores initial race state', function () {
    var state = Race.createRaceState({});
    state.phase = 'racing';
    state.clockMs = 54321;
    state.cars.forEach(function (car) {
      car.x += 999; car.lap = 2; car.tire.wearPct = 70; car.fuel.kg = 3; car.ers.pct = 12;
      car.pit.stopsCompleted = 1; car.nextCheckpointIndex = 2;
    });

    var fresh = Race.resetRace({});
    assertEqual(fresh.phase, 'countdown', 'phase');
    assertEqual(fresh.clockMs, 0, 'clockMs');
    fresh.cars.forEach(function (car, i) {
      assertEqual(car.lap, 0, 'car[' + i + '].lap');
      assertEqual(car.tire.wearPct, 0, 'car[' + i + '].tire.wearPct');
      assertEqual(car.fuel.kg, Physics.CONFIG.FUEL_START_KG, 'car[' + i + '].fuel.kg');
      assertEqual(car.ers.pct, 100, 'car[' + i + '].ers.pct');
      assertEqual(car.pit.stopsCompleted, 0, 'car[' + i + '].pit.stopsCompleted');
      assertEqual(car.nextCheckpointIndex, 0, 'car[' + i + '].nextCheckpointIndex');
    });
  });

  // ---------------------------------------------------------------
  // 12: standings use total progress, not just raw lap count
  // ---------------------------------------------------------------
  test('12. Ranking accounts for progress within the lap, not just lap count', function () {
    var state = Race.createRaceState({});
    var a = state.cars[0], b = state.cars[1];
    a.lap = 1; a.progress.distanceAlong = 10;
    b.lap = 0; b.progress.distanceAlong = Track.length - 5;
    var standings = Race.computeStandings(state);
    assert(standings.indexOf(a) < standings.indexOf(b), 'car with more total distance travelled should rank ahead');
  });

  // ---------------------------------------------------------------
  // 13: corrupted localStorage never crashes the game
  // ---------------------------------------------------------------
  test('13. Corrupted localStorage falls back to defaults without throwing', function () {
    var rawSetItem = localStorage.setItem.bind(localStorage);
    rawSetItem(GameStorage.KEYS.SETTINGS, '{not valid json,,,');
    var settings = GameStorage.getSettings();
    assertEqual(settings.value.cameraMode, GameStorage.DEFAULT_SETTINGS.cameraMode, 'settings fall back to defaults');

    rawSetItem(GameStorage.KEYS.BEST_LAP, '"not-a-number"');
    var best = GameStorage.getBestLap();
    assertEqual(best.value, null, 'bestLap falls back to null');
    assertEqual(best.corrupted, true, 'bestLap reports corrupted');

    rawSetItem(GameStorage.KEYS.LAST_RESULT, '{"standings": "not-an-array"}');
    var lastResult = GameStorage.getLastResult();
    assertEqual(lastResult.value, null, 'lastResult falls back to null when shape is wrong');

    // cleanup
    localStorage.removeItem(GameStorage.KEYS.SETTINGS);
    localStorage.removeItem(GameStorage.KEYS.BEST_LAP);
    localStorage.removeItem(GameStorage.KEYS.LAST_RESULT);
  });

  // ---------------------------------------------------------------
  // 14: Demo Race drives every car through the real update loop
  // ---------------------------------------------------------------
  test('14. Demo Race uses the real physics/AI/rules loop (no teleporting, no scripted result)', function () {
    var state = Race.createRaceState({ aiDifficulty: 'normal', mode: 'demo' });
    var MAX_TICKS = 22000;
    var MAX_PER_TICK_DISPLACEMENT = 5; // generous vs. ~100 units/s top speed * 1/60s tick
    var lastPositions = state.cars.map(function (c) { return { x: c.x, y: c.y }; });
    var sawFinite = true;

    var tick = 0;
    for (; tick < MAX_TICKS; tick++) {
      var inputs = {};
      state.cars.forEach(function (car) {
        inputs[car.id] = AI.computeInput(car, state, car.aiDifficulty || 'normal');
      });
      Race.update(state, Physics.FIXED_DT, inputs);

      state.cars.forEach(function (car, i) {
        if (!isFinite(car.x) || !isFinite(car.y)) sawFinite = false;
        if (state.phase === 'racing') {
          var d = Math.hypot(car.x - lastPositions[i].x, car.y - lastPositions[i].y);
          if (d > MAX_PER_TICK_DISPLACEMENT) {
            throw new Error('car ' + i + ' moved ' + d.toFixed(1) + ' units in a single tick - looks teleported, not simulated');
          }
        }
        lastPositions[i] = { x: car.x, y: car.y };
      });

      if (state.phase === 'finished') break;
    }

    assert(sawFinite, 'all car positions stayed finite (no NaN)');
    assert(state.mode === 'demo', 'race state stayed in demo mode');
    var leader = Race.computeStandings(state)[0];
    assert(leader.lap >= 1, 'the field should have completed at least one real lap during the demo (got ' + leader.lap + ')');
    assert(tick < MAX_TICKS, 'demo race should reach a finish within ' + MAX_TICKS + ' ticks (approx ' + Math.round(MAX_TICKS / 60) + 's of race time)');
    assertEqual(state.phase, 'finished', 'demo race should reach the finished phase');
  });

  // ---------------------------------------------------------------
  // Runner
  // ---------------------------------------------------------------
  function runAll() {
    return tests.map(function (t) {
      try {
        t.fn();
        return { name: t.name, pass: true };
      } catch (e) {
        return { name: t.name, pass: false, error: (e && e.message) ? e.message : String(e) };
      }
    });
  }

  global.GameTests = { runAll: runAll, _tests: tests };
})(typeof window !== 'undefined' ? window : global);
