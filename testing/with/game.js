/* Prompt Pinball — pure HTML/CSS/JS pinball toy.
 * Physics: gravity + circle/segment collision resolution with restitution.
 * A debug handle is exposed on window.__PINBALL__ so the game can be driven
 * and inspected by automated tests.
 */
(() => {
  "use strict";

  // ---- DOM ----
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const logEl = document.getElementById("log");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const finalScoreEl = document.getElementById("final-score");
  const restartBtn = document.getElementById("restart");
  const restartSideBtn = document.getElementById("restart-side");

  // ---- Tuning ----
  const GRAVITY = 1000;        // px / s^2
  const MAX_SPEED = 1500;      // px / s
  const WALL_REST = 0.72;
  const GUIDE_REST = 0.55;
  const BUMPER_REST = 0.55;
  const FLIPPER_REST = 0.35;
  const BUMPER_KICK = 265;     // extra pop imparted by a bumper
  const FLIP_RATE = 32;        // how snappy a flipper swings
  const START_LIVES = 3;
  const BALL_R = 11;

  // ---- Static geometry ----
  const GUIDES = [
    { ax: 0, ay: 500, bx: 130, by: 615, t: 7 }, // left funnel
    { ax: W, ay: 500, bx: 330, by: 615, t: 7 }, // right funnel
  ];

  const PROMPTS = [
    { label: "refactor", color: "#38bdf8", x: 120, y: 190, r: 32 },
    { label: "verify", color: "#34d399", x: 340, y: 190, r: 32 },
    { label: "ship", color: "#f472b6", x: 230, y: 300, r: 34 },
    { label: "debug", color: "#fbbf24", x: 110, y: 430, r: 30 },
    { label: "focus", color: "#a78bfa", x: 350, y: 430, r: 30 },
  ];

  // ---- Mutable state ----
  const ball = { x: W / 2, y: 90, vx: 0, vy: 0, r: BALL_R };

  let bumpers = [];
  let flippers = [];

  const game = {
    score: 0,
    lives: START_LIVES,
    log: [],          // newest first, plain strings — handy for tests
    gameOver: false,
    paused: false,
    ball,
    get bumpers() { return bumpers; },
    get flippers() { return flippers; },
  };

  // ---- Helpers ----
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function makeBumpers() {
    return PROMPTS.map((p) => ({ ...p, glow: 0, cooldown: 0 }));
  }

  function makeFlippers() {
    return [
      {
        side: "L", px: 130, py: 632, len: 95, t: 9,
        restAngle: 0.5, upAngle: -0.45,
        angle: 0.5, omega: 0, pressed: false,
      },
      {
        side: "R", px: 330, py: 632, len: 95, t: 9,
        restAngle: Math.PI - 0.5, upAngle: Math.PI + 0.45,
        angle: Math.PI - 0.5, omega: 0, pressed: false,
      },
    ];
  }

  function flipperTip(f) {
    return { x: f.px + f.len * Math.cos(f.angle), y: f.py + f.len * Math.sin(f.angle) };
  }

  function resetBall() {
    ball.x = W / 2 + (Math.random() * 40 - 20);
    ball.y = 90;
    ball.vx = Math.random() * 90 - 45;
    ball.vy = 40;
  }

  function reset() {
    game.score = 0;
    game.lives = START_LIVES;
    game.log = [];
    game.gameOver = false;
    game.paused = false;
    bumpers = makeBumpers();
    flippers = makeFlippers();
    resetBall();
    logEl.innerHTML = "";
    addLog("ball launched", "info", "");
    overlay.hidden = true;
    syncScore(false);
    syncLives();
  }

  // ---- UI sync ----
  function syncScore(pop) {
    scoreEl.textContent = String(game.score);
    if (pop) {
      scoreEl.classList.add("bump");
      setTimeout(() => scoreEl.classList.remove("bump"), 130);
    }
  }

  function syncLives() {
    livesEl.innerHTML = "";
    for (let i = 0; i < START_LIVES; i++) {
      const pip = document.createElement("div");
      pip.className = "pip" + (i >= game.lives ? " lost" : "");
      livesEl.appendChild(pip);
    }
  }

  function addLog(text, cls, pts) {
    game.log.unshift(text);
    if (game.log.length > 60) game.log.pop();

    const li = document.createElement("li");
    li.className = cls || "info";
    if (pts !== undefined && cls !== "info") {
      const ptsEl = document.createElement("span");
      ptsEl.className = "pts";
      ptsEl.textContent = pts;
      const tagEl = document.createElement("span");
      tagEl.className = "tag";
      tagEl.textContent = text.replace(pts, "").trim();
      li.appendChild(ptsEl);
      li.appendChild(tagEl);
    } else {
      li.textContent = text;
    }
    logEl.prepend(li);
    while (logEl.children.length > 40) logEl.removeChild(logEl.lastChild);
  }

  // ---- Events ----
  function onBumperHit(b) {
    game.score += 100;
    b.glow = 1;
    syncScore(true);
    addLog(`+100 ${b.label}`, "hit", "+100");
  }

  function handleDrain() {
    if (game.gameOver) return;
    game.lives -= 1;
    syncLives();
    if (game.lives <= 0) {
      game.gameOver = true;
      addLog("−1 · game over", "drain", "−1");
      showOverlay();
    } else {
      addLog("−1 · drained", "drain", "−1");
      resetBall();
    }
  }

  function showOverlay() {
    overlayTitle.textContent = "Game Over";
    finalScoreEl.textContent = String(game.score);
    overlay.hidden = false;
  }

  // ---- Collision primitives ----
  function collideSegment(ax, ay, bx, by, thickness, rest, surf) {
    const abx = bx - ax, aby = by - ay;
    const apx = ball.x - ax, apy = ball.y - ay;
    const len2 = abx * abx + aby * aby || 1;
    const t = clamp((apx * abx + apy * aby) / len2, 0, 1);
    const cx = ax + abx * t, cy = ay + aby * t;
    let dx = ball.x - cx, dy = ball.y - cy;
    let dist = Math.hypot(dx, dy);
    const minDist = ball.r + thickness;
    if (dist >= minDist) return false;

    if (dist < 1e-4) { dx = 0; dy = -1; dist = 1; }
    const nx = dx / dist, ny = dy / dist;
    ball.x = cx + nx * minDist;
    ball.y = cy + ny * minDist;

    const svx = surf ? surf.x : 0;
    const svy = surf ? surf.y : 0;
    const rvn = (ball.vx - svx) * nx + (ball.vy - svy) * ny;
    if (rvn < 0) {
      const j = -(1 + rest) * rvn;
      ball.vx += j * nx;
      ball.vy += j * ny;
    }
    return { cx, cy };
  }

  function collideFlipper(f) {
    const tip = flipperTip(f);
    // surface velocity of the closest point is derived after we know it, so
    // compute the closest point here and pass ω-based surface velocity in.
    const abx = tip.x - f.px, aby = tip.y - f.py;
    const apx = ball.x - f.px, apy = ball.y - f.py;
    const len2 = abx * abx + aby * aby || 1;
    const t = clamp((apx * abx + apy * aby) / len2, 0, 1);
    const cx = f.px + abx * t, cy = f.py + aby * t;
    const rx = cx - f.px, ry = cy - f.py;
    const surf = { x: -f.omega * ry, y: f.omega * rx };
    return collideSegment(f.px, f.py, tip.x, tip.y, f.t, FLIPPER_REST, surf);
  }

  function collideBumper(b) {
    let dx = ball.x - b.x, dy = ball.y - b.y;
    let dist = Math.hypot(dx, dy);
    const minDist = ball.r + b.r;
    if (dist >= minDist) return;

    if (dist < 1e-4) { dx = 0; dy = -1; dist = 1; }
    const nx = dx / dist, ny = dy / dist;
    ball.x = b.x + nx * minDist;
    ball.y = b.y + ny * minDist;

    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      const j = -(1 + BUMPER_REST) * vn;
      ball.vx += j * nx;
      ball.vy += j * ny;
    }
    ball.vx += nx * BUMPER_KICK;
    ball.vy += ny * BUMPER_KICK;

    b.glow = 1;
    if (b.cooldown <= 0) {
      onBumperHit(b);
      b.cooldown = 0.25;
    }
  }

  // ---- Physics step ----
  function integrate(dt) {
    // flippers swing toward their target angle
    for (const f of flippers) {
      const prev = f.angle;
      const target = f.pressed ? f.upAngle : f.restAngle;
      f.angle += (target - f.angle) * clamp(dt * FLIP_RATE, 0, 1);
      f.omega = (f.angle - prev) / dt;
    }

    // decay per-bumper timers
    for (const b of bumpers) {
      b.glow = Math.max(0, b.glow - dt * 3);
      b.cooldown = Math.max(0, b.cooldown - dt);
    }

    // gravity + speed clamp + integrate
    ball.vy += GRAVITY * dt;
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > MAX_SPEED) { ball.vx *= MAX_SPEED / sp; ball.vy *= MAX_SPEED / sp; }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // static walls
    if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx = -ball.vx * WALL_REST; }
    if (ball.x + ball.r > W) { ball.x = W - ball.r; ball.vx = -ball.vx * WALL_REST; }
    if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy = -ball.vy * WALL_REST; }

    for (const g of GUIDES) collideSegment(g.ax, g.ay, g.bx, g.by, g.t, GUIDE_REST, null);
    for (const b of bumpers) collideBumper(b);
    for (const f of flippers) collideFlipper(f);

    // drain
    if (ball.y - ball.r > H) {
      handleDrain();
      return false;
    }
    return true;
  }

  function stepPhysics(dt) {
    const steps = Math.max(1, Math.ceil(dt / 0.006));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (!integrate(sdt)) break;
    }
  }

  // ---- Rendering ----
  function drawBumper(b) {
    const glowR = b.r + 4 + b.glow * 10;
    ctx.save();
    // glow ring
    if (b.glow > 0.01) {
      ctx.globalAlpha = b.glow * 0.7;
      ctx.beginPath();
      ctx.arc(b.x, b.y, glowR, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.filter = "blur(6px)";
      ctx.fill();
      ctx.filter = "none";
      ctx.globalAlpha = 1;
    }
    // body
    const grad = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.35, 2, b.x, b.y, b.r);
    grad.addColorStop(0, mix(b.color, "#ffffff", 0.55 + b.glow * 0.35));
    grad.addColorStop(1, b.color);
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.stroke();
    // label
    ctx.fillStyle = "#0b1120";
    ctx.font = "700 13px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.label, b.x, b.y);
    ctx.restore();
  }

  function drawFlipper(f) {
    const tip = flipperTip(f);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = f.t * 2;
    const up = f.pressed;
    ctx.strokeStyle = up ? "#fbbf24" : "#f97316";
    ctx.shadowColor = up ? "rgba(251,191,36,0.7)" : "rgba(249,115,22,0.4)";
    ctx.shadowBlur = up ? 16 : 8;
    ctx.beginPath();
    ctx.moveTo(f.px, f.py);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // pivot
    ctx.beginPath();
    ctx.arc(f.px, f.py, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#cbd5e1";
    ctx.fill();
    ctx.restore();
  }

  function drawBall() {
    ctx.save();
    ctx.shadowColor = "rgba(56,189,248,0.7)";
    ctx.shadowBlur = 16;
    const grad = ctx.createRadialGradient(
      ball.x - ball.r * 0.4, ball.y - ball.r * 0.4, 1, ball.x, ball.y, ball.r
    );
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(1, "#7dd3fc");
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  function drawGuides() {
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "#334970";
    ctx.lineWidth = 7 * 2;
    for (const g of GUIDES) {
      ctx.beginPath();
      ctx.moveTo(g.ax, g.ay);
      ctx.lineTo(g.bx, g.by);
      ctx.stroke();
    }
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawGuides();
    for (const b of bumpers) drawBumper(b);
    for (const f of flippers) drawFlipper(f);
    drawBall();
  }

  // tiny color mixer for the bumper highlight
  function mix(hexA, hexB, t) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const bl = Math.round(a.b + (b.b - a.b) * t);
    return `rgb(${r},${g},${bl})`;
  }
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  // ---- Main loop ----
  let last = 0;
  function loop(ts) {
    if (!last) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    dt = Math.min(dt, 1 / 30); // avoid huge steps after a stall
    if (!game.paused && !game.gameOver) stepPhysics(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---- Input ----
  const LEFT_KEYS = new Set(["a", "A", "ArrowLeft"]);
  const RIGHT_KEYS = new Set(["d", "D", "ArrowRight"]);

  function setFlipper(key, pressed) {
    if (LEFT_KEYS.has(key)) { flippers[0].pressed = pressed; return true; }
    if (RIGHT_KEYS.has(key)) { flippers[1].pressed = pressed; return true; }
    return false;
  }

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (setFlipper(e.key, true)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => {
    if (setFlipper(e.key, false)) e.preventDefault();
  });

  restartBtn.addEventListener("click", reset);
  restartSideBtn.addEventListener("click", reset);

  // ---- Debug / test handle ----
  window.__PINBALL__ = {
    state() {
      return {
        x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy,
        score: game.score, lives: game.lives,
        logLen: game.log.length, log: game.log.slice(),
        gameOver: game.gameOver, paused: game.paused,
        flipperAngles: flippers.map((f) => f.angle),
      };
    },
    setBall(x, y, vx, vy) { ball.x = x; ball.y = y; ball.vx = vx; ball.vy = vy; },
    pause() { game.paused = true; },
    resume() { game.paused = false; },
    step(dt) { stepPhysics(dt || 1 / 60); render(); },
    pressFlipper(side, on) { flippers[side === "R" ? 1 : 0].pressed = !!on; },
    hitBumper(i) { onBumperHit(bumpers[i]); },
    bumperCenter(i) { const b = bumpers[i]; return { x: b.x, y: b.y, r: b.r }; },
    reset,
    game,
  };

  // ---- Boot ----
  reset();
  requestAnimationFrame(loop);
})();
