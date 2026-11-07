import {test,after} from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
const {server}=await import('../server.mjs');
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
after(()=>new Promise(resolve=>server.close(resolve)));
const base=`http://127.0.0.1:${server.address().port}`;
test('chance API and bounded clip stream preserve exact interval across gaps',async()=>{
 const catalogue=await(await fetch(base+'/api/matches/1886347/chances')).json();assert.equal(catalogue.chances.length,27);assert.ok(catalogue.chances.some(c=>c.outcome==='goal'));
 const realFetch=globalThis.fetch;
 try{globalThis.fetch=(url,...args)=>String(url).startsWith('https://media.githubusercontent.com/')?Promise.resolve(new Response([10,11,15,20,21].map(frame=>JSON.stringify({frame,period:frame>=20?2:1,timestamp:'00:00:01.00',player_data:[]})).join('\n')+'\n')):realFetch(url,...args);
 const r=await realFetch(base+'/api/matches/1886347/clip?start=10&end=20&period=1&count=11');assert.equal(r.status,200);const frames=await r.json();assert.deepEqual(frames.map(f=>f.frame),[10,11,15]);
 }finally{globalThis.fetch=realFetch;}
 assert.equal((await fetch(base+'/api/matches/1886347/clip?start=100&end=99')).status,400);
});
test('deployment health, static app, demo and match catalogue',async()=>{for(const p of ['/health','/','/client.js','/geometry.js','/danger.js','/access.js','/possession.js','/passing.js','/d3-delaunay.min.js','/demo.json'])assert.equal((await fetch(base+p)).status,200,p);const matches=await (await fetch(base+'/api/matches')).json();assert.equal(matches.length,20);const m=await(await fetch(base+'/api/matches/1886347/metadata')).json();assert.equal(m.pitch_length,104);const phases=await(await fetch(base+'/api/matches/1886347/phases')).json();assert.equal(phases[0].frame_start,'28');});
test('reject unknown matches, invalid bounds and arbitrary file paths',async()=>{for(const p of ['/api/matches/1/metadata','/package.json'])assert.equal((await fetch(base+p)).status,404);assert.equal((await fetch(base+'/api/matches/1886347/clip?count=999999')).status,400);});

test("passing API supplies fitted settings, physical profiles and runs",async()=>{const r=await fetch(base+"/api/matches/1886347/passing");assert.equal(r.status,200);const d=await r.json();assert.ok(d.settings.RUN_CREDIT>0&&d.settings.RUN_CREDIT<1);assert.ok(d.runs.length);assert.ok(Object.values(d.physical).every(p=>p.vmax>0&&p.amax>=3));});
