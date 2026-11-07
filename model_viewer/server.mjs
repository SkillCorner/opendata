// Model viewer server: static files, the match/sequence data built by scripts/build_data.py, and tracking clips.
// Tracking (~100 MB per match, Git LFS) is read from GitHub's LFS media URL with byte-range requests:
// a binary search on byte offsets finds the clip's first frame, then only the clip itself is downloaded.
// If the real tracking file is present locally (git lfs pull), it is read from disk instead.
import http from 'node:http';
import {readFile, stat, open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import path from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_DATA = path.join(HERE, '..', 'data', 'matches');
const REF = process.env.TRACKING_REF || 'main';
const REMOTE = id => `https://media.githubusercontent.com/media/misoverfitting/soccer_data/${REF}/data/matches/${id}/${id}_tracking_extrapolated.jsonl`;
const MAX_FRAMES = 900;          // 90 s at 10 fps
const CHUNK = 1 << 19;           // 512 KB reads

const matchIds = new Set(JSON.parse(await readFile(path.join(HERE, 'data', 'matches.json'), 'utf8')).map(m => String(m.id)));

// ---------- byte sources ----------
async function localSource(id) {
  const file = path.join(REPO_DATA, id, `${id}_tracking_extrapolated.jsonl`);
  try {
    const s = await stat(file);
    if (s.size < 10_000) return null;                    // Git LFS pointer, not the data
    return {size: s.size, async read(offset, len) {
      const fh = await open(file, 'r');
      try { const b = Buffer.alloc(Math.min(len, s.size - offset)); await fh.read(b, 0, b.length, offset); return b; }
      finally { await fh.close(); }
    }};
  } catch { return null; }
}
async function remoteSource(id) {
  const url = REMOTE(id);
  const get = async (offset, len) => {
    const r = await fetch(url, {headers: {Range: `bytes=${offset}-${offset + len - 1}`}, signal: AbortSignal.timeout(60000)});
    if (r.status !== 206) throw Error(`Tracking download failed (HTTP ${r.status})`);
    return {buf: Buffer.from(await r.arrayBuffer()), total: Number((r.headers.get('content-range') || '').split('/')[1])};
  };
  const first = await get(0, 1024);
  return {size: first.total, read: async (offset, len) => (await get(offset, Math.min(len, first.total - offset))).buf};
}
const sources = new Map();
async function source(id) {
  if (!sources.has(id)) sources.set(id, (await localSource(id)) || (await remoteSource(id)));
  return sources.get(id);
}

// ---------- frame search ----------
async function frameNear(src, offset) {
  const b = await src.read(offset, 16384);
  const s = b.toString('utf8');
  const nl = offset === 0 ? -1 : s.indexOf('\n');
  const m = s.slice(nl + 1).match(/^\{"frame": (\d+)/);
  return {frame: m ? Number(m[1]) : null, lineStart: offset + Buffer.byteLength(s.slice(0, nl + 1))};
}
async function seek(src, target) {
  let lo = 0, hi = src.size;
  while (hi - lo > CHUNK) {
    const mid = Math.floor((lo + hi) / 2);
    const {frame, lineStart} = await frameNear(src, mid);
    if (frame == null || frame >= target) hi = mid; else lo = lineStart;
  }
  return lo;
}
const compact = f => ({
  f: f.frame, t: f.timestamp, p: f.period,
  b: f.ball_data && f.ball_data.x != null ? [f.ball_data.x, f.ball_data.y] : null,
  g: f.possession ? f.possession.group : null,
  pl: f.player_data.map(p => [p.player_id, p.x, p.y, p.is_detected ? 1 : 0]),
});
async function readClip(id, start, end) {
  const src = await source(id);
  let offset = await seek(src, start), rest = '', frames = [];
  while (offset < src.size) {
    const b = await src.read(offset, CHUNK); offset += b.length;
    const lines = (rest + b.toString('utf8')).split('\n'); rest = lines.pop();
    for (const line of lines) {
      if (!line) continue;
      const fr = Number(line.slice(10, line.indexOf(',')));
      if (fr < start) continue;
      if (fr > end) return frames;
      frames.push(compact(JSON.parse(line)));
    }
  }
  return frames;
}
const clipCache = new Map();
async function clip(id, start, end) {
  const key = `${id}:${start}:${end}`;
  if (clipCache.has(key)) { const v = clipCache.get(key); clipCache.delete(key); clipCache.set(key, v); return v; }
  const body = gzipSync(JSON.stringify({id: Number(id), start, end, frames: await readClip(id, start, end)}));
  clipCache.set(key, body);
  if (clipCache.size > 16) clipCache.delete(clipCache.keys().next().value);
  return body;
}

// ---------- http ----------
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml'};
const json = (res, status, data) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(data)); };
async function sendFile(res, file, cache = 'no-cache') {
  const body = await readFile(file);
  res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff'});
  res.end(body);
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p === '/health') return json(res, 200, {status: 'ok'});
    if (p === '/data/models.json' || p === '/data/matches.json') return await sendFile(res, path.join(HERE, p));
    let m = p.match(/^\/data\/match\/(\d+)\.json$/);
    if (m && matchIds.has(m[1])) return await sendFile(res, path.join(HERE, 'data', 'match', `${m[1]}.json`));
    m = p.match(/^\/api\/clip\/(\d+)$/);
    if (m) {
      if (!matchIds.has(m[1])) return json(res, 404, {error: 'Unknown match'});
      const start = Number(url.searchParams.get('start')), end = Number(url.searchParams.get('end'));
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end - start > MAX_FRAMES)
        return json(res, 400, {error: `start/end must be frame numbers at most ${MAX_FRAMES} apart`});
      const body = await clip(m[1], start, end);
      res.writeHead(200, {'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=86400'});
      return res.end(body);
    }
    const file = p === '/' ? 'index.html' : p.slice(1);
    if (!/^[\w.-]+$/.test(file)) return json(res, 404, {error: 'Not found'});
    return await sendFile(res, path.join(HERE, 'public', file));
  } catch (e) {
    if (e.code === 'ENOENT') return json(res, 404, {error: 'Not found'});
    console.error(e);
    json(res, 502, {error: e.message});
  }
});

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Model viewer on http://localhost:${port}`));
}
