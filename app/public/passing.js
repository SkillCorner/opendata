// Receiver-specific extension of defensive_shape_integrity.ipynb's fitted value_points.
// The extra arrival gate localises each halo: winning a race is insufficient if
// neither side can reach the pass. This continuous surface is not separately fitted.
export const MIN_RECEIVE_PROBABILITY=0.02; // 2%.
const sig=x=>1/(1+Math.exp(-x));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function haloColour(p){
 if(!Number.isFinite(p)||p<MIN_RECEIVE_PROBABILITY)return null;
 const t=Math.max(0,Math.min(1,p));
 return [Math.round(245*(1-t)),Math.round(250+5*t),Math.round(245*(1-t)),Math.round(255*(.24+.58*t))];
}
// Keep individual boundaries even where teammates' receiving areas overlap.
export function haloBoundary(mask,width,height){
 const edges=[];
 const on=(x,y)=>x>=0&&x<width&&y>=0&&y<height&&mask[y*width+x];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(on(x,y)){
  if(!on(x,y-1))edges.push([x,y,x+1,y]);
  if(!on(x+1,y))edges.push([x+1,y,x+1,y+1]);
  if(!on(x,y+1))edges.push([x+1,y+1,x,y+1]);
  if(!on(x-1,y))edges.push([x,y+1,x,y]);
 }
 return edges;
}
export function buildPassing(frame,before,after,meta,data){
 const empty=reason=>({reason,receivers:[],at:()=>0});
 if(!data)return empty('Receiving model unavailable');
 const ball=frame.ball_data;
 if(!ball||!Number.isFinite(ball.x)||!Number.isFinite(ball.y))return empty('Ball position unavailable');
 const roster=new Map(meta.players.map(p=>[p.id,p]));
 const raw=(frame.player_data??[]).filter(p=>roster.has(p.player_id)&&Number.isFinite(p.x)&&Number.isFinite(p.y));
 const carrier=raw.find(p=>p.player_id===frame.possession?.player_id);
 const team=carrier?roster.get(carrier.player_id).team_id:frame.possession?.group==='home team'?meta.home_team.id:frame.possession?.group==='away team'?meta.away_team.id:null;
 if(team==null)return empty('Receiving halos need known possession');
 // Team-only possession: exclude the closest teammate as the estimated carrier.
 const carrierId=carrier?.player_id??raw.filter(p=>roster.get(p.player_id).team_id===team).sort((a,b)=>dist(a,ball)-dist(b,ball))[0]?.player_id;
 const valid=f=>f&&f.period===frame.period&&Math.abs(f.frame-frame.frame)<=2;
 const lo=valid(before)?before:frame,hi=valid(after)?after:frame;
 const prev=new Map(lo.player_data.map(p=>[p.player_id,p])),next=new Map(hi.player_data.map(p=>[p.player_id,p]));
 const dt=(hi.frame-lo.frame)/10,s=data.settings,k=Math.PI/(Math.sqrt(3)*s.SIGMA);
 const players=raw.map(p=>{
  const a=prev.get(p.player_id)??p,b=next.get(p.player_id)??p;
  const vx=dt>0?(b.x-a.x)/dt:0,vy=dt>0?(b.y-a.y)/dt:0;
  const moving=Math.hypot(vx,vy)>1.5;
  return {...p,...data.physical[p.player_id],team:roster.get(p.player_id).team_id,vx,vy,fx:moving?vx:ball.x-p.x,fy:moving?vy:ball.y-p.y};
 });
 if(players.some(p=>!Number.isFinite(p.vmax)||!Number.isFinite(p.amax)))return empty('Player physical profiles unavailable');
 const defenders=players.filter(p=>p.team!==team),receivers=players.filter(p=>p.team===team&&p.player_id!==carrierId);
 if(!defenders.length)return empty('Defender positions unavailable');
 function arrival(p,q){
  const dx=q.x-p.x-p.vx*s.T_REACT,dy=q.y-p.y-p.vy*s.T_REACT,d=Math.hypot(dx,dy),a=p.amax*s.ACC_SCALE;
  const da=p.vmax*p.vmax/(2*a);
  const run=d<da?Math.sqrt(2*d/a):p.vmax/a+(d-da)/p.vmax;
  const cosine=(dx*p.fx+dy*p.fy)/(d*Math.hypot(p.fx,p.fy)+1e-9);
  return s.T_REACT+run+(d>1?Math.acos(Math.max(-1,Math.min(1,cosine)))/s.OMEGA:0);
 }
 const activeRuns=new Map((data.runs??[]).filter(r=>r.start<=frame.frame&&r.end>frame.frame).map(r=>[r.player_id,r]));
 function projected(p,t){
  const run=activeRuns.get(p.player_id);
  let x=p.x,y=p.y;
  if(run){const flip=run.side==='right_to_left'?-1:1,f=Math.min(1,t/Math.max(.1,(run.end-frame.frame)/10));x+=(flip*run.x-p.x)*f;y+=(flip*run.y-p.y)*f;}
  else if(Math.hypot(p.vx,p.vy)>2){x+=p.vx*Math.min(t,2);y+=p.vy*Math.min(t,2);}
  return {x:Math.max(-meta.pitch_length/2,Math.min(meta.pitch_length/2,x)),y:Math.max(-meta.pitch_width/2,Math.min(meta.pitch_width/2,y))};
 }
 const eff=(t,tb)=>Math.max(t,tb)+s.TIE_BREAK*t;
 function at(p,q,precomputed){
  const d=dist(ball,q),tb=d/s.V_BALL;
  const td=precomputed?.td??Math.min(...defenders.map(o=>arrival(o,q)));
  const rawTime=arrival(p,q),project=projected(p,tb);
  // Credit the measured run only near its projected destination. Never grant an
  // arbitrary halo cell the receiver's on-time arrival at a different location.
  const runTime=tb+dist(project,q)/p.vmax;
  const tr=(!activeRuns.has(p.player_id)&&Math.hypot(p.vx,p.vy)<=2)?rawTime:Math.min(rawTime,runTime+(1-s.RUN_CREDIT)*Math.max(0,rawTime-runTime));
  let intercept=precomputed?.intercept;
  if(intercept==null){intercept=0;for(let j=0;j<8;j++){const f=.15+j*(.9-.15)/7,dp=d*f;if(dp<=2)continue;const pt={x:ball.x+(q.x-ball.x)*f,y:ball.y+(q.y-ball.y)*f};intercept=Math.max(intercept,sig(k*(dp/s.V_BALL-Math.min(...defenders.map(o=>arrival(o,pt))))));}}
  const race=t=>sig(k*(eff(td,t)-eff(tr,t)));
  const ready=t=>sig(k*(t-tr));
  const ground=(1-intercept)*race(tb)*ready(tb);
  const tl=d/s.V_LOFT+s.T_HANG;
  const loft=d>15?s.LOFT_CONTROL*race(tl)*ready(tl):0;
  return Math.max(ground,loft);
 }
 // One shared defender/interception calculation per cell, rather than per player.
 function grid(step=1){
  const width=Math.ceil(meta.pitch_length/step),height=Math.ceil(meta.pitch_width/step),values=new Float32Array(width*height),masks=receivers.map(()=>new Uint8Array(width*height));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const q={x:-meta.pitch_length/2+(x+.5)*step,y:meta.pitch_width/2-(y+.5)*step},d=dist(ball,q);
   const td=Math.min(...defenders.map(o=>arrival(o,q)));let intercept=0;
   for(let j=0;j<8;j++){const f=.15+j*.75/7;if(d*f<=2)continue;const pt={x:ball.x+(q.x-ball.x)*f,y:ball.y+(q.y-ball.y)*f};intercept=Math.max(intercept,sig(k*(d*f/s.V_BALL-Math.min(...defenders.map(o=>arrival(o,pt))))));}
   let best=0;for(let r=0;r<receivers.length;r++){const probability=at(receivers[r],q,{td,intercept});best=Math.max(best,probability);if(probability>=MIN_RECEIVE_PROBABILITY)masks[r][y*width+x]=1;}
   if(best>=MIN_RECEIVE_PROBABILITY)values[y*width+x]=best;
  }
  return {width,height,values,outlines:masks.map(mask=>haloBoundary(mask,width,height))};
 }
 return {reason:null,receivers,at,grid,projected,carrierId};
}
