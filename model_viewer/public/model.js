// Pitch control and value models: a line-for-line port of Sections 2–4b of
// notebooks/defensive_shape_integrity.ipynb (pitch_control, time_to_reach, context_value).
// Runs in the browser and in Node (tests compare it with the Python output in test/fixtures.json).
//
// Every computation is in the ATTACKING frame: the team in possession attacks towards +x,
// and the defending team protects the goal at x = +52.5.

const sig = z => 1 / (1 + Math.exp(-z));
const clip = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// numpy rounds halves to the nearest even integer; match it so grid lookups agree exactly
const roundHalfEven = v => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };
const FRACS = Array.from({length: 8}, (_, i) => 0.15 + i * (0.75 / 7));   // np.linspace(0.15, 0.9, 8)
export const PROT_BEHIND_M = 5;     // the protection zone starts 5 m behind the ball (notebook: CELLS[:, 0] >= ball[0] - 5)
export const PROTECT_OUT = -1;      // marks cells outside the protection zone

export function createModel(models) {
  const {x0, y0, nx, ny, half_l: HALF_L} = models.grid;
  const N = nx * ny;
  const CX = new Float64Array(N), CY = new Float64Array(N);
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) { CX[iy * nx + ix] = x0 + ix; CY[iy * nx + ix] = y0 + iy; }
  const VM = models.value;
  const V_LOC = Float64Array.from(VM.V_loc);
  const V_OPP = new Float64Array(N);                     // V[::-1, ::-1]: the opponent's value if the ball is lost here
  for (let k = 0; k < N; k++) V_OPP[k] = V_LOC[N - 1 - k];
  const LOFT_MIN = models.constants.LOFT_MIN_DIST;
  const COS_CONE = Math.cos(VM.cone_deg * Math.PI / 180);
  const lookup = (x, y) => {                             // value_at(): nearest grid cell, clipped to the pitch
    const ix = clip(roundHalfEven(x + HALF_L - 0.5), 0, nx - 1);
    const iy = clip(roundHalfEven(y + models.grid.half_w - 0.5), 0, ny - 1);
    return iy * nx + ix;
  };

  // buffers reused between frames, per settings version
  const buffers = {};
  const buf = (key, len) => (buffers[key] && buffers[key].length === len) ? buffers[key] : (buffers[key] = new Float64Array(len));

  /** Facing: direction of travel if moving faster than 1.5 m/s, otherwise towards the ball. */
  function facing(s) {
    const fx = new Float64Array(s.n), fy = new Float64Array(s.n);
    for (let i = 0; i < s.n; i++) {
      const moving = Math.hypot(s.vx[i], s.vy[i]) > 1.5;
      const ax = moving ? s.vx[i] : s.ball[0] - s.x[i], ay = moving ? s.vy[i] : s.ball[1] - s.y[i];
      const nrm = Math.hypot(ax, ay) + 1e-9;
      fx[i] = ax / nrm; fy[i] = ay / nrm;
    }
    return {fx, fy};
  }

  /** Arrival time of player i at (tx, ty): react, then accelerate to top speed, plus a turn penalty. */
  function arrive(s, i, f, set, tx, ty) {
    const a = s.amax[i] * set.ACC_SCALE, vm = s.vmax[i];
    const px = s.x[i] + s.vx[i] * set.T_REACT, py = s.y[i] + s.vy[i] * set.T_REACT;
    const dx = tx - px, dy = ty - py, d = Math.hypot(dx, dy);
    const dAcc = vm * vm / (2 * a);
    let t = set.T_REACT + (d < dAcc ? Math.sqrt(2 * d / a) : vm / a + (d - dAcc) / vm);
    if (d > 1.0) {
      const c = clip((dx * f.fx[i] + dy * f.fy[i]) / (d + 1e-9), -1, 1);
      t += Math.acos(c) / set.OMEGA;
    }
    return t;
  }

  /** Min arrival time over attackers and over defenders (goalkeepers included), for every cell. */
  function arrivalGrids(s, set, key) {
    const f = facing(s);
    const tAtt = buf(key + ':att', N), tDef = buf(key + ':def', N);
    tAtt.fill(Infinity); tDef.fill(Infinity);
    for (let i = 0; i < s.n; i++) {
      const target = s.att[i] ? tAtt : tDef;
      for (let k = 0; k < N; k++) { const t = arrive(s, i, f, set, CX[k], CY[k]); if (t < target[k]) target[k] = t; }
    }
    return {tAtt, tDef, f};
  }

  /** P_att (pitch control) and P_succ (pass success) for every cell. */
  function pitchControl(s, set, key) {
    const K = Math.PI / (Math.sqrt(3) * set.SIGMA);
    const {tAtt, tDef, f} = arrivalGrids(s, set, key);
    const pAtt = buf(key + ':patt', N), pSucc = buf(key + ':psucc', N);
    const eff = (t, tb) => Math.max(t, tb) + set.TIE_BREAK * t;
    const [bx, by] = s.ball;
    for (let k = 0; k < N; k++) {
      const dist = Math.hypot(CX[k] - bx, CY[k] - by);
      const tb = dist / set.V_BALL;
      const pa = sig(K * (eff(tDef[k], tb) - eff(tAtt[k], tb)));
      pAtt[k] = pa;
      // interception: can a defender reach a point on the ball's path before the ball?
      let pInt = 0;
      for (const fr of FRACS) {
        const qx = bx + fr * (CX[k] - bx), qy = by + fr * (CY[k] - by);
        const dq = Math.hypot(qx - bx, qy - by);
        if (dq > 2.0) pInt = Math.max(pInt, sig(K * (dq / set.V_BALL - tDef[lookup(qx, qy)])));
      }
      const pGround = (1 - pInt) * pa;
      // lofted alternative: no interception, slower ball, harder first touch
      let pLoft = 0;
      if (dist > LOFT_MIN) {
        const tl = dist / set.V_LOFT + set.T_HANG;
        pLoft = set.LOFT_CONTROL * sig(K * (eff(tDef[k], tl) - eff(tAtt[k], tl)));
      }
      pSucc[k] = Math.max(pGround, pLoft);
    }
    return {pAtt, pSucc, tDef, f};
  }

  /** v2 value: location value × multiplier for the defensive situation at each point (Section 4b). */
  function contextValueAt(s, px, py, pressureT, base) {
    let nearest = Infinity, ahead = 0;
    const gx = HALF_L - px, gy = -py, dGoal = Math.hypot(gx, gy);
    for (let i = 0; i < s.n; i++) {
      if (s.att[i]) continue;
      const dx = s.x[i] - px, dy = s.y[i] - py, d = Math.hypot(dx, dy);
      if (d < nearest) nearest = d;
      const cos = (dx * gx + dy * gy) / (d * dGoal + 1e-9);
      const closer = Math.hypot(s.x[i] - HALF_L, s.y[i]) < dGoal;
      if (cos > COS_CONE && closer) ahead++;
    }
    const F = [clip(pressureT, 0, VM.pressure_cap_s), Math.log1p(clip(nearest, 0, VM.nearest_cap_m)), ahead];
    const close = Math.exp(-dGoal / VM.near_goal_scale_m);
    let z = VM.intercept;
    for (let j = 0; j < 3; j++) z += VM.coef[j] * F[j] + VM.coef[j + 3] * F[j] * close;
    return base * Math.exp(z);
  }

  /**
   * Compute one model version for one frame.
   * s: {n, x, y, vx, vy, vmax, amax, att, ball:[x, y]} in the attacking frame.
   * version: 'v0' (literature settings, location-only value) or 'v2' (fitted settings, context value).
   * Returns Float64Arrays over the 105 × 68 grid (row = y): pAtt, pSucc, value, gain, protect;
   * and two numbers: vBall, integrity.
   */
  function compute(s, version) {
    const set = models.settings[version];
    const {pAtt, pSucc, tDef, f} = pitchControl(s, set, version);
    const value = buf(version + ':value', N), gain = buf(version + ':gain', N);
    let vBall;
    if (version === 'v0') {
      value.set(V_LOC);
      vBall = V_LOC[lookup(s.ball[0], s.ball[1])];
    } else {
      for (let k = 0; k < N; k++) value[k] = contextValueAt(s, CX[k], CY[k], tDef[k], V_LOC[k]);
      let tb = Infinity;
      for (let i = 0; i < s.n; i++) if (!s.att[i]) tb = Math.min(tb, arrive(s, i, f, set, s.ball[0], s.ball[1]));
      vBall = contextValueAt(s, s.ball[0], s.ball[1], tb, V_LOC[lookup(s.ball[0], s.ball[1])]);
    }
    for (let k = 0; k < N; k++) gain[k] = pSucc[k] * value[k] - (1 - pSucc[k]) * V_OPP[k] - vBall;
    const {protect, integrity} = protection(s, pSucc, version);
    return {pAtt, pSucc, value, gain, vBall, protect, integrity};
  }

  /**
   * Integrity I = protection (Section 5 of the notebook, definition chosen in Section 8b):
   * how well the defence denies passes into the valuable space between the ball and goal.
   *   zone: cells at most 5 m behind the ball, up to the goal line ("ballgoal")
   *   I = Σ_zone V_loc · (1 − P_succ) / Σ_zone V_loc
   * Both versions weight by the location value V_loc, as the notebook does; only P_succ differs.
   * protect[k] = 1 − P_succ inside the zone, PROTECT_OUT outside it.
   */
  function protection(s, pSucc, key) {
    const protect = buf(key + ':protect', N), x0 = s.ball[0] - PROT_BEHIND_M;
    let num = 0, den = 0;
    for (let k = 0; k < N; k++) {
      if (CX[k] >= x0) { const deny = 1 - pSucc[k]; protect[k] = deny; num += V_LOC[k] * deny; den += V_LOC[k]; }
      else protect[k] = PROTECT_OUT;
    }
    return {protect, integrity: den > 0 ? num / den : NaN};
  }

  return {compute, grid: models.grid, N, cellX: CX, cellY: CY, lookup, V_LOC};
}
