/*
 * Prompt Pinball — browser wiring: rendering, input, DOM/HUD.
 * All game rules live in physics.js (PinballPhysics).
 */
(function () {
  "use strict";

  var P = window.PinballPhysics;
  var CONFIG = P.CONFIG;

  var canvas = document.getElementById("board");
  var ctx = canvas.getContext("2d");

  // Crisp rendering on high-DPI displays.
  var dpr = window.devicePixelRatio || 1;
  canvas.width = CONFIG.width * dpr;
  canvas.height = CONFIG.height * dpr;
  canvas.style.width = CONFIG.width + "px";
  canvas.style.height = CONFIG.height + "px";
  ctx.scale(dpr, dpr);

  var els = {
    score: document.getElementById("score"),
    lives: document.getElementById("lives"),
    log: document.getElementById("log"),
    overlay: document.getElementById("overlay"),
    finalScore: document.getElementById("final-score"),
    restart: document.getElementById("restart"),
    overlayRestart: document.getElementById("overlay-restart"),
  };

  var game = P.createGame();
  var input = { left: false, right: false };

  // Track what we've already reflected into the DOM so redraws are cheap.
  var rendered = { score: -1, lives: -1, lastEventId: 0, gameOver: null };

  // ---- input ----------------------------------------------------------
  function setKey(e, down) {
    var k = e.key;
    if (k === "a" || k === "A" || k === "ArrowLeft") {
      input.left = down;
      e.preventDefault();
    } else if (k === "d" || k === "D" || k === "ArrowRight") {
      input.right = down;
      e.preventDefault();
    } else if ((k === " " || k === "Spacebar") && game.gameOver) {
      restart();
      e.preventDefault();
    }
  }
  window.addEventListener("keydown", function (e) {
    setKey(e, true);
  });
  window.addEventListener("keyup", function (e) {
    setKey(e, false);
  });

  function restart() {
    P.restart(game);
    rendered.lastEventId = 0;
    els.log.innerHTML = '<li class="empty">Hit a bumper to start logging…</li>';
    syncHud(true);
  }
  els.restart.addEventListener("click", restart);
  els.overlayRestart.addEventListener("click", restart);

  // ---- HUD sync -------------------------------------------------------
  function syncHud(force) {
    if (force || game.score !== rendered.score) {
      els.score.textContent = game.score;
      rendered.score = game.score;
    }
    if (force || game.lives !== rendered.lives) {
      renderLives();
      rendered.lives = game.lives;
    }
    // Append any new event rows (newest at top).
    var newest = game.events[game.events.length - 1];
    var newestId = newest ? newest.id : 0;
    if (newestId !== rendered.lastEventId) {
      var i = game.events.length - 1;
      var toAdd = [];
      while (i >= 0 && game.events[i].id > rendered.lastEventId) {
        toAdd.push(game.events[i]);
        i--;
      }
      var emptyEl = els.log.querySelector(".empty");
      if (emptyEl) emptyEl.remove();
      // toAdd is newest-first already; insert each at the top.
      for (var j = toAdd.length - 1; j >= 0; j--) {
        prependEvent(toAdd[j]);
      }
      rendered.lastEventId = newestId;
      // Cap the visible list.
      while (els.log.children.length > 40) {
        els.log.removeChild(els.log.lastChild);
      }
    }
    if (force || game.gameOver !== rendered.gameOver) {
      if (game.gameOver) {
        els.finalScore.textContent = game.score;
        els.overlay.classList.add("show");
      } else {
        els.overlay.classList.remove("show");
      }
      rendered.gameOver = game.gameOver;
    }
  }

  function prependEvent(ev) {
    var li = document.createElement("li");
    var m = /^(\+\d+)\s+(.*)$/.exec(ev.text);
    if (m) {
      var pts = document.createElement("span");
      pts.className = "pts";
      pts.textContent = m[1];
      li.appendChild(pts);
      li.appendChild(document.createTextNode(" " + m[2]));
    } else {
      li.textContent = ev.text;
    }
    els.log.insertBefore(li, els.log.firstChild);
  }

  function renderLives() {
    els.lives.innerHTML = "";
    for (var i = 0; i < CONFIG.startLives; i++) {
      var d = document.createElement("span");
      d.className = "life-dot" + (i >= game.lives ? " lost" : "");
      els.lives.appendChild(d);
    }
  }

  // ---- rendering ------------------------------------------------------
  function draw() {
    ctx.clearRect(0, 0, CONFIG.width, CONFIG.height);

    drawWalls();
    drawBumpers();
    drawFlippers();
    drawBall();
  }

  function drawWalls() {
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(92,200,255,0.55)";
    ctx.shadowColor = "rgba(92,200,255,0.5)";
    ctx.shadowBlur = 8;
    for (var i = 0; i < game.walls.length; i++) {
      var w = game.walls[i];
      ctx.beginPath();
      ctx.moveTo(w.ax, w.ay);
      ctx.lineTo(w.bx, w.by);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  function drawBumpers() {
    for (var i = 0; i < game.bumpers.length; i++) {
      var b = game.bumpers[i];
      var glow = b.glow / CONFIG.glowFrames; // 0..1
      var baseR = b.r + glow * 4;

      // glow halo
      if (glow > 0) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, baseR + 10, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,207,92," + 0.35 * glow + ")";
        ctx.fill();
      }

      var grad = ctx.createRadialGradient(
        b.x - b.r * 0.4,
        b.y - b.r * 0.4,
        2,
        b.x,
        b.y,
        baseR
      );
      if (glow > 0) {
        grad.addColorStop(0, "#fff6d8");
        grad.addColorStop(1, "#ffb638");
      } else {
        grad.addColorStop(0, "#7fd7ff");
        grad.addColorStop(1, "#2f6bd6");
      }
      ctx.beginPath();
      ctx.arc(b.x, b.y, baseR, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.shadowColor = glow > 0 ? "rgba(255,190,56,0.8)" : "rgba(47,107,214,0.6)";
      ctx.shadowBlur = glow > 0 ? 24 : 10;
      ctx.fill();
      ctx.shadowBlur = 0;

      // ring
      ctx.beginPath();
      ctx.arc(b.x, b.y, baseR, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.stroke();

      // label
      ctx.fillStyle = glow > 0 ? "#5a3d00" : "#06122a";
      ctx.font = "600 12px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(b.label, b.x, b.y);
    }
  }

  function drawFlippers() {
    ["left", "right"].forEach(function (side) {
      var f = game.flippers[side];
      ctx.beginPath();
      ctx.moveTo(f.pivotX, f.pivotY);
      ctx.lineTo(f.tipX, f.tipY);
      ctx.lineCap = "round";
      ctx.lineWidth = CONFIG.flipperRadius * 2;
      ctx.strokeStyle = "#ff7ac6";
      ctx.shadowColor = "rgba(255,122,198,0.7)";
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // pivot hub
      ctx.beginPath();
      ctx.arc(f.pivotX, f.pivotY, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd0ec";
      ctx.fill();
    });
  }

  function drawBall() {
    var b = game.ball;
    var grad = ctx.createRadialGradient(
      b.x - b.r * 0.4,
      b.y - b.r * 0.4,
      1,
      b.x,
      b.y,
      b.r
    );
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.5, "#dfe7f5");
    grad.addColorStop(1, "#8b97b5");
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.shadowColor = "rgba(255,255,255,0.5)";
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // ---- main loop ------------------------------------------------------
  function frame() {
    if (!game.gameOver) {
      P.step(game, input);
    }
    draw();
    syncHud(false);
    requestAnimationFrame(frame);
  }

  renderLives();
  requestAnimationFrame(frame);

  // Expose for debugging / manual testing in the console.
  window.__pinball = { game: game, input: input, restart: restart };
})();
