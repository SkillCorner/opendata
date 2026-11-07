// One worker per model version. It computes every frame of the loaded clip, starting at the playhead
// ("focus") and working forwards, and sends back all five surfaces quantised to Int16 (value × 32767).
import {createModel} from './model.js';

let model = null, version = null, states = [], done = [], clipId = -1, focus = 0, busy = false;

self.onmessage = e => {
  const m = e.data;
  if (m.type === 'init') { model = createModel(m.models); version = m.version; }
  else if (m.type === 'clip') { clipId = m.clipId; states = m.states; done = new Array(states.length).fill(false); focus = 0; schedule(); }
  else if (m.type === 'focus' && m.clipId === clipId) { focus = m.i; schedule(); }
};

function nextIndex() {
  for (let k = 0; k < states.length; k++) { const i = (focus + k) % states.length; if (!done[i]) return i; }
  return -1;
}
function schedule() { if (!busy) { busy = true; setTimeout(step, 0); } }
function step() {
  busy = false;
  const i = nextIndex();
  if (i < 0 || !model) return;
  done[i] = true;
  const s = states[i];
  if (!s) self.postMessage({clipId, version, i, q: null, integrity: null});
  else {
    const out = model.compute(s, version), N = model.N, q = new Int16Array(5 * N);
    const put = (arr, off) => { for (let k = 0; k < N; k++) q[off + k] = Math.round(Math.max(-1, Math.min(1, arr[k])) * 32767); };
    put(out.pAtt, 0); put(out.pSucc, N); put(out.value, 2 * N); put(out.gain, 3 * N); put(out.protect, 4 * N);
    self.postMessage({clipId, version, i, q, vBall: out.vBall, integrity: out.integrity}, [q.buffer]);
  }
  schedule();
}
