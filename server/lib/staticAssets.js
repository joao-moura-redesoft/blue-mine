// Serviço do frontend compilado (SPA) com dois back-ends:
//
//   • embutido  → quando `server/dist-embedded.cjs` existe (gerado no build SEA),
//                 os arquivos vivem DENTRO do bundle/executável (single-file real).
//   • em disco  → dev e build pkg: cai no express.static da pasta dist.
//
// Assim o mesmo app.js funciona nos três modos sem ramificações espalhadas.
const path = require('path');
const express = require('express');

// Tenta carregar o mapa de assets embutido. Ausente em dev/pkg → null (fallback).
let embedded = null;
try {
  // eslint-disable-next-line global-require
  embedded = require('../dist-embedded.cjs');
} catch {
  embedded = null;
}

const CT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
};
const contentType = (p) => CT[path.extname(p).toLowerCase()] || 'application/octet-stream';

const hasEmbedded = () => !!embedded && !!embedded.assets;

// Decodifica (lazy) e memoiza os buffers a partir do base64 do módulo embutido.
const bufCache = new Map();
function assetBuffer(key) {
  if (bufCache.has(key)) return bufCache.get(key);
  const b64 = embedded.assets[key];
  if (b64 == null) return null;
  const buf = Buffer.from(b64, 'base64');
  bufCache.set(key, buf);
  return buf;
}

// Só o que o Vite versiona por hash no nome (/assets/index-CjVOvynn.js) pode ser
// `immutable` — o nome muda a cada build, então cachear por um ano é seguro.
// Todo o resto tem nome FIXO entre builds: /index.html, /sw.js, /registerSW.js,
// /manifest.webmanifest e os ícones de `includeAssets`. Marcar esses como
// immutable congelava o app na versão instalada: o navegador nunca reberia o
// registerSW.js novo, então o autoUpdate do service worker não disparava.
const isHashedAsset = (key) => key.startsWith('/assets/');

// Registra o serviço da SPA no app (estáticos + fallback para index.html).
// `diskDir` é usado apenas no modo em disco (dev/pkg).
function mountSpa(app, diskDir) {
  if (hasEmbedded()) {
    const sendAsset = (res, key) => {
      const buf = assetBuffer(key);
      if (!buf) return false;
      res.set('Content-Type', contentType(key));
      res.set(
        'Cache-Control',
        isHashedAsset(key) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
      res.send(buf);
      return true;
    };
    // Estáticos + navegação do SPA. Rotas /api não registradas caem no 404 do next().
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      const key = req.path === '/' ? '/index.html' : req.path;
      if (sendAsset(res, key)) return;
      // Rota de navegação do SPA → index.html.
      sendAsset(res, '/index.html');
    });
    return;
  }

  // Fallback em disco (dev / pkg): arquivos reais em `diskDir`.
  app.use(express.static(diskDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(diskDir, 'index.html'));
  });
}

module.exports = { mountSpa, hasEmbedded };
