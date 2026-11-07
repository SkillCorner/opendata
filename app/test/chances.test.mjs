import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseCsv} from '../csv.mjs';
import {identifyChances} from '../chances.mjs';
test('quoted CSV fields preserve column alignment',()=>{assert.deepEqual(parseCsv('a,b\n"hello, world","a""b"\n'),[{a:'hello, world',b:'a"b'}]);});
test('chance anchors use shots and goal confirmations, not build-up outcome flags',()=>{
 const meta={id:1,home_team:{id:10,name:'Home'},away_team:{id:20,name:'Away'},match_periods:[{period:1,start_frame:10,end_frame:1000}]};
 const rows=[{event_id:'pass',event_type:'player_possession',team_id:'10',period:'1',frame_end:'40',lead_to_goal:'True',possession_epv_for_end:'.2'},
 {event_id:'shot',event_type:'player_possession',team_id:'10',period:'1',frame_end:'100',end_type:'shot'},
 {event_id:'defender',event_type:'on_ball_engagement',team_id:'20',period:'1',frame_end:'100',game_interruption_after:'goal_against'}];
 const c=identifyChances(rows,meta);assert.equal(c.length,1);assert.equal(c[0].outcome,'goal');assert.equal(c[0].startFrame,10);assert.equal(c[0].endFrame,180);assert.equal(c[0].peakEpv,.2);assert.equal(c[0].anchorFrame,100);
});
test('precomputed catalogue is bounded, reproducible and includes all shot anchors',async()=>{
 const catalogue=JSON.parse(await readFile(new URL('../chance-catalogue.json',import.meta.url),'utf8'));assert.equal(Object.keys(catalogue.matches).length,20);
 for(const [id,chances] of Object.entries(catalogue.matches)){
 const meta=JSON.parse(await readFile(new URL(`../../data/matches/${id}/${id}_match.json`,import.meta.url),'utf8'));
 const events=parseCsv(await readFile(new URL(`../../data/matches/${id}/${id}_dynamic_events.csv`,import.meta.url),'utf8'));
 assert.deepEqual(chances,identifyChances(events,meta));
 const shotIds=events.filter(r=>r.event_type==='player_possession'&&r.end_type==='shot').map(r=>r.event_id);
 for(const eventId of shotIds)assert.ok(chances.some(c=>c.eventId===eventId));
 assert.equal(new Set(chances.map(c=>c.id)).size,chances.length);
 for(const c of chances){assert.ok(c.startFrame<=c.anchorFrame&&c.endFrame>=c.anchorFrame);assert.ok(c.count>0&&c.count<=600);const p=meta.match_periods.find(p=>p.period===c.period);assert.ok(c.startFrame>=p.start_frame&&c.endFrame<p.end_frame);assert.equal(c.highDanger,c.outcome==='goal'||c.peakEpv!=null&&c.peakEpv>=.1);}
 }
});
