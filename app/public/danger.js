// Transparent spatial EPV proxy, not a fitted/calibrated goal probability.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const sigmoid=x=>1/(1+Math.exp(-clamp(x,-30,30)));
export function teamScaleColour(team,meta,period){
 const homeDirection=meta.home_team_side?.[Number(period)-1];
 if(!['left_to_right','right_to_left'].includes(homeDirection))return '#b5bdc5';
 const leftId=homeDirection==='left_to_right'?meta.home_team.id:meta.away_team.id;
 if(team!==meta.home_team.id&&team!==meta.away_team.id)return '#b5bdc5';
 return team===leftId?'#2a7eff':'#f4444e';
}
// Fixed log contrast: raw values retain their original [-1,1] meaning.
// Never normalize by this frame's extrema (which would exaggerate quiet frames).
export function dangerColour(value){if(value==null||!Number.isFinite(value))return '#b5bdc5';const t=Math.log1p(Math.abs(clamp(value,-1,1))*10000)/Math.log1p(10000),end=value<0?[42,126,255]:[244,68,78];return `rgb(${end.map((c,i)=>Math.round([236,238,241][i]+(c-[236,238,241][i])*t)).join(',')})`;}
export function buildDanger(frame,previous,meta){
 const direction=meta.home_team_side?.[Number(frame.period)-1];
 const left=direction==='left_to_right'?meta.home_team:direction==='right_to_left'?meta.away_team:null;
 const right=left?(left.id===meta.home_team.id?meta.away_team:meta.home_team):null;
 const ball=frame.ball_data;
 const validBall=ball&&Number.isFinite(ball.x)&&Number.isFinite(ball.y);
 const roster=new Map(meta.players.map(p=>[p.id,p.team_id]));
 const prior=new Map((previous?.player_data??[]).map(p=>[p.player_id,p]));
 const dt=previous&&previous.period===frame.period?(frame.frame-previous.frame)/10:0;
 const players=(frame.player_data??[]).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&roster.has(p.player_id)).map(p=>{const old=prior.get(p.player_id);let vx=dt>0&&dt<=.5&&old?(p.x-old.x)/dt:0,vy=dt>0&&dt<=.5&&old?(p.y-old.y)/dt:0;const speed=Math.hypot(vx,vy);if(speed>9){vx*=9/speed;vy*=9/speed;}return {...p,team:roster.get(p.player_id),vx,vy};});
 const ready=!!left&&validBall&&players.some(p=>p.team===left.id)&&players.some(p=>p.team===right.id);
 const arrival=(p,q)=>.7+Math.hypot(q.x-p.x-p.vx*.7,q.y-p.y-p.vy*.7)/5;
 const reach=(team,q)=>Math.min(...players.filter(p=>p.team===team).map(p=>arrival(p,q)));
 const control=(team,q)=>sigmoid((reach(team===left.id?right.id:left.id,q)-reach(team,q))/.5);
 // Distance, visible goal angle and nearby defensive pressure determine spatial value.
 const value=(team,q)=>{const gx=team===left.id?meta.pitch_length/2:-meta.pitch_length/2,dx=Math.abs(gx-q.x),dy=q.y;
 const angle=Math.atan2(7.32*dx,dx*dx+dy*dy-3.66**2);
 const pressure=players.filter(p=>p.team!==team).reduce((s,p)=>s+Math.exp(-distance(p,q)/3),0);
 return clamp(Math.exp(-Math.hypot(dx,dy)/24)*clamp(angle/(Math.PI/3),.05,1)/(1+.5*pressure),0,1);};
 let possession=null,confidence=0;
 const carrier=players.find(p=>p.player_id===frame.possession?.player_id);
 if(carrier){possession=carrier.team;confidence=1;}
 else if(frame.possession?.group==='home team'){possession=meta.home_team.id;confidence=1;}
 else if(frame.possession?.group==='away team'){possession=meta.away_team.id;confidence=1;}
 // Unknown possession stays unknown; proximity is not asserted as possession.
 const share=team=>possession==null?control(team,ball):possession===team?1:0;
 const sign=team=>team===left.id?-1:1;
 const current=ready?clamp(players.filter(p=>[left.id,right.id].includes(p.team)).length?[-1,1].reduce((s,_,i)=>{const team=i?right.id:left.id;return s+sign(team)*share(team)*value(team,ball);},0):0,-1,1):null;
 function potential(q){if(!ready)return null;const travel=distance(ball,q)/15;
 let total=0;for(const team of [left.id,right.id]){const opponents=players.filter(p=>p.team!==team);let safety=1;
 // Evaluate interception margin along the pass, including before the destination.
 for(const f of [.25,.5,.75,1]){const target={x:ball.x+(q.x-ball.x)*f,y:ball.y+(q.y-ball.y)*f};const opp=Math.min(...opponents.map(p=>arrival(p,target)));safety=Math.min(safety,sigmoid((opp-travel*f)/.35));}
 const receiverTime=reach(team,q);const receiverReady=sigmoid((travel+1-receiverTime)/.5);
 total+=sign(team)*share(team)*safety*receiverReady*control(team,q)*value(team,q);
 }return clamp(total,-1,1);}
 return {left,right,current,potential,knownPossession:confidence===1,estimated:players.some(p=>!p.is_detected)||!ball?.is_detected};
}
