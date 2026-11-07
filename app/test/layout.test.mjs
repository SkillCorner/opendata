import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {playbackPitchHeight} from '../public/layout.js';
for(const [name,args] of [
 ['desktop',{viewportHeight:720,pitchWidth:1000,pitchTop:190,controlsHeight:50,controlsMargins:28}],
 ['mobile portrait',{viewportHeight:640,pitchWidth:366,pitchTop:200,controlsHeight:62,controlsMargins:16,mobile:true}],
 ['mobile landscape',{viewportHeight:360,pitchWidth:600,pitchTop:150,controlsHeight:62,controlsMargins:16,mobile:true}]
])test(`${name} reserves visible space for playback controls`,()=>{
 const h=playbackPitchHeight(args);
 assert.ok(h>0);assert.ok(h<=args.pitchWidth/(args.mobile?1.5:1.6));
 assert.ok(args.pitchTop+h+args.controlsHeight+args.controlsMargins+16<=args.viewportHeight);
});
test('preview explanation lives in the tooltip rather than a growing on-screen banner',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 assert.equal(html.includes('id="passAdvice"'),false);
 const {settingHelp}=await import('../public/settings-help.js');
 assert.match(settingHelp('viewIntegrity').text,/1 s preview/);
 assert.match(settingHelp('viewIntegrity').text,/five distinct arrows/);
});
