/*
 * Prompt Pinball — pure physics/logic core.
 * Deliberately has NO DOM / canvas dependencies so it can run in a headless
 * JS engine for testing as well as in the browser.
 *
 * Coordinate system: origin top-left, y grows DOWNWARD (canvas convention),
 * so gravity is a positive vy.
 *
 * Exposes `PinballPhysics` on the global object (window in the browser).
 */
(function (global) {
  "use strict";

  var CONFIG = {
    width: 440,
    height: 680,
    ballRadius: 9,
    gravity: 0.30,
    velocityDamping: 0.996, // gentle air/roll friction each frame
    maxSpeed: 17,
    wallRestitution: 0.68,
    bumperRestitution: 0.9,
    bumperBoost: 4.4, // extra outward kick on bumper hit
    bumperCooldown: 6, // frames before a bumper can score again
    bumperPoints: 100,
    flipperLength: 80,
    flipperRadius: 9, // capsule thickness
    flipperSpeed: 0.42, // rad per frame while swinging
    glowFrames: 16,
    startLives: 3,
  };

  // ---- geometry helpers -------------------------------------------------

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // Closest point on segment a->b to point p. Returns {x,y,t}.
  function closestOnSegment(px, py, ax, ay, bx, by) {
    var abx = bx - ax;
    var aby = by - ay;
    var len2 = abx * abx + aby * aby;
    var t = len2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / len2;
    t = clamp(t, 0, 1);
    return { x: ax + t * abx, y: ay + t * aby, t: t };
  }

  // ---- world construction ----------------------------------------------

  function makeBumpers() {
    return [
      { x: 130, y: 175, r: 27, label: "refactor" },
      { x: 310, y: 175, r: 27, label: "verify" },
      { x: 220, y: 295, r: 30, label: "ship" },
      { x: 120, y: 405, r: 27, label: "debug" },
      { x: 320, y: 405, r: 27, label: "focus" },
    ].map(function (b) {
      b.glow = 0;
      b.cooldown = 0;
      return b;
    });
  }

  // Static wall segments (ball reflects off these). Points are inside-facing.
  function makeWalls() {
    var W = CONFIG.width;
    return [
      { ax: 10, ay: 12, bx: W - 10, by: 12 }, // top
      { ax: 10, ay: 12, bx: 10, by: 560 }, // left
      { ax: W - 10, ay: 12, bx: W - 10, by: 560 }, // right
      { ax: 10, ay: 560, bx: 132, by: 652 }, // left outlane funnel
      { ax: W - 10, ay: 560, bx: W - 132, by: 652 }, // right outlane funnel
    ];
  }

  function makeFlippers() {
    // rest = tip low toward centre; active = tip swung up.
    var left = {
      side: "left",
      pivotX: 150,
      pivotY: 628,
      rest: 0.5, // ~ +28.6°, points right & slightly down
      active: -0.42, // swung up
      angle: 0.5,
      angVel: 0,
    };
    var right = {
      side: "right",
      pivotX: 290,
      pivotY: 628,
      rest: Math.PI - 0.5, // points left & slightly down
      active: Math.PI + 0.42, // swung up
      angle: Math.PI - 0.5,
      angVel: 0,
    };
    updateFlipperTip(left);
    updateFlipperTip(right);
    return { left: left, right: right };
  }

  function updateFlipperTip(f) {
    f.tipX = f.pivotX + CONFIG.flipperLength * Math.cos(f.angle);
    f.tipY = f.pivotY + CONFIG.flipperLength * Math.sin(f.angle);
  }

  function spawnBall(game) {
    // Drop from upper right with a small sideways nudge so it enters play.
    game.ball.x = CONFIG.width - 34;
    game.ball.y = 70;
    game.ball.vx = -2.2;
    game.ball.vy = 0;
  }

  function createGame() {
    var game = {
      config: CONFIG,
      ball: { x: 0, y: 0, vx: 0, vy: 0, r: CONFIG.ballRadius },
      bumpers: makeBumpers(),
      walls: makeWalls(),
      flippers: makeFlippers(),
      score: 0,
      lives: CONFIG.startLives,
      gameOver: false,
      events: [], // {id, text} newest pushed to end
      _eventSeq: 0,
    };
    spawnBall(game);
    return game;
  }

  // ---- collision resolution --------------------------------------------

  function reflectOffSegment(ball, ax, ay, bx, by, restitution) {
    var cp = closestOnSegment(ball.x, ball.y, ax, ay, bx, by);
    var dx = ball.x - cp.x;
    var dy = ball.y - cp.y;
    var dist = Math.hypot(dx, dy);
    var minDist = ball.r;
    if (dist >= minDist) return false;

    var nx, ny;
    if (dist > 0.0001) {
      nx = dx / dist;
      ny = dy / dist;
    } else {
      // Ball centre exactly on the wall: push straight up as a fallback.
      nx = 0;
      ny = -1;
    }
    // Depenetrate.
    var overlap = minDist - dist;
    ball.x += nx * overlap;
    ball.y += ny * overlap;
    // Reflect only the inbound normal component.
    var vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      var j = -(1 + restitution) * vn;
      ball.vx += j * nx;
      ball.vy += j * ny;
    }
    return true;
  }

  function collideBumper(game, ball, bumper) {
    var dx = ball.x - bumper.x;
    var dy = ball.y - bumper.y;
    var dist = Math.hypot(dx, dy);
    var minDist = ball.r + bumper.r;
    if (dist >= minDist) return false;

    var nx, ny;
    if (dist > 0.0001) {
      nx = dx / dist;
      ny = dy / dist;
    } else {
      nx = 0;
      ny = -1;
    }
    var overlap = minDist - dist;
    ball.x += nx * overlap;
    ball.y += ny * overlap;

    var vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      var j = -(1 + CONFIG.bumperRestitution) * vn;
      ball.vx += j * nx;
      ball.vy += j * ny;
    }
    // Snappy outward kick regardless of incoming speed.
    ball.vx += nx * CONFIG.bumperBoost;
    ball.vy += ny * CONFIG.bumperBoost;

    if (bumper.cooldown === 0) {
      game.score += CONFIG.bumperPoints;
      bumper.glow = CONFIG.glowFrames;
      bumper.cooldown = CONFIG.bumperCooldown;
      game._eventSeq += 1;
      game.events.push({
        id: game._eventSeq,
        text: "+" + CONFIG.bumperPoints + " " + bumper.label,
      });
    }
    return true;
  }

  function collideFlipper(ball, f) {
    var cp = closestOnSegment(ball.x, ball.y, f.pivotX, f.pivotY, f.tipX, f.tipY);
    var dx = ball.x - cp.x;
    var dy = ball.y - cp.y;
    var dist = Math.hypot(dx, dy);
    var minDist = ball.r + CONFIG.flipperRadius;
    if (dist >= minDist) return false;

    var nx, ny;
    if (dist > 0.0001) {
      nx = dx / dist;
      ny = dy / dist;
    } else {
      nx = 0;
      ny = -1;
    }
    var overlap = minDist - dist;
    ball.x += nx * overlap;
    ball.y += ny * overlap;

    // Velocity of the flipper surface at the contact point (rotation about pivot).
    var rx = cp.x - f.pivotX;
    var ry = cp.y - f.pivotY;
    var surfVx = -f.angVel * ry;
    var surfVy = f.angVel * rx;

    // Relative normal velocity (ball relative to moving surface).
    var relVn = (ball.vx - surfVx) * nx + (ball.vy - surfVy) * ny;
    if (relVn < 0) {
      var j = -(1 + 0.5) * relVn; // restitution 0.5 relative to surface
      ball.vx += j * nx;
      ball.vy += j * ny;
    }
    return true;
  }

  function capSpeed(ball) {
    var sp = Math.hypot(ball.vx, ball.vy);
    if (sp > CONFIG.maxSpeed) {
      var s = CONFIG.maxSpeed / sp;
      ball.vx *= s;
      ball.vy *= s;
    }
  }

  // ---- main step --------------------------------------------------------

  function stepFlipper(f, pressed) {
    var target = pressed ? f.active : f.rest;
    var prev = f.angle;
    var diff = target - f.angle;
    var maxStep = CONFIG.flipperSpeed;
    if (diff > maxStep) diff = maxStep;
    else if (diff < -maxStep) diff = -maxStep;
    f.angle += diff;
    f.angVel = f.angle - prev;
    updateFlipperTip(f);
  }

  // input = { left: bool, right: bool }. Returns an event describing life loss:
  // one of null | "life" | "gameover".
  function step(game, input) {
    if (game.gameOver) return null;
    input = input || {};

    stepFlipper(game.flippers.left, !!input.left);
    stepFlipper(game.flippers.right, !!input.right);

    var ball = game.ball;
    ball.vy += CONFIG.gravity;
    ball.vx *= CONFIG.velocityDamping;
    ball.vy *= CONFIG.velocityDamping;
    capSpeed(ball);

    // Substep integration to avoid tunnelling through thin flippers/walls.
    var speed = Math.hypot(ball.vx, ball.vy);
    var subs = clamp(Math.ceil(speed / 5), 1, 8);
    var i, w;
    for (i = 0; i < subs; i++) {
      ball.x += ball.vx / subs;
      ball.y += ball.vy / subs;

      for (w = 0; w < game.walls.length; w++) {
        var seg = game.walls[w];
        reflectOffSegment(ball, seg.ax, seg.ay, seg.bx, seg.by, CONFIG.wallRestitution);
      }
      for (w = 0; w < game.bumpers.length; w++) {
        collideBumper(game, ball, game.bumpers[w]);
      }
      collideFlipper(ball, game.flippers.left);
      collideFlipper(ball, game.flippers.right);
    }

    // Decay glow / cooldown timers.
    for (i = 0; i < game.bumpers.length; i++) {
      if (game.bumpers[i].glow > 0) game.bumpers[i].glow -= 1;
      if (game.bumpers[i].cooldown > 0) game.bumpers[i].cooldown -= 1;
    }

    // Drain: ball fell past the bottom of the field.
    if (ball.y - ball.r > CONFIG.height) {
      game.lives -= 1;
      if (game.lives <= 0) {
        game.lives = 0;
        game.gameOver = true;
        return "gameover";
      }
      spawnBall(game);
      return "life";
    }
    return null;
  }

  function restart(game) {
    game.score = 0;
    game.lives = CONFIG.startLives;
    game.gameOver = false;
    game.events.length = 0;
    game._eventSeq = 0;
    game.bumpers.forEach(function (b) {
      b.glow = 0;
      b.cooldown = 0;
    });
    spawnBall(game);
    return game;
  }

  var api = {
    CONFIG: CONFIG,
    createGame: createGame,
    step: step,
    restart: restart,
    // exported for tests
    closestOnSegment: closestOnSegment,
    updateFlipperTip: updateFlipperTip,
  };

  global.PinballPhysics = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
