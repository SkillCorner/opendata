// Clip API: seeks into the tracking file and returns exactly the requested frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {server} from '../server.mjs';

test('clip endpoint returns the requested frame window', async t => {
  await new Promise(r => server.listen(0, r)); t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/clip/1925299?start=10&end=5000`)).status, 400);
  const r = await fetch(`${base}/api/clip/1925299?start=44300&end=44305`);
  assert.equal(r.status, 200);
  const {frames} = await r.json();
  assert.deepEqual(frames.map(f => f.f), [44300, 44301, 44302, 44303, 44304, 44305]);
  const shot = frames.find(f => f.f === 44303);
  assert.deepEqual(shot.b, [-47.88, -6.21]);
  assert.equal(shot.pl.length, 22);
  const m = await (await fetch(`${base}/data/match/1925299.json`)).json();
  assert.ok(m.sequences.some(s => s.outcome === 'goal' && s.end === 44303));
  assert.equal((await fetch(`${base}/../server.mjs`)).status, 404);
});
