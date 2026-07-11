/* physics.js
 * Vehicle physics. Pure(ish): operates on plain car-state objects and plain
 * environment/boundary descriptors handed in by the caller. NO DOM access,
 * and NO direct dependency on Track (the caller performs track queries and
 * passes the results in). Exposes window.Physics.
 */
(function (global) {
  'use strict';

  var CONFIG = global.CONFIG;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ---- Car state factory ----
  // opts: { id, team (index), abbr, color, x, y, heading, isAI }
  function createCar(opts) {
    opts = opts || {};
    var team = (CONFIG.teams[opts.team != null ? opts.team : 0]) || CONFIG.teams[0];
    return {
      id: opts.id != null ? opts.id : 0,
      team: team.id,
      name: team.name,
      abbr: opts.abbr || team.abbr,
      color: opts.color || team.color,
      accent: team.accent,
      isAI: !!opts.isAI,

      x: opts.x || 0,
      y: opts.y || 0,
      heading: opts.heading || 0,   // radians, direction the car faces
      vx: 0, vy: 0,                  // world-frame velocity
      speed: 0,                      // |velocity|
      fVel: 0,                       // signed forward speed
      slide: 0,                      // lateral slip magnitude (for effects/heat)

      tire: {
        temp: CONFIG.physics.tire.ambient,
        wear: 0,                     // percent 0..100
        grip: CONFIG.physics.tire.baseGrip
      },
      fuel: 100,                     // percent
      ers: 60,                       // percent charge 0..100
      ersActive: false,
      drsOpen: false,

      // race bookkeeping (owned/mutated by Race, initialised here)
      lap: 0,
      nextCp: 0,
      progress: 0,
      _prevProgress: 0,
      totalProgress: 0,
      position: 0,
      finished: false,
      finishTime: 0
    };
  }

  // ---- Tire grip model ----
  // Grip decreases as wear increases (monotonic) and peaks in a temperature band.
  function computeGrip(tire) {
    var T = CONFIG.physics.tire;
    var d = (tire.temp - T.optimalTemp) / T.tempSpread;
    var tempFactor = clamp(1 - d * d, T.minTempFactor, 1);
    var wearFactor = 1 - (tire.wear / 100) * T.wearGripLoss;
    return T.baseGrip * tempFactor * wearFactor;
  }

  // ---- ERS boost ----
  // Zero extra power once depleted; positive boost while active with charge.
  function computeErsBoost(car, ersActive) {
    if (ersActive && car.ers > 0) return CONFIG.physics.ers.boostAccel;
    return 0;
  }

  function surfaceGripMul(surface) {
    if (surface === 'grass') return CONFIG.physics.grassGripMul;
    if (surface === 'pit') return CONFIG.physics.pitGripMul;
    return 1.0;
  }

  function updateTire(car, ctx, dt) {
    var T = CONFIG.physics.tire;
    var heat = T.heatFromSlide * ctx.slide +
               T.heatFromSpeed * ctx.speed +
               T.heatFromBrake * ctx.brake;
    car.tire.temp += heat * dt;
    var coolRate = (ctx.surface === 'grass') ? T.grassCoolRate : T.coolRate;
    car.tire.temp -= coolRate * (car.tire.temp - T.ambient) * dt;
    if (car.tire.temp < T.ambient) car.tire.temp = T.ambient;

    var wearInc = (T.wearRate + T.wearFromSlide * ctx.slide + T.wearFromBrake * ctx.brake) * dt;
    // Only accumulate meaningful wear while actually moving.
    if (ctx.speed < 1.5) wearInc *= 0.15;
    car.tire.wear = clamp(car.tire.wear + wearInc, 0, 100);
    car.tire.grip = computeGrip(car.tire);
  }

  // ---- Main integration step ----
  // input: { throttle:0..1, brake:0..1, steer:-1..1, ers:bool, drs:bool }
  //        (drs here is the request; car.drsOpen is decided by Race and read for drag)
  // env:   { surface: 'track'|'grass'|'pit' }
  function stepCar(car, input, dt, env) {
    var P = CONFIG.physics;
    var surface = (env && env.surface) || 'track';

    var throttle = clamp(input.throttle || 0, 0, 1);
    var brake = clamp(input.brake || 0, 0, 1);
    var steer = clamp(input.steer || 0, -1, 1);

    // Old-frame basis.
    var fx = Math.cos(car.heading), fy = Math.sin(car.heading);
    var rx = -fy, ry = fx;

    var fVel = car.vx * fx + car.vy * fy;   // forward speed
    var lVel = car.vx * rx + car.vy * ry;   // lateral (slip) speed

    // Engine: lighter fuel load => slightly better acceleration.
    var accelBonus = (1 - car.fuel / 100) * P.fuelAccelBonus;
    var accel = throttle * P.throttleAccel * (1 + accelBonus);

    // ERS deployment.
    car.ersActive = !!input.ers && car.ers > 0;
    accel += computeErsBoost(car, input.ers);
    if (input.ers && car.ers > 0) {
      car.ers -= P.ers.drainRate * dt;
    } else if (throttle > 0.1) {
      car.ers += P.ers.passiveRegen * dt;
    }
    if (brake > 0) car.ers += P.ers.regenRate * brake * dt;
    car.ers = clamp(car.ers, 0, 100);

    // Longitudinal integration.
    fVel += accel * dt;
    var bd = brake * P.brakeDecel * dt;
    if (fVel > 0) fVel = Math.max(0, fVel - bd);
    else if (fVel < 0) fVel = Math.min(0, fVel + bd);

    // Drag + rolling resistance.
    var dragC = car.drsOpen ? P.dragCoefDrs : P.dragCoef;
    var roll = P.rollDrag;
    if (surface === 'grass') { dragC *= P.grassDragMul; roll *= P.grassRollMul; }
    fVel -= (dragC * fVel * Math.abs(fVel) + roll * fVel) * dt;

    fVel = clamp(fVel, -P.reverseMax, P.maxSpeed);

    // Lateral grip scrub: grip pulls the velocity toward the heading direction.
    var speed = Math.hypot(car.vx, car.vy);
    var grip = computeGrip(car.tire) * surfaceGripMul(surface);
    var scrub = clamp(grip * P.lateralGripBase * dt, 0, 1);
    var lVelBefore = lVel;
    lVel -= lVel * scrub;
    car.slide = Math.abs(lVelBefore) * (1 - scrub); // remaining slip => visible slide

    // Recompose velocity in the OLD frame (so steering below induces slip
    // that grip resolves over subsequent ticks -> real cornering feel).
    car.vx = fx * fVel + rx * lVel;
    car.vy = fy * fVel + ry * lVel;

    // Steering: authority drops with speed; needs some motion to bite.
    var steerResp = P.steerBase / (1 + speed * P.steerSpeedFactor);
    var motionFactor = Math.min(1, speed / P.steerMinSpeed);
    var dirSign = fVel >= 0 ? 1 : -1;
    car.heading += steer * steerResp * motionFactor * dirSign * dt;
    // normalise heading
    if (car.heading > Math.PI) car.heading -= 2 * Math.PI;
    else if (car.heading < -Math.PI) car.heading += 2 * Math.PI;

    // Integrate position.
    car.x += car.vx * dt;
    car.y += car.vy * dt;
    car.speed = Math.hypot(car.vx, car.vy);
    car.fVel = fVel;

    // Consumables.
    updateTire(car, { slide: car.slide, brake: brake, speed: car.speed, surface: surface }, dt);
    car.fuel = Math.max(0, car.fuel - P.fuelBurnRate * (0.3 + 0.7 * throttle) * dt);

    return car;
  }

  // ---- Wall collision ----
  // b: { nx, ny, offset, posWall, negWall, projX, projY }
  //    n is the unit "left" normal of the track; offset is signed distance of the
  //    car from the centreline along n; posWall/negWall are the allowed extents.
  function resolveWalls(car, b) {
    if (!b) return;
    var P = CONFIG.physics;
    if (b.offset > b.posWall) {
      car.x -= b.nx * (b.offset - b.posWall);
      car.y -= b.ny * (b.offset - b.posWall);
      var vn = car.vx * b.nx + car.vy * b.ny;
      if (vn > 0) { car.vx -= vn * b.nx * (1 + P.wallRestitution); car.vy -= vn * b.ny * (1 + P.wallRestitution); }
    } else if (b.offset < b.negWall) {
      car.x -= b.nx * (b.offset - b.negWall);
      car.y -= b.ny * (b.offset - b.negWall);
      var vn2 = car.vx * b.nx + car.vy * b.ny;
      if (vn2 < 0) { car.vx -= vn2 * b.nx * (1 + P.wallRestitution); car.vy -= vn2 * b.ny * (1 + P.wallRestitution); }
    } else {
      return;
    }
    car.speed = Math.hypot(car.vx, car.vy);
    // keep forward-speed bookkeeping roughly consistent
    car.fVel = car.vx * Math.cos(car.heading) + car.vy * Math.sin(car.heading);
  }

  // ---- Car-vs-car collision ----
  // Elastic-ish push apart along the contact normal. Never locks: it only ever
  // separates overlapping cars and damps the closing velocity.
  function resolveCarCollision(a, c) {
    var P = CONFIG.physics;
    var minDist = P.carRadius * 2;
    var dx = c.x - a.x, dy = c.y - a.y;
    var d = Math.hypot(dx, dy);
    if (d >= minDist || d === 0) {
      if (d === 0) { // exactly coincident: nudge apart deterministically
        c.x += 0.1; a.x -= 0.1;
      }
      if (d >= minDist) return false;
    }
    if (d === 0) { dx = 1; dy = 0; d = 0.0001; }
    var nx = dx / d, ny = dy / d;
    var overlap = minDist - d;
    // Separate.
    a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
    c.x += nx * overlap * 0.5; c.y += ny * overlap * 0.5;
    // Exchange normal velocity component (damped).
    var va = a.vx * nx + a.vy * ny;
    var vc = c.vx * nx + c.vy * ny;
    var rel = vc - va;
    if (rel < 0) { // approaching
      var imp = -(1 + P.carRestitution) * rel * 0.5;
      a.vx -= imp * nx; a.vy -= imp * ny;
      c.vx += imp * nx; c.vy += imp * ny;
    }
    a.speed = Math.hypot(a.vx, a.vy);
    c.speed = Math.hypot(c.vx, c.vy);
    return true;
  }

  global.Physics = {
    createCar: createCar,
    computeGrip: computeGrip,
    computeErsBoost: computeErsBoost,
    stepCar: stepCar,
    resolveWalls: resolveWalls,
    resolveCarCollision: resolveCarCollision,
    _clamp: clamp
  };
})(typeof window !== 'undefined' ? window : this);
