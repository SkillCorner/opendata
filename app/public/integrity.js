import {buildPassing} from './passing.js';
import {inside,area} from './geometry.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const sigmoid=x=>1/(1+Math.exp(-x));
const roundEven=x=>{const n=Math.floor(x);return x-n===.5?(n%2===0?n:n+1):Math.round(x);};

// Minimum-cost one-to-one assignment, padded for unequal team counts.
export function assignment(cost){
 const rows=cost.length,cols=cost[0]?.length??0,n=Math.max(rows,cols);if(!rows||!cols)return [];
 const u=Array(n+1).fill(0),v=Array(n+1).fill(0),p=Array(n+1).fill(0),way=Array(n+1).fill(0);
 for(let i=1;i<=n;i++){
  p[0]=i;let j0=0;const min=Array(n+1).fill(Infinity),used=Array(n+1).fill(false);
  do{used[j0]=true;const i0=p[j0];let delta=Infinity,j1=0;
   for(let j=1;j<=n;j++)if(!used[j]){const cur=(cost[i0-1]?.[j-1]??0)-u[i0]-v[j];if(cur<min[j]){min[j]=cur;way[j]=j0;}if(min[j]<delta){delta=min[j];j1=j;}}
   for(let j=0;j<=n;j++)if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else min[j]-=delta;
   j0=j1;
  }while(p[j0]);
  do{const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0);
 }
 return p.flatMap((row,col)=>row>0&&row<=rows&&col>0&&col<=cols?[[row-1,col-1]]:[]);
}

export function buildIntegrity(frame,before,after,meta,data){
 const base=buildPassing(frame,before,after,meta,data);if(base.reason)return base;
 const vm=data.valueModel;if(!vm)return {...base,reason:'Fitted value model unavailable'};
 const {players,defenders,arrival,ball,team}=base,s=data.settings,k=Math.PI/(Math.sqrt(3)*s.SIGMA);
 const attackers=players.filter(p=>p.team===team),roster=new Map(meta.players.map(p=>[p.id,p]));
 const direction=meta.home_team_side?.[frame.period-1];
 if(!direction)return {...base,reason:'Attacking direction unavailable'};
 const flip=(team===meta.home_team.id?direction:direction==='left_to_right'?'right_to_left':'left_to_right')==='right_to_left'?-1:1;
 const goal={x:52.5*flip,y:0};
 function location(q){const x=clamp(roundEven(q.x*flip-vm.grid_x0),0,vm.V_loc[0].length-1),y=clamp(roundEven(q.y*flip-vm.grid_y0),0,vm.V_loc.length-1);return vm.V_loc[y][x];}
 function context(q,times){
  const pressure=clamp(times?Math.min(...defenders.map(p=>times.get(p.player_id))):Math.min(...defenders.map(p=>arrival(p,q))),0,vm.pressure_cap_s);
  const nearest=Math.log1p(clamp(Math.min(...defenders.map(p=>distance(p,q))),0,vm.nearest_cap_m));
  const dg=distance(q,goal),gx=goal.x-q.x,gy=-q.y;
  const ahead=defenders.filter(p=>((p.x-q.x)*gx+(p.y-q.y)*gy)/(distance(p,q)*dg+1e-9)>Math.cos(vm.cone_deg*Math.PI/180)&&distance(p,goal)<dg).length;
  const close=Math.exp(-dg/vm.near_goal_scale_m),f=[pressure,nearest,ahead,pressure*close,nearest*close,ahead*close];
  return location(q)*Math.exp(vm.intercept+Object.values(vm.coef).reduce((sum,b,i)=>sum+b*f[i],0));
 }
 const ballValue=context(ball),eff=(t,tb)=>Math.max(t,tb)+s.TIE_BREAK*t;
 function evaluate(q,receiver=null,receiverTime=null){
  const times=new Map(players.map(p=>[p.player_id,arrival(p,q)]));
  if(receiver&&receiverTime!=null){const raw=times.get(receiver.player_id);times.set(receiver.player_id,Math.min(raw,receiverTime+(1-s.RUN_CREDIT)*Math.max(0,raw-receiverTime)));}
  const ta=Math.min(...attackers.map(p=>times.get(p.player_id))),td=Math.min(...defenders.map(p=>times.get(p.player_id))),d=distance(ball,q),tb=d/s.V_BALL;
  const control=sigmoid(k*(eff(td,tb)-eff(ta,tb)));
  let interception=0;
  for(let j=0;j<8;j++){const f=.15+j*.75/7;if(d*f<=2)continue;const pt={x:ball.x+(q.x-ball.x)*f,y:ball.y+(q.y-ball.y)*f};interception=Math.max(interception,sigmoid(k*(d*f/s.V_BALL-Math.min(...defenders.map(p=>arrival(p,pt))))));}
  const ground=(1-interception)*control,tl=d/s.V_LOFT+s.T_HANG;
  const loft=d>15?s.LOFT_CONTROL*sigmoid(k*(eff(td,tl)-eff(ta,tl))):0;
  const success=Math.max(ground,loft),value=context(q,times),opponentValue=location({x:-q.x,y:-q.y});
  return {control,success,value,td,interception,gain:success*value-(1-success)*opponentValue-ballValue,receiverSuccess:receiver?base.at(receiver,q):null};
 }
 function projectedOption(p,opt=null){
  const run=opt?.run?data.runs.find(r=>r.id===opt.run&&r.end>frame.frame):null;
  const moving=run||Math.hypot(p.vx,p.vy)>2;
  const project=t=>run?{x:clamp(p.x+((run.side==='right_to_left'?-1:1)*run.x-p.x)*Math.min(1,t/Math.max(.1,(run.end-frame.frame)/10)),-meta.pitch_length/2,meta.pitch_length/2),y:clamp(p.y+((run.side==='right_to_left'?-1:1)*run.y-p.y)*Math.min(1,t/Math.max(.1,(run.end-frame.frame)/10)),-meta.pitch_width/2,meta.pitch_width/2)}:base.projected(p,t);
  let t=distance(p,ball)/s.V_BALL;for(let i=0;i<8;i++)t=distance(project(t),ball)/s.V_BALL;
  const q=project(t);return {...evaluate(q,p,moving?t:null),...q,player_id:p.player_id,name:roster.get(p.player_id)?.short_name??String(p.player_id)};
 }
 function recommendations(event){
  const recorded=(data.options??[]).filter(o=>o.possession===event.id),unique=new Map();
  for(const opt of recorded){const p=base.receivers.find(p=>p.player_id===opt.player_id);if(p)unique.set(p.player_id,projectedOption(p,opt));}
  // In clips with no option annotations use tracked off-ball teammates, explicitly labelled.
  if(!recorded.length)for(const p of base.receivers)unique.set(p.player_id,projectedOption(p));
  const sorted=[...unique.values()].sort((a,b)=>b.gain-a.gain),distinct=[];
  for(const o of sorted)if(distinct.every(d=>distance(d,o)>=2)){distinct.push(o);if(distinct.length===5)break;}
  return {options:distinct,source:recorded.length?'recorded passing options':'tracked teammates (option annotations unavailable)'};
 }
 let cachedGrid;
 function grid(){
  if(cachedGrid)return cachedGrid;
  const width=Math.ceil(meta.pitch_length),height=Math.ceil(meta.pitch_width),cells=[];let deny=0,weight=0,threat=-Infinity;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const q={x:-meta.pitch_length/2+x+.5,y:meta.pitch_width/2-y-.5},v=evaluate(q);
   // Receiver-specific pass value retains the halo arrival gate, while the
   // notebook's control, success, net gain and integrity remain unchanged.
   let receiverGain=-Infinity;
   for(const p of base.receivers){const ps=base.at(p,q,{td:v.td,intercept:v.interception});receiverGain=Math.max(receiverGain,ps*v.value-(1-ps)*location({x:-q.x,y:-q.y})-ballValue);}
   cells.push({...q,...v,passValue:receiverGain});threat=Math.max(threat,v.gain);
   if(q.x*flip>=ball.x*flip-5){const w=location(q);deny+=w*(1-v.success);weight+=w;}
  }
  cachedGrid={width,height,cells,integrity:weight?deny/weight:null,threat};return cachedGrid;
 }
 function diagnostics(delaunayFactory){
  const g=grid(),d=defenders.filter(p=>roster.get(p.player_id)?.player_role?.name!=='Goalkeeper'),tiles=[],links=[];
  if(d.length>=3){const tri=delaunayFactory(d),edges=new Set();
   for(let i=0;i<tri.triangles.length;i+=3){const indices=[...tri.triangles.slice(i,i+3)],vs=indices.map(i=>d[i]);if(area(...vs)<1e-6)continue;
    const samples=g.cells.filter(c=>inside(c,...vs)),strength=samples.length?samples.reduce((s,c)=>s+1-c.control,0)/samples.length:null;
    const lengths=vs.map((p,i)=>distance(p,vs[(i+1)%3]));tiles.push({vs,strength,area:area(...vs),stretched:Math.max(...lengths)>30});
    for(let j=0;j<3;j++)edges.add([indices[j],indices[(j+1)%3]].sort((a,b)=>a-b).join(':'));
   }
   for(const edge of edges){const [a,b]=edge.split(':').map(i=>d[+i]);if(distance(a,b)>30)continue;let strength=1;
    for(let j=0;j<9;j++){const f=.1+j*.8/8;strength=Math.min(strength,1-evaluate({x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f}).control);}links.push({a,b,strength});}
  }
  const targets=base.receivers.filter(p=>roster.get(p.player_id)?.player_role?.name!=='Goalkeeper');
  const pairs=assignment(d.map(p=>targets.map(a=>arrival(p,a)))),marks=targets.map(a=>({attacker:a,covered:0,defender:null,danger:location(a)}));
  for(const [i,j] of pairs){const a=targets[j],p=d[i],goalSide=(goal.x-a.x)*(p.x-a.x)+(goal.y-a.y)*(p.y-a.y)>0;marks[j].covered=sigmoid(k*(distance(ball,a)/s.V_BALL+1-arrival(p,a)))*(goalSide?1:.5);marks[j].defender=p;}
  const dangerSum=marks.reduce((s,m)=>s+m.danger,0),marking=dangerSum?marks.reduce((s,m)=>s+m.danger*m.covered,0)/dangerSum:null;
  const free=[...marks].sort((a,b)=>b.danger*(1-b.covered)-a.danger*(1-a.covered))[0];
  const core=tiles.filter(t=>!t.stretched&&t.strength!=null),aSum=core.reduce((s,t)=>s+t.area,0);
  const individual=d.map(p=>{const target=attackers.filter(a=>roster.get(a.player_id)?.player_role?.name!=='Goalkeeper').sort((a,b)=>distance(p,a)-distance(p,b))[0];if(!target)return {player:p,marking:null};const goalSide=(goal.x-target.x)*(p.x-target.x)+(goal.y-target.y)*(p.y-target.y)>0;return {player:p,target,marking:sigmoid(k*(distance(ball,target)/s.V_BALL+1-arrival(p,target)))*(goalSide?1:.5)};});
  const nearestMarking=individual.length?individual.reduce((sum,m)=>sum+(m.marking??0),0)/individual.length:null;
  const orientation=d.length?d.reduce((sum,p)=>sum+(1+((ball.x-p.x)*p.fx+(ball.y-p.y)*p.fy)/(distance(ball,p)*Math.hypot(p.fx,p.fy)+1e-9))/2,0)/d.length:null;
  return {tiles,links,marks,marking,nearestMarking,individual,orientation,free:free?roster.get(free.attacker.player_id)?.short_name:null,oldIntegrity:aSum?core.reduce((s,t)=>s+t.strength*t.area,0)/aSum:null,...g};
 }
 return {...base,flip,ballValue,location,context,evaluate,projectedOption,recommendations,grid,diagnostics};
}

export function integrityColour(value,kind='control'){
 if(!Number.isFinite(value))return [120,130,140,100];
 const t=kind==='control'?clamp(value,0,1):.5+.5*Math.sign(value)*Math.log1p(Math.abs(value)*100)/Math.log1p(10);
 const z=clamp(t,0,1),end=z<.5?[38,111,238]:[247,76,54],f=Math.abs(z-.5)*2;
 return [...end.map(c=>Math.round(240+(c-240)*f)),185];
}
