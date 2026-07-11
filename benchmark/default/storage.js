/* storage.js
 * localStorage persistence (best lap, difficulty, settings, last result)
 * and telemetry CSV export. All reads are corruption-safe: a bad/missing
 * value never throws past this file, it just falls back to a default and
 * reports that it did so via the `corrupted` flag.
 */
(function (global) {
  'use strict';

  var KEYS = {
    BEST_LAP: 'apexSprint.bestLapMs',
    DIFFICULTY: 'apexSprint.difficulty',
    SETTINGS: 'apexSprint.settings',
    LAST_RESULT: 'apexSprint.lastResult'
  };

  var DEFAULT_SETTINGS = {
    masterVolume: 0.6,
    sfxVolume: 0.8,
    showMinimap: true,
    cameraMode: 'follow'
  };

  function hasLocalStorage() {
    try {
      var testKey = '__apexSprint_test__';
      global.localStorage.setItem(testKey, '1');
      global.localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  }

  var storageAvailable = hasLocalStorage();

  function rawGet(key) {
    if (!storageAvailable) return null;
    try {
      return global.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function rawSet(key, value) {
    if (!storageAvailable) return false;
    try {
      global.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Load a JSON value from localStorage. Returns { value, corrupted }.
   * `validate` is an optional function(parsed) -> boolean used to reject
   * structurally-wrong data (e.g. a string where an object was expected).
   */
  function loadJSON(key, fallback, validate) {
    var text = rawGet(key);
    if (text === null || text === undefined) {
      return { value: fallback, corrupted: false };
    }
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { value: fallback, corrupted: true };
    }
    if (typeof validate === 'function' && !validate(parsed)) {
      return { value: fallback, corrupted: true };
    }
    return { value: parsed, corrupted: false };
  }

  function saveJSON(key, value) {
    try {
      var text = JSON.stringify(value);
      return rawSet(key, text);
    } catch (e) {
      return false;
    }
  }

  function isFiniteNumber(n) {
    return typeof n === 'number' && isFinite(n);
  }

  function getBestLap() {
    var result = loadJSON(KEYS.BEST_LAP, null, function (v) {
      return v === null || isFiniteNumber(v);
    });
    return result;
  }

  function setBestLapIfBetter(ms) {
    if (!isFiniteNumber(ms) || ms <= 0) return false;
    var current = getBestLap().value;
    if (current === null || ms < current) {
      saveJSON(KEYS.BEST_LAP, ms);
      return true;
    }
    return false;
  }

  function getDifficulty() {
    var result = loadJSON(KEYS.DIFFICULTY, 'normal', function (v) {
      return v === 'normal' || v === 'hard';
    });
    return result;
  }

  function setDifficulty(value) {
    if (value !== 'normal' && value !== 'hard') value = 'normal';
    saveJSON(KEYS.DIFFICULTY, value);
  }

  function validateSettings(v) {
    if (!v || typeof v !== 'object') return false;
    if (typeof v.masterVolume !== 'number') return false;
    if (typeof v.sfxVolume !== 'number') return false;
    if (typeof v.showMinimap !== 'boolean') return false;
    if (typeof v.cameraMode !== 'string') return false;
    return true;
  }

  function getSettings() {
    var result = loadJSON(KEYS.SETTINGS, DEFAULT_SETTINGS, validateSettings);
    if (result.corrupted) {
      result.value = DEFAULT_SETTINGS;
    }
    return result;
  }

  function setSettings(settings) {
    var merged = {};
    var base = DEFAULT_SETTINGS;
    for (var k in base) {
      if (Object.prototype.hasOwnProperty.call(base, k)) {
        merged[k] = (settings && settings[k] !== undefined) ? settings[k] : base[k];
      }
    }
    saveJSON(KEYS.SETTINGS, merged);
    return merged;
  }

  function getLastResult() {
    return loadJSON(KEYS.LAST_RESULT, null, function (v) {
      return v && typeof v === 'object' && Array.isArray(v.standings);
    });
  }

  function setLastResult(resultObject) {
    saveJSON(KEYS.LAST_RESULT, resultObject);
  }

  var TELEMETRY_COLUMNS = [
    'timeMs', 'lap', 'x', 'y', 'speed', 'throttle', 'brake', 'steer',
    'tireTempC', 'tireWearPct', 'ersPct', 'drsActive', 'onTrack'
  ];

  function buildTelemetryCSV(records) {
    var lines = [TELEMETRY_COLUMNS.join(',')];
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var row = TELEMETRY_COLUMNS.map(function (col) {
        var val = r[col];
        if (val === undefined || val === null) return '';
        if (typeof val === 'number') return Math.round(val * 1000) / 1000;
        return String(val);
      });
      lines.push(row.join(','));
    }
    return lines.join('\r\n');
  }

  function downloadTextFile(filename, text, mimeType) {
    if (typeof global.document === 'undefined') return false;
    try {
      var blob = new global.Blob([text], { type: mimeType || 'text/csv' });
      var url = global.URL.createObjectURL(blob);
      var a = global.document.createElement('a');
      a.href = url;
      a.download = filename;
      global.document.body.appendChild(a);
      a.click();
      global.document.body.removeChild(a);
      global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (e) {
      return false;
    }
  }

  global.GameStorage = {
    KEYS: KEYS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    isAvailable: function () { return storageAvailable; },
    loadJSON: loadJSON,
    saveJSON: saveJSON,
    getBestLap: getBestLap,
    setBestLapIfBetter: setBestLapIfBetter,
    getDifficulty: getDifficulty,
    setDifficulty: setDifficulty,
    getSettings: getSettings,
    setSettings: setSettings,
    getLastResult: getLastResult,
    setLastResult: setLastResult,
    TELEMETRY_COLUMNS: TELEMETRY_COLUMNS,
    buildTelemetryCSV: buildTelemetryCSV,
    downloadTextFile: downloadTextFile
  };
})(typeof window !== 'undefined' ? window : global);
