import {test} from 'node:test';
import assert from 'node:assert/strict';
import {possessionSource} from '../public/possession.js';
const frames=()=>Array.from({length:33},(_,i)=>({frame:100+i,period:1,possession:i===0?{player_id:11}: {}}));
test('hold last possession through 29 frames, expire on 30',()=>{const f=frames();assert.deepEqual(possessionSource(f,0),{index:0,heldFrames:0,reason:null});for(let i=1;i<30;i++){assert.equal(possessionSource(f,i).index,0);assert.equal(possessionSource(f,i).heldFrames,i);}assert.equal(possessionSource(f,30).index,null);assert.equal(possessionSource(f,32).index,null);});
test('new possession immediately resets the hold; scrubbing is independent of playback history',()=>{const f=frames();f[11].possession={group:'away team'};assert.equal(possessionSource(f,12).index,11);assert.equal(possessionSource(f,5).index,0);assert.equal(possessionSource(f,11).heldFrames,0);});
test('do not hold across recording gaps, half boundaries or clips without prior possession',()=>{let f=frames();f[1].period=2;assert.equal(possessionSource(f,1).index,null);f=frames();f[1].frame=105;assert.equal(possessionSource(f,1).index,null);assert.equal(possessionSource(frames().slice(2),0).index,null);});
