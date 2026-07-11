'use strict';var fs=require('fs'),path=require('path'),vm=require('vm');
global.window=global;global.addEventListener=function(){};var _s={};
global.localStorage={getItem:k=>_s[k]==null?null:_s[k],setItem:(k,v)=>{_s[k]=String(v);},removeItem:k=>{delete _s[k];}};
function noopCtx(){return new Proxy({},{get:(t,p)=>{if(p==='canvas')return{width:960,height:600};if(p==='setLineDash')return function(){};return function(){};}});}
function fakeEl(id){return {id:id,style:{},textContent:'',innerHTML:'',value:'Normal',clientWidth:200,clientHeight:140,
  getContext:()=>noopCtx(),getBoundingClientRect:()=>({width:960,height:600}),
  addEventListener:function(){},appendChild:function(){},removeChild:function(){},click:function(){}};}
var els={};
global.document={
  getElementById:function(id){if(!els[id])els[id]=fakeEl(id);return els[id];},
  createElement:()=>fakeEl('a'),body:fakeEl('body'),addEventListener:function(){},activeElement:null,readyState:'complete'};
var frameCbs=[];global.requestAnimationFrame=function(cb){frameCbs.push(cb);return frameCbs.length;};
global.cancelAnimationFrame=function(){};global.performance={now:()=>global.__t||0};global.devicePixelRatio=1;
global.Blob=function(){};global.URL={createObjectURL:()=>'blob:x',revokeObjectURL:function(){}};
var ROOT=path.resolve(__dirname,'..');
['constants.js','physics.js','track.js','ai.js','race.js','storage.js','game.js'].forEach(f=>vm.runInThisContext(fs.readFileSync(path.join(ROOT,f),'utf8'),{filename:f}));
console.log('Game.init() ->', global.Game.init());
global.Game.startRace(true); // demo so no key input needed
// pump the RAF loop manually for ~15 simulated seconds
global.__t=0;var frames=0;
while(frames<900){var cb=frameCbs.shift();if(!cb)break;global.__t+=16.7;try{cb(global.__t);}catch(e){console.log('FRAME ERROR at frame',frames,e.stack);process.exit(1);}frames++;}
var R=global.Game.getRace();
console.log('pumped',frames,'frames; phase=',R.phase,'clock=',R.clock.toFixed(1),'car0 lap',R.cars[0].lap,'prog',R.cars[0].progress.toFixed(2),'speed',R.cars[0].speed.toFixed(0));
console.log('HUD speed text:',els.hudSpeed.textContent,'| pos:',els.hudPos.textContent,'| status:',els.hudStatus.textContent);
console.log('telemetry samples:',global.Storage.getTelemetry().length);
// pause + camera toggle + restart should not throw
global.Game.togglePause();global.Game.toggleCamera();global.Game.restart();
console.log('togglePause/toggleCamera/restart OK; no exceptions');
console.log('SMOKE OK');
