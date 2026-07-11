/* tests.js
 * Auto-running test suite. Every test calls REAL window.Physics / window.Track /
 * window.AI / window.Race / window.Storage / window.Game code and real data
 * shapes — no parallel reimplementations, no always-pass assertions.
 * Renders results into #testResults when a DOM is present; always logs a
 * PASS/FAIL summary to the console (so a headless Node harness can capture it).
 */
(function (global) {
  'use strict';

  var CONFIG = global.CONFIG;
  var Physics = global.Physics;
  var Track = global.Track;
  var Race = global.Race;
  var Storage = global.Storage;

  var TESTS = [];
  function test(name, fn) { TESTS.push({ name: name, fn: fn }); }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

  function runUntilRacing(R, maxIters) {
    var i = 0;
    while (R.phase !== 'racing' && i < (maxIters || 3000)) { Race.update(R, CONFIG.dt); i++; }
    return R.phase === 'racing';
  }

  // ---------------------------------------------------------------------
  // 1. Out-of-order checkpoints must not increment lap count.
  test('1. Out-of-order checkpoints do not increment lap', function () {
    var car = Physics.createCar({ id: 0 });
    var cps = Track.checkpoints;
    car.lap = 0; car.nextCp = 0;
    // Start BETWEEN cp0 and cp1 so cp0 was never registered.
    car._prevProgress = (cps[0].progress + cps[1].progress) / 2;
    car.progress = car._prevProgress;
    Race.applyLapLogic(car, cps[1].progress + 0.001, 3); // crosses cp1, but cp0 is expected
    assert(car.nextCp === 0, 'nextCp must stay 0 when cp0 skipped, got ' + car.nextCp);
    Race.applyLapLogic(car, 0.98, 3);
    Race.applyLapLogic(car, 0.01, 3); // forward finish wrap
    assert(car.lap === 0, 'lap must remain 0 with incomplete checkpoints, got ' + car.lap);
  });

  // 2. Checkpoints in order + finish crossing increments lap by exactly one.
  test('2. In-order checkpoints + finish increments lap by one', function () {
    var car = Physics.createCar({ id: 0 });
    var cps = Track.checkpoints;
    car.lap = 0; car.nextCp = 0; car._prevProgress = 0.02; car.progress = 0.02;
    Race.applyLapLogic(car, cps[0].progress + 0.001, 3); assert(car.nextCp === 1, 'cp0 not registered');
    Race.applyLapLogic(car, cps[1].progress + 0.001, 3); assert(car.nextCp === 2, 'cp1 not registered');
    Race.applyLapLogic(car, cps[2].progress + 0.001, 3); assert(car.nextCp === 3, 'cp2 not registered');
    Race.applyLapLogic(car, 0.99, 3);
    Race.applyLapLogic(car, 0.01, 3); // forward wrap with all checkpoints done
    assert(car.lap === 1, 'lap should be exactly 1, got ' + car.lap);
  });

  // 3. Repeatedly crossing the finish line backward must not increment lap.
  test('3. Backward finish crossings never increment lap', function () {
    var car = Physics.createCar({ id: 0 });
    car.lap = 0; car.nextCp = Track.checkpoints.length; car._prevProgress = 0.02; car.progress = 0.02;
    for (var i = 0; i < 5; i++) {
      Race.applyLapLogic(car, 0.97, 3); // backward wrap (delta > 0.5)
      Race.applyLapLogic(car, 0.02, 3); // forward wrap but checkpoints invalidated
    }
    assert(car.lap === 0, 'lap must remain 0 under backward crossings, got ' + car.lap);
  });

  // 4. After pause, race time and car position must not advance.
  test('4. Pause freezes race clock and car position', function () {
    var R = Race.createRace({ demo: true, difficulty: 'Normal' });
    assert(runUntilRacing(R), 'race never reached racing phase');
    for (var i = 0; i < 40; i++) Race.update(R, CONFIG.dt);
    var clk = R.clock;
    var x0 = R.cars[0].x, y0 = R.cars[0].y;
    Race.setPaused(R, true);
    for (var j = 0; j < 90; j++) Race.update(R, CONFIG.dt);
    assert(R.clock === clk, 'race clock advanced while paused');
    assert(R.cars[0].x === x0 && R.cars[0].y === y0, 'car moved while paused');
  });

  // 5. ERS charge stays within [0,100] under repeated use/recharge.
  test('5. ERS charge clamped to [0,100]', function () {
    var car = Physics.createCar({ id: 0 });
    car.ers = 50;
    for (var i = 0; i < 3000; i++) {
      Physics.stepCar(car, { throttle: 1, brake: 0, steer: 0, ers: true, drs: false }, CONFIG.dt, { surface: 'track' });
      assert(car.ers >= 0 && car.ers <= 100, 'ERS out of range (deploy): ' + car.ers);
    }
    for (var j = 0; j < 3000; j++) {
      Physics.stepCar(car, { throttle: 0, brake: 1, steer: 0, ers: false, drs: false }, CONFIG.dt, { surface: 'track' });
      assert(car.ers >= 0 && car.ers <= 100, 'ERS out of range (recharge): ' + car.ers);
    }
  });

  // 6. Depleted ERS provides no additional acceleration.
  test('6. Depleted ERS gives no boost', function () {
    var empty = Physics.createCar({ id: 0 }); empty.ers = 0;
    assert(Physics.computeErsBoost(empty, true) === 0, 'boost non-zero at 0 charge');
    var charged = Physics.createCar({ id: 1 }); charged.ers = 50;
    assert(Physics.computeErsBoost(charged, true) > 0, 'boost zero with charge available');
    // Through the full step: two depleted cars, one requesting ERS, one not.
    var a = Physics.createCar({ id: 2 }); a.ers = 0;
    var b = Physics.createCar({ id: 3 }); b.ers = 0;
    Physics.stepCar(a, { throttle: 1, ers: true }, CONFIG.dt, { surface: 'track' });
    Physics.stepCar(b, { throttle: 1, ers: false }, CONFIG.dt, { surface: 'track' });
    assert(approx(a.fVel, b.fVel, 1e-9), 'depleted ERS still boosted accel: ' + a.fVel + ' vs ' + b.fVel);
  });

  // 7. DRS unusable during lap 1 even in zone with eligibility met.
  test('7. DRS blocked on lap 1', function () {
    var R = Race.createRace({ demo: false });
    var car = R.cars[0];
    car.lap = 0; car._drsEligible = true;
    car.progress = (Track.drsZone.start + Track.drsZone.end) / 2;
    car.drsOpen = false;
    var res = Race.tryOpenDrs(car, R);
    assert(res.ok === false, 'DRS opened on lap 1');
    assert(/lap 1/i.test(res.reason), 'reason should mention lap 1, got: ' + res.reason);
    assert(car.drsOpen === false, 'car.drsOpen should stay false on lap 1');
  });

  // 8. DRS auto-closes once the car leaves the DRS zone.
  test('8. DRS closes when leaving the zone', function () {
    var R = Race.createRace({ demo: false });
    var car = R.cars[0];
    car.lap = 2; car._drsEligible = true;
    car.progress = (Track.drsZone.start + Track.drsZone.end) / 2;
    car.drsOpen = true;
    assert(Track.inDrsZone(car.progress) === true, 'setup: should be in zone');
    car.progress = Track.drsZone.end + 0.02; // leave the zone
    Race.updateDrsState(car, R, false);
    assert(car.drsOpen === false, 'DRS should auto-close outside the zone');
  });

  // 9. Higher tire wear yields lower grip.
  test('9. Tire wear reduces grip', function () {
    var T = CONFIG.physics.tire;
    var low = { temp: T.optimalTemp, wear: 10, grip: 0 };
    var high = { temp: T.optimalTemp, wear: 85, grip: 0 };
    var gLow = Physics.computeGrip(low), gHigh = Physics.computeGrip(high);
    assert(gHigh < gLow, 'grip did not decrease with wear: ' + gLow + ' -> ' + gHigh);
  });

  // 10. After a completed pit stop, tire wear is reset.
  test('10. Pit stop resets tire wear', function () {
    var R = Race.createRace({ demo: true });
    var car = R.cars[0];
    car.x = Track.pitBox.x; car.y = Track.pitBox.y;
    car.vx = 0; car.vy = 0; car.speed = 0;
    car.tire.wear = 85;
    var iters = Math.ceil(CONFIG.race.pitDwell / CONFIG.dt) + 5;
    for (var i = 0; i < iters; i++) Race.updatePit(R, car, CONFIG.dt);
    assert(car._pitDone === true, 'pit service never completed');
    assert(car.tire.wear <= 0.1, 'tire wear not reset, got ' + car.tire.wear);
  });

  // 11. Reset restores the exact initial race state.
  test('11. Reset restores initial state', function () {
    var R = Race.createRace({ demo: false, difficulty: 'Normal' });
    assert(runUntilRacing(R), 'never reached racing');
    for (var i = 0; i < 200; i++) Race.update(R, CONFIG.dt);
    Race.reset(R);
    var fresh = Race.createRace({ demo: false, difficulty: 'Normal' });
    assert(R.phase === 'countdown', 'phase not reset');
    assert(R.clock === 0, 'clock not reset');
    assert(R.fastestLap === null, 'fastestLap not reset');
    for (var c = 0; c < R.cars.length; c++) {
      var a = R.cars[c], b = fresh.cars[c];
      assert(approx(a.x, b.x) && approx(a.y, b.y), 'car ' + c + ' position not restored');
      assert(approx(a.heading, b.heading), 'car ' + c + ' heading not restored');
      assert(a.vx === 0 && a.vy === 0, 'car ' + c + ' velocity not zero');
      assert(a.lap === 0 && a.nextCp === 0, 'car ' + c + ' lap/checkpoint not reset');
      assert(approx(a.fuel, b.fuel) && approx(a.ers, b.ers), 'car ' + c + ' fuel/ers not restored');
      assert(approx(a.tire.wear, b.tire.wear) && approx(a.tire.temp, b.tire.temp), 'car ' + c + ' tires not restored');
      assert(approx(a.progress, b.progress), 'car ' + c + ' progress not restored');
      assert(a.finished === false, 'car ' + c + ' still finished');
    }
  });

  // 12. Ranking must factor track progress, not lap count alone.
  test('12. Ranking uses progress within the lap', function () {
    var a = Physics.createCar({ id: 0 });
    var b = Physics.createCar({ id: 1 });
    a.lap = 1; a.progress = 0.30; a.finished = false;
    b.lap = 1; b.progress = 0.60; b.finished = false;
    assert(a.lap === b.lap, 'setup: laps must be equal to prove progress matters');
    var ranked = Race.computeRankings([a, b]);
    assert(ranked[0].id === b.id, 'car with more progress on same lap should lead');
    assert(b.position === 1 && a.position === 2, 'positions wrong: a=' + a.position + ' b=' + b.position);
  });

  // 13. Corrupted localStorage must not throw and must fall back to defaults.
  test('13. Corrupt localStorage falls back to defaults', function () {
    // Requires a localStorage; skip gracefully if truly absent.
    var hasLS = false;
    try { hasLS = !!global.localStorage; } catch (e) { hasLS = false; }
    assert(hasLS, 'no localStorage available to test against');
    global.localStorage.setItem(CONFIG.storage.settings, '{ this is : not json ');
    global.localStorage.setItem(CONFIG.storage.bestLap, 'NaN-not-a-number');
    global.localStorage.setItem(CONFIG.storage.difficulty, '###');
    var s, ok = true, err = '';
    try {
      s = Storage.getSettings();
      Storage.getBestLap();
      Storage.getDifficulty();
      Storage.getLastResult();
    } catch (e) { ok = false; err = e.message; }
    assert(ok, 'Storage threw on corrupt data: ' + err);
    assert(s && s.camera === 'chase' && s.audio === true, 'settings not defaulted');
    assert(Storage.getBestLap() === null, 'bestLap should default to null');
    assert(Storage.getDifficulty() === 'Normal', 'difficulty should default to Normal');
  });

  // 14. Demo Race runs the real pipeline (no baked/teleport result).
  test('14. Demo Race runs real physics, no teleport', function () {
    // (a) Integration consistency: position advances exactly by velocity*dt.
    var c = Physics.createCar({ id: 0 });
    c.vx = 22; c.vy = 6; c.heading = Math.atan2(6, 22);
    var ox = c.x, oy = c.y;
    Physics.stepCar(c, { throttle: 0, brake: 0, steer: 0, ers: false, drs: false }, CONFIG.dt, { surface: 'track' });
    assert(approx(c.x - ox, c.vx * CONFIG.dt, 1e-6) && approx(c.y - oy, c.vy * CONFIG.dt, 1e-6),
      'integration inconsistent (would indicate teleport)');

    // (b) Full demo pipeline for all 4 AI cars.
    var R = Race.createRace({ demo: true, difficulty: 'Hard' });
    assert(runUntilRacing(R), 'demo never reached racing');
    // Wrap-safe advancement metric that ONLY moves via the real checkpoint/lap
    // logic (never via a raw progress teleport across the start line).
    var nCp = Track.checkpoints.length;
    function advance(c) { return c.lap * (nCp + 1) + c.nextCp; }
    var before = R.cars.map(advance);

    // one-tick no-teleport check on a specific car
    var car = R.cars[1];
    var px = car.x, py = car.y;
    Race.update(R, CONFIG.dt);
    var moved = Math.hypot(car.x - px, car.y - py);
    assert(moved <= CONFIG.physics.maxSpeed * CONFIG.dt + 2, 'car moved too far in one tick (teleport): ' + moved);

    for (var i = 0; i < 1800; i++) Race.update(R, CONFIG.dt);
    var after = R.cars.map(advance);
    var advanced = false, maxSpeedOk = true;
    for (var k = 0; k < R.cars.length; k++) {
      if (after[k] > before[k]) advanced = true;              // passed checkpoints/laps
      if (R.cars[k].speed > CONFIG.physics.maxSpeed + 5) maxSpeedOk = false;
      assert(R.cars[k].lap <= R.laps, 'lap exceeded total laps (baked?)');
    }
    assert(advanced, 'no AI car advanced through the real checkpoint/lap logic in demo');
    assert(maxSpeedOk, 'a car exceeded physical max speed (not real physics)');
  });

  // ---------------------------------------------------------------------
  // Runner
  // ---------------------------------------------------------------------
  function runAll() {
    var results = [], pass = 0, fail = 0;
    for (var i = 0; i < TESTS.length; i++) {
      var t = TESTS[i];
      try {
        t.fn();
        results.push({ name: t.name, ok: true, err: '' });
        pass++;
        log('PASS  ' + t.name);
      } catch (e) {
        results.push({ name: t.name, ok: false, err: (e && e.message) || String(e) });
        fail++;
        log('FAIL  ' + t.name + '  ::  ' + ((e && e.message) || e));
      }
    }
    log('TOTAL: ' + pass + ' passed, ' + fail + ' failed, ' + TESTS.length + ' total');
    render(results, pass, fail);
    return { pass: pass, fail: fail, results: results };
  }

  function log(s) { if (global.console && global.console.log) global.console.log(s); }

  function render(results, pass, fail) {
    var doc = global.document;
    if (!doc || !doc.getElementById) return;
    var host = doc.getElementById('testResults');
    if (!host) return;
    var html = '<div class="summary ' + (fail === 0 ? 'ok' : 'bad') + '">' +
      pass + ' / ' + (pass + fail) + ' passed' + (fail ? (' — ' + fail + ' failed') : '') + '</div>';
    html += '<table class="testtbl"><thead><tr><th>#</th><th>Test</th><th>Result</th><th>Detail</th></tr></thead><tbody>';
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      html += '<tr class="' + (r.ok ? 'pass' : 'fail') + '"><td>' + (i + 1) + '</td><td>' + esc(r.name) +
        '</td><td>' + (r.ok ? 'PASS' : 'FAIL') + '</td><td>' + esc(r.err) + '</td></tr>';
    }
    html += '</tbody></table>';
    host.innerHTML = html;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  global.ASCTests = { runAll: runAll, TESTS: TESTS };

  // Auto-run.
  if (global.document && global.document.addEventListener) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', runAll);
    } else {
      runAll();
    }
  } else {
    runAll();
  }
})(typeof window !== 'undefined' ? window : this);
