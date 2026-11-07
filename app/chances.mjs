export const HIGH_EPV=.10;
const numeric=v=>v!==''&&v!=null&&Number.isFinite(Number(v))?Number(v):null;
const epv=row=>Math.max(...['possession_epv_for_start','possession_epv_for_end','pass_reception_epv_for'].map(k=>numeric(row[k])??0));
export function identifyChances(rows,meta){
 const possessions=rows.filter(r=>r.event_type==='player_possession');
 const anchors=possessions.filter(r=>r.end_type==='shot').map(r=>({row:r,teamId:Number(r.team_id),goal:false}));
 // goal_for / goal_against explicitly confirm the outcome; lead_to_goal alone
 // describes an earlier action and must not generate a separate goal clip.
 for(const r of rows.filter(r=>['goal_for','goal_against'].includes(r.game_interruption_after))){
  const teamId=r.game_interruption_after==='goal_for'?Number(r.team_id):Number(r.team_id)===meta.home_team.id?meta.away_team.id:meta.home_team.id;
  const shot=anchors.find(a=>a.teamId===teamId&&a.row.period===r.period&&Math.abs(Number(a.row.frame_end)-Number(r.frame_end))<=50);
  if(shot)shot.goal=true;
  else if(!anchors.some(a=>a.goal&&a.teamId===teamId&&a.row.period===r.period&&Math.abs(Number(a.row.frame_end)-Number(r.frame_end))<=50))anchors.push({row:r,teamId,goal:true,goalOnly:true});
 }
 return anchors.map(({row:r,teamId,goal,goalOnly})=>{
  const period=Number(r.period),anchor=Number(r.frame_end),bounds=meta.match_periods.find(p=>p.period===period);
  if(!bounds||!Number.isFinite(anchor))return null;
  const start=Math.max(bounds.start_frame,anchor-200),end=Math.min(bounds.end_frame-1,anchor+80);
  const buildup=possessions.filter(p=>Number(p.period)===period&&Number(p.team_id)===teamId&&Number(p.frame_end)>=start&&Number(p.frame_end)<=anchor);
  const values=buildup.filter(p=>['possession_epv_for_start','possession_epv_for_end','pass_reception_epv_for'].some(k=>numeric(p[k])!=null));
  const peak=values.length?Math.max(...values.map(epv)):null;
  const team=teamId===meta.home_team.id?meta.home_team:meta.away_team;
  return {id:`${meta.id}:${period}:${r.event_id}`,matchId:meta.id,period,teamId,team:team.name,player:goalOnly?null:r.player_name,anchorFrame:anchor,startFrame:start,endFrame:end,count:end-start+1,time:r.time_end,outcome:goal?'goal':'shot',anchorType:goalOnly?'goal marker':'shot',peakEpv:peak,highDanger:goal||peak!=null&&peak>=HIGH_EPV,eventId:r.event_id,fullyExtrapolated:r.fully_extrapolated==='True'};
 }).filter(Boolean).sort((a,b)=>Number(b.outcome==='goal')-Number(a.outcome==='goal')||(b.peakEpv??-1)-(a.peakEpv??-1)||a.anchorFrame-b.anchorFrame);
}
