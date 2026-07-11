/* dev-tools/harness.js
 * Node re-verification harness: stubs the minimal browser globals the
 * non-rendering logic needs, then executes the game scripts IN ORDER inside a
 * shared global and lets tests.js auto-run, printing the real PASS/FAIL output.
 *
 * Run:  "/mnt/c/Program Files/nodejs/node.exe" dev-tools/harness.js
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

// ---- Browser global stubs -------------------------------------------------
global.window = global;

var _store = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null; },
  setItem: function (k, v) { _store[k] = String(v); },
  removeItem: function (k) { delete _store[k]; },
  clear: function () { _store = {}; }
};

// A no-op 2D context in case any renderer path is exercised.
function noopCtx() {
  var p = new Proxy({}, {
    get: function (t, prop) {
      if (prop === 'canvas') return { width: 800, height: 600 };
      if (prop === 'setLineDash') return function () {};
      return function () {};
    }
  });
  return p;
}

// Minimal document stub (tests.js will still take its non-DOM path because we
// omit addEventListener from window; but game.js helpers may probe document).
global.document = {
  getElementById: function () { return null; },
  createElement: function () { return { style: {}, appendChild: function () {}, click: function () {} }; },
  body: { appendChild: function () {}, removeChild: function () {} },
  addEventListener: function () {},
  activeElement: null,
  readyState: 'complete'
};
// Intentionally DO NOT set global.document.addEventListener path for tests.js:
// tests.js checks `global.document && global.document.addEventListener`. We have
// it, so guide it to run immediately via readyState !== 'loading'.

global.requestAnimationFrame = function () { return 0; };
global.cancelAnimationFrame = function () {};
global.performance = { now: function () { return Date.now(); } };
global.devicePixelRatio = 1;

// ---- Execute game scripts in order ---------------------------------------
var ROOT = path.resolve(__dirname, '..');
var files = ['constants.js', 'physics.js', 'track.js', 'ai.js', 'race.js', 'storage.js', 'game.js', 'tests.js'];

files.forEach(function (f) {
  var code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInThisContext(code, { filename: f });
});
// tests.js auto-runs on load and prints the summary.

// Extra explicit re-run to also surface the return value counts distinctly.
var res = global.ASCTests.runAll();
console.log('HARNESS SUMMARY -> pass=' + res.pass + ' fail=' + res.fail);
process.exit(res.fail === 0 ? 0 : 1);
