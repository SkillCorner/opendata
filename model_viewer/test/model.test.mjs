// The JavaScript models must reproduce the notebook's Python models (fixtures from scripts/make_fixtures.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createModel, PROT_BEHIND_M, PROTECT_OUT} from '../public/model.js';

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

    test(`frame ${c.frame} ${version} integrity follows the notebook's protection definition`, () => {
      const out = model.compute(toState(c), version), V = model.V_LOC;
      let num = 0, den = 0;
      for (let k = 0; k < model.N; k++) {
        const inZone = model.cellX[k] >= c.ball[0] - PROT_BEHIND_M;
        if (inZone) {
          num += V[k] * (1 - out.pSucc[k]); den += V[k];
          assert.equal(out.protect[k], 1 - out.pSucc[k]);
        } else assert.equal(out.protect[k], PROTECT_OUT);
      }
      assert.ok(Math.abs(out.integrity - num / den) < 1e-12);
      assert.ok(out.integrity > 0 && out.integrity < 1);
      // the same, from the Python P_succ fixture (every 7th cell): a check against the notebook's own numbers
      let pn = 0, pd = 0, jn = 0, jd = 0;
      ref(c, version).cells.forEach((k, j) => {
        if (model.cellX[k] < c.ball[0] - PROT_BEHIND_M) return;
        pn += V[k] * (1 - ref(c, version).p_succ[j]); pd += V[k];
        jn += V[k] * (1 - out.pSucc[k]); jd += V[k];
      });
      assert.ok(Math.abs(pn / pd - jn / jd) < 1e-5, 'sampled integrity agrees with Python P_succ');
    });
  }
}

function ref(c, version) { return c[version]; }
