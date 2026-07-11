'use strict';
var fs=require('fs'),path=require('path'),vm=require('vm');
global.window=global;var _s={};global.localStorage={getItem:k=>_s[k]==null?null:_s[k],setItem:(k,v)=>{_s[k]=String(v);},removeItem:k=>{delete _s[k];}};
global.document={getElementById:()=>null,addEventListener:()=>{},readyState:'complete',createElement:()=>({style:{},click(){},appendChild(){}}),body:{appendChild(){},removeChild(){}}};
global.requestAnimationFrame=()=>{};global.performance={now:()=>Date.now()};
var ROOT=path.resolve(__dirname,'..');
['constants.js','physics.js','track.js','ai.js','race.js','storage.js'].forEach(f=>vm.runInThisContext(fs.readFileSync(path.join(ROOT,f),'utf8'),{filename:f}));
var Track=global.Track,Race=global.Race,CONFIG=global.CONFIG;
var R=Race.createRace({demo:true,difficulty:'Hard'});
var i=0;while(R.phase!=='racing'&&i<5000){Race.update(R,CONFIG.dt);i++;}
var pitTicks={},serviced={},penalty={};R.cars.forEach(c=>{pitTicks[c.id]=0;});
var maxTicks=Math.round(400/CONFIG.dt);var tk=0;
while(R.phase!=='finished'&&tk<maxTicks){Race.update(R,CONFIG.dt);tk++;R.cars.forEach(c=>{if(Track.surfaceAt(c.x,c.y)==='pit')pitTicks[c.id]++;if(c._pitDone)serviced[c.id]=true;penalty[c.id]=c.penaltyTime;});}
console.log('race ended phase',R.phase,'after',(tk*CONFIG.dt).toFixed(1),'s sim');
R.cars.forEach(c=>console.log('  ',c.abbr,'lap',c.lap,'finished',c.finished,'pitTicks',pitTicks[c.id],'serviced',!!serviced[c.id],'penalty',c.penaltyTime,'finishTime',c.finishTime.toFixed(2),'pos',c.position));
console.log('classification:',R.classification.map(c=>c.position+':'+c.abbr).join('  '));
