import http from 'node:http';
import {passingData} from './passing-data.mjs';
import {readFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const cache=new Map();
const catalogue=JSON.parse(await readFile(path.join(root,'app/chance-catalogue.json'),'utf8'));
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function clip(id,start,count,end=null,period=null){
 const key=`${id}:${start}:${count}:${end}:${period}`; if(cache.has(key))return cache.get(key);
 const response=await fetch(`https://media.githubusercontent.com/media/misoverfitting/soccer_data/4340d274572876239c154c90bc507a9b3250a656/data/matches/${id}/${id}_tracking_extrapolated.jsonl`,{signal:AbortSignal.timeout(90000)});
 if(!response.ok)throw Error('Tracking download unavailable; try the bundled demo.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',frames=[];
 try {outer:while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;const f=JSON.parse(line);if(end!=null&&f.frame>end)break outer;if(f.frame>=start&&f.timestamp!=null&&(period==null||f.period===period)){frames.push(f);if(frames.length>=count)break outer;}}} } finally {await reader.cancel();}
 if(!frames.length)throw Error('No tracking frames at that location.');
 if(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(key,frames);return frames;
}
export const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/health')return json(res,200,{status:'ok'});
 if(url.pathname==='/api/matches') {const dirs=await readdir(path.join(root,'data/matches'));const matches=await Promise.all(dirs.filter(x=>/^\d+$/.test(x)).map(async id=>{const m=JSON.parse(await readFile(path.join(root,`data/matches/${id}/${id}_match.json`),'utf8'));return {id:m.id,label:`${m.home_team.name} vs ${m.away_team.name}`,date:m.date_time};}));return json(res,200,matches);}
 const match=url.pathname.match(/^\/api\/matches\/(\d+)\/(metadata|phases|chances|clip|passing)$/);
 if(match){const [,id,kind]=match;const ids=await readdir(path.join(root,'data/matches'));if(!ids.includes(id))return json(res,404,{error:'Unknown match'});
 if(kind==='passing'){const key=`passing:${id}`;if(!cache.has(key)){const m=JSON.parse(await readFile(path.join(root,`data/matches/${id}/${id}_match.json`),'utf8'));cache.set(key,await passingData(root,id,m));}return json(res,200,cache.get(key));}
 if(kind==='metadata')return json(res,200,JSON.parse(await readFile(path.join(root,`data/matches/${id}/${id}_match.json`),'utf8')));
 if(kind==='chances')return json(res,200,{...catalogue,matches:undefined,chances:catalogue.matches[id]??[]});
 if(kind==='phases'){const csv=await readFile(path.join(root,`data/matches/${id}/${id}_phases_of_play.csv`),'utf8');const [header,...rows]=csv.trim().split(/\r?\n/);const keys=header.split(',');return json(res,200,rows.map(row=>Object.fromEntries(row.split(',').map((v,i)=>[keys[i],v]))));}
 const start=Number(url.searchParams.get('start')??10),count=Number(url.searchParams.get('count')??300);
 if(!Number.isInteger(start)||start<0||start>150000||!Number.isInteger(count)||count<1||count>600)return json(res,400,{error:'start must be 0–150000; count must be 1–600'});
 const end=url.searchParams.has('end')?Number(url.searchParams.get('end')):null,period=url.searchParams.has('period')?Number(url.searchParams.get('period')):null;
 if(end!=null&&(!Number.isInteger(end)||end<start||end-start>=600)||period!=null&&![1,2].includes(period))return json(res,400,{error:'Invalid clip end or period'});
 return json(res,200,await clip(id,start,count,end,period));}
 const files={'/':'index.html','/style.css':'style.css','/client.js':'client.js','/geometry.js':'geometry.js','/danger.js':'danger.js','/access.js':'access.js','/passing.js':'passing.js','/possession.js':'possession.js','/d3-delaunay.min.js':'d3-delaunay.min.js','/demo.json':'demo.json'};
 const file=files[url.pathname];if(!file)return json(res,404,{error:'Not found'});
 const content=await readFile(path.join(root,'app/public',file));res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'application/json','X-Content-Type-Options':'nosniff'});res.end(content);
 }catch(error){console.error(error.message);json(res,502,{error:error.message});}});
if(process.env.NODE_ENV!=='test')server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Pitch tiles listening'));
