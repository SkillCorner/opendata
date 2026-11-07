import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {parseCsv} from './csv.mjs';

const median=a=>{a=a.filter(Number.isFinite).sort((x,y)=>x-y);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
export async function passingData(root,id,meta){
 const [settingsText,physicalText,eventText,valueText]=await Promise.all([
  readFile(path.join(root,'notebooks/fitted/pitch_control_settings.json'),'utf8'),
  readFile(path.join(root,'data/aggregates/aus1league_physicalaggregates_20242025.csv'),'utf8'),
  readFile(path.join(root,`data/matches/${id}/${id}_dynamic_events.csv`),'utf8'),
  readFile(path.join(root,'notebooks/fitted/value_model.json'),'utf8')]);
 const rows=parseCsv(physicalText),fields=['psv99','timetosprint_top3'];
 const byId=new Map();
 for(const r of rows){if(!byId.has(+r.player_id))byId.set(+r.player_id,[]);byId.get(+r.player_id).push(r);}
 const averages=new Map([...byId].map(([id,rs])=>[id,Object.fromEntries(fields.map(k=>[k,mean(rs.filter(r=>r[k]!==''&&Number.isFinite(+r[k])).map(r=>+r[k]))]))]));
 const players=meta.players.map(p=>({...p,...averages.get(p.id)}));
 const physical=Object.fromEntries(players.map(p=>{
  const values=fields.map(k=>p[k]??median(players.filter(q=>q.player_role.position_group===p.player_role.position_group).map(q=>q[k]))??median([...averages.values()].map(q=>q[k])));
  return [p.id,{vmax:values[0]/3.6,amax:Math.max(3,Math.min(7,(25/3.6)/values[1]))}];
 }));
 const events=parseCsv(eventText);
 const runs=events.filter(r=>r.event_type==='off_ball_run').map(r=>({id:r.event_id,player_id:+r.player_id,start:+r.frame_start,end:+r.frame_end,x:+r.x_end,y:+r.y_end,side:r.attacking_side}));
 const possessions=events.filter(r=>r.event_type==='player_possession').sort((a,b)=>+a.frame_start-+b.frame_start);
 const options=events.filter(r=>r.event_type==='passing_option'&&(r.passing_option_at_pass_moment==='True'||r.targeted==='True')).map(r=>({possession:r.associated_player_possession_event_id,player_id:+r.player_id,name:r.player_name,targeted:r.targeted==='True',run:r.associated_off_ball_run_event_id}));
 const passes=possessions.flatMap((r,i)=>r.end_type==='pass'?[{id:r.event_id,release:+r.frame_end,complete:+(possessions[i+1]?.frame_start??r.frame_end),period:+r.period,team:+r.team_id,carrier:+r.player_id,side:r.attacking_side,outcome:r.pass_outcome}]:[]);
 return {settings:JSON.parse(settingsText).settings,valueModel:JSON.parse(valueText),physical,runs,options,passes};
}
