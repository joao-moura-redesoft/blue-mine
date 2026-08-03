/**
 * Cache-Control dos estáticos da SPA.
 *
 * O bug que isto trava: antes, TUDO que não era /index.html levava
 * `immutable` por um ano — inclusive /sw.js, /registerSW.js e
 * /manifest.webmanifest, que têm nome FIXO entre builds. Num app instalado
 * como exe isso congela a versão: o navegador nunca rebusca o registerSW.js,
 * então o autoUpdate do service worker não dispara e o usuário fica preso.
 *
 * Só /assets/* é versionado por hash pelo Vite e pode ser immutable.
 *
 * O teste roda contra o dist-embedded.cjs REAL (o mesmo mapa de assets que vai
 * dentro do exe), não contra um mock — assim ele valida os nomes de arquivo que
 * o build de fato produz. Se o bundle não estiver gerado, os testes são pulados
 * em vez de darem falso verde.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mountSpa, hasEmbedded } from './staticAssets.js';

const embedded = hasEmbedded();
const d = embedded ? describe : describe.skip;

// App falso que só captura o handler registrado em app.get('*').
function captureHandler() {
  let handler;
  mountSpa({ get: (_pat, fn) => (handler = fn), use: () => {} }, '/tmp/dist');
  return handler;
}

function headersFor(handler, urlPath) {
  const headers = {};
  const res = {
    set: (k, v) => {
      headers[k] = v;
      return res;
    },
    send: () => res,
  };
  handler({ path: urlPath }, res, () => {});
  return headers;
}

d('Cache-Control dos estáticos (build embutido real)', () => {
  let handler;
  let hashedAssets;

  beforeAll(() => {
    handler = captureHandler();
    // eslint-disable-next-line global-require
    const assets = require('../dist-embedded.cjs').assets;
    hashedAssets = Object.keys(assets).filter((k) => k.startsWith('/assets/'));
  });

  it('o build embutido de fato contém os arquivos de nome fixo', () => {
    // Guarda contra o teste virar vacuoso: se o Vite parar de emitir estes
    // nomes, os casos abaixo estariam passando sem exercitar nada.
    // eslint-disable-next-line global-require
    const assets = require('../dist-embedded.cjs').assets;
    for (const p of ['/sw.js', '/registerSW.js', '/manifest.webmanifest', '/index.html']) {
      expect(assets, `${p} sumiu do build`).toHaveProperty(p);
    }
    expect(hashedAssets.length).toBeGreaterThan(10);
  });

  it('assets versionados por hash são immutable por um ano', () => {
    for (const p of hashedAssets.slice(0, 20)) {
      expect(headersFor(handler, p)['Cache-Control'], p).toBe(
        'public, max-age=31536000, immutable',
      );
    }
  });

  it('NUNCA marca como immutable arquivos de nome fixo entre builds', () => {
    // Estes são os que congelavam o app na versão instalada.
    for (const p of [
      '/sw.js',
      '/registerSW.js',
      '/manifest.webmanifest',
      '/icon-192.png',
      '/favicon.svg',
    ]) {
      const cc = headersFor(handler, p)['Cache-Control'];
      expect(cc, `${p} não pode ser immutable`).not.toContain('immutable');
      expect(cc, p).toBe('no-cache');
    }
  });

  it('index.html revalida sempre', () => {
    expect(headersFor(handler, '/')['Cache-Control']).toBe('no-cache');
    expect(headersFor(handler, '/index.html')['Cache-Control']).toBe('no-cache');
  });

  it('rota de navegação do SPA cai no index.html sem herdar immutable', () => {
    const h = headersFor(handler, '/kanban');
    expect(h['Content-Type']).toBe('text/html; charset=utf-8');
    expect(h['Cache-Control']).toBe('no-cache');
  });

  it('não intercepta /api/', () => {
    let passed = false;
    handler({ path: '/api/issues' }, { set: () => {}, send: () => {} }, () => (passed = true));
    expect(passed).toBe(true);
  });
});
