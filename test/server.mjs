// Serves the built app (and the test site build at /preview/, as on GitHub Pages) plus a stand-in for the Apps Script web app, running the real Code.gs against a mock sheet.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fixtureBook, loadScript, fakeGroq } from './mock-gas.mjs';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
export function start(port = 0) {
  // Groq stand-in. A test can set g.groq to script its own replies; every request is kept in g.groqRequests.
  const invented = fakeGroq();
  const g = loadScript(fixtureBook(), { fetch: (u, o) => { g.groqRequests.push(JSON.parse(o.payload)); return (g.groq || invented)(u, o); } });
  g.groqRequests = [];
  g.api.setup();
  g.props.GROQ_API_KEY = 'test-only'; // the mock's invented Groq answers; nothing leaves the machine
  const key = g.logs.find((l) => /SECRET KEY/.test(l)).split(': ')[1];
  const dist = new URL('../dist/', import.meta.url).pathname;
  const distPreview = new URL('../dist-preview/', import.meta.url).pathname;
  g.requests = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/api' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => { g.posts.push(body); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(g.post(body))); });
      return;
    }
    g.requests.push(req.url);
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/preview') { res.writeHead(301, { Location: '/preview/' }); res.end(); return; }
    const root = p.startsWith('/preview/') ? distPreview : dist;
    if (root === distPreview) p = p.slice('/preview'.length);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  g.posts = [];
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, g, key, url: `http://127.0.0.1:${server.address().port}` })));
}
if (process.argv[1] === new URL(import.meta.url).pathname) start(4173).then((s) => console.log(s.url, s.key));
