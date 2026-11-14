// Serves the built app plus a stand-in for the Apps Script web app, running the real Code.gs against a mock sheet.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fixtureBook, loadScript } from './mock-gas.mjs';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
export function start(port = 0) {
  const g = loadScript(fixtureBook());
  g.api.setup();
  const key = g.logs.find((l) => /SECRET KEY/.test(l)).split(': ')[1];
  const dist = new URL('../dist/', import.meta.url).pathname;
  const server = http.createServer((req, res) => {
    if (req.url === '/api' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => { g.posts.push(body); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(g.post(body))); });
      return;
    }
    const file = path.join(dist, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(dist) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  g.posts = [];
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, g, key, url: `http://127.0.0.1:${server.address().port}` })));
}
if (process.argv[1] === new URL(import.meta.url).pathname) start(4173).then((s) => console.log(s.url, s.key));
