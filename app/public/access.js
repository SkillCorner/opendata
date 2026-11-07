import {inside} from './geometry.js';
// A transparent 5-second direct-route accessibility index, not a completion probability.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const clamp=x=>Math.max(0,Math.min(1,x));
const logistic=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
export function accessColour(score){return score==null?'#8d969d':`hsl(${Math.round(clamp(score)*150)} 72% 55%)`;}
export function buildAccess(frame,previous,meta){
 const roster=new Map(meta.players.map(p=>[p.id,p]));
 const old=new Map((previous?.player_data??[]).map(p=>[p.player_id,p]));
 const dt=previous?.period===frame.period?(frame.frame-previous.frame)/10:0;
 const players=(frame.player_data??[]).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&roster.has(p.player_id)).map(p=>{
  const prior=old.get(p.player_id);let vx=dt>0&&dt<=.5&&prior&&Number.isFinite(prior.x)&&Number.isFinite(prior.y)?(p.x-prior.x)/dt:0,vy=dt>0&&dt<=.5&&prior&&Number.isFinite(prior.x)&&Number.isFinite(prior.y)?(p.y-prior.y)/dt:0;
  const speed=Math.hypot(vx,vy);if(speed>9){vx*=9/speed;vy*=9/speed;}
  return {...p,team:roster.get(p.player_id).team_id,name:roster.get(p.player_id).short_name??String(p.player_id),vx,vy};
 });
 const ball=frame.ball_data;
 const named=players.find(p=>p.player_id===frame.possession?.player_id);
 const team=named?.team??(frame.possession?.group==='home team'?meta.home_team.id:frame.possession?.group==='away team'?meta.away_team.id:null);
 const friends=players.filter(p=>p.team===team),opponents=players.filter(p=>p.team!==team);
 const carrier=ball&&Number.isFinite(ball.x)&&Number.isFinite(ball.y)?friends.filter(p=>distance(p,ball)<=3).sort((a,b)=>distance(a,ball)-distance(b,ball))[0]:null;
 const reason=!ball||!Number.isFinite(ball.x)||!Number.isFinite(ball.y)?'Ball position unavailable':team==null?'Possession team unknown':!carrier?'No controlled ball carrier within 3 m':ball.z>1.5?'Ball airborne':!opponents.length?'Opponent positions unavailable':null;
 const unavailable={score:null,pass:null,carry:null,route:'unavailable',reason};
 const arrival=(p,q)=>.25+Math.hypot(q.x-p.x-.25*p.vx,q.y-p.y-.25*p.vy)/6;
 const opponentTime=q=>Math.min(...opponents.map(p=>arrival(p,q)));
 const inPitch=q=>Number.isFinite(q.x)&&Number.isFinite(q.y)&&Math.abs(q.x)<=meta.pitch_length/2&&Math.abs(q.y)<=meta.pitch_width/2;
 function at(q){
  if(reason)return {...unavailable};
  if(!inPitch(q))return {...unavailable,reason:'Target outside pitch'};
  const d=distance(ball,q),passTime=.2+d/15,carryTime=d/4;
  let pass=0,carry=0;
  const receivers=friends.filter(p=>p.player_id!==carrier.player_id);
  if(passTime<=5&&receivers.length){
   const receiver=receivers.reduce((best,p)=>arrival(p,q)<arrival(best,q)?p:best);
   let lane=1;for(const fraction of [.1,.25,.4,.6,.8,1]){const sample={x:ball.x+(q.x-ball.x)*fraction,y:ball.y+(q.y-ball.y)*fraction};lane=Math.min(lane,logistic((opponentTime(sample)-(.2+d*fraction/15))/.35));}
   pass=lane*logistic((passTime+.75-arrival(receiver,q))/.4)*Math.exp(-passTime/12);
  }
  if(carryTime<=5){let safety=1;for(const fraction of [.1,.25,.4,.6,.8,1]){const sample={x:ball.x+(q.x-ball.x)*fraction,y:ball.y+(q.y-ball.y)*fraction};safety=Math.min(safety,logistic((opponentTime(sample)-carryTime*fraction)/.4));}carry=safety*Math.exp(-carryTime/8);}
  return {score:clamp(Math.max(pass,carry)),pass:clamp(pass),carry:clamp(carry),route:pass===0&&carry===0?'no direct route within 5 s':pass>carry?'pass':'carry',seconds:pass===0&&carry===0?null:pass>carry?passTime:carryTime,reason:null};
 }
 function triangle(vs){
  if(reason)return {...unavailable};
  if(inside(ball,...vs))return {score:1,pass:null,carry:null,route:'already here',seconds:0,reason:null};
  const targets=[[1/3,1/3,1/3],[.6,.2,.2],[.2,.6,.2],[.2,.2,.6]].map(weights=>({x:vs.reduce((s,p,i)=>s+p.x*weights[i],0),y:vs.reduce((s,p,i)=>s+p.y*weights[i],0)}));
  const candidates=targets.map(target=>({...at(target),target})).filter(x=>x.score!=null);
  return candidates.length?candidates.reduce((a,b)=>a.score>=b.score?a:b):{...unavailable,reason:'Tile targets outside pitch'};
 }
 return {at,triangle,team,carrier:carrier?.name??null,reason,horizon:5,estimated:players.some(p=>!p.is_detected)||!ball?.is_detected};
}
