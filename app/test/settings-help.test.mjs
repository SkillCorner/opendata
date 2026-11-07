import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SETTING_HELP,settingHelp} from '../public/settings-help.js';
test('every explained setting has a separately labelled info button',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 for(const id of Object.keys(SETTING_HELP)){
  assert.ok(html.includes(`id="help-${id}"`),id);
  assert.ok(SETTING_HELP[id].title,id);
 }
 assert.ok(html.includes('id="receivingLegend"'),'preserve the existing halo legend');
 for(const id of ['colour','integrityColour'])assert.ok(html.indexOf(`id="help-${id}"`)<html.indexOf(`id="${id}"`),'colour help precedes its dropdown');
});
test('colour explanations distinguish all current calculations and the legacy override',()=>{
 for(const value of ['area','team','access','danger'])assert.ok(settingHelp('colour',value).text.length>30);
 for(const value of ['control','danger','pass','tiles'])assert.ok(settingHelp('integrityColour',value).text.length>30);
 assert.match(settingHelp('integrityColour','control').text,/Does not deduct lane interceptions/);
 assert.match(settingHelp('integrityColour','danger').text,/turnover/);
 assert.match(settingHelp('integrityColour','pass').text,/arrival gate/);
 assert.match(settingHelp('integrityColour','danger',true).title,/legacy/);
 assert.notEqual(settingHelp('integrityColour','danger',false).text,settingHelp('integrityColour','danger',true).text);
});

test('calculation tooltips include equations and keep explanations short',()=>{
 for(const value of ['control','danger','pass','tiles']){const h=settingHelp('integrityColour',value);assert.ok(h.equation.includes('='));assert.ok(h.text.split(/\s+/).length<=45);}
 for(const id of ['integrityConnections','integrityTiles','integrityMarking','integrityFacing'])assert.ok(settingHelp(id).equation);
});

test('pass-related help explains gold arrows and the faster fade',()=>{
 for(const id of ['viewIntegrity','chance','speed']){const text=settingHelp(id).text;assert.match(text,/gold/i);assert.match(text,/60%/);}
 const text=settingHelp('integrityColour','pass').text;assert.match(text,/gold outline/);assert.match(text,/60%/);
});
