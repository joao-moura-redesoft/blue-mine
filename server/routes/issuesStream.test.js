/**
 * Rota SSE /issues/stream: registro e ordem no router.
 *
 * Falha que isto pega: o Express casa rotas na ORDEM de registro, e
 * `/issues/:id` casaria com "/issues/stream" tratando "stream" como id. O
 * sintoma seria silencioso — o EventSource receberia JSON de tarefa em vez de
 * text/event-stream, nunca abriria, e o cliente cairia para sempre no polling
 * de segurança de 10 min. Nada quebra visivelmente; a tela só fica velha.
 */
import { describe, it, expect } from 'vitest';
import issuesRouter from './issues.js';

const rotasGet = () =>
  issuesRouter.stack.filter((l) => l.route?.methods?.get).map((l) => l.route.path);

describe('/issues/stream', () => {
  it('está registrada como GET', () => {
    expect(rotasGet()).toContain('/issues/stream');
  });

  it('vem ANTES de qualquer rota com parâmetro que a capturaria', () => {
    const rotas = rotasGet();
    const stream = rotas.indexOf('/issues/stream');
    const capturadoras = rotas
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => /^\/issues\/:[^/]+$/.test(p));

    for (const { p, i } of capturadoras) {
      expect(stream, `${p} (índice ${i}) capturaria /issues/stream`).toBeLessThan(i);
    }
  });

  it('as rotas fixas de /issues continuam registradas (não perdemos nada no caminho)', () => {
    const rotas = rotasGet();
    for (const p of [
      '/issues',
      '/issues/by-ids',
      '/issues/monitored',
      '/issues/authored',
      '/issues/to-review',
      '/issues/mentions',
    ]) {
      expect(rotas, `${p} sumiu`).toContain(p);
    }
  });
});
