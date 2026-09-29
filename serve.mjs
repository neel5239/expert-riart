// Static server with HTTP Range support (video seeking needs it).
// usage: node serve.mjs [port]            -> http://localhost:port (this computer)
//        node serve.mjs [port] --https    -> https on your Wi-Fi address, so a phone can use the camera
//        PORT=xxxx node serve.mjs         -> hosting (Railway etc.): listens on 0.0.0.0:$PORT, the host adds https
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const hosted = !!process.env.PORT;
const started = new Date().toISOString();
const port = Number(process.argv.find(a => /^\d+$/.test(a))) || Number(process.env.PORT) || 8101;
const secure = process.argv.includes('--https');
const log = process.argv.includes('--log');     // print each request (to see what a phone loads)
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.task': 'application/octet-stream',
};

function handler(req, res) {
  if (log) res.on('finish', () => console.log(res.statusCode, req.headers.range || '', req.url, (req.headers['user-agent'] || '').replace(/^.*?\(([^;)]*).*$/, '$1')));
  // which build is live: compare with the latest commit on GitHub (Railway sets RAILWAY_GIT_COMMIT_SHA)
  if (req.url === '/version') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ commit: (process.env.RAILWAY_GIT_COMMIT_SHA || 'local').slice(0, 7), started }));
    return;
  }
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(root, path.normalize(rel));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  // never serve hidden files (.cert keys, .git) or the server itself; when hosted, not the dev/test folders or raw footage
  const parts = path.relative(root, file).split(path.sep);
  if (parts.some(p => p.startsWith('.')) || parts[0] === 'serve.mjs' || (hosted && ['_dev', '_test', 'raw', 'node_modules'].includes(parts[0]))) {
    res.writeHead(404).end('Not found'); return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('Not found'); return; }
    const type = types[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // pages and code revalidate every visit; the film, models and images are cached for an hour
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const cache = parts[0] === 'assets' ? 'public, max-age=3600' : 'no-cache';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': cache }).end(); return; }
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range) {
      let start = range[1] === '' ? st.size - Number(range[2]) : Number(range[1]);
      let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : st.size - 1;
      if (start < 0 || start >= st.size || end < start) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end();
        return;
      }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, {
        'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache, ETag: etag,
        'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1,
      });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache, ETag: etag, 'Content-Length': st.size });
      fs.createReadStream(file).pipe(res);
    }
  });
}

const lan = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);

if (!secure) {
  const host = hosted ? '0.0.0.0' : '127.0.0.1';
  http.createServer(handler).listen(port, host, () => console.log(`RI'S ART on http://${hosted ? host : 'localhost'}:${port}` +
    (process.env.RAILWAY_GIT_COMMIT_SHA ? ` (commit ${process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7)})` : '')));
} else {
  // self-signed certificate for localhost + this machine's Wi-Fi addresses (made once, kept in .cert/)
  const dir = path.join(root, '.cert');
  const key = path.join(dir, 'key.pem'), crt = path.join(dir, 'cert.pem');
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...lan.map(a => `IP:${a}`)].join(',');
  const stamp = path.join(dir, 'san.txt');
  if (!fs.existsSync(crt) || !fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== san) {
    fs.mkdirSync(dir, { recursive: true });
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365',
        '-keyout', key, '-out', crt, '-subj', "/CN=RI'S ART local", '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
      fs.writeFileSync(stamp, san);
    } catch {
      console.error('Could not run openssl to make a certificate. Install OpenSSL (it ships with Git for Windows) and try again.');
      process.exit(1);
    }
  }
  https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, handler).listen(port, '0.0.0.0', () => {
    console.log(`RI'S ART (https) on https://localhost:${port}`);
    lan.forEach(a => console.log(`  phone on the same Wi-Fi: https://${a}:${port}`));
    console.log('  The phone will warn the certificate is self-signed: choose "Advanced" then "Proceed". This is only for testing.');
  });
}
