/* track.js
 * Fictional closed circuit geometry + query functions + renderer.
 * World-coordinate space only (no canvas/CSS/DPR concerns here).
 * Exposes window.Track. No dependency on Physics/Race.
 *
 * The circuit is a periodic Catmull-Rom spline through hand-placed control
 * points, sampled into a dense centreline polyline. From that we derive:
 *   - arc-length-normalised lap progress (0..1) for ranking,
 *   - per-sample tangent/normal for walls and the racing line,
 *   - surface classification (track / grass / pit),
 *   - checkpoints, start/finish, DRS zone + detection point, pit lane/box.
 *
 * Feature layout around the lap (by design of the control points):
 *   - a start/finish straight,
 *   - a long back straight carrying the DRS zone and the pit lane,
 *   - a fast sweeper, an esses section, and a tight hairpin.
 */
(function (global) {
  'use strict';

  var CONFIG = global.CONFIG;
  var TW = CONFIG.track;

  // Control points, in travel order (world metres). Periodic (wraps).
  var CTRL = [
    { x: 150, y: 300 },  // 0  start/finish straight (heading roughly downward)
    { x: 168, y: 470 },  // 1
    { x: 250, y: 585 },  // 2  onto the long back straight
    { x: 470, y: 620 },  // 3  long straight start (DRS + pit lane along here)
    { x: 800, y: 615 },  // 4  long straight end
    { x: 930, y: 520 },  // 5  fast sweeper
    { x: 955, y: 400 },  // 6
    { x: 890, y: 300 },  // 7
    { x: 955, y: 195 },  // 8  esses (top)
    { x: 835, y: 135 },  // 9
    { x: 700, y: 190 },  // 10 esses
    { x: 560, y: 120 },  // 11 esses
    { x: 430, y: 175 },  // 12
    { x: 315, y: 120 },  // 13 hairpin approach
    { x: 235, y: 205 },  // 14 hairpin tip (tight)
    { x: 300, y: 300 }   // 15 back toward start
  ];

  // ---- Catmull-Rom (centripetal-ish uniform) periodic sampling ----
  function catmull(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return {
      x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
    };
  }

  var pts = [];        // sampled centreline points {x,y}
  var seglen = [];     // length of segment i -> i+1
  var cum = [];        // cumulative arc length at point i
  var total = 0;       // total lap length
  var tangents = [];   // unit tangent at each point
  var normals = [];    // unit LEFT normal at each point

  function build() {
    var n = CTRL.length, sps = TW.samplesPerSeg;
    pts = [];
    for (var i = 0; i < n; i++) {
      var p0 = CTRL[(i - 1 + n) % n];
      var p1 = CTRL[i];
      var p2 = CTRL[(i + 1) % n];
      var p3 = CTRL[(i + 2) % n];
      for (var s = 0; s < sps; s++) {
        pts.push(catmull(p0, p1, p2, p3, s / sps));
      }
    }
    // arc lengths (closed)
    seglen = []; cum = []; total = 0;
    var m = pts.length;
    for (var k = 0; k < m; k++) {
      cum[k] = total;
      var a = pts[k], b = pts[(k + 1) % m];
      var dl = Math.hypot(b.x - a.x, b.y - a.y);
      seglen[k] = dl;
      total += dl;
    }
    // tangents & normals (left normal = rotate tangent +90deg)
    tangents = []; normals = [];
    for (var j = 0; j < m; j++) {
      var pa = pts[j], pb = pts[(j + 1) % m];
      var tx = pb.x - pa.x, ty = pb.y - pa.y;
      var tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      tangents[j] = { x: tx, y: ty };
      normals[j] = { x: -ty, y: tx };
    }
  }

  build();

  // Progress (0..1) at each control point, by arc length.
  function progressOfSampleIndex(idx) { return cum[idx] / total; }

  // Control point i corresponds to sample index i*samplesPerSeg.
  function ctrlProgress(i) { return progressOfSampleIndex(i * TW.samplesPerSeg); }

  // ---- Feature definitions ----
  // Start/finish line at progress 0 (control point 0).
  // Checkpoints spread around the lap, must be crossed in this order.
  var checkpoints = [
    { progress: ctrlProgress(4) },   // end of long straight
    { progress: ctrlProgress(8) },   // top / esses
    { progress: ctrlProgress(13) }   // hairpin approach
  ];

  // Long back straight spans control points 3->4.
  var straightStart = ctrlProgress(3);
  var straightEnd = ctrlProgress(4);

  // DRS zone: middle portion of the long straight. Detection point just before.
  var drsZone = {
    start: straightStart + (straightEnd - straightStart) * 0.30,
    end: straightStart + (straightEnd - straightStart) * 0.92,
    detection: straightStart + (straightEnd - straightStart) * 0.05
  };

  // Pit lane: parallel corridor on the interior side of the long straight.
  // Determine interior side by testing the centroid against the left normal.
  var centroid = (function () {
    var cx = 0, cy = 0;
    for (var i = 0; i < CTRL.length; i++) { cx += CTRL[i].x; cy += CTRL[i].y; }
    return { x: cx / CTRL.length, y: cy / CTRL.length };
  })();

  var pit = (function () {
    var midIdx = Math.round(3.5 * TW.samplesPerSeg);
    var p = pts[midIdx], nrm = normals[midIdx];
    var toC = { x: centroid.x - p.x, y: centroid.y - p.y };
    var side = (nrm.x * toC.x + nrm.y * toC.y) >= 0 ? 1 : -1; // +1 => interior on +normal
    var entry = straightStart + (straightEnd - straightStart) * 0.10;
    var exit = straightStart + (straightEnd - straightStart) * 0.95;
    var boxProg = straightStart + (straightEnd - straightStart) * 0.55;
    return {
      side: side,              // which normal side the pit corridor sits on
      entry: entry,
      exit: exit,
      boxProgress: boxProg,
      speedLimit: CONFIG.race.pitSpeedLimit,
      inner: TW.halfWidth + 6,           // corridor near edge
      outer: TW.halfWidth + 6 + TW.pitWidth // corridor far edge (wall)
    };
  })();

  // Compute the pit box world position (on the pit corridor centreline).
  var pitBox = (function () {
    var b = worldAtProgress(pit.boxProgress);
    var off = (pit.inner + pit.outer) / 2 * pit.side;
    return { x: b.x + b.nx * off, y: b.y + b.ny * off, progress: pit.boxProgress };
  })();

  // ---- Geometry queries ----

  // Nearest centreline point to (x,y). Returns projection + signed lateral
  // offset (along left normal) + progress. O(N) scan.
  function nearest(x, y) {
    var m = pts.length;
    var best = Infinity, bi = 0, bproj = null, bt = 0;
    for (var i = 0; i < m; i++) {
      var a = pts[i], b = pts[(i + 1) % m];
      var abx = b.x - a.x, aby = b.y - a.y;
      var ll = abx * abx + aby * aby || 1;
      var t = ((x - a.x) * abx + (y - a.y) * aby) / ll;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var px = a.x + abx * t, py = a.y + aby * t;
      var dd = (x - px) * (x - px) + (y - py) * (y - py);
      if (dd < best) { best = dd; bi = i; bproj = { x: px, y: py }; bt = t; }
    }
    var nrm = normals[bi];
    var offset = (x - bproj.x) * nrm.x + (y - bproj.y) * nrm.y;
    var prog = (cum[bi] + seglen[bi] * bt) / total;
    return {
      index: bi, t: bt, projX: bproj.x, projY: bproj.y,
      dist: Math.sqrt(best), offset: offset, progress: prog,
      nx: nrm.x, ny: nrm.y, tx: tangents[bi].x, ty: tangents[bi].y
    };
  }

  // World point + basis at a given progress (0..1).
  function worldAtProgress(p) {
    p = ((p % 1) + 1) % 1;
    var target = p * total;
    var m = pts.length;
    // linear scan (small)
    for (var i = 0; i < m; i++) {
      var next = cum[i] + seglen[i];
      if (target <= next || i === m - 1) {
        var t = seglen[i] > 0 ? (target - cum[i]) / seglen[i] : 0;
        var a = pts[i], b = pts[(i + 1) % m];
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          nx: normals[i].x, ny: normals[i].y,
          tx: tangents[i].x, ty: tangents[i].y,
          index: i
        };
      }
    }
    var a0 = pts[0];
    return { x: a0.x, y: a0.y, nx: normals[0].x, ny: normals[0].y, tx: tangents[0].x, ty: tangents[0].y, index: 0 };
  }

  function progressAt(x, y) { return nearest(x, y).progress; }

  function inRange(p, start, end) {
    if (start <= end) return p >= start && p <= end;
    return p >= start || p <= end; // wraps 0
  }

  function inPitCorridor(offset, progress) {
    if (!inRange(progress, pit.entry, pit.exit)) return false;
    var s = offset * pit.side; // signed distance on the pit side
    return s >= pit.inner && s <= pit.outer;
  }

  // Surface classification at a world point.
  function surfaceAt(x, y) {
    var nr = nearest(x, y);
    if (inPitCorridor(nr.offset, nr.progress)) return 'pit';
    if (Math.abs(nr.offset) <= TW.halfWidth) return 'track';
    return 'grass';
  }

  // Boundary descriptor for wall collision. posWall/negWall are the allowed
  // extents of `offset` (signed distance along left normal). Pit corridor
  // extends the wall on the pit side within the pit progress range.
  function boundaryAt(x, y) {
    var nr = nearest(x, y);
    var wall = TW.halfWidth + TW.grassWidth;
    var posWall = wall, negWall = -wall;
    if (inRange(nr.progress, pit.entry, pit.exit)) {
      if (pit.side > 0) posWall = pit.outer;
      else negWall = -pit.outer;
    }
    return {
      nx: nr.nx, ny: nr.ny, offset: nr.offset,
      posWall: posWall, negWall: negWall,
      projX: nr.projX, projY: nr.projY, progress: nr.progress
    };
  }

  // ---- DRS helpers ----
  function inDrsZone(progress) { return inRange(progress, drsZone.start, drsZone.end); }

  // ---- Racing line lookahead (used by AI). Returns a point `ahead` metres
  // further along the centreline from progress p, plus local curvature. ----
  function lookAhead(progress, aheadMetres) {
    var p2 = progress + aheadMetres / total;
    return worldAtProgress(p2);
  }

  // Curvature estimate around a progress value (angle change per metre).
  function curvatureAt(progress, span) {
    span = span || 40;
    var a = worldAtProgress(progress - span / total);
    var b = worldAtProgress(progress);
    var c = worldAtProgress(progress + span / total);
    var a1 = Math.atan2(b.y - a.y, b.x - a.x);
    var a2 = Math.atan2(c.y - b.y, c.x - b.x);
    var d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d) / (2 * span); // rad per metre
  }

  // Starting grid slots: staggered pairs behind the start/finish line.
  function gridSlots(count) {
    var slots = [];
    var R = CONFIG.race;
    for (var i = 0; i < count; i++) {
      var back = (i + 1) * R.gridSpacing; // metres behind the line
      var p = -back / total; // negative progress => behind line
      var w = worldAtProgress(p);
      var lateral = (i % 2 === 0 ? 1 : -1) * R.gridStagger;
      slots.push({
        x: w.x + w.nx * lateral,
        y: w.y + w.ny * lateral,
        heading: Math.atan2(w.ty, w.tx)
      });
    }
    return slots;
  }

  // ---- Renderer ----
  function drawPolyOffset(ctx, offset, close) {
    var m = pts.length;
    ctx.beginPath();
    for (var i = 0; i <= m; i++) {
      var idx = i % m;
      var p = pts[idx], nrm = normals[idx];
      var x = p.x + nrm.x * offset, y = p.y + nrm.y * offset;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    if (close) ctx.closePath();
  }

  function draw(ctx) {
    var C = CONFIG.colors, m = pts.length;

    // Grass base.
    ctx.fillStyle = C.grass;
    ctx.fillRect(0, 0, CONFIG.world.width, CONFIG.world.height);

    // Grass texture stripes (decoration).
    ctx.fillStyle = C.grassDark;
    for (var gx = 0; gx < CONFIG.world.width; gx += 80) {
      ctx.fillRect(gx, 0, 40, CONFIG.world.height);
    }

    // Track surface as a thick stroked ribbon.
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = C.track;
    ctx.lineWidth = TW.halfWidth * 2;
    drawPolyOffset(ctx, 0, true);
    ctx.stroke();

    // Track edges.
    ctx.strokeStyle = C.trackEdge;
    ctx.lineWidth = 2;
    drawPolyOffset(ctx, TW.halfWidth, true); ctx.stroke();
    drawPolyOffset(ctx, -TW.halfWidth, true); ctx.stroke();

    // Curbs on the inside of tight corners (simple: dashed along both edges).
    ctx.lineWidth = 4;
    for (var e = 0; e < 2; e++) {
      var off = e === 0 ? TW.halfWidth - 2 : -(TW.halfWidth - 2);
      for (var i = 0; i < m; i += 2) {
        var idx = i % m;
        var p = pts[idx], nrm = normals[idx];
        ctx.strokeStyle = (i % 4 === 0) ? C.curbA : C.curbB;
        ctx.beginPath();
        ctx.moveTo(p.x + nrm.x * off, p.y + nrm.y * off);
        var nx = pts[(idx + 1) % m];
        var nn = normals[(idx + 1) % m];
        ctx.lineTo(nx.x + nn.x * off, nx.y + nn.y * off);
        ctx.stroke();
      }
    }

    // DRS zone shading.
    ctx.fillStyle = C.drs;
    drawZoneBand(ctx, drsZone.start, drsZone.end, TW.halfWidth);

    // Pit lane corridor.
    var pin = worldBandPoints(pit.entry, pit.exit);
    ctx.fillStyle = CONFIG.colors.pit;
    ctx.beginPath();
    var innerOff = pit.inner * pit.side, outerOff = pit.outer * pit.side;
    for (var a = 0; a < pin.length; a++) {
      var pp = pin[a];
      var xi = pp.x + pp.nx * innerOff, yi = pp.y + pp.ny * innerOff;
      if (a === 0) ctx.moveTo(xi, yi); else ctx.lineTo(xi, yi);
    }
    for (var b2 = pin.length - 1; b2 >= 0; b2--) {
      var pq = pin[b2];
      ctx.lineTo(pq.x + pq.nx * outerOff, pq.y + pq.ny * outerOff);
    }
    ctx.closePath();
    ctx.fill();
    // pit speed-limit lines
    ctx.strokeStyle = C.pitLine; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Pit box.
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(pitBox.x - 7, pitBox.y - 7, 14, 14);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
    ctx.strokeRect(pitBox.x - 7, pitBox.y - 7, 14, 14);

    // Checkpoints.
    for (var c = 0; c < checkpoints.length; c++) {
      drawLineAt(ctx, checkpoints[c].progress, C.checkpoint, TW.halfWidth, 6);
    }

    // Start/finish line (chequered).
    drawFinishLine(ctx);

    // Start grid marks.
    var slots = gridSlots(4);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (var g = 0; g < slots.length; g++) {
      ctx.save();
      ctx.translate(slots[g].x, slots[g].y);
      ctx.rotate(slots[g].heading);
      ctx.fillRect(-6, -1.5, 12, 3);
      ctx.restore();
    }

    // Trees / decoration around the outside.
    drawDecoration(ctx);
  }

  function worldBandPoints(start, end) {
    var out = [];
    var steps = 40;
    for (var i = 0; i <= steps; i++) {
      var p = start + (endMinus(start, end)) * (i / steps);
      out.push(worldAtProgress(p));
    }
    return out;
  }
  function endMinus(start, end) { return (end >= start) ? (end - start) : (1 - start + end); }

  function drawZoneBand(ctx, start, end, half) {
    var band = worldBandPoints(start, end);
    ctx.beginPath();
    for (var i = 0; i < band.length; i++) {
      var p = band[i];
      var x = p.x + p.nx * half, y = p.y + p.ny * half;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (var j = band.length - 1; j >= 0; j--) {
      var q = band[j];
      ctx.lineTo(q.x - q.nx * half, q.y - q.ny * half);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawLineAt(ctx, progress, color, half, width) {
    var w = worldAtProgress(progress);
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(w.x + w.nx * half, w.y + w.ny * half);
    ctx.lineTo(w.x - w.nx * half, w.y - w.ny * half);
    ctx.stroke();
  }

  function drawFinishLine(ctx) {
    var w = worldAtProgress(0);
    var half = TW.halfWidth, squares = 8, sq = (half * 2) / squares;
    for (var i = 0; i < squares; i++) {
      var t = -half + i * sq;
      var x = w.x + w.nx * t, y = w.y + w.ny * t;
      ctx.fillStyle = (i % 2 === 0) ? '#111' : '#fff';
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(w.ty, w.tx));
      ctx.fillRect(-2.5, 0, 5, sq);
      ctx.restore();
    }
  }

  var decoCache = null;
  function drawDecoration(ctx) {
    if (!decoCache) {
      decoCache = [];
      // deterministic pseudo-random trees on the grass, away from the track
      var seed = 1234;
      function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
      var tries = 0, placed = 0;
      while (placed < 40 && tries < 800) {
        tries++;
        var x = rnd() * CONFIG.world.width;
        var y = rnd() * CONFIG.world.height;
        var nr = nearest(x, y);
        if (Math.abs(nr.offset) > TW.halfWidth + TW.grassWidth + 10) {
          decoCache.push({ x: x, y: y, r: 5 + rnd() * 5 });
          placed++;
        }
      }
    }
    for (var i = 0; i < decoCache.length; i++) {
      var d = decoCache[i];
      ctx.fillStyle = CONFIG.colors.decoTree;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  global.Track = {
    // data
    points: function () { return pts; },
    totalLength: function () { return total; },
    checkpoints: checkpoints,
    drsZone: drsZone,
    pit: pit,
    pitBox: pitBox,
    finishProgress: 0,
    controlPoints: CTRL,
    // queries
    nearest: nearest,
    worldAtProgress: worldAtProgress,
    progressAt: progressAt,
    surfaceAt: surfaceAt,
    boundaryAt: boundaryAt,
    inDrsZone: inDrsZone,
    inPitCorridor: function (x, y) { var nr = nearest(x, y); return inPitCorridor(nr.offset, nr.progress); },
    lookAhead: lookAhead,
    curvatureAt: curvatureAt,
    gridSlots: gridSlots,
    ctrlProgress: ctrlProgress,
    inRange: inRange,
    // render
    draw: draw,
    _rebuild: build
  };
})(typeof window !== 'undefined' ? window : this);
