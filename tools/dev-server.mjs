// Local dev server: serves the app and collects ?log=1 telemetry into tmp/session-log.jsonl.
// Development only. Bound to localhost; the deployed site is static and has no log endpoint.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = path.join(ROOT, 'tmp', 'session-log.jsonl');
const PORT = Number(process.env.PORT ?? 8000);
const MAX_LOG_BODY = 1_000_000;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.task': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.ico': 'image/x-icon',
};

fs.mkdirSync(path.dirname(LOG), { recursive: true });

function collectLog(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > MAX_LOG_BODY) req.destroy();
  });
  req.on('end', () => {
    fs.appendFile(LOG, body.trimEnd() + '\n', () => {});
    res.writeHead(204).end();
  });
}

function serveFile(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(ROOT, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return res.writeHead(403).end();
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return res.writeHead(404).end('Not found');
    const headers = { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' };
    // Byte ranges, so <video> test clips can seek and loop.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/__log') return collectLog(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') return serveFile(req, res);
  res.writeHead(405).end();
}).listen(PORT, '127.0.0.1', () => {
  console.log(`LiftSafe dev server: http://localhost:${PORT}`);
  console.log(`Telemetry (?log=1) → ${path.relative(ROOT, LOG)}`);
});
