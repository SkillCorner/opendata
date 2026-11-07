import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {passingData} from '../passing-data.mjs';

test('Docker image packages the resources needed by the receiving model',async()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const docker=await readFile(path.join(root,'Dockerfile'),'utf8');
 const image=await mkdtemp(path.join(tmpdir(),'soccer-image-'));
 try{
  // Reproduce the Docker COPY manifest without requiring a local Docker daemon.
  for(const line of docker.split(/\r?\n/)){
   const copy=line.match(/^COPY\s+(\S+)\s+(\S+)$/);if(!copy)continue;
   const [,source,destination]=copy;
   await cp(path.join(root,source),path.join(image,destination.endsWith('/')?path.join(destination,path.basename(source)):destination),{recursive:true});
  }
  const meta=JSON.parse(await readFile(path.join(image,'data/matches/1886347/1886347_match.json'),'utf8'));
  const model=await passingData(image,1886347,meta);
  assert.ok(model.settings.RUN_CREDIT>0);assert.ok(model.valueModel.V_loc.length);assert.ok(model.runs.length);
  assert.ok(Object.values(model.physical).every(p=>p.vmax>0&&p.amax>0));
 }finally{await rm(image,{recursive:true,force:true});}
});
