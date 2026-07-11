/* Instrumented drive comparison for the two F1 physics builds.
 * Loads each build's real physics into a headless chromium page and drives
 * scripted maneuvers, sampling car state every tick. Writes CSVs + a summary.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BENCH = '/mnt/c/MyDocuments/codes/fable5_harness/benchmark';
const OUT = __dirname; // scratchpad

const HARNESS_CONSTANTS = fs.readFileSync(path.join(BENCH, 'harness/constants.js'), 'utf8');
const HARNESS_PHYSICS   = fs.readFileSync(path.join(BENCH, 'harness/physics.js'),   'utf8');
const DEFAULT_PHYSICS   = fs.readFileSync(path.join(BENCH, 'default/physics.js'),   'utf8');

const ADAPTERS = `
window.makeHarness = function () {
  var car = window.Physics.createCar({ x:0, y:0, heading:0 });
  var dt = window.CONFIG.dt;
  return {
    name: 'harness', dt: dt, car: car,
    step: function (input) {
      window.Physics.stepCar(car, input, dt, { surface: 'track' });
      var speed = car.speed;
      var slipAngle = 0;
      if (speed > 1e-6) {
        var velAng = Math.atan2(car.vy, car.vx);
        slipAngle = Math.atan2(Math.sin(velAng - car.heading), Math.cos(velAng - car.heading));
      }
      return { heading: car.heading, speed: speed, slide: car.slide,
               slipAngle: slipAngle, x: car.x, y: car.y,
               grip: car.tire.grip, temp: car.tire.temp, wear: car.tire.wear, fVel: car.fVel };
    }
  };
};
window.makeDefault = function () {
  var car = window.Physics.createCarState(0, 0, 0);
  var surface = { onGrass:false, gripMultiplier:1, dragMultiplier:1 };
  var dt = window.Physics.FIXED_DT;
  return {
    name: 'default', dt: dt, car: car,
    step: function (input) {
      window.Physics.stepCar(car, input, surface, dt);
      var speed = Math.hypot(car.vForward, car.vLateral);
      var slipAngle = Math.atan2(car.vLateral, car.vForward);
      return { heading: car.heading, speed: speed, slide: Math.abs(car.vLateral),
               slipAngle: slipAngle, x: car.x, y: car.y,
               grip: car.tire.gripFactor, temp: car.tire.tempC, wear: car.tire.wearPct, fVel: car.vForward };
    }
  };
};
`;

const RUNNER = `
window.unwrap = function (samples) {
  var dt = samples.dt;
  var cont = 0, prev = null;
  for (var i = 0; i < samples.rows.length; i++) {
    var h = samples.rows[i].heading;
    if (prev === null) { cont = h; }
    else { var d = h - prev; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI; cont += d; }
    prev = h; samples.rows[i].contHeading = cont;
  }
  for (var j = 0; j < samples.rows.length; j++) {
    samples.rows[j].yawRate = j === 0 ? 0 : (samples.rows[j].contHeading - samples.rows[j-1].contHeading) / dt;
  }
  return samples;
};
window.measureTopSpeed = function (makeName) {
  var d = window[makeName](); var last = 0;
  for (var i = 0; i < 6000; i++) { var s = d.step({ throttle:1, brake:0, steer:0, ers:false, drs:false }); last = s.speed; }
  return last;
};
window.spinUp = function (makeName, target) {
  var d = window[makeName](); var s = null;
  for (var i = 0; i < 4000; i++) { s = d.step({ throttle:1, brake:0, steer:0, ers:false, drs:false }); if (s.speed >= target) break; }
  return { d: d, start: s };
};
window.stepSteer = function (makeName, target) {
  var up = window.spinUp(makeName, target); var d = up.d, dt = d.dt;
  var rows = []; var STEER_TICKS = Math.round(2.0/dt); var REL_TICKS = Math.round(2.0/dt); var t = 0;
  for (var i = 0; i < STEER_TICKS; i++) { var s = d.step({ throttle:0.5, brake:0, steer:1, ers:false, drs:false }); s.t=t; s.phase='steer'; rows.push(s); t+=dt; }
  for (var k = 0; k < REL_TICKS; k++) { var s2 = d.step({ throttle:0.5, brake:0, steer:0, ers:false, drs:false }); s2.t=t; s2.phase='release'; rows.push(s2); t+=dt; }
  return window.unwrap({ dt: dt, rows: rows, start: up.start, steerTicks: STEER_TICKS });
};
window.slalom = function (makeName, target) {
  var up = window.spinUp(makeName, target); var d = up.d, dt = d.dt;
  var rows = []; var TOTAL = Math.round(6.0/dt); var HALF = Math.round(0.7/dt); var t=0, dir=1, cnt=0;
  for (var i = 0; i < TOTAL; i++) { var s = d.step({ throttle:0.6, brake:0, steer:dir, ers:false, drs:false }); s.t=t; s.steerCmd=dir; rows.push(s); t+=dt; cnt++; if (cnt>=HALF){cnt=0;dir=-dir;} }
  return window.unwrap({ dt: dt, rows: rows, start: up.start });
};
window.recovery = function (makeName, target) {
  var up = window.spinUp(makeName, target); var d = up.d, dt = d.dt;
  var rows = []; var BUILD = Math.round(1.5/dt); var REL = Math.round(3.0/dt); var t=0;
  for (var i = 0; i < BUILD; i++) { var s = d.step({ throttle:0.5, brake:0, steer:1, ers:false, drs:false }); s.t=t; s.phase='build'; rows.push(s); t+=dt; }
  for (var k = 0; k < REL; k++) { var s2 = d.step({ throttle:0, brake:0, steer:0, ers:false, drs:false }); s2.t=t; s2.phase='release'; rows.push(s2); t+=dt; }
  return window.unwrap({ dt: dt, rows: rows, start: up.start, buildTicks: BUILD });
};
`;

function std(arr){ if(!arr.length) return 0; var m=arr.reduce((a,b)=>a+b,0)/arr.length; return Math.sqrt(arr.reduce((a,b)=>a+(b-m)*(b-m),0)/arr.length); }
function rms(arr){ if(!arr.length) return 0; return Math.sqrt(arr.reduce((a,b)=>a+b*b,0)/arr.length); }

function writeCSV(name, res){
  var cols = ['t','phase','steerCmd','heading','contHeading','yawRate','speed','slide','slipAngle','x','y','grip','temp','wear','fVel'];
  var lines = [cols.join(',')];
  res.rows.forEach(r => { lines.push(cols.map(c => { var v=r[c]; if(v===undefined) return ''; return typeof v==='number'? v.toFixed(6):v; }).join(',')); });
  fs.writeFileSync(path.join(OUT, name), lines.join('\n'));
}

function analyzeStep(runs){
  const per = runs.map(res=>{
    const steerRows = res.rows.filter(r=>r.phase==='steer');
    const relRows = res.rows.filter(r=>r.phase==='release');
    const startSpeed = res.start.speed;
    const peakYaw = Math.max(...steerRows.map(r=>Math.abs(r.yawRate)));
    const after = steerRows.filter(r=>r.t>=0.5).map(r=>r.yawRate);
    const yawStd = std(after);
    const peakSlide = Math.max(...steerRows.map(r=>r.slide));
    const peakSlip = Math.max(...steerRows.map(r=>Math.abs(r.slipAngle)));
    const netRot = Math.abs(res.rows[res.rows.length-1].contHeading - res.rows[0].contHeading);
    const spun = netRot > Math.PI;
    const headAtRelease = steerRows[steerRows.length-1].contHeading;
    const overshoot = Math.max(0, ...relRows.map(r=>Math.abs(r.contHeading - headAtRelease)));
    const endSpeed = res.rows[res.rows.length-1].speed;
    const minSpeed = Math.min(...res.rows.map(r=>r.speed));
    return { startSpeed, peakYaw, yawStd, peakSlide, peakSlipDeg:peakSlip*180/Math.PI, netRotDeg: netRot*180/Math.PI, spun,
             overshootDeg: overshoot*180/Math.PI, endSpeed, minSpeed, speedRetainedPct: 100*minSpeed/startSpeed };
  });
  return aggregate(per);
}
function analyzeSlalom(runs){
  const per = runs.map(res=>{
    const dt = res.dt;
    const yr = res.rows.map(r=>r.yawRate);
    const jerk = []; for (let i=1;i<yr.length;i++) jerk.push((yr[i]-yr[i-1])/dt);
    const jerkRMS = rms(jerk);
    const peakSlide = Math.max(...res.rows.map(r=>r.slide));
    const meanSlide = res.rows.reduce((a,r)=>a+r.slide,0)/res.rows.length;
    const peakSlipDeg = Math.max(...res.rows.map(r=>Math.abs(r.slipAngle)))*180/Math.PI;
    const ys = res.rows.map(r=>r.y);
    const half = Math.floor(res.rows.length/2);
    const amp1 = Math.max(...ys.slice(0,half)) - Math.min(...ys.slice(0,half));
    const amp2 = Math.max(...ys.slice(half)) - Math.min(...ys.slice(half));
    const startSpeed = res.start.speed;
    const endSpeed = res.rows[res.rows.length-1].speed;
    const netRotDeg = Math.abs(res.rows[res.rows.length-1].contHeading - res.rows[0].contHeading)*180/Math.PI;
    return { startSpeed, jerkRMS, peakSlide, meanSlide, peakSlipDeg, pathAmp1:amp1, pathAmp2:amp2,
             ampGrowth: amp2/Math.max(1e-6,amp1), endSpeed, speedRetainedPct:100*endSpeed/startSpeed, netRotDeg };
  });
  return aggregate(per);
}
function analyzeRecovery(runs){
  const per = runs.map(res=>{
    const dt = res.dt;
    const rel = res.rows.filter(r=>r.phase==='release');
    const buildRows = res.rows.filter(r=>r.phase==='build');
    const peakSlideAtRelease = buildRows[buildRows.length-1].slide;
    let settleTicks = -1;
    for (let i=0;i<rel.length;i++){ if (Math.abs(rel[i].yawRate) < 0.05 && rel[i].slide < 0.5) { settleTicks = i; break; } }
    const settleSec = settleTicks<0 ? null : settleTicks*dt;
    const at = i => rel[i] ? rel[i].slide : null;
    return { startSpeed: res.start.speed, peakSlideAtRelease, slide_0_5s: at(Math.round(0.5/dt)), slide_1s: at(Math.round(1.0/dt)), settleSec };
  });
  return aggregate(per);
}
function aggregate(per){
  const keys = Object.keys(per[0]);
  const out = { runs: per, mean: {} };
  keys.forEach(k=>{ const vals = per.map(p=>p[k]).filter(v=>typeof v==='number'); if (vals.length) out.mean[k]=vals.reduce((a,b)=>a+b,0)/vals.length; else out.mean[k]=per[0][k]; });
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  async function loadEngine(which){
    await page.goto('about:blank');
    if (which === 'harness'){ await page.addScriptTag({content:HARNESS_CONSTANTS}); await page.addScriptTag({content:HARNESS_PHYSICS}); }
    else { await page.addScriptTag({content:DEFAULT_PHYSICS}); }
    await page.addScriptTag({content:ADAPTERS});
    await page.addScriptTag({content:RUNNER});
  }
  const summary = { engines: {} };
  for (const eng of ['default','harness']){
    await loadEngine(eng);
    const makeName = eng==='harness'?'makeHarness':'makeDefault';
    const top = await page.evaluate(mn=>window.measureTopSpeed(mn), makeName);
    const targets = { p50: top*0.50, p85: top*0.85 };
    summary.engines[eng] = { topSpeed: top, targets, maneuvers: {} };
    for (const [lvl,tgt] of Object.entries(targets)){
      const stepRuns=[]; for(let r=0;r<3;r++){ const res=await page.evaluate(([mn,t])=>window.stepSteer(mn,t),[makeName,tgt]); stepRuns.push(res); if(r===0) writeCSV(`${eng}_stepsteer_${lvl}.csv`,res); }
      summary.engines[eng].maneuvers[`stepsteer_${lvl}`]=analyzeStep(stepRuns);
      const slaRuns=[]; for(let r=0;r<3;r++){ const res=await page.evaluate(([mn,t])=>window.slalom(mn,t),[makeName,tgt]); slaRuns.push(res); if(r===0) writeCSV(`${eng}_slalom_${lvl}.csv`,res); }
      summary.engines[eng].maneuvers[`slalom_${lvl}`]=analyzeSlalom(slaRuns);
      const recRuns=[]; for(let r=0;r<3;r++){ const res=await page.evaluate(([mn,t])=>window.recovery(mn,t),[makeName,tgt]); recRuns.push(res); if(r===0) writeCSV(`${eng}_recovery_${lvl}.csv`,res); }
      summary.engines[eng].maneuvers[`recovery_${lvl}`]=analyzeRecovery(recRuns);
    }
  }
  fs.writeFileSync(path.join(OUT,'summary.json'), JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary,null,2));
  await browser.close();
})().catch(e=>{ console.error('FATAL', e); process.exit(1); });
