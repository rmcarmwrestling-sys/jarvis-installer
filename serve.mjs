import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.zip': 'application/zip', '.exe': 'application/vnd.microsoft.portable-executable',
};

function networkUrls() {
  return Object.values(os.networkInterfaces()).flatMap(entries => (entries || [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal)
    .map(entry => `http://${entry.address}:${PORT}/`));
}

const server = http.createServer(async (request, response) => {
  try {
    const requestPath = decodeURIComponent(new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname);
    const relative = requestPath === '/' ? 'index.html' : requestPath.endsWith('/') ? `${requestPath.replace(/^\/+|\/$/g, '')}/index.html` : requestPath.replace(/^\/+/, '');
    const filePath = path.resolve(ROOT, relative);
    if (!filePath.startsWith(ROOT) || !existsSync(filePath)) { response.writeHead(404); response.end('No encontrado'); return; }
    const body = await fs.readFile(filePath);
    response.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(body);
  } catch (error) {
    response.writeHead(500); response.end(`Error del servidor: ${error.message}`);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nPágina de instalación de Jarvis disponible en este ordenador: http://localhost:${PORT}/`);
  const urls = networkUrls();
  if (urls.length) {
    console.log('En el móvil conectado a la misma Wi‑Fi, abre una de estas direcciones:');
    urls.forEach(url => console.log(`  ${url}`));
  } else console.log('No se detectó una dirección de red local.');
  console.log('\nPulsa Ctrl+C para detener el servidor.');
});
