/* ai.js
 * AI driver. Given a car, its AI state, the Track, the other cars and the race
 * state, returns an input frame {throttle,brake,steer,ers,drs} each tick.
 * Looks ahead along the racing line, brakes for corners, recovers onto the
 * track, avoids getting stuck, deploys ERS, requests DRS, and decides to pit
 * on tire wear. Two tuning profiles: Normal and Hard. Exposes window.AI.
 *
 * AI cars are driven through the SAME Physics.stepCar as the player (this file
 * only produces inputs; it never moves cars directly).
 */
(function (global) {
  'use strict';

  var CONFIG = global.CONFIG;
  var CURVE_GAIN = 320;   // maps track curvature to a target-speed reduction
  var STUCK_TIME = 1.1;   // seconds of near-zero motion before recovery kicks in

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function normAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  function profileFor(ai) { return CONFIG.difficulty[ai.profile] || CONFIG.difficulty.Normal; }

  // Target speed for the tightest curvature within the braking horizon ahead.
  function targetSpeed(car, track, prof) {
    var total = track.totalLength();
    var speed = car.speed;
    var brakeDist = 25 + (speed * speed) / (2 * CONFIG.physics.brakeDecel) * prof.brakeBias;
    var nr = track.nearest(car.x, car.y);
    var vmax = CONFIG.physics.maxSpeed;
    for (var d = 12; d <= brakeDist; d += 14) {
      var kap = track.curvatureAt(nr.progress + d / total, 30);
      var v = CONFIG.physics.maxSpeed * prof.cornerSpeed / (1 + kap * CURVE_GAIN);
      if (v < vmax) vmax = v;
    }
    return { vmax: vmax, nr: nr };
  }

  function computeInput(car, ai, track, cars, race, dt) {
    dt = dt || CONFIG.dt;
    var prof = profileFor(ai);
    var ts = targetSpeed(car, track, prof);
    var nr = ts.nr;
    var total = track.totalLength();
    var speed = car.speed;

    // ---- Pit intent: decide on wear, act near the pit lane ----
    if (car.tire.wear > CONFIG.race.pitWearThreshold && !car._pitDone) ai.wantPit = true;
    var pit = track.pit, headingToPit = false;
    var vTarget = ts.vmax;

    // ---- Steering target point on the racing line ahead ----
    var aheadM = 16 + speed * 0.65;
    var tp = track.lookAhead(nr.progress, aheadM);
    var targetX = tp.x, targetY = tp.y;

    if (ai.wantPit && track.inRange(nr.progress, pit.entry, pit.exit)) {
      // Aim into the pit corridor centreline and respect the speed limit.
      var w = track.worldAtProgress(nr.progress + aheadM / total);
      var off = ((pit.inner + pit.outer) / 2) * pit.side;
      targetX = w.x + w.nx * off; targetY = w.y + w.ny * off;
      vTarget = Math.min(vTarget, pit.speedLimit - 3);
      headingToPit = true;
      // Slow to a stop near the box.
      var db = Math.hypot(car.x - track.pitBox.x, car.y - track.pitBox.y);
      if (db < CONFIG.race.pitBoxRadius * 1.6) vTarget = 0;
    }

    // ---- Off-track recovery: steer back toward the centreline projection ----
    var surface = track.surfaceAt(car.x, car.y);
    if (surface === 'grass' && Math.abs(nr.offset) > CONFIG.track.halfWidth) {
      // blend target toward a point slightly ahead on the centreline
      var rec = track.lookAhead(nr.progress, 10);
      targetX = (targetX + rec.x) * 0.5;
      targetY = (targetY + rec.y) * 0.5;
      vTarget = Math.min(vTarget, 30);
    }

    // ---- Steering ----
    var ang = Math.atan2(targetY - car.y, targetX - car.x);
    var dh = normAngle(ang - car.heading);
    var steer = clamp(dh / 0.5, -1, 1);

    // ---- Throttle / brake from speed error ----
    var throttle = 0, brake = 0;
    if (vTarget < 1.0) {
      // Want to stop (e.g. parking in the pit box): never feed throttle.
      throttle = 0;
      brake = speed > 0.4 ? 1 : 0.3;
    } else if (speed > vTarget + 1.5) {
      brake = clamp((speed - vTarget) / 10, 0.15, 1);
    } else {
      throttle = clamp((vTarget - speed) / 7 + 0.35, 0, 1);
    }

    // ---- Stuck detection / recovery ----
    var moved = Math.hypot(car.x - (ai.prevX || car.x), car.y - (ai.prevY || car.y));
    ai.prevX = car.x; ai.prevY = car.y;
    if (speed < 2.5 && Math.abs(car.fVel) < 2.5 && !(headingToPit && vTarget === 0)) {
      ai.stuck = (ai.stuck || 0) + dt;
    } else {
      ai.stuck = 0;
    }
    if (ai.stuck > STUCK_TIME) {
      throttle = 1; brake = 0;
      var toC = Math.atan2(nr.projY - car.y, nr.projX - car.x);
      var recAng = track.lookAhead(nr.progress, 12);
      var toAhead = Math.atan2(recAng.y - car.y, recAng.x - car.x);
      // steer toward the track/ahead, blended
      steer = clamp(normAngle(((toC + toAhead) / 2) - car.heading) / 0.5, -1, 1);
    }

    // ---- ERS: deploy on straights when charge is available ----
    var kapNow = track.curvatureAt(nr.progress, 25);
    var ers = kapNow < 0.006 &&
              speed < CONFIG.physics.maxSpeed * 0.985 &&
              car.ers > (1 - prof.ersAggr) * 45 &&
              throttle > 0.5 &&
              !headingToPit;

    // ---- DRS: request while in the zone; Race gates real eligibility ----
    var drs = track.inDrsZone(nr.progress) && !headingToPit && brake < 0.2;

    return { throttle: throttle, brake: brake, steer: steer, ers: !!ers, drs: !!drs };
  }

  global.AI = {
    computeInput: computeInput,
    _targetSpeed: targetSpeed
  };
})(typeof window !== 'undefined' ? window : this);
