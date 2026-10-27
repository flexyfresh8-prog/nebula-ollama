/* Dev web server for headless QA.
   Serves the project at http://localhost:8123/ and rewrites index.html:
   - drops the real Neutralino client (no WS token in a plain browser)
   - injects dev/shim.js which fakes the Neutralino API + a virtual workspace */
import http from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8123;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path === '/' || path === '\\') path = '/index.html';

  try {
    if (path === '/index.html') {
      let html = await readFile(join(ROOT, 'resources/index.html'), 'utf8');
      html = html
        .replace('<script src="js/neutralino.js"></script>', '')
        .replace('<script src="js/dither.js"></script>', '<script src="/dev/shim.js"></script>\n  <script src="js/dither.js"></script>');
      html = html.replace(/(href|src)="(css|js|assets)\//g, '$1="/resources/$2/');
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(html);
    }
    const file = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found: ' + path);
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`dev harness on http://127.0.0.1:${PORT}/`));
