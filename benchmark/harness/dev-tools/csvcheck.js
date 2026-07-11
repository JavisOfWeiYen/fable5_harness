'use strict';var fs=require('fs'),path=require('path'),vm=require('vm');
global.window=global;global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
var ROOT=path.resolve(__dirname,'..');
['constants.js','physics.js','track.js','ai.js','race.js','storage.js'].forEach(f=>vm.runInThisContext(fs.readFileSync(path.join(ROOT,f),'utf8'),{filename:f}));
var S=global.Storage,P=global.Physics,C=global.CONFIG;
S.resetTelemetry();
var car=P.createCar({id:0});car.x=100;car.y=200;car.vx=30;car.speed=30;car.drsOpen=true;
var t=0;for(var i=0;i<20;i++){S.sampleTelemetry(t,car,{throttle:1,brake:0,steer:0.2},true);t+=C.telemetry.sampleInterval;}
var csv=S.telemetryToCSV();var lines=csv.split('\n');
console.log('header:',lines[0]);
console.log('expected cols:',S.TELEMETRY_COLUMNS.length,'  header cols:',lines[0].split(',').length);
console.log('data rows:',lines.length-1,' sample row:',lines[1]);
console.log('row col count matches header:',lines[1].split(',').length===S.TELEMETRY_COLUMNS.length);
