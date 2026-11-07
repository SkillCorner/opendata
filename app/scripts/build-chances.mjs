import {readFile,readdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parseCsv} from '../csv.mjs';
import {identifyChances,HIGH_EPV} from '../chances.mjs';
const root=new URL('../../',import.meta.url),matches={};
for(const id of (await readdir(new URL('data/matches/',root))).filter(x=>/^\d+$/.test(x))){
 const meta=JSON.parse(await readFile(new URL(`data/matches/${id}/${id}_match.json`,root),'utf8'));
 const events=parseCsv(await readFile(new URL(`data/matches/${id}/${id}_dynamic_events.csv`,root),'utf8'));
 matches[id]=identifyChances(events,meta);
}
const result={version:1,sourceCommit:'4340d274572876239c154c90bc507a9b3250a656',highEpvThreshold:HIGH_EPV,preSeconds:20,postSeconds:8,matches};
await writeFile(new URL('../chance-catalogue.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
const all=Object.values(matches).flat();console.log(`${Object.keys(matches).length} matches; ${all.length} chances; ${all.filter(c=>c.highDanger).length} high-danger; ${all.filter(c=>c.outcome==='goal').length} confirmed goals`);
