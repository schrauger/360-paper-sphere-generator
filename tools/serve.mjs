// Dependency-free static file server for the web app: `npm run serve`, then open http://localhost:8080/web/.
// Serves the repository root (the app imports ../src/...). PORT overrides the port.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** The file a request path maps to, or null when it would leave the root. */
function resolvePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const file = join(root, normalize(decoded));
  return file === root || file.startsWith(root + sep) ? file : null;
}

const server = createServer(async (req, res) => {
  const send = (status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed');
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/') {
    res.writeHead(302, { Location: '/web/' });
    return res.end();
  }
  let file = resolvePath(pathname);
  if (!file) return send(403, 'Forbidden');
  try {
    if ((await stat(file)).isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { Location: `${pathname}/` });
        return res.end();
      }
      file = join(file, 'index.html');
    }
    send(200, await readFile(file), TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
  } catch {
    send(404, 'Not found');
  }
});

server.listen(port, () => console.log(`Serving ${root} at http://localhost:${port}/web/`));
