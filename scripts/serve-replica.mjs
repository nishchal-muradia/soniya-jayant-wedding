import http from 'node:http';
import {readFile, stat, realpath} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {replicaHeaders} from './replica-policy.mjs';
import {handleGoogleFormRsvp} from '../backend/google-form-worker.mjs';
import {handleRsvp} from '../backend/rsvp-worker.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const port = Number(value('--port', '4175'));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
const root = await realpath(path.resolve(args.includes('--dist') ? 'dist-replica' : 'replica/public'));
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const headers = replicaHeaders(html);
const config = JSON.parse(await readFile('replica/content.json','utf8'));
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8'
};
http.createServer(async (req, res) => {
  const fail = (status, message, extra = {}) => {
    res.writeHead(status, {...headers, 'Content-Type': 'text/plain; charset=utf-8', ...extra});
    res.end(req.method === 'HEAD' ? undefined : message);
  };
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/api/rsvp') {
      const request = new Request(`http://127.0.0.1:${port}/api/rsvp`, {
        method: req.method, headers: req.headers,
        ...(!['GET', 'HEAD'].includes(req.method) ? {body: Readable.toWeb(req), duplex: 'half'} : {})
      });
      const response = config.rsvp.googleForm ? await handleGoogleFormRsvp(request, config.rsvp.googleForm) : await handleRsvp(request, {
        RSVP_APPS_SCRIPT_URL: process.env.RSVP_APPS_SCRIPT_URL,
        RSVP_RELAY_SECRET: process.env.RSVP_RELAY_SECRET
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      return res.end(req.method === 'HEAD' ? undefined : await response.text());
    }
    if (!['GET', 'HEAD'].includes(req.method)) return fail(405, 'Method not allowed.', {Allow: 'GET, HEAD'});
    if (rel.startsWith('/api/')) return fail(404, 'No API is available in the local template preview.');
    if (['_worker.js', '_routes.json', '_headers'].includes(rel.slice(1))) return fail(404, 'Not found');
    if (['/', '/template-frame/royal-gateway', '/template-frame/royal-gateway/'].includes(rel)) rel = '/index.html';
    if (rel.includes('\0') || rel.includes('\\') || rel.split('/').some(p => p.startsWith('.'))) return fail(403, 'Forbidden');
    const filename = await realpath(path.resolve(root, '.' + rel));
    if (!filename.startsWith(root + path.sep)) return fail(403, 'Forbidden');
    const info = await stat(filename);
    if (!info.isFile()) return fail(404, 'Not found');
    res.writeHead(200, {...headers, 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-store'});
    res.end(req.method === 'HEAD' ? undefined : await readFile(filename));
  } catch {
    fail(404, 'Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Royal Gateway local replica: http://127.0.0.1:${port}/`));
