// Pitch Model Lab: pick a sequence, play it back, and compare v0 and v2 pitch control / EPV / gain / integrity surfaces.
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const getJSON = async url => { const r = await fetch(url); if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`); return r.json(); };

// ---------------- colour scales ----------------
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const ramp = stops => { const c = stops.map(hex); return t => {
  t = Math.min(1, Math.max(0, t)) * (c.length - 1); const i = Math.min(c.length - 2, Math.floor(t)), f = t - i;
  return [0, 1, 2].map(j => c[i][j] + (c[i + 1][j] - c[i][j]) * f); }; };
const RDBU = ramp(['#2166ac', '#92c5de', '#f7f7f7', '#f4a582', '#b2182b']);
const MAGMA = ramp(['#fcfdbf', '#feb078', '#f1605d', '#9e2f7f', '#440f76']);
const PUOR = ramp(['#5e3c99', '#b2abd2', '#f7f7f7', '#fdb863', '#e66101']);
const EPV_LO = Math.log(0.018), EPV_HI = Math.log(0.15);
const SCALES = {
  pc:   {map: v => RDBU(v), lo: '0 · defence', mid: '0.5', hi: '1 · attack', diff: 0.5},
  epv:  {map: v => MAGMA((Math.log(Math.max(v, 1e-4)) - EPV_LO) / (EPV_HI - EPV_LO)), lo: '0.018', mid: '0.05', hi: '0.15+ (log scale)', diff: 0.05},
  gain: {map: v => RDBU(0.5 + v / 0.12), lo: '−0.06 · loses value', mid: '0', hi: '+0.06 · gains', diff: 0.05},
  integ: {map: v => RDBU(1 - v), lo: '0 · pass there gets through', mid: '0.5', hi: '1 · denied', diff: 0.5},
};
const PROTECT_OUT = -1, PROT_BEHIND_M = 5;   // same as model.js: cells outside the ball → goal zone, and where the zone starts
const TEXT = {
  pc: {v0: ['v0 · literature settings', 'reaction 0.5 s · ground ball 15 m/s · σ 0.45 · lofted 12 m/s'],
       v2: ['v2 · fitted settings', 'reaction 0.10 s · ground ball 17.3 m/s · σ 0.62 · lofted 20 m/s · fitted on 15 matches']},
  epv: {v0: ['v0 · location only', 'SkillCorner EPV smoothed by location'],
        v2: ['v2 · location + defensive context', '× pressure time, nearest defender, defenders goal-side']},
  gain: {v0: ['v0 · literature PC × location value', 'P_succ·V − (1−P_succ)·V_opp − V(ball)'],
         v2: ['v2 · fitted PC × context value', 'P_succ·V − (1−P_succ)·V_opp − V(ball)']},
  integ: {v0: ['v0 · literature pitch control', '1 − P_succ from 5 m behind the ball to goal, weighted by V'],
          v2: ['v2 · fitted pitch control', '1 − P_succ from 5 m behind the ball to goal, weighted by V']},
};

// ---------------- state ----------------
const S = {
  models: null, matches: [], match: null, roster: new Map(), seq: null, filter: 'goal',
  clip: null,               // {id, frames, states, attTeam, flip, period}
  res: {v0: [], v2: []}, vBall: {v0: [], v2: []}, integ: {v0: [], v2: []}, clipId: 0,
  i: 0, playing: false, speed: 1, acc: 0, last: 0,
  layer: 'pc', pcKind: 'att', view: 'side', single: 'v2', hover: null, panels: [],
};
const workers = {};
const N = 105 * 68, NX = 105, NY = 68;

// ---------------- boot ----------------
async function boot() {
  [S.models, S.matches] = await Promise.all([getJSON('data/models.json'), getJSON('data/matches.json')]);
  const vl = S.models.value.V_loc, vmax = Math.max(...vl);
  S.weight = Float32Array.from(vl, v => 0.25 + 0.75 * Math.sqrt(v / vmax));   // integrity map: fade space that counts little in I
  $('#itrackCanvas').addEventListener('click', e => {
    if (!S.clip) return;
    const r = e.currentTarget.getBoundingClientRect();
    stop(); setIndex(Math.round((e.clientX - r.left) / r.width * (S.clip.frames.length - 1)));
  });
  for (const v of ['v0', 'v2']) {
    const w = new Worker('worker.js', {type: 'module'});
    w.postMessage({type: 'init', models: S.models, version: v});
    w.onmessage = onResult;
    workers[v] = w;
  }
  $('#match').innerHTML = S.matches.map(m => `<option value="${m.id}">${m.date} · ${m.label}${m.test_match ? ' · held-out' : ''}</option>`).join('');
  wireControls();
  const h = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  for (const [k, key] of [['l', 'layer'], ['k', 'pcKind'], ['v', 'view'], ['o', 'single']]) if (h[k]) S[key] = h[k];
  syncToggles();
  await selectMatch(Number(h.m) || 1925299, h.s ? Number(h.s) : null);
}

function wireControls() {
  $('#aboutBtn').onclick = () => { const a = $('#about'); a.hidden = !a.hidden; $('#aboutBtn').setAttribute('aria-expanded', String(!a.hidden)); };
  $('#match').onchange = e => selectMatch(Number(e.target.value), null);
  $$('#filter button').forEach(b => b.onclick = () => { S.filter = b.dataset.f; syncToggles(); renderSeqList(); });
  const seg = (id, key, after) => $$(`#${id} button`).forEach(b => b.onclick = () => {
    S[key] = id === 'speed' ? Number(b.dataset.v) : b.dataset.v; syncToggles(); after?.(); writeHash(); });
  seg('layer', 'layer', buildPanels); seg('pcKind', 'pcKind', draw); seg('view', 'view', buildPanels); seg('single', 'single', buildPanels); seg('speed', 'speed');
  $('#play').onclick = togglePlay;
  $('#back').onclick = () => step(-1);
  $('#fwd').onclick = () => step(1);
  $('#scrub').oninput = e => { setIndex(Number(e.target.value)); };
  $('#cLoad').onclick = loadCustom;
  document.addEventListener('keydown', e => {
    if (['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  window.addEventListener('resize', () => { sizeCanvases(); draw(); });
}

function syncToggles() {
  const set = (id, val) => $$(`#${id} button`).forEach(b => b.setAttribute('aria-checked', String(b.dataset.v ?? b.dataset.f) === String(val)));
  set('filter', S.filter); set('layer', S.layer); set('pcKind', S.pcKind); set('view', S.view); set('single', S.single); set('speed', S.speed);
  $('#pcKind').hidden = S.layer !== 'pc';
  $('#single').hidden = S.view !== 'single';
}
function writeHash() {
  const p = new URLSearchParams({m: S.match?.id ?? '', l: S.layer, k: S.pcKind, v: S.view, o: S.single});
  if (S.seq) p.set('s', S.seq.start);
  history.replaceState(null, '', '#' + p);
}

// ---------------- match + sequences ----------------
async function selectMatch(id, seqStart) {
  $('#match').value = String(id);
  S.match = await getJSON(`data/match/${id}.json`);
  S.roster = new Map(S.match.players.map(p => [p.id, p]));
  const seq = seqStart != null ? S.match.sequences.find(s => s.start === seqStart) : null;
  if (seq) S.filter = seq.outcome === 'goal' ? 'goal' : ['shot', 'goal'].includes(seq.outcome) ? 'shot' : (seq.max_epv ?? 0) >= 0.1 ? 'epv' : 'all';
  else S.filter = S.match.sequences.some(s => s.outcome === 'goal') ? 'goal' : 'shot';
  syncToggles(); renderSeqList();
  const first = seq || filtered()[0];
  if (first) loadSequence(first);
}
const teamName = id => (S.match.home.id === id ? S.match.home : S.match.away).short_name;
function filtered() {
  const f = S.filter, ss = S.match.sequences;
  if (f === 'goal') return ss.filter(s => s.outcome === 'goal');
  if (f === 'shot') return ss.filter(s => s.outcome === 'goal' || s.outcome === 'shot');
  if (f === 'epv') return ss.filter(s => (s.max_epv ?? 0) >= 0.1 || s.outcome === 'goal');
  return ss;
}
function renderSeqList() {
  const list = filtered();
  const chain = s => { const p = s.players; return p.length <= 5 ? p.join(' → ') : `${p.slice(0, 2).join(' → ')} → … → ${p.slice(-2).join(' → ')}`; };
  $('#seqList').innerHTML = list.length ? list.map(s => `<li><button data-s="${s.start}" aria-current="${S.seq?.start === s.start}">
      <span class="t"><span>${s.clock} · ${teamName(s.team_id)}</span><span class="badge ${s.outcome}">${s.outcome.replace('_', ' ')}</span></span>
      <span class="p">${s.n} action${s.n > 1 ? 's' : ''} · ${chain(s)}</span></button></li>`).join('')
    : '<li class="empty">No sequences of this kind in this match.</li>';
  $$('#seqList button').forEach(b => b.onclick = () => loadSequence(S.match.sequences.find(s => s.start === Number(b.dataset.s))));
}

function sideOf(teamId, period) {
  const home = S.match.home_team_side[period - 1];
  return teamId === S.match.home.id ? home : home === 'left_to_right' ? 'right_to_left' : 'left_to_right';
}

async function loadSequence(seq) {
  S.seq = seq;
  $$('#seqList button').forEach(b => b.setAttribute('aria-current', String(Number(b.dataset.s) === seq.start)));
  const per = S.match.periods.find(p => p.period === seq.period);
  let start = Math.max(per.start, seq.start - 30), end = Math.min(per.end, seq.end + 30);
  if (end - start > 880) start = end - 880;
  await loadClip(start, end, seq.team_id, seq.period);
  writeHash();
}

async function loadCustom() {
  const period = Number($('#cPeriod').value);
  const [mm, ss] = $('#cStart').value.split(':').map(Number);
  const len = Math.min(88, Math.max(2, Number($('#cLen').value) || 20));
  const per = S.match.periods.find(p => p.period === period);
  if (!per || !Number.isFinite(mm)) return status('Enter the start as mm:ss.', true);
  const clockStart = period === 2 ? 45 * 60 : 0;
  const start = Math.max(per.start, Math.round(per.start + ((mm * 60 + (ss || 0)) - clockStart) * 10));
  const end = Math.min(per.end, start + len * 10);
  S.seq = null; $$('#seqList button').forEach(b => b.setAttribute('aria-current', 'false'));
  await loadClip(start, end, null, period);
  writeHash();
}

// ---------------- clip ----------------
async function loadClip(start, end, teamId, period) {
  stop();
  const clipId = ++S.clipId;
  status('Loading tracking…');
  let data;
  try { data = await getJSON(`api/clip/${S.match.id}?start=${start - 2}&end=${end + 2}`); }
  catch (e) { return status(`Could not load tracking: ${e.message}`, true); }
  if (clipId !== S.clipId) return;
  const frames = data.frames.filter(f => f.p === period || f.p == null);
  if (!frames.length) return status('No tracking in that window.', true);
  if (teamId == null) {             // custom clip: attack = team in possession at the first frame that says
    const g = frames.find(f => f.g)?.g;
    teamId = g === 'away team' ? S.match.away.id : S.match.home.id;
  }
  S.clip = {frames, period, start, end, byF: new Map(frames.map(f => [f.f, f]))};
  S.i = Math.max(0, frames.findIndex(f => f.f >= start));
  setAttack(teamId);
}

function setAttack(teamId) {
  const c = S.clip, clipId = ++S.clipId;
  c.attTeam = teamId;
  c.flip = sideOf(teamId, c.period) === 'right_to_left';
  c.states = buildStates(c.frames, teamId, c.flip);
  S.res = {v0: new Array(c.frames.length), v2: new Array(c.frames.length)};
  S.vBall = {v0: [], v2: []};
  S.integ = {v0: new Array(c.frames.length).fill(null), v2: new Array(c.frames.length).fill(null)};
  for (const v of ['v0', 'v2']) {
    workers[v].postMessage({type: 'clip', clipId, states: c.states});
    workers[v].postMessage({type: 'focus', clipId, i: S.i});
  }
  const other = teamId === S.match.home.id ? S.match.away : S.match.home;
  $('#attackLabel').innerHTML = `<span class="dot" style="background:var(--attack)"></span> ${teamName(teamId)} attacking ${c.flip ? '←' : '→'}
    &nbsp;<span class="dot" style="background:var(--defend)"></span> ${other.short_name} defending
    <button class="ghost" id="swap" style="margin-left:8px;padding:2px 9px;font-size:12px">Swap</button>`;
  $('#swap').onclick = () => setAttack(other.id);
  $('#scrub').max = String(c.frames.length - 1);
  renderTicks();
  syncIndex();
  buildPanels();
  status('');
}

function buildStates(frames, attTeam, flip) {
  const byF = new Map(frames.map(f => [f.f, f])), sgn = flip ? -1 : 1;
  return frames.map(fr => {
    if (!fr.b) return null;
    const prev = byF.get(fr.f - 2) || fr, next = byF.get(fr.f + 2) || fr;
    const pm = new Map(prev.pl.map(p => [p[0], p])), nm = new Map(next.pl.map(p => [p[0], p]));
    const rows = fr.pl.filter(p => S.roster.has(p[0]));
    const n = rows.length, s = {n, x: new Float64Array(n), y: new Float64Array(n), vx: new Float64Array(n), vy: new Float64Array(n),
      vmax: new Float64Array(n), amax: new Float64Array(n), att: new Uint8Array(n), ball: [fr.b[0] * sgn, fr.b[1] * sgn]};
    rows.forEach((p, i) => {
      const a = pm.get(p[0]) || p, c = nm.get(p[0]) || p, r = S.roster.get(p[0]);
      s.x[i] = p[1] * sgn; s.y[i] = p[2] * sgn;
      s.vx[i] = (c[1] - a[1]) * sgn / 0.4; s.vy[i] = (c[2] - a[2]) * sgn / 0.4;
      s.vmax[i] = r.vmax; s.amax[i] = r.amax; s.att[i] = r.team_id === attTeam ? 1 : 0;
    });
    return s;
  });
}

function onResult(e) {
  const m = e.data;
  if (m.clipId !== S.clipId) return;
  S.res[m.version][m.i] = m.q || 'empty';
  S.vBall[m.version][m.i] = m.vBall;
  S.integ[m.version][m.i] = Number.isFinite(m.integrity) ? m.integrity : null;
  if (m.i === S.i) draw();
  else if (S.layer === 'integ') drawTrack();
  progress();
}
function progress() {
  const n = S.clip?.frames.length || 0, d = v => S.res[v].filter(x => x !== undefined).length;
  const a = d('v0'), b = d('v2');
  $('#progress').textContent = n && (a < n || b < n) ? `computing models · v0 ${a}/${n} · v2 ${b}/${n}` : n ? `models ready · ${n} frames` : '';
}

// ---------------- playback ----------------
const needed = () => S.view === 'single' ? [S.single] : ['v0', 'v2'];
const ready = i => needed().every(v => S.res[v][i] !== undefined);
function togglePlay() { S.playing ? stop() : play(); }
function play() {
  if (!S.clip) return;
  if (S.i >= S.clip.frames.length - 1) setIndex(0);
  S.playing = true; S.last = performance.now(); S.acc = 0; $('#play').textContent = '❚❚'; $('#play').setAttribute('aria-label', 'Pause');
  requestAnimationFrame(tick);
}
function stop() { S.playing = false; $('#play').textContent = '▶'; $('#play').setAttribute('aria-label', 'Play'); }
function tick(now) {
  if (!S.playing) return;
  S.acc += (now - S.last) / 1000 * 10 * S.speed; S.last = now;
  let moved = false;
  while (S.acc >= 1) {
    if (S.i >= S.clip.frames.length - 1) { stop(); break; }
    if (!ready(S.i + 1)) { status('buffering models…'); S.acc = 0; break; }
    S.i++; S.acc -= 1; moved = true;
  }
  if (moved) { status(''); syncIndex(); draw(); }
  requestAnimationFrame(tick);
}
function step(d) { stop(); setIndex(S.i + d); }
function setIndex(i) {
  if (!S.clip) return;
  S.i = Math.max(0, Math.min(S.clip.frames.length - 1, i));
  for (const v of ['v0', 'v2']) workers[v].postMessage({type: 'focus', clipId: S.clipId, i: S.i});
  syncIndex(); draw();
}
function syncIndex() {
  const f = S.clip.frames[S.i];
  $('#scrub').value = String(S.i);
  const t = f.t ? f.t.split(':') : null;
  const clock = t ? `${Number(t[0]) * 60 + Number(t[1])}:${t[2].slice(0, 2)}` : '—';
  $('#clock').textContent = `${clock} · P${f.p ?? '?'} · frame ${f.f}`;
  $('#caption').textContent = captionAt(f.f);
}
function captionAt(fr) {
  if (!S.seq) return '';
  const ps = S.seq.possessions;
  const now = ps.find(p => fr >= p.start && fr <= p.end + 2);
  if (now) return `${now.player} · ${now.end_type === 'pass' ? `pass${now.target ? ' → ' + now.target : ''}` : now.end_type.replace('_', ' ')}`;
  const prev = [...ps].reverse().find(p => p.end < fr);
  if (prev && prev.end_type === 'pass' && ps.some(p => p.start > fr)) return `ball travelling${prev.target ? ' → ' + prev.target : ''}`;
  return '';
}
function renderTicks() {
  const c = S.clip, n = c.frames.length - 1, first = c.frames[0].f, last = c.frames[n].f;
  const marks = S.seq ? S.seq.possessions.map(p => ({f: p.start, shot: p.end_type === 'shot'})) : [];
  $('#ticks').innerHTML = marks.filter(m => m.f >= first && m.f <= last)
    .map(m => `<i class="${m.shot ? 'shot' : ''}" style="left:${(m.f - first) / (last - first) * 100}%"></i>`).join('');
}

// ---------------- drawing ----------------
const WORLD = {x0: -55.5, x1: 55.5, y0: -37, y1: 37};
function buildPanels() {
  syncToggles();
  const specs = S.view === 'side' ? [{ver: 'v0'}, {ver: 'v2'}] : S.view === 'single' ? [{ver: S.single}] : [{diff: true}];
  $('#pitches').className = 'pitches' + (specs.length === 1 ? ' one' : '');
  $('#pitches').innerHTML = specs.map((s, j) => {
    const [title, sub] = s.diff ? ['v2 − v0', 'orange: v2 higher · purple: v2 lower'] : TEXT[S.layer][s.ver];
    return `<div class="pitchCard"><span class="vball" data-j="${j}"></span><h3>${title}</h3><p>${sub}</p><canvas data-j="${j}"></canvas></div>`;
  }).join('');
  S.panels = specs.map((s, j) => ({...s, canvas: $(`#pitches canvas[data-j="${j}"]`), vball: $(`.vball[data-j="${j}"]`)}));
  S.panels.forEach(p => {
    p.canvas.addEventListener('mousemove', e => hover(e, p.canvas));
    p.canvas.addEventListener('mouseleave', () => { S.hover = null; draw(); readout(); });
  });
  sizeCanvases(); renderLegend(); draw();
}
function sizeCanvases() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  S.panels.forEach(p => {
    const w = p.canvas.clientWidth || 600, h = w * (WORLD.y1 - WORLD.y0) / (WORLD.x1 - WORLD.x0);
    p.canvas.width = Math.round(w * dpr); p.canvas.height = Math.round(h * dpr); p.canvas.style.height = `${h}px`;
    p.scale = p.canvas.width / (WORLD.x1 - WORLD.x0);
  });
}
const off = Object.assign(document.createElement('canvas'), {width: NX, height: NY});
const offCtx = off.getContext('2d');
const img = offCtx.createImageData(NX, NY);

function field(ver, i) {
  const q = S.res[ver][i];
  if (!q || q === 'empty') return null;
  if (S.layer === 'integ') return k => q[4 * N + k] === PROTECT_OUT * 32767 ? NaN : q[4 * N + k] / 32767;
  const o = S.layer === 'pc' ? (S.pcKind === 'att' ? 0 : N) : S.layer === 'epv' ? 2 * N : S.layer === 'gain' ? 3 * N : 4 * N;
  return k => q[o + k] / 32767;
}
function paintSurface(ctx, p, get) {
  const sc = SCALES[S.layer], flip = S.clip.flip;
  for (let r = 0; r < NY; r++) for (let ix = 0; ix < NX; ix++) {
    const iy = NY - 1 - r, kRaw = iy * NX + ix, k = flip ? N - 1 - kRaw : kRaw;
    const v = get(k);
    let R, G, B;
    if (Number.isNaN(v)) [R, G, B] = OUT_RGB;          // integrity layer: outside the ball → goal zone
    else {
      [R, G, B] = p.diff ? PUOR(0.5 + v / (2 * sc.diff)) : sc.map(v);
      if (S.layer === 'integ' && !p.diff) { const w = S.weight[k]; R = BG_RGB[0] + (R - BG_RGB[0]) * w; G = BG_RGB[1] + (G - BG_RGB[1]) * w; B = BG_RGB[2] + (B - BG_RGB[2]) * w; }
    }
    const o = (r * NX + ix) * 4; img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = 255;
  }
  offCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const [x, y] = toPx(p, -52.5, 34);
  ctx.drawImage(off, x, y, 105 * p.scale, 68 * p.scale);
}
const BG_RGB = [233, 236, 228], OUT_RGB = [214, 216, 210];
const toPx = (p, x, y) => [(x - WORLD.x0) * p.scale, (WORLD.y1 - y) * p.scale];

function draw() {
  if (!S.clip || !S.panels.length) return;
  const fr = S.clip.frames[S.i];
  for (const p of S.panels) {
    const ctx = p.canvas.getContext('2d'), W = p.canvas.width, H = p.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#e9ece4'; ctx.fillRect(0, 0, W, H);
    let get = null;
    if (p.diff) { const a = field('v0', S.i), b = field('v2', S.i); if (a && b) get = k => b(k) - a(k); }
    else get = field(p.ver, S.i);
    if (get) paintSurface(ctx, p, get);
    drawPitch(ctx, p);
    if (S.layer === 'integ' && fr.b) drawZone(ctx, p, fr);
    drawPlayers(ctx, p, fr);
    if (S.hover) crosshair(ctx, p);
    if (!get) { ctx.fillStyle = 'rgba(29,31,34,.7)'; ctx.font = `${12 * p.scale / 6}px system-ui`; ctx.fillText(fr.b ? 'computing…' : 'ball not tracked in this frame', 10 * p.scale / 6, 18 * p.scale / 6); }
    p.vball.classList.toggle('score', S.layer === 'integ');
    if (S.layer === 'integ') {
      const I = ver => S.integ[ver][S.i], fmt = x => x == null ? '…' : x.toFixed(2);
      p.vball.textContent = p.diff ? (I('v0') != null && I('v2') != null ? `ΔI ${(I('v2') - I('v0') >= 0 ? '+' : '−')}${Math.abs(I('v2') - I('v0')).toFixed(2)}` : '')
        : `I ${fmt(I(p.ver))}`;
    } else {
      const vb = p.diff ? null : S.vBall[p.ver][S.i];
      p.vball.textContent = (S.layer !== 'pc' && vb != null) ? `V(ball) ${vb.toFixed(3)}` : '';
    }
  }
  drawTrack();
  readout();
}
// integrity zone: from 5 m behind the ball (in the attacking direction) to the goal line
function drawZone(ctx, p, fr) {
  const sgn = S.clip.flip ? -1 : 1, edge = (fr.b[0] * sgn - PROT_BEHIND_M) * sgn, hw = S.match.pitch[1] / 2;
  if (Math.abs(edge) > 52.5) return;
  ctx.save(); ctx.strokeStyle = 'rgba(17,17,17,.75)'; ctx.lineWidth = Math.max(1, p.scale * 0.2); ctx.setLineDash([p.scale * 1.2, p.scale * 0.8]);
  ctx.beginPath(); ctx.moveTo(...toPx(p, edge, hw)); ctx.lineTo(...toPx(p, edge, -hw)); ctx.stroke(); ctx.restore();
}
// integrity over the whole clip, both versions, with the playhead and the sequence's actions
function drawTrack() {
  const box = $('#itrack');
  box.hidden = S.layer !== 'integ' || !S.clip;
  if (box.hidden) return;
  const c = $('#itrackCanvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round((c.clientWidth || 600) * dpr), H = Math.round(90 * dpr);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const ctx = c.getContext('2d'), n = S.clip.frames.length, css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--muted').trim() || '#62666d', line = css.getPropertyValue('--line').trim() || '#dcdad3';
  const padL = 30 * dpr, padR = 6 * dpr, padT = 6 * dpr, padB = 14 * dpr;
  const X = i => padL + (W - padL - padR) * i / Math.max(1, n - 1), Y = v => padT + (H - padT - padB) * (1 - v);
  ctx.clearRect(0, 0, W, H);
  ctx.font = `${10 * dpr}px system-ui`; ctx.fillStyle = ink; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = line; ctx.lineWidth = dpr;
  for (const v of [0, 0.5, 1]) { ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(W - padR, Y(v)); ctx.stroke(); ctx.fillText(v.toFixed(1), padL - 5 * dpr, Y(v)); }
  // action markers from the sequence
  if (S.seq) {
    const first = S.clip.frames[0].f, last = S.clip.frames[n - 1].f;
    for (const ps of S.seq.possessions) {
      if (ps.start < first || ps.start > last) continue;
      const x = X((ps.start - first) / Math.max(1, last - first) * (n - 1));
      ctx.strokeStyle = ps.end_type === 'shot' ? '#c97a12' : line; ctx.lineWidth = (ps.end_type === 'shot' ? 2 : 1) * dpr;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
    }
  }
  for (const [ver, col, dash] of [['v0', '#9a9a9a', [4 * dpr, 3 * dpr]], ['v2', '#1a9850', []]]) {
    ctx.strokeStyle = col; ctx.lineWidth = (ver === 'v2' ? 2 : 1.5) * dpr; ctx.setLineDash(dash); ctx.beginPath();
    let pen = false;
    S.integ[ver].forEach((v, i) => { if (v == null) { pen = false; return; } pen ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); pen = true; });
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.strokeStyle = css.getPropertyValue('--ink').trim() || '#1d1f22'; ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.moveTo(X(S.i), padT); ctx.lineTo(X(S.i), H - padB); ctx.stroke();
  const done = ['v0', 'v2'].map(v => S.integ[v].filter(x => x != null).length);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = ink;
  ctx.fillText(done.every(d => d >= n - S.clip.frames.filter(f => !f.b).length) ? 'click to jump' : 'filling in as the models compute…', padL, H - 2 * dpr);
}
function drawPitch(ctx, p) {
  const [L, Wd] = S.match.pitch, hl = L / 2, hw = Wd / 2, s = p.scale;
  ctx.strokeStyle = 'rgba(30,32,36,.55)'; ctx.lineWidth = Math.max(1, s * 0.12);
  const rect = (x0, y0, x1, y1) => { const [a, b] = toPx(p, x0, y1), [c, d] = toPx(p, x1, y0); ctx.strokeRect(a, b, c - a, d - b); };
  rect(-hl, -hw, hl, hw);
  ctx.beginPath(); ctx.moveTo(...toPx(p, 0, hw)); ctx.lineTo(...toPx(p, 0, -hw)); ctx.stroke();
  ctx.beginPath(); ctx.arc(...toPx(p, 0, 0), 9.15 * s, 0, 2 * Math.PI); ctx.stroke();
  for (const sgn of [-1, 1]) {
    rect(Math.min(sgn * hl, sgn * (hl - 16.5)), -20.16, Math.max(sgn * hl, sgn * (hl - 16.5)), 20.16);
    rect(Math.min(sgn * hl, sgn * (hl - 5.5)), -9.16, Math.max(sgn * hl, sgn * (hl - 5.5)), 9.16);
    rect(Math.min(sgn * hl, sgn * (hl + 1.5)), -3.66, Math.max(sgn * hl, sgn * (hl + 1.5)), 3.66);
  }
}
function drawPlayers(ctx, p, fr) {
  const s = p.scale, r = Math.max(6, s * 1.15);
  const nx = S.clip.byF.get(fr.f + 2), nm = nx ? new Map(nx.pl.map(q => [q[0], q])) : new Map();
  for (const q of fr.pl) {
    const ro = S.roster.get(q[0]); if (!ro) continue;
    const att = ro.team_id === S.clip.attTeam, [x, y] = toPx(p, q[1], q[2]);
    const n2 = nm.get(q[0]);
    if (n2) {                             // velocity arrow: where they'll be in 1 s
      const [x2, y2] = toPx(p, q[1] + (n2[1] - q[1]) * 5, q[2] + (n2[2] - q[2]) * 5);
      ctx.strokeStyle = att ? 'rgba(228,87,46,.8)' : 'rgba(42,111,219,.8)'; ctx.lineWidth = Math.max(1, s * 0.15);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = att ? '#e4572e' : '#2a6fdb'; ctx.fill();
    ctx.lineWidth = ro.gk ? Math.max(2, s * 0.3) : Math.max(1, s * 0.12); ctx.strokeStyle = ro.gk ? '#111' : 'rgba(0,0,0,.55)';
    if (!q[3]) ctx.setLineDash([3, 2]);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#fff'; ctx.font = `600 ${Math.max(8, r * 1.05)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(ro.number), x, y + 0.5);
  }
  if (fr.b) {
    const [bx, by] = toPx(p, fr.b[0], fr.b[1]);
    ctx.beginPath(); ctx.arc(bx, by, Math.max(3.5, r * 0.55), 0, 2 * Math.PI);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = Math.max(1.5, s * 0.18); ctx.strokeStyle = '#111'; ctx.stroke();
  }
}
function crosshair(ctx, p) {
  const [x, y] = toPx(p, S.hover.x, S.hover.y);
  ctx.strokeStyle = 'rgba(17,17,17,.9)'; ctx.lineWidth = Math.max(1, p.scale * 0.15);
  ctx.beginPath(); ctx.arc(x, y, p.scale * 1.6, 0, 2 * Math.PI); ctx.stroke();
}
function hover(e, canvas) {
  const p = S.panels.find(q => q.canvas === canvas), rect = canvas.getBoundingClientRect();
  const k = canvas.width / rect.width;
  const x = (e.clientX - rect.left) * k / p.scale + WORLD.x0, y = WORLD.y1 - (e.clientY - rect.top) * k / p.scale;
  S.hover = Math.abs(x) <= 52.5 && Math.abs(y) <= 34 ? {x, y} : null;
  draw();
}
function readout() {
  const cells = $$('#readout td');
  if (!S.hover || !S.clip) {
    cells.forEach(c => c.textContent = '');
    if (S.clip) for (const v of ['v0', 'v2']) { const I = S.integ[v][S.i]; $(`#readout td[data-k="${v}-I"]`).textContent = I == null ? '—' : I.toFixed(2); }
    $('#readoutCap').textContent = 'Hover over a pitch to compare v0 and v2 at one spot';
    return;
  }
  const sgn = S.clip.flip ? -1 : 1, ax = S.hover.x * sgn, ay = S.hover.y * sgn;
  const k = Math.min(NY - 1, Math.max(0, Math.round(ay + 33.5))) * NX + Math.min(NX - 1, Math.max(0, Math.round(ax + 52)));
  for (const v of ['v0', 'v2']) {
    const q = S.res[v][S.i];
    for (let j = 0; j < 4; j++) {
      const td = $(`#readout td[data-k="${v}-${j}"]`);
      td.textContent = q && q !== 'empty' ? (q[j * N + k] / 32767).toFixed(j < 2 ? 2 : 3) : '—';
    }
    const I = S.integ[v][S.i];
    $(`#readout td[data-k="${v}-I"]`).textContent = I == null ? '—' : I.toFixed(2);
  }
  const fr = S.clip.frames[S.i];
  let best = null, bd = Infinity;
  for (const q of fr.pl) { const d = Math.hypot(q[1] - S.hover.x, q[2] - S.hover.y); if (d < bd && S.roster.has(q[0])) { bd = d; best = q; } }
  const who = best && bd < 3 ? ` · ${S.roster.get(best[0]).name} (${teamName(S.roster.get(best[0]).team_id)})` : '';
  $('#readoutCap').textContent = `${Math.round(ax)} m towards goal, ${Math.round(ay)} m across (attacking frame)${who}`;
}
function renderLegend() {
  const sc = SCALES[S.layer], diff = S.view === 'diff';
  const c = document.createElement('canvas'); c.width = 240; c.height = 12;
  const ctx = c.getContext('2d');
  for (let x = 0; x < 240; x++) {
    const t = x / 239;
    const rgb = diff ? PUOR(t) : S.layer === 'pc' || S.layer === 'gain' ? RDBU(t) : S.layer === 'integ' ? RDBU(1 - t) : MAGMA(t);
    ctx.fillStyle = `rgb(${rgb.map(Math.round).join(',')})`; ctx.fillRect(x, 0, 1, 12);
  }
  const lab = diff ? [`−${sc.diff}`, '0', `+${sc.diff}`] : [sc.lo, sc.mid, sc.hi];
  $('#legend').innerHTML = `<span>${lab[0]}</span><span id="lg"></span><span>${lab[2]}</span>
    <span class="key"><span class="dot" style="background:var(--attack)"></span>attacking</span>
    <span class="key"><span class="dot" style="background:var(--defend)"></span>defending</span>
    ${S.layer === 'integ' ? `<span class="key">grey = outside the zone · dashed line = zone starts 5 m behind the ball · faint = space worth little, counts less in I</span>` : ''}
    <span class="key">dashed ring = position estimated off camera · line = run over the next second</span>`;
  $('#lg').replaceWith(c);
}
function status(msg, err = false) { const el = $('#status'); el.textContent = msg; el.className = err ? 'err' : ''; }

boot().catch(e => status(`Failed to start: ${e.message}`, true));
