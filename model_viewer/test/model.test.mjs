// The JavaScript models must reproduce the notebook's Python models (fixtures from scripts/make_fixtures.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createModel} from '../public/model.js';

const models = JSON.parse(readFileSync(new URL('../data/models.json', import.meta.url)));
const cases = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)));
const model = createModel(models);

const toState = c => {
  const p = c.players, n = p.length, arr = k => Float64Array.from(p.map(r => r[k]));
  return {n, x: arr('x'), y: arr('y'), vx: arr('vx'), vy: arr('vy'), vmax: arr('vmax'), amax: arr('amax'),
          att: Uint8Array.from(p.map(r => r.att ? 1 : 0)), ball: c.ball};
};

for (const c of cases) {
  for (const version of ['v0', 'v2']) {
    test(`frame ${c.frame} ${version} matches the Python model`, () => {
      const t0 = performance.now();
      const out = model.compute(toState(c), version);
      const ms = performance.now() - t0;
      const ref = c[version];
      let worst = {p_att: 0, p_succ: 0, value: 0, gain: 0};
      ref.cells.forEach((k, j) => {
        worst.p_att = Math.max(worst.p_att, Math.abs(out.pAtt[k] - ref.p_att[j]));
        worst.p_succ = Math.max(worst.p_succ, Math.abs(out.pSucc[k] - ref.p_succ[j]));
        worst.value = Math.max(worst.value, Math.abs(out.value[k] - ref.value[j]));
        worst.gain = Math.max(worst.gain, Math.abs(out.gain[k] - ref.gain[j]));
      });
      console.log(`  frame ${c.frame} ${version}: ${ms.toFixed(0)} ms, worst |Δ|`, Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, v.toExponential(1)])));
      assert.ok(worst.p_att < 1e-5 && worst.p_succ < 1e-5, 'probabilities');
      assert.ok(worst.value < 1e-6 && worst.gain < 1e-6, 'value and gain');
      assert.ok(Math.abs(out.vBall - ref.v_ball) < 1e-6, 'ball value');
    });
  }
}
