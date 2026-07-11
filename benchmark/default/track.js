/* track.js
 * Fictional closed-loop circuit "Solvik Grand Loop": a long straight, a
 * high-speed sweeper, a hairpin, an esses section, a DRS zone/detection
 * point, three ordered checkpoints, and a pit lane.
 *
 * The centerline is built once (Catmull-Rom through hand-placed waypoints,
 * then resampled at a uniform arc-length spacing) so every later query
 * (car progress, surface type, wall contact, world position of a given
 * distance/offset) is cheap and numerically well-behaved.
 *
 * Coordinate system: plain 2D plane, x right, y down (matches <canvas>).
 * heading is measured from +x, increasing "clockwise" on screen.
 */
(function (global) {
  'use strict';

  var HALF_WIDTH = 12;         // tarmac half-width
  var GRASS_WIDTH = 16;        // grass band beyond the tarmac edge
  var PIT_LANE_WIDTH = 14;     // extra corridor width available inside the pit region
  var WALL_HALF_WIDTH = HALF_WIDTH + GRASS_WIDTH; // 28, normal wall distance
  var PIT_WALL_HALF_WIDTH = WALL_HALF_WIDTH + PIT_LANE_WIDTH; // 42, wall distance inside pit region
  var PIT_LANE_SIDE = 1; // pit lane sits on the positive-lateral side

  var SAMPLE_SPACING_TARGET = 4;
  var CATMULL_SAMPLES_PER_SPAN = 24;

  // Waypoints for the closed-loop centerline (cyclic - last connects to first).
  var WAYPOINTS = [
    { x: 150, y: 620 },  // start/finish, bottom straight begins
    { x: 500, y: 622 },
    { x: 850, y: 618 },  // end of long straight
    { x: 1010, y: 568 }, // begin high-speed sweep
    { x: 1085, y: 440 },
    { x: 1050, y: 290 },
    { x: 940, y: 180 },  // sweep exit, short straight follows
    { x: 800, y: 145 },
    { x: 715, y: 175 },  // hairpin entry
    { x: 665, y: 265 },  // hairpin apex (tight cluster)
    { x: 700, y: 345 },
    { x: 630, y: 385 },  // hairpin exit
    { x: 500, y: 372 },
    { x: 430, y: 300 },  // esses kink 1
    { x: 345, y: 250 },
    { x: 300, y: 330 },  // esses kink 2 (opposite bend)
    { x: 235, y: 400 },
    { x: 150, y: 470 },  // corner back toward the pit straight
    { x: 100, y: 555 }
  ];

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function catmullRomPoint(p0, p1, p2, p3, t) {
    var t2 = t * t;
    var t3 = t2 * t;
    var x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
    var y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
    return { x: x, y: y };
  }

  function buildDensePolyline(waypoints) {
    var n = waypoints.length;
    var dense = [];
    for (var i = 0; i < n; i++) {
      var p0 = waypoints[(i - 1 + n) % n];
      var p1 = waypoints[i];
      var p2 = waypoints[(i + 1) % n];
      var p3 = waypoints[(i + 2) % n];
      for (var s = 0; s < CATMULL_SAMPLES_PER_SPAN; s++) {
        var t = s / CATMULL_SAMPLES_PER_SPAN;
        dense.push(catmullRomPoint(p0, p1, p2, p3, t));
      }
    }
    return dense;
  }

  function resampleUniform(dense, spacingTarget) {
    var n = dense.length;
    var cum = new Array(n);
    cum[0] = 0;
    for (var i = 1; i < n; i++) {
      cum[i] = cum[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y);
    }
    var lastClose = Math.hypot(dense[0].x - dense[n - 1].x, dense[0].y - dense[n - 1].y);
    var totalLength = cum[n - 1] + lastClose;

    var count = Math.max(8, Math.round(totalLength / spacingTarget));
    var spacing = totalLength / count;
    var samples = [];
    var denseIdx = 0;
    for (var k = 0; k < count; k++) {
      var targetDist = k * spacing;
      while (denseIdx < n - 1 && cum[denseIdx + 1] <= targetDist) denseIdx++;
      var d0 = cum[denseIdx];
      var p0 = dense[denseIdx];
      var p1 = dense[(denseIdx + 1) % n];
      var segLen = (denseIdx + 1 < n ? cum[denseIdx + 1] : totalLength) - d0;
      var t = segLen > 1e-9 ? (targetDist - d0) / segLen : 0;
      samples.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, dist: targetDist });
    }
    return { samples: samples, length: totalLength, spacing: spacing };
  }

  function computeHeadingsAndCurvature(samples, length, spacing) {
    var n = samples.length;
    for (var i = 0; i < n; i++) {
      var prev = samples[(i - 1 + n) % n];
      var next = samples[(i + 1) % n];
      var dx = next.x - prev.x;
      var dy = next.y - prev.y;
      samples[i].heading = Math.atan2(dy, dx);
    }
    for (var j = 0; j < n; j++) {
      var hPrev = samples[(j - 1 + n) % n].heading;
      var hNext = samples[(j + 1) % n].heading;
      var dh = hNext - hPrev;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      samples[j].curvature = dh / (2 * spacing);
    }
  }

  function buildTrack() {
    var dense = buildDensePolyline(WAYPOINTS);
    var resampled = resampleUniform(dense, SAMPLE_SPACING_TARGET);
    var samples = resampled.samples;
    var length = resampled.length;
    var spacing = resampled.spacing;
    computeHeadingsAndCurvature(samples, length, spacing);

    function atFraction(f) { return f * length; }

    var checkpoints = [
      { id: 0, dist: atFraction(0.30) },
      { id: 1, dist: atFraction(0.55) },
      { id: 2, dist: atFraction(0.80) }
    ];

    var drsZone = {
      detectionDist: atFraction(0.97),
      zoneStart: atFraction(0.14),
      zoneEnd: atFraction(0.25)
    };

    var pitLane = {
      entryDist: atFraction(0.95),
      exitDist: atFraction(0.105),
      lateralCenter: (WALL_HALF_WIDTH + PIT_WALL_HALF_WIDTH) / 2 * PIT_LANE_SIDE,
      speedLimit: 20,
      boxes: []
    };
    // Pit boxes sit in the middle portion of the wrapped entry->exit span.
    var spanLen = (length - pitLane.entryDist) + pitLane.exitDist;
    var boxCount = 4;
    var usableStart = pitLane.entryDist + spanLen * 0.28;
    var boxSpacing = (spanLen * 0.55) / (boxCount - 1);
    for (var b = 0; b < boxCount; b++) {
      var boxDist = (usableStart + b * boxSpacing) % length;
      pitLane.boxes.push({ index: b, dist: boxDist, lateral: pitLane.lateralCenter, captureRadiusDist: 3.5, captureRadiusLateral: 5 });
    }

    var track = {
      samples: samples,
      length: length,
      spacing: spacing,
      halfWidth: HALF_WIDTH,
      grassWidth: GRASS_WIDTH,
      wallHalfWidth: WALL_HALF_WIDTH,
      pitWallHalfWidth: PIT_WALL_HALF_WIDTH,
      pitLaneSide: PIT_LANE_SIDE,
      checkpoints: checkpoints,
      drsZone: drsZone,
      pitLane: pitLane
    };
    return track;
  }

  var TRACK = buildTrack();

  function wrapDist(d) {
    var L = TRACK.length;
    d = d % L;
    if (d < 0) d += L;
    return d;
  }

  function isWithinWrappedRange(d, start, end) {
    d = wrapDist(d);
    start = wrapDist(start);
    end = wrapDist(end);
    if (start <= end) return d >= start && d <= end;
    return d >= start || d <= end;
  }

  function sampleIndexAt(dist) {
    var idx = Math.round(wrapDist(dist) / TRACK.spacing) % TRACK.samples.length;
    if (idx < 0) idx += TRACK.samples.length;
    return idx;
  }

  function rightNormalAt(heading) {
    return { x: -Math.sin(heading), y: Math.cos(heading) };
  }

  /** Nearest-point-on-centerline query. Returns distanceAlong, signed lateralOffset, heading, curvature. */
  function getProgress(x, y) {
    var samples = TRACK.samples;
    var n = samples.length;
    var bestIdx = 0;
    var bestD2 = Infinity;
    for (var i = 0; i < n; i++) {
      var dx = samples[i].x - x;
      var dy = samples[i].y - y;
      var d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
    }

    var best = null;
    // Check both segments touching the nearest sample (the one ending here
    // and the one starting here) - checking only one side clamps t=0/1 at
    // the sample and can freeze distanceAlong for points past the wrap seam.
    var candidates = [(bestIdx - 1 + n) % n, bestIdx];
    for (var c = 0; c < candidates.length; c++) {
      var i0 = candidates[c];
      var i1 = (i0 + 1) % n;
      var A = samples[i0];
      var B = samples[i1];
      var ABx = B.x - A.x, ABy = B.y - A.y;
      var abLen2 = ABx * ABx + ABy * ABy || 1e-9;
      var APx = x - A.x, APy = y - A.y;
      var t = clamp((APx * ABx + APy * ABy) / abLen2, 0, 1);
      var closestX = A.x + ABx * t;
      var closestY = A.y + ABy * t;
      var dx2 = x - closestX, dy2 = y - closestY;
      var d2b = dx2 * dx2 + dy2 * dy2;
      if (!best || d2b < best.d2) {
        var normal = rightNormalAt(A.heading);
        var lateralSign = (dx2 * normal.x + dy2 * normal.y) >= 0 ? 1 : -1;
        best = {
          d2: d2b,
          distanceAlong: wrapDist(A.dist + t * TRACK.spacing),
          lateralOffset: lateralSign * Math.sqrt(d2b),
          heading: A.heading,
          curvature: A.curvature,
          sampleIndex: i0
        };
      }
    }
    return {
      distanceAlong: best.distanceAlong,
      lateralOffset: best.lateralOffset,
      heading: best.heading,
      curvature: best.curvature,
      sampleIndex: best.sampleIndex
    };
  }

  function wallHalfWidthFor(distanceAlong, lateralSign) {
    if (lateralSign === PIT_LANE_SIDE && isWithinWrappedRange(distanceAlong, TRACK.pitLane.entryDist, TRACK.pitLane.exitDist)) {
      return PIT_WALL_HALF_WIDTH;
    }
    return WALL_HALF_WIDTH;
  }

  /**
   * Classifies a (distanceAlong, lateralOffset) pair.
   * Returns { surface, gripMultiplier, dragMultiplier, wallContact }
   * wallContact (if any): { normalX, normalY, depth } to push the car back in-bounds.
   */
  function classify(distanceAlong, lateralOffset, heading) {
    var absLat = Math.abs(lateralOffset);
    var sign = lateralOffset >= 0 ? 1 : -1;
    var wallLimit = wallHalfWidthFor(distanceAlong, sign);

    var result = { surface: 'track', onGrass: false, gripMultiplier: 1, dragMultiplier: 1, wallContact: null };

    if (absLat > wallLimit) {
      var depth = absLat - wallLimit;
      var normal = rightNormalAt(heading != null ? heading : 0);
      result.surface = 'wall';
      result.onGrass = true;
      result.gripMultiplier = 0.4;
      result.dragMultiplier = 1.6;
      result.wallContact = { normalX: -sign * normal.x, normalY: -sign * normal.y, depth: depth };
      return result;
    }

    if (sign === PIT_LANE_SIDE && absLat > WALL_HALF_WIDTH &&
      isWithinWrappedRange(distanceAlong, TRACK.pitLane.entryDist, TRACK.pitLane.exitDist)) {
      result.surface = 'pitlane';
      result.onGrass = false;
      result.gripMultiplier = 1;
      result.dragMultiplier = 1;
      return result;
    }

    if (absLat > HALF_WIDTH) {
      result.surface = 'grass';
      result.onGrass = true;
      result.gripMultiplier = 1;
      result.dragMultiplier = 1;
      return result;
    }

    return result;
  }

  /** distance/offset -> world point (O(1) sample lookup, good enough for placement & rendering). */
  function getWorldPointAt(distanceAlong, lateralOffset) {
    var idx = sampleIndexAt(distanceAlong);
    var s = TRACK.samples[idx];
    var normal = rightNormalAt(s.heading);
    return {
      x: s.x + normal.x * lateralOffset,
      y: s.y + normal.y * lateralOffset,
      heading: s.heading
    };
  }

  function isInDrsZone(distanceAlong) {
    return isWithinWrappedRange(distanceAlong, TRACK.drsZone.zoneStart, TRACK.drsZone.zoneEnd);
  }

  function getStartGridSlot(index) {
    var rowSpacing = 16;
    var lateralStagger = (index % 2 === 0) ? -4.5 : 4.5;
    var distBehind = (index + 1) * rowSpacing;
    var dist = wrapDist(0 - distBehind);
    var pt = getWorldPointAt(dist, lateralStagger);
    return { x: pt.x, y: pt.y, heading: pt.heading, distanceAlong: dist, lateralOffset: lateralStagger };
  }

  /** Precomputed polylines for rendering: inner/outer tarmac edge, outer grass edge, pit lane edges. */
  function buildBoundaryPolylines() {
    var n = TRACK.samples.length;
    var inner = [], outer = [], grassOuter = [], pitOuter = [], pitInner = [];
    for (var i = 0; i < n; i++) {
      var s = TRACK.samples[i];
      var normal = rightNormalAt(s.heading);
      inner.push({ x: s.x - normal.x * HALF_WIDTH, y: s.y - normal.y * HALF_WIDTH });
      outer.push({ x: s.x + normal.x * HALF_WIDTH, y: s.y + normal.y * HALF_WIDTH });
      var wallLimitHere = wallHalfWidthFor(s.dist, 1);
      grassOuter.push({ x: s.x + normal.x * WALL_HALF_WIDTH, y: s.y + normal.y * WALL_HALF_WIDTH });
      if (wallLimitHere > WALL_HALF_WIDTH) {
        pitInner.push({ x: s.x + normal.x * WALL_HALF_WIDTH, y: s.y + normal.y * WALL_HALF_WIDTH });
        pitOuter.push({ x: s.x + normal.x * PIT_WALL_HALF_WIDTH, y: s.y + normal.y * PIT_WALL_HALF_WIDTH });
      }
    }
    return { inner: inner, outer: outer, grassOuter: grassOuter, pitInner: pitInner, pitOuter: pitOuter };
  }

  var boundaries = buildBoundaryPolylines();

  global.Track = {
    samples: TRACK.samples,
    length: TRACK.length,
    spacing: TRACK.spacing,
    halfWidth: HALF_WIDTH,
    grassWidth: GRASS_WIDTH,
    wallHalfWidth: WALL_HALF_WIDTH,
    pitWallHalfWidth: PIT_WALL_HALF_WIDTH,
    checkpoints: TRACK.checkpoints,
    drsZone: TRACK.drsZone,
    pitLane: TRACK.pitLane,
    boundaries: boundaries,
    wrapDist: wrapDist,
    isWithinWrappedRange: isWithinWrappedRange,
    getProgress: getProgress,
    classify: classify,
    getWorldPointAt: getWorldPointAt,
    isInDrsZone: isInDrsZone,
    getStartGridSlot: getStartGridSlot,
    rightNormalAt: rightNormalAt
  };
})(typeof window !== 'undefined' ? window : global);
