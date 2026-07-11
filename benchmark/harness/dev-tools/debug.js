'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
global.window = global;
var _s = {}; global.localStorage = { getItem: function (k) { return _s[k] == null ? null : _s[k]; }, setItem: function (k, v) { _s[k] = String(v); }, removeItem: function (k) { delete _s[k]; } };
global.document = { getElementById: function () { return null; }, addEventListener: function () {}, readyState: 'complete', createElement: function () { return { style: {}, click: function () {}, appendChild: function () {} }; }, body: { appendChild: function () {}, removeChild: function () {} } };
global.requestAnimationFrame = function () {}; global.performance = { now: function () { return Date.now(); } };
var ROOT = path.resolve(__dirname, '..');
['constants.js', 'physics.js', 'track.js', 'ai.js', 'race.js', 'storage.js'].forEach(function (f) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); });

var Track = global.Track, Race = global.Race, CONFIG = global.CONFIG;
console.log('track total length:', Track.totalLength().toFixed(1));
console.log('checkpoints:', Track.checkpoints.map(function (c) { return c.progress.toFixed(3); }));
console.log('finish@0 world:', Track.worldAtProgress(0));
var slots = Track.gridSlots(4);
console.log('grid slots:');
slots.forEach(function (s, i) { console.log('  ', i, 'x', s.x.toFixed(1), 'y', s.y.toFixed(1), 'hdg', s.heading.toFixed(2), 'prog', Track.progressAt(s.x, s.y).toFixed(3), 'surf', Track.surfaceAt(s.x, s.y)); });

var R = Race.createRace({ demo: true, difficulty: 'Hard' });
var i = 0;
while (R.phase !== 'racing' && i < 5000) { Race.update(R, CONFIG.dt); i++; }
console.log('reached racing after', i, 'ticks');
var seconds = 320;
var ticks = Math.round(seconds / CONFIG.dt);
for (var t = 0; t < ticks; t++) {
  Race.update(R, CONFIG.dt);
  if (t % Math.round(20 / CONFIG.dt) === 0) {
    var line = 't=' + (t * CONFIG.dt).toFixed(1) + 's ';
    R.cars.forEach(function (c) {
      line += '[' + c.abbr + ' L' + c.lap + ' p' + c.progress.toFixed(2) + ' spd' + c.speed.toFixed(0) + ' cp' + c.nextCp + ' surf' + Track.surfaceAt(c.x, c.y)[0] + ']';
    });
    console.log(line);
  }
}
console.log('FINAL phase', R.phase);
R.cars.forEach(function (c) { console.log('  ', c.abbr, 'lap', c.lap, 'prog', c.progress.toFixed(3), 'laps done', c.laps.length, 'finished', c.finished, 'wear', c.tire.wear.toFixed(0)); });
