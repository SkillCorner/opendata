import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildPassing,haloBoundary,haloColour,MIN_RECEIVE_PROBABILITY} from '../public/passing.js';
import {passingData} from '../passing-data.mjs';
import {fileURLToPath} from 'node:url';
const settings=JSON.parse(await readFile(new URL('../../notebooks/fitted/pitch_control_settings.json',import.meta.url))).settings;
const meta={pitch_length:104,pitch_width:68,home_team:{id:1},away_team:{id:2},players:[{id:1,team_id:1},{id:2,team_id:1},{id:3,team_id:2}]};
const data={settings,physical:{1:{vmax:8,amax:5},2:{vmax:8,amax:5},3:{vmax:8,amax:5}},runs:[]};
const frame=(defender={x:8,y:20})=>({frame:10,period:1,ball_data:{x:0,y:0},possession:{player_id:1},player_data:[{player_id:1,x:0,y:0},{player_id:2,x:12,y:0},{player_id:3,...defender}]});
test('specific receiver, excluded carrier, interceptions and unreachable destinations',()=>{
 const f=frame(),clear=buildPassing(f,null,null,meta,data),blocked=buildPassing(frame({x:6,y:0}),null,null,meta,data),q={x:12,y:0};
 assert.deepEqual(clear.receivers.map(p=>p.player_id),[2]);
 assert.ok(clear.at(clear.receivers[0],q)>.8);
 assert.ok(blocked.at(blocked.receivers[0],q)<clear.at(clear.receivers[0],q));
 assert.ok(clear.at(clear.receivers[0],{x:-10,y:30})<MIN_RECEIVE_PROBABILITY);
 assert.equal(haloColour(.049999),null);assert.ok(haloColour(.05));assert.deepEqual(haloColour(1),[0,255,0,209]);
});
test('receiver motion changes reach and unknown possession produces no halo',()=>{
 const f=frame(),before=structuredClone(f),after=structuredClone(f);before.frame=8;after.frame=12;before.player_data[1].x=11;after.player_data[1].x=13;
 const moving=buildPassing(f,before,after,meta,data),standing=buildPassing(f,null,null,meta,data),q={x:17,y:0};
 assert.ok(moving.at(moving.receivers[0],q)>standing.at(standing.receivers[0],q));
 f.possession={};assert.equal(buildPassing(f,null,null,meta,data).receivers.length,0);
});
test('real match physical data, runs and fitted settings feed a bounded grid',async()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),demo=JSON.parse(await readFile(new URL('../public/demo.json',import.meta.url)));
 const model=await passingData(root,demo.metadata.id,demo.metadata);
 assert.deepEqual(model.settings,settings);assert.ok(model.runs.length);
 assert.ok(Object.values(model.physical).every(p=>p.vmax>0&&p.amax>=3&&p.amax<=7));
 const f=demo.frames.find(f=>f.possession?.player_id!=null),overlay=buildPassing(f,null,null,demo.metadata,model);
 assert.equal(overlay.reason,null);const grid=overlay.grid(2);
 assert.ok(grid.values.some(p=>p>0));assert.ok(grid.values.every(p=>p===0||p>=MIN_RECEIVE_PROBABILITY&&p<=1));
});

test('halo outlines follow individual masks without drawing internal cell edges',()=>{
 assert.equal(haloBoundary(new Uint8Array([1]),1,1).length,4);
 assert.equal(haloBoundary(new Uint8Array([1,1]),2,1).length,6);
 assert.equal(haloBoundary(new Uint8Array([0,0]),2,1).length,0);
 const ring=new Uint8Array([1,1,1,1,0,1,1,1,1]);
 assert.equal(haloBoundary(ring,3,3).length,16,'include the inner interception hole');
});
