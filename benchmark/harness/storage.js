/* storage.js
 * Safe localStorage wrapper (never throws on corrupt/missing data), plus
 * telemetry recording and CSV export. Exposes window.Storage.
 */
(function (global) {
  'use strict';

  var CONFIG = global.CONFIG;
  var K = CONFIG.storage;

  function ls() {
    try { return global.localStorage || null; } catch (e) { return null; }
  }

  // ---- Low-level safe get/set -------------------------------------------
  function safeGet(key, fallback) {
    var store = ls();
    if (!store) return fallback;
    try {
      var raw = store.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback; // corrupted JSON -> defaults, never throw
    }
  }

  function safeSet(key, value) {
    var store = ls();
    if (!store) return false;
    try {
      store.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function remove(key) {
    var store = ls();
    if (!store) return;
    try { store.removeItem(key); } catch (e) { /* ignore */ }
  }

  // ---- Typed accessors with sane defaults --------------------------------
  var DEFAULT_SETTINGS = { audio: true, showMiniMap: true, camera: 'chase' };

  function getSettings() {
    var s = safeGet(K.settings, null);
    if (!s || typeof s !== 'object') return Object.assign({}, DEFAULT_SETTINGS);
    return {
      audio: typeof s.audio === 'boolean' ? s.audio : DEFAULT_SETTINGS.audio,
      showMiniMap: typeof s.showMiniMap === 'boolean' ? s.showMiniMap : DEFAULT_SETTINGS.showMiniMap,
      camera: (s.camera === 'chase' || s.camera === 'full') ? s.camera : DEFAULT_SETTINGS.camera
    };
  }
  function saveSettings(s) { return safeSet(K.settings, s); }

  function getBestLap() {
    var v = safeGet(K.bestLap, null);
    return (typeof v === 'number' && isFinite(v) && v > 0) ? v : null;
  }
  function saveBestLap(t) {
    if (typeof t !== 'number' || !isFinite(t) || t <= 0) return false;
    var cur = getBestLap();
    if (cur == null || t < cur) return safeSet(K.bestLap, t);
    return false;
  }

  function getDifficulty() {
    var v = safeGet(K.difficulty, null);
    return (v === 'Normal' || v === 'Hard') ? v : 'Normal';
  }
  function saveDifficulty(d) {
    if (d !== 'Normal' && d !== 'Hard') return false;
    return safeSet(K.difficulty, d);
  }

  function getLastResult() { return safeGet(K.lastResult, null); }
  function saveLastResult(r) { return safeSet(K.lastResult, r); }

  // ---- Telemetry ---------------------------------------------------------
  // Column order MUST match TELEMETRY_COLUMNS (used by CSV header + tests).
  var TELEMETRY_COLUMNS = [
    'time', 'lap', 'x', 'y', 'speed', 'throttle', 'brake', 'steer',
    'tireTemp', 'tireWear', 'ers', 'drs', 'onTrack'
  ];

  var telemetry = [];
  var lastSampleTime = -Infinity;

  function resetTelemetry() { telemetry = []; lastSampleTime = -Infinity; }

  // Sample a row from car + input at race time `t` (respects sampleInterval).
  function sampleTelemetry(t, car, input, onTrack) {
    if (t - lastSampleTime < CONFIG.telemetry.sampleInterval) return false;
    lastSampleTime = t;
    if (telemetry.length >= CONFIG.telemetry.maxSamples) telemetry.shift();
    telemetry.push({
      time: +t.toFixed(3),
      lap: car.lap,
      x: +car.x.toFixed(2),
      y: +car.y.toFixed(2),
      speed: +car.speed.toFixed(2),
      throttle: +(input.throttle || 0).toFixed(3),
      brake: +(input.brake || 0).toFixed(3),
      steer: +(input.steer || 0).toFixed(3),
      tireTemp: +car.tire.temp.toFixed(2),
      tireWear: +car.tire.wear.toFixed(2),
      ers: +car.ers.toFixed(2),
      drs: car.drsOpen ? 1 : 0,
      onTrack: onTrack ? 1 : 0
    });
    return true;
  }

  function getTelemetry() { return telemetry; }

  // Build a CSV string with a header row and one row per sample.
  function telemetryToCSV() {
    var lines = [TELEMETRY_COLUMNS.join(',')];
    for (var i = 0; i < telemetry.length; i++) {
      var row = telemetry[i];
      var cells = [];
      for (var c = 0; c < TELEMETRY_COLUMNS.length; c++) {
        cells.push(row[TELEMETRY_COLUMNS[c]]);
      }
      lines.push(cells.join(','));
    }
    return lines.join('\n');
  }

  // Trigger a browser download of the CSV (works from file:// via Blob + <a>).
  function downloadTelemetry(filename) {
    var csv = telemetryToCSV();
    try {
      var blob = new global.Blob([csv], { type: 'text/csv' });
      var url = global.URL.createObjectURL(blob);
      var a = global.document.createElement('a');
      a.href = url;
      a.download = filename || 'apex_sprint_telemetry.csv';
      global.document.body.appendChild(a);
      a.click();
      global.document.body.removeChild(a);
      global.URL.revokeObjectURL(url);
      return true;
    } catch (e) {
      return false; // no DOM/Blob (e.g. headless) — caller can still use telemetryToCSV()
    }
  }

  global.Storage = {
    safeGet: safeGet,
    safeSet: safeSet,
    remove: remove,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getBestLap: getBestLap,
    saveBestLap: saveBestLap,
    getDifficulty: getDifficulty,
    saveDifficulty: saveDifficulty,
    getLastResult: getLastResult,
    saveLastResult: saveLastResult,
    resetTelemetry: resetTelemetry,
    sampleTelemetry: sampleTelemetry,
    getTelemetry: getTelemetry,
    telemetryToCSV: telemetryToCSV,
    downloadTelemetry: downloadTelemetry,
    TELEMETRY_COLUMNS: TELEMETRY_COLUMNS
  };
})(typeof window !== 'undefined' ? window : this);
