// Dev server for the panel harness (no dependencies). Localhost only.
//   node dev/serve.js [port]  ->  http://localhost:8360/  (the panel against the synthetic org)
// Serves an allowlist only (the extension in src/, the harness platform, the synthetic org): never .env, dist/
// or .git, whatever the path or letter case.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const ALLOW = [/^src\/(panel|lib|icons)\/[\w.-]+$/, /^src\/manifest\.json$/, /^src\/core\/([\w-]+\/)*[\w.-]+\.js$/, /^dev\/platform-fake\.js$/, /^test\/fixtures\/fake-org\.js$/];

/** Maps a URL path to a file inside the repo, or null if it is not allowed. */
export function resolvePath(urlPath, base = root) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  if (p === '/') p = '/src/panel/panel.html';
  if (p.includes('\0') || p.includes('\\')) return null;
  const rel = path.posix.normalize(p).replace(/^\/+/, '');
  if (rel.startsWith('..') || !ALLOW.some((re) => re.test(rel))) return null;
  const file = path.resolve(base, rel);
  const fromBase = path.relative(base, file);
  if (fromBase.startsWith('..') || path.isAbsolute(fromBase)) return null;
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || process.env.PORT || 8360);
  http.createServer((req, res) => {
    // DNS-rebinding guard: only answer requests addressed to localhost
    const host = String(req.headers.host || '').toLowerCase();
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) { res.writeHead(403).end('Forbidden'); return; }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    // the panel's relative paths (panel.css, ../icons/) need its real location in the URL
    if (pathname === '/') { res.writeHead(302, { Location: '/src/panel/panel.html' }).end(); return; }
    const file = resolvePath(pathname);
    if (!file) { res.writeHead(404).end('Not found'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(data);
    });
  }).listen(port, '127.0.0.1', () => console.log(`Harness: http://localhost:${port}/`));
}
