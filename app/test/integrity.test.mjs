import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildIntegrity,assignment} from '../public/integrity.js';
import {PassPlayback} from '../public/pass-playback.js';
const settings=JSON.parse(await readFile(new URL('../../notebooks/fitted/pitch_control_settings.json',import.meta.url))).settings;
const valueModel=JSON.parse(await readFile(new URL('../../notebooks/fitted/value_model.json',import.meta.url)));
const meta={pitch_length:104,pitch_width:68,home_team:{id:1},away_team:{id:2},home_team_side:['left_to_right','right_to_left'],players:[{id:1,team_id:1,short_name:'Carrier'},{id:2,team_id:1,short_name:'Receiver'},{id:3,team_id:2,short_name:'Defender'}]};
const data={settings,valueModel,physical:{1:{vmax:8,amax:5},2:{vmax:8,amax:5},3:{vmax:8,amax:5}},runs:[],options:[],passes:[]};
const frame={frame:10,period:1,ball_data:{x:0,y:0},possession:{player_id:1},player_data:[{player_id:1,x:0,y:0},{player_id:2,x:12,y:0},{player_id:3,x:8,y:20}]};
test('matches independent Python evaluation of the notebook equations',async()=>{
 const reference=JSON.parse(await readFile(new URL('./notebook-reference.json',import.meta.url)));
 const model=buildIntegrity(frame,null,null,meta,data);
 for(const q of reference){const actual=model.evaluate(q);for(const key of ['control','success','value','gain'])assert.ok(Math.abs(actual[key]-q[key])<1e-12,`${key} at ${q.x},${q.y}`);}
});
test('notebook arrival, control, pass success and context value combine into risk-adjusted gain',()=>{
 const model=buildIntegrity(frame,null,null,meta,data),q={x:12,y:0},r=model.evaluate(q);
 const opposite=model.location({x:-q.x,y:-q.y});
 assert.ok(r.control>.99);assert.ok(r.success>.99);
 assert.equal(r.gain,r.success*r.value-(1-r.success)*opposite-model.ballValue);
 assert.ok(r.value>0&&r.value!==model.location(q),'defensive context changes location value');
 const mirrored=structuredClone(frame);mirrored.period=2;for(const p of mirrored.player_data){p.x=-p.x;p.y=-p.y;}
 const reverse=buildIntegrity(mirrored,null,null,meta,data).evaluate({x:-q.x,y:-q.y});
 for(const key of ['control','success','gain','value'])assert.ok(Math.abs(r[key]-reverse[key])<1e-12,key+' must be invariant under stadium reversal');
});
test('recommendations deduplicate receiver annotations and respect the carrier exclusion',()=>{
 const model=buildIntegrity(frame,null,null,meta,{...data,options:[{possession:'p',player_id:2},{possession:'p',player_id:2},{possession:'p',player_id:1}]});
 const rec=model.recommendations({id:'p'});assert.equal(rec.options.length,1);assert.equal(rec.options[0].player_id,2);assert.ok(Number.isFinite(rec.options[0].gain));
});
test('assignment is optimal and never double-marks an attacker',()=>{
 const cost=[[10,1,8],[2,10,7],[9,8,1]],pairs=assignment(cost);
 assert.equal(pairs.reduce((s,[r,c])=>s+cost[r][c],0),4);
 assert.equal(new Set(pairs.map(p=>p[1])).size,3);
 assert.equal(assignment([[1,2,3]]).length,1);assert.equal(assignment([[1],[2],[3]]).length,1);
});
test('preview pause is one second regardless of speed, and completion is drawn before hiding',()=>{
 const frames=Array.from({length:40},(_,i)=>({frame:i,period:1})),passes=[{id:'a',release:10,complete:20,period:1}],p=new PassPlayback();
 assert.equal(p.advance(0,15,frames,passes,100).index,10);
 assert.equal(p.advance(10,30,frames,passes,1099).waiting,true);
 assert.equal(p.advance(10,30,frames,passes,1100).index,20);
 assert.equal(p.active.id,'a','keep recommendations through completion');
 assert.equal(p.advance(20,25,frames,passes,1200).event,null);
 p.seek(25,1,passes);assert.equal(p.advance(25,30,frames,passes,1300).event,null);
 p.reset();assert.equal(p.advance(0,10,frames,passes,2000).waiting,true);
});
