/* physics.js
 * Car dynamics: throttle/brake/drag/rolling resistance, speed-dependent
 * steering, lateral grip & slip, tire heat/wear, fuel burn, ERS charge,
 * and generic collision resolution (wall + car-vs-car).
 *
 * Everything here operates on plain data objects so the same functions
 * can be driven by the player, the AI, the demo mode, or the tests.
 * The simulation is advanced with a FIXED timestep (see FIXED_DT) by the
 * caller (game.js owns the accumulator loop) so behaviour is identical
 * regardless of the display frame rate.
 */
(function (global) {
  'use strict';

  var FIXED_DT = 1 / 60;
  var MAX_STEPS_PER_FRAME = 8; // guards against the "tab was backgrounded" spiral of death

  var CONFIG = {
    DRY_MASS_KG: 720,
    FUEL_START_KG: 45,
    FUEL_BURN_RATE_KG_PER_SEC: 0.35,

    ENGINE_FORCE_N: 11000,
    BRAKE_FORCE_N: 22000,

    DRAG_COEFF: 1.52,
    DRAG_COEFF_DRS_MULT: 0.75,
    ROLL_RESIST_ACCEL: 0.45,
    GRASS_ROLL_MULT: 3.0,
    GRASS_DRAG_MULT: 1.6,

    MAX_STEER_RATE: 2.4, // rad/s at reference speed
    STEER_REF_SPEED: 26, // m/s where steer authority is strongest
    STEER_HIGH_SPEED_FALLOFF: 0.35,
    STEER_MIN_GAIN_FACTOR: 0.4,

    GRIP_BASE_ACCEL: 18, // m/s^2 max lateral accel on fresh warm tarmac tires
    GRASS_GRIP_MULT: 0.45,
    SLIP_GAIN: 1.0,
    SLIP_RECOVERY_RATE: 5.0, // 1/s, scaled by current grip factor

    ERS_MAX_PCT: 100,
    ERS_DRAIN_RATE_PCT: 28,
    ERS_REGEN_RATE_PCT: 18,
    ERS_BOOST_ACCEL: 6.5,

    TIRE_AMBIENT_C: 45,
    TIRE_MOVING_REST_C: 60,
    TIRE_IDEAL_MIN_C: 85,
    TIRE_IDEAL_MAX_C: 105,
    TIRE_MAX_C: 140,
    TIRE_COOL_RATE: 0.35,
    TIRE_GRASS_COOL_BONUS: 0.5,
    TIRE_HEAT_SLIP_COEF: 9.0,
    TIRE_HEAT_BRAKE_COEF: 0.12,
    TIRE_WEAR_BASE_COEF: 0.55,
    TIRE_WEAR_SLIP_COEF: 3.2,
    TIRE_WEAR_BRAKE_COEF: 0.05,
    TIRE_WEAR_MIN_GRIP: 0.55,
    TIRE_COLD_GRIP_FLOOR: 0.72,
    TIRE_OVERHEAT_GRIP_FLOOR: 0.5,
    TIRE_GRIP_ABSOLUTE_FLOOR: 0.2,

    COLLISION_RESTITUTION: 0.35,
    WALL_RESTITUTION: 0.4,

    GEAR_SPEED_STEP: 11 // m/s per simplified gear
  };

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function createTireState() {
    return {
      tempC: CONFIG.TIRE_AMBIENT_C,
      wearPct: 0,
      gripFactor: computeTireGrip(CONFIG.TIRE_AMBIENT_C, 0)
    };
  }

  function createFuelState() {
    return { kg: CONFIG.FUEL_START_KG };
  }

  function createErsState() {
    return { pct: 100 };
  }

  /** Factory for a fresh car physics/subsystem state. Pure data, no behaviour. */
  function createCarState(x, y, heading) {
    return {
      x: x, y: y, heading: heading,
      vForward: 0,
      vLateral: 0,
      tire: createTireState(),
      fuel: createFuelState(),
      ers: createErsState(),
      collisionRadius: 2.6,
      lastSlipMagnitude: 0
    };
  }

  function tempFactor(tempC) {
    if (tempC < CONFIG.TIRE_IDEAL_MIN_C) {
      var coldSpan = CONFIG.TIRE_IDEAL_MIN_C - CONFIG.TIRE_AMBIENT_C;
      var t = clamp((tempC - CONFIG.TIRE_AMBIENT_C) / Math.max(1, coldSpan), 0, 1);
      return CONFIG.TIRE_COLD_GRIP_FLOOR + (1 - CONFIG.TIRE_COLD_GRIP_FLOOR) * t;
    }
    if (tempC > CONFIG.TIRE_IDEAL_MAX_C) {
      var hotSpan = CONFIG.TIRE_MAX_C - CONFIG.TIRE_IDEAL_MAX_C;
      var t2 = clamp((tempC - CONFIG.TIRE_IDEAL_MAX_C) / Math.max(1, hotSpan), 0, 1);
      return 1 - (1 - CONFIG.TIRE_OVERHEAT_GRIP_FLOOR) * t2;
    }
    return 1;
  }

  function wearFactor(wearPct) {
    var t = clamp(wearPct / 100, 0, 1);
    return 1 - (1 - CONFIG.TIRE_WEAR_MIN_GRIP) * t;
  }

  function computeTireGrip(tempC, wearPct) {
    var g = tempFactor(tempC) * wearFactor(wearPct);
    return Math.max(CONFIG.TIRE_GRIP_ABSOLUTE_FLOOR, g);
  }

  /** Advances tire temperature/wear given this tick's dynamic load. */
  function updateTire(tire, params) {
    var slip = Math.abs(params.slipMagnitude) || 0;
    var brake = clamp(params.brakeInput || 0, 0, 1);
    var speed = Math.max(0, params.speed || 0);
    var dt = params.dt;
    var onGrass = !!params.onGrass;

    var heatGain = (CONFIG.TIRE_HEAT_SLIP_COEF * slip + CONFIG.TIRE_HEAT_BRAKE_COEF * brake * speed) * dt;
    var restTemp = speed > 3 ? CONFIG.TIRE_MOVING_REST_C : CONFIG.TIRE_AMBIENT_C;
    var coolRate = CONFIG.TIRE_COOL_RATE + (onGrass ? CONFIG.TIRE_GRASS_COOL_BONUS : 0);
    var coolLoss = coolRate * (tire.tempC - restTemp) * dt;

    tire.tempC = clamp(tire.tempC + heatGain - coolLoss, CONFIG.TIRE_AMBIENT_C, CONFIG.TIRE_MAX_C);

    var wearGain = (CONFIG.TIRE_WEAR_BASE_COEF * speed * 0.05 +
      CONFIG.TIRE_WEAR_SLIP_COEF * slip +
      CONFIG.TIRE_WEAR_BRAKE_COEF * brake * speed) * dt;
    tire.wearPct = clamp(tire.wearPct + wearGain, 0, 100);

    tire.gripFactor = computeTireGrip(tire.tempC, tire.wearPct);
    return tire;
  }

  /** Called on pit stop completion: fresh, cooler tires with wear reset. */
  function resetTire(tire) {
    tire.tempC = CONFIG.TIRE_AMBIENT_C;
    tire.wearPct = 0;
    tire.gripFactor = computeTireGrip(tire.tempC, tire.wearPct);
    return tire;
  }

  function updateFuel(fuel, params) {
    var throttle = clamp(params.throttleInput || 0, 0, 1);
    var burn = CONFIG.FUEL_BURN_RATE_KG_PER_SEC * throttle * params.dt;
    fuel.kg = Math.max(0, fuel.kg - burn);
    return fuel;
  }

  /** Returns whether ERS boost is actually available this tick, then drains/regens. */
  function updateErs(ers, params) {
    var wantsBoost = !!params.active;
    var brakeInput = clamp(params.brakeInput || 0, 0, 1);
    var dt = params.dt;
    var boostActive = wantsBoost && ers.pct > 0;

    if (boostActive) {
      ers.pct = clamp(ers.pct - CONFIG.ERS_DRAIN_RATE_PCT * dt, 0, CONFIG.ERS_MAX_PCT);
    }
    if (brakeInput > 0) {
      ers.pct = clamp(ers.pct + CONFIG.ERS_REGEN_RATE_PCT * brakeInput * dt, 0, CONFIG.ERS_MAX_PCT);
    }
    return boostActive;
  }

  function steerGainAt(speed) {
    var refSpeed = CONFIG.STEER_REF_SPEED;
    var lowFactor = 0.35 + 0.65 * clamp(speed / refSpeed, 0, 1);
    var highPenalty = 1 - CONFIG.STEER_HIGH_SPEED_FALLOFF * clamp((speed - refSpeed) / refSpeed, 0, 1);
    var gain = CONFIG.MAX_STEER_RATE * lowFactor * Math.max(CONFIG.STEER_MIN_GAIN_FACTOR, highPenalty);
    return gain;
  }

  /**
   * Advances one car by one fixed timestep.
   * input: { throttle:0..1, brake:0..1, steer:-1..1, ers:boolean, drs:boolean }
   * surface: { onGrass:boolean, gripMultiplier:number, dragMultiplier:number }
   * Returns diagnostics used for rendering/telemetry: { speed, isSlipping, ersBoostActive }
   */
  function stepCar(car, input, surface, dt) {
    dt = dt || FIXED_DT;
    var throttle = clamp(input.throttle || 0, 0, 1);
    var brake = clamp(input.brake || 0, 0, 1);
    var steer = clamp(input.steer || 0, -1, 1);
    surface = surface || { onGrass: false, gripMultiplier: 1, dragMultiplier: 1 };

    var mass = CONFIG.DRY_MASS_KG + car.fuel.kg;

    // --- steering & lateral slip -------------------------------------
    var speedBefore = Math.hypot(car.vForward, car.vLateral);
    var turnRate = steer * steerGainAt(speedBefore);
    var desiredLateralAccel = turnRate * car.vForward;

    var maxLateralAccel = CONFIG.GRIP_BASE_ACCEL * car.tire.gripFactor *
      surface.gripMultiplier * (surface.onGrass ? CONFIG.GRASS_GRIP_MULT : 1);

    var isSlipping = Math.abs(desiredLateralAccel) > maxLateralAccel;
    if (isSlipping) {
      var excess = Math.abs(desiredLateralAccel) - maxLateralAccel;
      car.vLateral += Math.sign(desiredLateralAccel) * excess * CONFIG.SLIP_GAIN * dt;
    }
    var recoveryFactor = Math.exp(-CONFIG.SLIP_RECOVERY_RATE * car.tire.gripFactor * surface.gripMultiplier * dt);
    car.vLateral *= recoveryFactor;

    car.heading += turnRate * dt;

    // --- drag & rolling resistance (acts on the whole velocity vector) ---
    var speed = Math.hypot(car.vForward, car.vLateral);
    var dragCoeff = CONFIG.DRAG_COEFF * (surface.onGrass ? CONFIG.GRASS_DRAG_MULT : 1) *
      (input.drs ? CONFIG.DRAG_COEFF_DRS_MULT : 1);
    var dragDecel = (dragCoeff * speed * speed) / mass;
    var rollDecel = CONFIG.ROLL_RESIST_ACCEL * (surface.onGrass ? CONFIG.GRASS_ROLL_MULT : 1);
    var totalDecel = (dragDecel + rollDecel) * dt;
    if (speed > 0) {
      var keep = Math.max(0, speed - totalDecel) / speed;
      car.vForward *= keep;
      car.vLateral *= keep;
    }

    // --- ERS ---
    var ersBoostActive = updateErs(car.ers, { active: input.ers, brakeInput: brake, dt: dt });

    // --- longitudinal accel (throttle + ERS boost) / brake ---
    var engineAccel = (CONFIG.ENGINE_FORCE_N / mass) * throttle;
    if (ersBoostActive) engineAccel += CONFIG.ERS_BOOST_ACCEL;
    car.vForward += engineAccel * dt;

    if (brake > 0) {
      var brakeDecel = (CONFIG.BRAKE_FORCE_N / mass) * brake * dt;
      car.vForward = Math.max(0, car.vForward - brakeDecel);
    }
    if (car.vForward < 0) car.vForward = 0;

    // --- integrate position ---
    var cosH = Math.cos(car.heading);
    var sinH = Math.sin(car.heading);
    var worldVx = cosH * car.vForward - sinH * car.vLateral;
    var worldVy = sinH * car.vForward + cosH * car.vLateral;
    car.x += worldVx * dt;
    car.y += worldVy * dt;

    // --- tire / fuel wear from this tick's dynamic load ---
    updateTire(car.tire, {
      slipMagnitude: car.vLateral,
      brakeInput: brake,
      speed: speed,
      onGrass: surface.onGrass,
      dt: dt
    });
    updateFuel(car.fuel, { throttleInput: throttle, dt: dt });

    car.lastSlipMagnitude = car.vLateral;

    return {
      speed: Math.hypot(car.vForward, car.vLateral),
      isSlipping: isSlipping || Math.abs(car.vLateral) > 1.5,
      ersBoostActive: ersBoostActive
    };
  }

  function speedToGear(speed) {
    return clamp(1 + Math.floor(speed / CONFIG.GEAR_SPEED_STEP), 1, 8);
  }

  /** Resolves a car penetrating a track wall. `contact` = {normalX,normalY,depth}. */
  function resolveWallCollision(car, contact) {
    if (!contact || contact.depth <= 0) return;
    car.x += contact.normalX * contact.depth;
    car.y += contact.normalY * contact.depth;

    var cosH = Math.cos(car.heading);
    var sinH = Math.sin(car.heading);
    var worldVx = cosH * car.vForward - sinH * car.vLateral;
    var worldVy = sinH * car.vForward + cosH * car.vLateral;

    var vDotN = worldVx * contact.normalX + worldVy * contact.normalY;
    if (vDotN < 0) {
      var restitution = CONFIG.WALL_RESTITUTION;
      worldVx -= (1 + restitution) * vDotN * contact.normalX;
      worldVy -= (1 + restitution) * vDotN * contact.normalY;
    }
    // damp overall speed a bit further to represent scrubbing against the barrier
    worldVx *= 0.9;
    worldVy *= 0.9;

    car.vForward = worldVx * cosH + worldVy * sinH;
    car.vLateral = -worldVx * sinH + worldVy * cosH;
  }

  /** Resolves an overlap between two circular cars. Always fully separates them. */
  function resolveCarCollision(carA, carB) {
    var dx = carB.x - carA.x;
    var dy = carB.y - carA.y;
    var dist = Math.hypot(dx, dy);
    var minDist = carA.collisionRadius + carB.collisionRadius;
    if (dist >= minDist) return false;
    if (dist < 1e-6) { dx = 1; dy = 0; dist = 1e-6; }

    var nx = dx / dist;
    var ny = dy / dist;
    var overlap = minDist - dist;

    carA.x -= nx * overlap * 0.5;
    carA.y -= ny * overlap * 0.5;
    carB.x += nx * overlap * 0.5;
    carB.y += ny * overlap * 0.5;

    [carA, carB].forEach(function (car, idx) {
      var sign = idx === 0 ? -1 : 1;
      var cosH = Math.cos(car.heading);
      var sinH = Math.sin(car.heading);
      var worldVx = cosH * car.vForward - sinH * car.vLateral;
      var worldVy = sinH * car.vForward + cosH * car.vLateral;
      var vDotN = worldVx * (nx * sign) + worldVy * (ny * sign);
      if (vDotN < 0) {
        var restitution = CONFIG.COLLISION_RESTITUTION;
        worldVx -= (1 + restitution) * vDotN * (nx * sign);
        worldVy -= (1 + restitution) * vDotN * (ny * sign);
      }
      car.vForward = worldVx * cosH + worldVy * sinH;
      car.vLateral = -worldVx * sinH + worldVy * cosH;
    });
    return true;
  }

  global.Physics = {
    FIXED_DT: FIXED_DT,
    MAX_STEPS_PER_FRAME: MAX_STEPS_PER_FRAME,
    CONFIG: CONFIG,
    createCarState: createCarState,
    createTireState: createTireState,
    createFuelState: createFuelState,
    createErsState: createErsState,
    stepCar: stepCar,
    updateTire: updateTire,
    resetTire: resetTire,
    updateFuel: updateFuel,
    updateErs: updateErs,
    computeTireGrip: computeTireGrip,
    speedToGear: speedToGear,
    resolveWallCollision: resolveWallCollision,
    resolveCarCollision: resolveCarCollision
  };
})(typeof window !== 'undefined' ? window : global);
