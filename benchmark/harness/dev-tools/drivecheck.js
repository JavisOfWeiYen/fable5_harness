'use strict';var fs=require('fs'),path=require('path'),vm=require('vm');
global.window=global;global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
var ROOT=path.resolve(__dirname,'..');
['constants.js','physics.js'].forEach(f=>vm.runInThisContext(fs.readFileSync(path.join(ROOT,f),'utf8'),{filename:f}));
var P=global.Physics,C=global.CONFIG,dt=C.dt;
function drive(car,input,secs){for(var i=0;i<secs/dt;i++)P.stepCar(car,input,dt,{surface:'track'});}
var car=P.createCar({id:0});car.heading=0;
drive(car,{throttle:1},3);console.log('after 3s full throttle: speed=',car.speed.toFixed(1),'m/s (',(car.speed*3.6).toFixed(0),'km/h)');
var v1=car.speed;drive(car,{brake:1},1);console.log('after 1s braking: speed=',car.speed.toFixed(1),'(was',v1.toFixed(1),') decreased='+(car.speed<v1));
var h0=car.heading;drive(car,{throttle:1,steer:1},1);console.log('after 1s steer right while accel: heading changed by',(car.heading-h0).toFixed(3),'rad');
// grass slows more
var g=P.createCar({id:1});g.vx=60;g.vy=0;g.heading=0;var gs=g.speed;P.stepCar(g,{throttle:0},dt,{surface:'grass'});
var t=P.createCar({id:2});t.vx=60;t.vy=0;t.heading=0;P.stepCar(t,{throttle:0},dt,{surface:'track'});
console.log('coast one tick @60: grass slowed to',g.vx.toFixed(3),'track to',t.vx.toFixed(3),'-> grass drags more='+(g.vx<t.vx));
// stopped car pulls away
var s=P.createCar({id:3});s.heading=0;drive(s,{throttle:1},0.5);console.log('stopped car after 0.5s throttle: speed=',s.speed.toFixed(1),'pulls away='+(s.speed>2));
