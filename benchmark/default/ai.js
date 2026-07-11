/* ai.js
 * AI drivers. Produces the exact same { throttle, brake, steer, ers,
 * drsRequest } input shape the player provides, so AI cars run through
 * identical physics (physics.js) and identical rules (race.js) - no
 * teleporting, no scripted speeds.
 *
 * Strategy: pure-pursuit steering toward a look-ahead point on the
 * centerline, throttle/brake derived from the track curvature between the
 * car and that point (brake for the tightest curvature ahead, accelerate
 * otherwise), plus simple ERS/DRS/pit-stop decision rules.
 */
(function (global) {
  'use strict';

  var Track = global.Track;
  var Physics = global.Physics;

  var DIFFICULTY = {
    normal: {
      gripSafetyFactor: 0.72,
      brakeLateMargin: 2,
      ersPctMargin: 22,
      ersCurvatureMax: 0.010,
      pitWearThreshold: 62,
      lateralBiasScale: 1
    },
    hard: {
      gripSafetyFactor: 0.90,
      brakeLateMargin: 6,
      ersPctMargin: 8,
      ersCurvatureMax: 0.016,
      pitWearThreshold: 80,
      lateralBiasScale: 1.3
    }
  };

  var LATERAL_BIAS_BY_INDEX = [0, -3.5, 3.5, -1.8];
  var LOOKAHEAD_MIN = 18;
  var LOOKAHEAD_MAX = 130;
  var LOOKAHEAD_SPEED_FACTOR = 0.9;
  var CURVATURE_SAMPLE_COUNT = 6;
  var STEER_ANGLE_REF = 0.38;
  var PIT_APPROACH_LEAD = 150;
  var PIT_FINAL_BRAKE_ZONE = 26;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function normalizeAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  function maxCurvatureAhead(fromDist, spanDist) {
    var maxAbs = 0;
    for (var i = 0; i <= CURVATURE_SAMPLE_COUNT; i++) {
      var d = Track.wrapDist(fromDist + (spanDist * i) / CURVATURE_SAMPLE_COUNT);
      var idx = Math.round(d / Track.spacing) % Track.samples.length;
      var curvature = Track.samples[idx].curvature;
      if (Math.abs(curvature) > maxAbs) maxAbs = Math.abs(curvature);
    }
    return maxAbs;
  }

  function computePitOverride(car, diff) {
    var pit = car.pit;
    var box = Track.pitLane.boxes[pit.boxIndex];
    var distToBox = Track.wrapDist(box.dist - car.progress.distanceAlong);

    var nearOwnBox = pit.wantsToPit && distToBox <= PIT_APPROACH_LEAD;
    var shouldOverride = nearOwnBox || (pit.inPitLane && !pit.serviced);
    if (!shouldOverride) return null;

    var lookahead = clamp(distToBox, 6, 24);
    var targetDist = Track.wrapDist(car.progress.distanceAlong + lookahead);
    var targetLateral = Track.pitLane.lateralCenter;

    var speedCap = Track.pitLane.speedLimit - 2;
    if (distToBox < PIT_FINAL_BRAKE_ZONE) {
      speedCap = Math.max(0, (distToBox / PIT_FINAL_BRAKE_ZONE) * (Track.pitLane.speedLimit - 2));
    }
    return { targetDist: targetDist, targetLateral: targetLateral, speedCap: speedCap };
  }

  /** Decide whether this car should start planning a pit stop this lap. */
  function updatePitIntent(car, diff) {
    if (car.pit.stopsCompleted > 0) return; // one scheduled stop per short sprint race
    if (car.tire.wearPct >= diff.pitWearThreshold && car.lap >= 1) {
      car.pit.wantsToPit = true;
    }
  }

  function computeInput(car, state, difficultyName) {
    var diff = DIFFICULTY[difficultyName] || DIFFICULTY.normal;
    updatePitIntent(car, diff);

    var speed = Math.hypot(car.vForward, car.vLateral);
    var lookahead = clamp(LOOKAHEAD_MIN + speed * LOOKAHEAD_SPEED_FACTOR, LOOKAHEAD_MIN, LOOKAHEAD_MAX);

    var pitOverride = computePitOverride(car, diff);
    var targetDist, targetLateral, speedCap;
    if (pitOverride) {
      targetDist = pitOverride.targetDist;
      targetLateral = pitOverride.targetLateral;
      speedCap = pitOverride.speedCap;
    } else {
      targetDist = Track.wrapDist(car.progress.distanceAlong + lookahead);
      targetLateral = LATERAL_BIAS_BY_INDEX[car.index % LATERAL_BIAS_BY_INDEX.length] * diff.lateralBiasScale;
      speedCap = Infinity;
    }

    var targetPoint = Track.getWorldPointAt(targetDist, targetLateral);
    var dx = targetPoint.x - car.x;
    var dy = targetPoint.y - car.y;
    var desiredHeading = Math.atan2(dy, dx);
    var headingError = normalizeAngle(desiredHeading - car.heading);
    var steer = clamp(headingError / STEER_ANGLE_REF, -1, 1);

    var curvatureAhead = maxCurvatureAhead(car.progress.distanceAlong, lookahead);
    var gripAccel = Physics.CONFIG.GRIP_BASE_ACCEL * car.tire.gripFactor * diff.gripSafetyFactor;
    var safeSpeed = Math.sqrt(gripAccel / Math.max(curvatureAhead, 0.0009));
    safeSpeed = Math.min(safeSpeed, speedCap, 150);

    var throttle = 0, brake = 0;
    var facingWrongWay = Math.abs(headingError) > Math.PI / 2;
    var brakeMargin = pitOverride ? 0 : diff.brakeLateMargin;
    if (facingWrongWay) {
      throttle = 0;
      brake = 0.5;
    } else {
      var speedError = safeSpeed - speed;
      if (speedError < -brakeMargin) {
        brake = clamp(-speedError / 8, 0, 1);
        throttle = 0;
      } else {
        throttle = clamp(0.45 + speedError / 15, 0.15, 1);
        brake = 0;
      }
    }

    var ersRequest = !facingWrongWay && throttle > 0.6 &&
      curvatureAhead < diff.ersCurvatureMax &&
      car.ers.pct > diff.ersPctMargin;

    var drsCheck = global.Race ? global.Race.checkDrsEligibility(car) : { eligible: false };
    var drsRequest = drsCheck.eligible;

    return {
      throttle: throttle,
      brake: brake,
      steer: steer,
      ers: ersRequest,
      drsRequest: drsRequest
    };
  }

  global.AI = {
    DIFFICULTY: DIFFICULTY,
    computeInput: computeInput,
    updatePitIntent: updatePitIntent
  };
})(typeof window !== 'undefined' ? window : global);
