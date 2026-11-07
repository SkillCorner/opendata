import {buildPassing,haloColour} from './passing.js';
import {buildAccess,accessColour} from './access.js';
import {possessionSource,POSSESSION_HOLD_FRAMES} from './possession.js';
import {buildDanger,dangerColour,teamScaleColour} from './danger.js';
import {vertices,area,inside} from './geometry.js';
const $=id=>document.getElementById(id),canvas=$('pitch'),ctx=canvas.getContext('2d');
let frames=[],meta,phases=[],index=0,playing=false,last=0,triangles=[],selected=null,transform,request=0;
let chances=[],loadedChance=null,passingData=null;
const haloCanvas=document.createElement('canvas'),haloCtx=haloCanvas.getContext('2d');
let haloCacheFrame=null,haloCacheData=null,haloModel=null,haloOutlines=[];
function receivingOverlay(f){
 if(haloCacheFrame===f&&haloCacheData===passingData)return;
 haloCacheFrame=f;haloCacheData=passingData;
 haloModel=buildPassing(f,frames[index-2],frames[index+2],meta,passingData);
 if(haloModel.reason)return;
 const grid=haloModel.grid();haloOutlines=grid.outlines;
 const pixels=new Uint8ClampedArray(grid.width*grid.height*4);
 grid.values.forEach((p,i)=>{const c=haloColour(p);if(c)pixels.set(c,i*4);});
 haloCanvas.width=grid.width;haloCanvas.height=grid.height;haloCtx.putImageData(new ImageData(pixels,grid.width,grid.height),0,0);
}
const say=s=>{$('status').textContent=s;$('viewerStatus').textContent=s;};
const mobileLayout=window.matchMedia('(max-width: 900px)');
function setControlLayout(){$('meshControls').open=!mobileLayout.matches;}
setControlLayout();
mobileLayout.addEventListener?.('change',()=>{setControlLayout();requestAnimationFrame(draw);});
function showControls(id){$(id).open=true;$(id).scrollIntoView({block:'start',behavior:'smooth'});}
function showClipPanel(which){
 const chance=which==='chance';$('chancePanel').hidden=!chance;$('clipDetails').hidden=chance;
 $('showChances').setAttribute('aria-expanded',String(chance));$('showClipDetails').setAttribute('aria-expanded',String(!chance));
 $('showChances').classList.toggle('secondary',!chance);$('showClipDetails').classList.toggle('secondary',chance);
}
$('showChances').onclick=()=>showClipPanel('chance');
$('showClipDetails').onclick=()=>showClipPanel('details');
showClipPanel('chance');
$('showMesh').onclick=()=>showControls('meshControls');
function leaveFocus(){document.body.classList.remove('pitch-focus');$('focusPitch').textContent='Expand pitch';$('focusPitch').setAttribute('aria-pressed','false');requestAnimationFrame(draw);}
$('focusPitch').onclick=()=>{if(document.body.classList.contains('pitch-focus')){leaveFocus();return;}document.body.classList.add('pitch-focus');$('focusPitch').textContent='Exit expanded view';$('focusPitch').setAttribute('aria-pressed','true');requestAnimationFrame(draw);};
window.addEventListener('keydown',e=>{if(e.key==='Escape'){if(selected)closeTile();else leaveFocus();}});
function centerInitialMobileMesh(){
 if(!frames.length||!window.matchMedia('(max-width: 900px)').matches)return;
 // Wait for the initial frame to paint; do this only at startup so later
 // playback, clip loads and control changes never pull the user away.
 requestAnimationFrame(()=>canvas.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
}
async function get(url){const r=await fetch(url);const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data;}
function configure(m){meta=m;$('title').textContent=`${m.home_team.name} vs ${m.away_team.name}`;$('dimensions').textContent=`${m.pitch_length} × ${m.pitch_width} m`;$('team').replaceChildren(new Option('Both teams','all'),new Option(m.home_team.name,String(m.home_team.id)),new Option(m.away_team.name,String(m.away_team.id)));}
function install(data){$('startupLoading').hidden=true;$('play').disabled=false;$('scrub').disabled=false;loadedChance=null;frames=data;index=0;playing=false;$('play').textContent='▶ Play';$('scrub').max=frames.length-1;selected=null;draw();}
async function demo(){const token=++request;try{const d=await get('/demo.json');if(token!==request)return;configure(d.metadata);passingData=await get(`/api/matches/${d.metadata.id}/passing`).catch(()=>null);if(token!==request)return;install(d.frames);$('context').textContent='Bundled opening clip · real tracking · stadium orientation';say('Demo ready. Select a match and phase to explore another clip.');}catch(e){say(e.message);}}
function teamColour(team){return teamScaleColour(team,meta,frames[index]?.period);}
function drawSoccerBall(x,y,tint,detected){
 const r=4.6;
 ctx.save();ctx.translate(x,y);ctx.setLineDash([]);
 ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fillStyle=tint;ctx.fill();
 ctx.save();ctx.clip();
 // The light panels carry danger colour; black panels and seams stay neutral.
 ctx.fillStyle='#101820';ctx.strokeStyle='#101820';ctx.lineWidth=.45;
 function pentagon(cx,cy,size,rotation){ctx.beginPath();for(let i=0;i<5;i++){const a=rotation+i*Math.PI*2/5;const p=[cx+Math.cos(a)*size,cy+Math.sin(a)*size];i?ctx.lineTo(...p):ctx.moveTo(...p);}ctx.closePath();ctx.fill();}
 for(let i=0;i<5;i++){const angle=-Math.PI/2+i*Math.PI*2/5;ctx.beginPath();ctx.moveTo(Math.cos(angle)*r*.36,Math.sin(angle)*r*.36);ctx.lineTo(Math.cos(angle)*r,Math.sin(angle)*r);ctx.stroke();pentagon(Math.cos(angle)*r*.98,Math.sin(angle)*r*.98,r*.32,angle+Math.PI);}
 pentagon(0,0,r*.4,-Math.PI/2);
 ctx.restore();ctx.beginPath();ctx.arc(0,0,r+.4,0,Math.PI*2);ctx.strokeStyle='#000000';ctx.lineWidth=1.8;ctx.setLineDash([]);ctx.stroke();
 if(!detected&&$('showEstimates').checked){ctx.beginPath();ctx.arc(0,0,r+1.8,0,Math.PI*2);ctx.strokeStyle='#ffcc81';ctx.lineWidth=.8;ctx.setLineDash([2,2]);ctx.stroke();}
 ctx.restore();
}
function draw(){if(!meta||!frames.length)return;const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);const pixelWidth=Math.round(rect.width*dpr),pixelHeight=Math.round(rect.height*dpr);if(canvas.width!==pixelWidth)canvas.width=pixelWidth;if(canvas.height!==pixelHeight)canvas.height=pixelHeight;ctx.setTransform(dpr,0,0,dpr,0,0);const w=rect.width,h=rect.height,L=meta.pitch_length,W=meta.pitch_width,scale=Math.min((w-48)/L,(h-40)/W);transform={scale,ox:w/2,oy:h/2};const px=(x,y)=>[w/2+x*scale,h/2-y*scale];
 ctx.fillStyle='#102b29';ctx.fillRect(0,0,w,h);const f=frames[index],points=vertices(f,meta,{team:$('team').value,ball:$('ball').checked,detectedOnly:$('detected').checked});
 const source=possessionSource(frames,index),calculationIndex=source.index??index;
 const calculationFrame=frames[calculationIndex];
 let danger=buildDanger(calculationFrame,frames[calculationIndex-1],meta);
 let access=buildAccess(calculationFrame,frames[calculationIndex-1],meta);
 if(source.index==null){danger={...danger,current:null,potential:()=>null,knownPossession:false};access={...access,reason:source.reason,at:()=>({score:null}),triangle:()=>({score:null,pass:null,carry:null,reason:source.reason})};}
 // Hold scores at their last known geometry while player/ball markers keep moving.
 const heldSites=new Map(source.heldFrames?vertices(calculationFrame,meta,{ball:true}).flatMap(p=>p.members.map(m=>[m.id,p])):[]);
 const scoringSite=p=>source.heldFrames?heldSites.get(p.id)??p:p;
 const holdLabel=source.heldFrames?` · held during transit (${source.heldFrames}/${POSSESSION_HOLD_FRAMES} frames)` : '';
 $('danger').textContent=danger.current==null?'Unavailable':danger.current.toFixed(3);
 $('dangerTeams').textContent=danger.left?('−1 Blue: '+danger.left.name+' (attacks →) | +1 Red: '+danger.right.name+' (attacks ←)'):'Attacking directions unavailable';
 $('teamLegend').textContent=danger.left?('● Blue: '+danger.left.name+' · ● Red: '+danger.right.name):'Team directions unavailable';
 $('fillLegend').textContent=$('colour').value==='access'?(access.reason?'Ball access unavailable: '+access.reason:'Ball access: 0 hard (red) → 100 easy (green) · best direct route in 5 s'):$('colour').value==='danger'?'Fill: potential danger · fixed log contrast':$('colour').value==='area'?'Fill: area · teal → amber':'Fill: team composition';
 $('dangerQuality').textContent=(danger.knownPossession?'Known possession':'Possession inferred from reach')+(danger.estimated?' · includes estimated positions':'')+' · uncalibrated spatial EPV proxy';
 if(source.index==null)$('dangerQuality').textContent=source.reason;
 else if(source.heldFrames)$('dangerQuality').textContent='Previous calculated values'+holdLabel+' · uncalibrated spatial EPV proxy';
 $('fillLegend').textContent+=holdLabel;
 const delaunay=d3.Delaunay.from(points,p=>p.x,p=>p.y);triangles=[];ctx.save();ctx.beginPath();ctx.rect(...px(-L/2,W/2),L*scale,W*scale);ctx.clip();
 const poly=(arr)=>{ctx.beginPath();arr.forEach((p,i)=>{const q=px(p.x,p.y);i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.closePath();};
 if($('mode').value==='voronoi'&&points.length){const v=delaunay.voronoi([-L/2,-W/2,L/2,W/2]);points.forEach((p,i)=>{const polygon=v.cellPolygon(i);if(!polygon)return;poly(polygon.map(([x,y])=>({x,y})));ctx.fillStyle=$('colour').value==='access'?accessColour(access.at(scoringSite(p)).score):$('colour').value==='danger'?dangerColour(danger.potential(scoringSite(p))):teamColour(p.team);ctx.globalAlpha=['danger','access'].includes($('colour').value)?.72:.35;ctx.fill();ctx.globalAlpha=.6;ctx.strokeStyle=teamColour(p.team);ctx.setLineDash(p.is_detected?[]:[4,4]);ctx.stroke();});}
 else{for(let i=0;i<delaunay.triangles.length;i+=3){const vs=Array.from(delaunay.triangles.slice(i,i+3),j=>points[j]);const a=area(...vs);if(a<1e-6)continue;const key=vs.flatMap(v=>v.members.map(p=>p.id)).sort().join(':');const ball=vs.some(v=>v.members.some(p=>p.id==='ball')),estimated=vs.some(v=>!v.is_detected);const scoreVertices=vs.map(scoringSite);const centroid={x:scoreVertices.reduce((s,p)=>s+p.x,0)/3,y:scoreVertices.reduce((s,p)=>s+p.y,0)/3};const potential=danger.potential(centroid),entry=access.triangle(scoreVertices);triangles.push({vs,area:a,key,ball,estimated,potential,entry});poly(vs);const teams=new Set(vs.flatMap(v=>v.members.filter(p=>p.id!=='ball').map(p=>p.team)));const colour=$('colour').value==='access'?accessColour(entry.score):$('colour').value==='danger'?dangerColour(potential):$('colour').value==='area'?`hsl(${170-Math.min(a/350,1)*130} 62% 60%)`:teams.size===1?teamColour([...teams][0]):'#baabc9';ctx.fillStyle=colour;ctx.globalAlpha=$('ballOnly').checked&&!ball?.035:(['danger','access'].includes($('colour').value)?.72:.2);ctx.fill();ctx.strokeStyle=selected===key?'#ffffff':colour;ctx.globalAlpha=$('ballOnly').checked&&!ball?.08:.65;ctx.lineWidth=selected===key?3:1.5;ctx.setLineDash(estimated&&$('showEstimates').checked?[4,4]:[]);ctx.stroke();
 // Team edges are drawn independently of the tile fill/score.
 for(let e=0;e<3;e++){const p=vs[e],q=vs[(e+1)%3];const pt=new Set(p.members.filter(m=>m.id!=='ball').map(m=>m.team)),qt=new Set(q.members.filter(m=>m.id!=='ball').map(m=>m.team));const same=pt.size===1&&qt.size===1&&[...pt][0]=== [...qt][0];ctx.beginPath();ctx.moveTo(...px(p.x,p.y));ctx.lineTo(...px(q.x,q.y));ctx.globalAlpha=.95;ctx.strokeStyle=same?teamColour([...pt][0]):'#f4d292';ctx.lineWidth=same?2.5:1.8;ctx.setLineDash(same?[]:[5,3]);ctx.stroke();}ctx.setLineDash([]);}}
 $('receivingLegend').hidden=!$('showReceiving').checked;
 $('receivingStatus').textContent=haloModel?.reason??'Pale: slim chance · bright green: high chance · below 2% hidden';
 const chosen=triangles.find(t=>t.key===selected);
 if(chosen){poly(chosen.vs);ctx.globalAlpha=1;ctx.setLineDash([]);ctx.strokeStyle='#071219';ctx.lineWidth=6;ctx.stroke();ctx.strokeStyle='#ffffff';ctx.lineWidth=3;ctx.stroke();}
 ctx.restore();
 // Independent foreground pass: above all tile fills, edges and selection outlines.
 // Reset compositing/opacity so mesh settings cannot hide the receiving surface.
 if($('showReceiving').checked){
  receivingOverlay(f);
  if(!haloModel.reason){
   ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.imageSmoothingEnabled=false;
   ctx.beginPath();ctx.rect(...px(-L/2,W/2),L*scale,W*scale);ctx.clip();
   ctx.drawImage(haloCanvas,...px(-L/2,W/2),L*scale,W*scale);
   ctx.beginPath();
   for(const edges of haloOutlines)for(const [x1,y1,x2,y2] of edges){
    ctx.moveTo(...px(-L/2+x1,W/2-y1));ctx.lineTo(...px(-L/2+x2,W/2-y2));
   }
   ctx.setLineDash([]);ctx.lineJoin='round';
   ctx.strokeStyle='#123f22';ctx.lineWidth=2.5;ctx.stroke();
   ctx.strokeStyle='#baffbf';ctx.lineWidth=1.2;ctx.stroke();ctx.restore();
  }
 }
 ctx.globalAlpha=1;ctx.setLineDash([]);ctx.strokeStyle='#6c9690';ctx.lineWidth=1;ctx.strokeRect(...px(-L/2,W/2),L*scale,W*scale);ctx.beginPath();ctx.moveTo(...px(0,-W/2));ctx.lineTo(...px(0,W/2));ctx.stroke();ctx.beginPath();ctx.arc(...px(0,0),9.15*scale,0,Math.PI*2);ctx.stroke();for(const side of [-1,1]){const x=side<0?-L/2:L/2-16.5;ctx.strokeRect(...px(x,20.16),16.5*scale,40.32*scale);const gx=side<0?-L/2:L/2-5.5;ctx.strokeRect(...px(gx,9.16),5.5*scale,18.32*scale);}
 vertices(f,meta,{team:$('team').value,ball:true,detectedOnly:$('detected').checked}).forEach(p=>{const ball=p.members.some(v=>v.id==='ball');if(ball){drawSoccerBall(...px(p.x,p.y),dangerColour(danger.current),p.is_detected);return;}ctx.beginPath();ctx.arc(...px(p.x,p.y),Math.max(6,scale*1.2),0,Math.PI*2);ctx.fillStyle=teamColour(p.team);ctx.fill();const showEstimate=!p.is_detected&&$('showEstimates').checked;ctx.strokeStyle=showEstimate?'#ffcc81':'#102321';ctx.setLineDash(showEstimate?[2,2]:[]);ctx.lineWidth=2;ctx.stroke();ctx.setLineDash([]);if(!ball){ctx.fillStyle='#ffffff';ctx.font='bold 9px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.number??'?',...px(p.x,p.y));}});
 $('estimateLegend').hidden=!$('showEstimates').checked;
 $('jumpShot').hidden=!loadedChance;
 if(loadedChance){const seconds=(f.frame-loadedChance.anchorFrame)/10;$('chanceStage').textContent=`${loadedChance.outcome==='goal'?'Confirmed goal':'Recorded shot'} at ${loadedChance.time} · ${seconds<0?Math.abs(seconds).toFixed(1)+' s before marker':seconds.toFixed(1)+' s after marker'} · ${loadedChance.team}`;}else $('chanceStage').textContent='';
 $('scrub').value=index;$('frame').textContent=f.frame;$('clock').textContent=(f.timestamp??'').replace(/^00:/,'');$('vertices').textContent=points.length;$('estimated').textContent=points.filter(p=>!p.is_detected).length;
 if(selected){const t=triangles.find(t=>t.key===selected);if(t){const edges=t.vs.map((p,i)=>{const q=t.vs[(i+1)%3];return Math.hypot(p.x-q.x,p.y-q.y).toFixed(1);});$('inspect').textContent=`${t.area.toFixed(1)} m²${holdLabel} · ball access ${t.entry.score==null?t.entry.reason:Math.round(t.entry.score*100)+"/100 via "+t.entry.route+(t.entry.seconds?" (~"+t.entry.seconds.toFixed(1)+" s)":"")} · pass ${t.entry.pass==null?"—":Math.round(t.entry.pass*100)+"/100"} · carry ${t.entry.carry==null?"—":Math.round(t.entry.carry*100)+"/100"} · potential danger ${t.potential==null?"unavailable":t.potential.toFixed(3)} · edges ${edges.join(' / ')} m · ${t.vs.flatMap(v=>v.members.map(p=>p.name+(p.is_detected?'':' (estimated)'))).join(' ↔ ')}${t.ball?' · ball-adjacent':''}.`; }else $('inspect').textContent='Selected triangle is no longer present in this frame.';}
 const popup=$('tileFeedback');
 if(selected){
  const t=triangles.find(t=>t.key===selected);
  if(t){
   $('tileSummary').textContent=$('inspect').textContent;
   $('tileArea').textContent=`${t.area.toFixed(1)} m²`;
   $('tileAccess').textContent=t.entry.score==null?'—':`${Math.round(t.entry.score*100)}/100`;
   $('tileDanger').textContent=t.potential==null?'—':t.potential.toFixed(3);
   $('tileRoute').textContent=t.entry.score==null?t.entry.reason:`Best route: ${t.entry.route}${t.entry.seconds?' · '+t.entry.seconds.toFixed(1)+' s':''} · Pass ${t.entry.pass==null?'—':Math.round(t.entry.pass*100)} / Carry ${t.entry.carry==null?'—':Math.round(t.entry.carry*100)}${holdLabel}`;
   $('tilePlayers').textContent=t.vs.flatMap(v=>v.members.map(p=>p.name)).join(' · ');
   $('tileEdges').textContent='Edges: '+t.vs.map((p,i)=>{const q=t.vs[(i+1)%3];return Math.hypot(p.x-q.x,p.y-q.y).toFixed(1);}).join(' / ')+' m';
   popup.hidden=false;if(!popup.open)popup.show();positionTilePopup(t);
  }else closeTile();
 }
 else{if(popup.open)popup.close();popup.hidden=true;}
}
function positionTilePopup(t){
 const popup=$('tileFeedback'),rect=canvas.getBoundingClientRect(),size=popup.getBoundingClientRect();
 const x=rect.left+transform.ox+t.vs.reduce((s,p)=>s+p.x,0)/3*transform.scale;
 const y=rect.top+transform.oy-t.vs.reduce((s,p)=>s+p.y,0)/3*transform.scale;
 const viewportWidth=window.innerWidth??rect.width;
 const left=Math.max(8,Math.min(x-size.width/2,viewportWidth-size.width-8));
 popup.style.left=`${left}px`;popup.style.top=`${Math.max(8,y-size.height-14)}px`;
 popup.style.setProperty('--anchor-x',`${Math.max(16,Math.min(size.width-16,x-left))}px`);
}
function selectTriangle(clientX,clientY){
 if(!transform||$('mode').value!=='triangles')return;
 const r=canvas.getBoundingClientRect(),p={x:(clientX-r.left-transform.ox)/transform.scale,y:-(clientY-r.top-transform.oy)/transform.scale};
 if(Math.abs(p.x)>meta.pitch_length/2||Math.abs(p.y)>meta.pitch_width/2)return;
 const hit=triangles.find(t=>inside(p,...t.vs));if(!hit)return;
 playing=false;$('play').textContent='▶ Play';selected=hit.key;draw();
}
let touchTap=null,lastTouchSelection=-Infinity;
canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')return;if(!e.isPrimary){touchTap=null;return;}touchTap={id:e.pointerId,x:e.clientX,y:e.clientY};});
canvas.addEventListener('pointermove',e=>{if(touchTap?.id===e.pointerId&&Math.hypot(e.clientX-touchTap.x,e.clientY-touchTap.y)>10)touchTap=null;});
canvas.addEventListener('pointercancel',()=>touchTap=null);
canvas.addEventListener('pointerup',e=>{if(touchTap?.id!==e.pointerId)return;const tap=touchTap;touchTap=null;if(Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>10)return;lastTouchSelection=performance.now();selectTriangle(e.clientX,e.clientY);});
canvas.addEventListener('click',e=>{if(performance.now()-lastTouchSelection<600)return;selectTriangle(e.clientX,e.clientY);});
function closeTile(){selected=null;draw();}
$('clearTile').onclick=closeTile;
$('tileFeedback').addEventListener('cancel',e=>{e.preventDefault();closeTile();});
document.addEventListener('pointerdown',e=>{if(selected&&!$('tileFeedback').contains(e.target)&&e.target!==canvas)closeTile();});
window.addEventListener('scroll',()=>{const t=triangles.find(t=>t.key===selected);if(t)positionTilePopup(t);},{passive:true});

function chanceLabel(c){return `${c.outcome==='goal'?'GOAL':'SHOT'} · P${c.period} ${c.time} · ${c.team} · ${c.player??'goal marker'} · peak EPV ${c.peakEpv==null?'unavailable':c.peakEpv.toFixed(3)}`;}
function fillChances(){
 const filter=$('chanceFilter').value;
 const shown=chances.filter(c=>filter==='all'||filter==='goals'&&c.outcome==='goal'||filter==='high'&&c.highDanger);
 $('chance').replaceChildren(new Option(`Select a chance (${shown.length} available)…`,''),...shown.map(c=>new Option(chanceLabel(c),c.id)));
 $('chanceInfo').textContent=`${shown.length} clips · 20 s build-up + 8 s aftermath, bounded to the half. High = recorded attacking EPV ≥ 0.10 or a confirmed goal; this is not shot xG. Selecting loads the clip.`;
}
async function choose(){
 const token=++request;playing=false;$('play').textContent='▶ Play';$('chance').disabled=true;$('load').disabled=true;pendingMeta=null;
 say('Reading match metadata, phases and pre-identified chances…');
 try{const id=$('match').value;const [m,p,c]=await Promise.all([get(`/api/matches/${id}/metadata`),get(`/api/matches/${id}/phases`),get(`/api/matches/${id}/chances`)]);
 if(token!==request)return;phases=p;chances=c.chances;fillChances();$('phase').replaceChildren(new Option('Opening clip',''));
 for(let i=0;i<p.length;i++){const x=p[i];$('phase').add(new Option(`P${x.period} ${x.time_start} · ${x.team_in_possession_phase_type} / ${x.team_out_of_possession_phase_type}`,String(i)));}
 $('start').value=10;say('Select a danger chance, or load a custom tracking clip.');pendingMeta=m;
 }catch(e){if(token===request)say(e.message);}finally{if(token===request){$('chance').disabled=false;$('load').disabled=false;}}
}
let pendingMeta;
$('chanceFilter').onchange=fillChances;
$('phase').onchange=()=>{$('chance').value='';const p=phases[$('phase').value];$('start').value=p?.frame_start??10;};
$('start').oninput=()=>$('chance').value='';$('duration').onchange=()=>$('chance').value='';
async function loadClip(chance=null){
 const token=++request,id=$('match').value;playing=false;$('play').textContent='▶ Play';$('load').disabled=true;
 say('Streaming real tracking data… later clips may take up to 90 seconds.');
 try{const m=(pendingMeta?.id===Number(id)?pendingMeta:null)??await get(`/api/matches/${id}/metadata`);
 const query=chance?`start=${chance.startFrame}&count=${chance.count}&end=${chance.endFrame}&period=${chance.period}`:`start=${encodeURIComponent($('start').value)}&count=${Number($('duration').value)*10}`;
 const [data,model]=await Promise.all([get(`/api/matches/${id}/clip?${query}`),get(`/api/matches/${id}/passing`).catch(()=>null)]);if(token!==request)return;configure(m);passingData=model;install(data);loadedChance=chance;
 $('context').textContent=chance?chanceLabel(chance):`Match ${id} · ${$('phase').selectedOptions[0]?.textContent??'Custom clip'} · stadium orientation`;
 draw();
 if(chance){const covers=data[0].frame<=chance.anchorFrame&&data.at(-1).frame>=chance.anchorFrame;const exact=data.some(f=>f.frame===chance.anchorFrame);say(covers?`Chance ready · ${data.length} frames${exact?'':' · exact outcome frame missing; surrounding tracking shown'}.`:'Tracking does not cover the outcome marker for this chance.');canvas.scrollIntoView({block:'center',behavior:'smooth'});}
 else say(`Ready · ${data.length} frames. Dashed marks indicate estimates.`);
 return true;
 }catch(e){if(token===request){say(e.message);return false;}}finally{if(token===request)$('load').disabled=false;}
}
$('load').onclick=()=>loadClip(chances.find(c=>c.id===$('chance').value)??null);
$('chance').onchange=()=>{const c=chances.find(c=>c.id===$('chance').value);if(c){$('start').value=c.startFrame;$('phase').value='';return loadClip(c);}};
$('jumpShot').onclick=()=>{if(!loadedChance)return;index=frames.reduce((best,f,i)=>Math.abs(f.frame-loadedChance.anchorFrame)<Math.abs(frames[best].frame-loadedChance.anchorFrame)?i:best,0);playing=false;$('play').textContent='▶ Play';draw();};
$('match').onchange=choose;$('demo').onclick=demo;
$('play').onclick=()=>{selected=null;if(index>=frames.length-1)index=0;playing=!playing;last=performance.now();$('play').textContent=playing?'Ⅱ Pause':'▶ Play';draw();};
$('scrub').oninput=()=>{index=Number($('scrub').value);playing=false;$('play').textContent='▶ Play';draw();};
for(const id of ['mode','team','colour','ball','ballOnly','detected','showEstimates','showReceiving'])$(id).onchange=()=>{selected=null;$('inspect').textContent=$('mode').value==='voronoi'?'Cells show proximity to each selected site; ball cells are neutral.':'Pause and click a triangle to inspect it.';draw();};
function tick(now){if(playing&&frames.length){const dt=50/Number($('speed').value);if(now-last>=dt){index=Math.min(frames.length-1,index+Math.floor((now-last)/dt));last=now;draw();if(index===frames.length-1){playing=false;$('play').textContent='▶ Replay';}}}requestAnimationFrame(tick);}requestAnimationFrame(tick);window.addEventListener('resize',draw);
async function startup(){
 let expected=++request;
 say('Loading the default high-danger chance…');
 try{
  const matches=await get('/api/matches');if(request!==expected)return;
  $('match').replaceChildren(...matches.map(m=>new Option(m.label,String(m.id))));$('match').value='1886347';
  expected=request+1;await choose();if(request!==expected)return;
  const first=pendingMeta?.id===1886347?chances.find(c=>c.highDanger):null;
  if(!first)throw Error('No default high-danger chance available.');
  $('chance').value=first.id;$('start').value=first.startFrame;
  expected=request+1;const loaded=await loadClip(first);if(request!==expected)return;
  if(!loaded)throw Error('The default chance could not be loaded.');
  centerInitialMobileMesh();
 }catch(e){
  if(request!==expected)return;
  await demo();centerInitialMobileMesh();
  if(frames.length)say(`${e.message} Showing the bundled fallback clip.`);
  else $('startupLoading').textContent='Unable to load tracking. Please try Return to bundled demo.';
 }
}
await startup();
