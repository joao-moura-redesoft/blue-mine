/**
 * Disjuntor de autenticação do Talk.
 *
 * `talkEnabled()` só checa se EXISTE credencial salva, não se ela funciona. Com
 * senha de app revogada, a lista de salas seguia sendo pedida a cada 15s, em
 * segundo plano, para sempre: o log desta máquina acumulou ~1300 respostas 401
 * nesse endpoint em 25 dias (6→31/jul/2026), todas idênticas.
 *
 * O disjuntor para o POLLING, não as queries — daí a importância do rearme
 * automático: um 401 passageiro precisa se curar sozinho, senão trocamos um
 * desperdício por um chat que morre e não volta.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import {
  saveTalkAuth,
  clearTalkAuth,
  isTalkAuthBroken,
  subscribeTalkAuthBroken,
  resetTalkAuthBroken,
} from './talk';

// Encontra o par (onFulfilled, onRejected) registrado por api/talk.ts no axios.
// Testamos o interceptor REAL: reimplementá-lo aqui passaria mesmo com ele quebrado.
function interceptor() {
  const inst = (axios.create as unknown as { mock: { results: { value: unknown }[] } }).mock;
  const handlers = (
    inst.results[0].value as { interceptors: { response: { handlers: unknown[] } } }
  ).interceptors.response.handlers as {
    fulfilled: (r: unknown) => unknown;
    rejected: (e: unknown) => Promise<unknown>;
  }[];
  const h = handlers[handlers.length - 1];
  // Se a busca falhar, os testes passariam sem exercitar nada.
  if (!h?.rejected) throw new Error('interceptor de api/talk.ts não encontrado');
  return h;
}

vi.mock('axios', async () => {
  const real = await vi.importActual<typeof import('axios')>('axios');
  const created: unknown[] = [];
  const create = vi.fn((cfg) => {
    const inst = real.default.create(cfg);
    created.push(inst);
    return inst;
  });
  return { ...real, default: { ...real.default, create, delete: vi.fn() } };
});

const ok = { status: 200, data: [] };
const unauthorized = { response: { status: 401, data: { error: 'token revogado' } } };

describe('disjuntor de auth do Talk', () => {
  beforeEach(() => {
    localStorage.clear();
    resetTalkAuthBroken();
    saveTalkAuth({ url: 'https://nc.local', user: 'joao', appPassword: 'x' } as never);
    resetTalkAuthBroken(); // saveTalkAuth já rearma; garante o ponto de partida
  });

  it('começa fechado (polling normal)', () => {
    expect(isTalkAuthBroken()).toBe(false);
  });

  it('401 abre o disjuntor', async () => {
    await interceptor()
      .rejected(unauthorized)
      .catch(() => {});
    expect(isTalkAuthBroken()).toBe(true);
  });

  it('resposta bem-sucedida rearma sozinho — 401 passageiro não mata o chat', async () => {
    await interceptor()
      .rejected(unauthorized)
      .catch(() => {});
    expect(isTalkAuthBroken()).toBe(true);

    interceptor().fulfilled(ok);
    expect(isTalkAuthBroken()).toBe(false); // curou sem religar a conta
  });

  it('(re)vincular a conta rearma', async () => {
    await interceptor()
      .rejected(unauthorized)
      .catch(() => {});
    saveTalkAuth({ url: 'https://nc.local', user: 'joao', appPassword: 'novo' } as never);
    expect(isTalkAuthBroken()).toBe(false);
  });

  it('remover a conta rearma (não deixa o disjuntor preso para a próxima)', async () => {
    await interceptor()
      .rejected(unauthorized)
      .catch(() => {});
    await clearTalkAuth();
    expect(isTalkAuthBroken()).toBe(false);
  });

  it('erro que NÃO é 401 não abre o disjuntor', async () => {
    for (const status of [403, 500, 503]) {
      resetTalkAuthBroken();
      await interceptor()
        .rejected({ response: { status, data: {} } })
        .catch(() => {});
      expect(isTalkAuthBroken(), `status ${status}`).toBe(false);
    }
  });

  it('sem credencial salva, 401 não abre o disjuntor', async () => {
    localStorage.clear(); // getTalkAuth() → null
    resetTalkAuthBroken();
    await interceptor()
      .rejected(unauthorized)
      .catch(() => {});
    expect(isTalkAuthBroken()).toBe(false);
  });

  it('notifica os assinantes só quando o estado MUDA', async () => {
    const listener = vi.fn();
    const unsub = subscribeTalkAuthBroken(listener);

    await interceptor()
      .rejected(unauthorized)
      .catch(() => {});
    expect(listener).toHaveBeenCalledTimes(1);

    // Mais 401 com o disjuntor já aberto: nada muda, ninguém re-renderiza.
    await interceptor()
      .rejected(unauthorized)
      .catch(() => {});
    await interceptor()
      .rejected(unauthorized)
      .catch(() => {});
    expect(listener).toHaveBeenCalledTimes(1);

    interceptor().fulfilled(ok);
    expect(listener).toHaveBeenCalledTimes(2); // fechou

    unsub();
    await interceptor()
      .rejected(unauthorized)
      .catch(() => {});
    expect(listener).toHaveBeenCalledTimes(2); // desinscrito
  });
});
