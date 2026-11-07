export function vertices(frame,metadata,{detectedOnly=false,team='all',ball=true}={}){
 const roster=new Map(metadata.players.map(p=>[p.id,p]));const seen=new Set();const points=[];
 for(const p of frame.player_data??[]){const m=roster.get(p.player_id);if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||seen.has(p.player_id)||detectedOnly&&!p.is_detected||team!=='all'&&String(m?.team_id)!==team)continue;seen.add(p.player_id);points.push({...p,id:String(p.player_id),team:m?.team_id,name:m?.short_name??String(p.player_id),number:m?.number});}
 const b=frame.ball_data;if(ball&&b&&Number.isFinite(b.x)&&Number.isFinite(b.y)&&(!detectedOnly||b.is_detected))points.push({...b,id:'ball',name:'Ball',team:null});
 // One geometry site per location, with all coincident identities retained.
 const unique=new Map();for(const p of points){const key=`${p.x},${p.y}`;if(unique.has(key)){const v=unique.get(key);v.members.push(p);v.is_detected=v.is_detected&&p.is_detected;}else unique.set(key,{...p,members:[p]});}return [...unique.values()];
}
export function area(a,b,c){return Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/2;}
export function inside(p,a,b,c){const cross=(u,v,w)=>(v.x-u.x)*(w.y-u.y)-(v.y-u.y)*(w.x-u.x);const s=[cross(a,b,p),cross(b,c,p),cross(c,a,p)];return s.every(x=>x>=-1e-8)||s.every(x=>x<=1e-8);}
