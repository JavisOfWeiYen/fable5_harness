/* constants.js
 * Central tunable constants for Apex Sprint Challenge.
 * Loaded FIRST. Exposes window.CONFIG. No DOM access.
 * World-coordinate space is in abstract "metres"; canvas display size is a
 * rendering concern layered on top and never affects the numbers here.
 */
(function (global) {
  'use strict';

  var CONFIG = {
    // ---- Fixed timestep ----
    dt: 1 / 60,            // seconds per physics tick
    maxAccumSteps: 5,      // clamp: never simulate more than this many ticks per frame

    // ---- World ----
    world: { width: 1050, height: 720 },

    // ---- Vehicle physics ----
    physics: {
      throttleAccel: 24.0,   // m/s^2 at full throttle
      brakeDecel: 44.0,      // m/s^2 at full brake
      maxSpeed: 92.0,        // m/s hard cap (~331 km/h)
      reverseMax: 6.0,       // small reverse allowed
      dragCoef: 0.0028,      // quadratic drag (v^2) -> terminal ~87 m/s
      dragCoefDrs: 0.0020,   // reduced drag while DRS open
      rollDrag: 0.03,        // linear rolling resistance
      grassDragMul: 3.2,     // grass adds drag
      grassRollMul: 4.0,
      grassGripMul: 0.55,    // grass reduces grip
      pitGripMul: 0.95,

      steerBase: 3.2,        // rad/s steering authority at low speed
      steerSpeedFactor: 0.055, // steering falls off with speed
      steerMinSpeed: 2.5,    // below this speed steering has little effect

      lateralGripBase: 9.0,  // scrub rate multiplier (grip pulls velocity toward heading)

      wallRestitution: 0.25, // bounce off walls
      carRestitution: 0.35,  // car-vs-car bounce
      carRadius: 8.0,        // collision radius (m)
      carLength: 14.0,       // draw length
      carWidth: 7.0,         // draw width

      fuelBurnRate: 0.35,    // %/s at full throttle-ish
      fuelAccelBonus: 0.09,  // up to +9% accel when tank near empty

      ers: {
        max: 100,
        drainRate: 26.0,     // %/s while deployed
        regenRate: 14.0,     // %/s while braking (scaled by brake input)
        boostAccel: 9.0,     // extra m/s^2 while deployed and charge>0
        passiveRegen: 1.2    // %/s trickle charge under throttle
      },

      tire: {
        ambient: 25,
        optimalTemp: 92,
        tempSpread: 55,       // width of the working band
        minTempFactor: 0.62,  // grip factor floor from temperature
        baseGrip: 1.0,
        wearGripLoss: 0.45,   // grip lost at 100% wear
        heatFromSlide: 3.2,   // deg/s per m/s of lateral slide
        heatFromSpeed: 0.10,  // deg/s per m/s speed
        heatFromBrake: 18.0,  // deg/s at full brake
        coolRate: 0.55,       // relax toward ambient (1/s)
        grassCoolRate: 1.6,   // grass cools faster
        wearRate: 0.09,       // base %/s
        wearFromSlide: 0.13,  // extra %/s per m/s slide
        wearFromBrake: 0.13,  // extra %/s at full brake
        pitResetWear: 0,
        pitResetTemp: 60
      }
    },

    // ---- Track ----
    track: {
      halfWidth: 34,     // half racing-surface width
      grassWidth: 26,    // runoff before the wall
      pitWidth: 22,      // pit corridor width
      samplesPerSeg: 14  // Catmull-Rom samples per control-point segment
    },

    // ---- Race rules ----
    race: {
      laps: 3,
      gridSpacing: 26,       // spacing between grid slots along track
      gridStagger: 12,       // lateral stagger
      lightCount: 5,
      lightInterval: 1.0,    // seconds between each red light coming on
      lightsOutMin: 1.0,     // random hold before lights out (min)
      lightsOutMax: 2.0,     // (max)
      pitSpeedLimit: 22.0,   // m/s pit-lane limit (~80 km/h)
      pitSpeedPenalty: 3.0,  // seconds added if speeding in pit
      pitDwell: 2.4,         // seconds stationary in box to complete service
      pitWearThreshold: 45,  // AI decides to pit once tire wear exceeds this
      pitBoxRadius: 10.0,    // must be within this of the box centre and slow
      drsGapThreshold: 22.0, // seconds*?? -> we use metres/normalized; see race.js
      drsGapMetres: 90.0     // within this distance of car ahead at detection point
    },

    // ---- Telemetry ----
    telemetry: {
      sampleInterval: 0.25,  // seconds between samples
      maxSamples: 6000
    },

    // ---- Storage keys ----
    storage: {
      bestLap: 'asc.bestLap',
      difficulty: 'asc.difficulty',
      settings: 'asc.settings',
      lastResult: 'asc.lastResult'
    },

    // ---- Fictional teams (no real F1 names/liveries) ----
    teams: [
      { id: 0, name: 'Vermillion Racing', abbr: 'VMR', color: '#e63946', accent: '#ffd1d6' },
      { id: 1, name: 'Azure Dynamics',    abbr: 'AZD', color: '#2a6fdb', accent: '#cfe0ff' },
      { id: 2, name: 'Verde Motorsport',  abbr: 'VRD', color: '#2a9d5c', accent: '#cdf0da' },
      { id: 3, name: 'Solaris GP',        abbr: 'SOL', color: '#f4a72c', accent: '#ffe9c2' }
    ],

    // ---- Difficulty tuning for AI ----
    difficulty: {
      Normal: { brakeBias: 1.0,  cornerSpeed: 0.90, ersAggr: 0.55, lookAhead: 10 },
      Hard:   { brakeBias: 0.82, cornerSpeed: 1.02, ersAggr: 0.85, lookAhead: 12 }
    },

    // ---- Render colors ----
    colors: {
      grass: '#2f7d3a',
      grassDark: '#276a31',
      track: '#4a4a52',
      trackEdge: '#d9d9e0',
      pit: '#5a5a63',
      pitLine: '#f4d03f',
      curbA: '#d94141',
      curbB: '#f2f2f2',
      finish: '#ffffff',
      checkpoint: 'rgba(120,200,255,0.35)',
      drs: 'rgba(80,220,120,0.18)',
      decoTree: '#1e5a29'
    }
  };

  global.CONFIG = CONFIG;
})(typeof window !== 'undefined' ? window : this);
