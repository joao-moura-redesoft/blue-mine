/**
 * Pool de concorrência do polling de push (mapPool).
 *
 * `pollPush` percorria as inscrições com `await` dentro do `for`: cada usuário
 * só começava quando o anterior terminava, e a duração do tick crescia linear
 * com o número de pessoas. Passando dos 60s do intervalo, o `if (pushPolling)
 * return` descarta o tick seguinte SEM log — notificação atrasa e nada explica.
 *
 * O `mapPool` já existia no arquivo (o polling do Talk usa), mas o pollPush
 * tinha ficado para trás. Os testes abaixo fixam as três propriedades de que o
 * laço depende:
 *   - roda em paralelo até o limite (o ponto da mudança);
 *   - NUNCA passa do limite (senão viram rajadas no Redmine, e o remédio fica
 *     pior que a doença);
 *   - processa todos os itens, inclusive quando a lista não divide pelo limite.
 */
import { describe, it, expect, vi } from 'vitest';
import push from './push.js';

const { mapPool } = push.__testables;

// Espia a concorrência: registra o pico de execuções simultâneas.
function rastreador() {
  const st = { ativos: 0, pico: 0, vistos: [] };
  const fn = async (item) => {
    st.ativos += 1;
    st.pico = Math.max(st.pico, st.ativos);
    st.vistos.push(item);
    await new Promise((r) => setTimeout(r, 1));
    st.ativos -= 1;
  };
  return { st, fn };
}

describe('mapPool', () => {
  it('roda em paralelo até o limite', async () => {
    const { st, fn } = rastreador();
    await mapPool([1, 2, 3, 4, 5, 6, 7, 8], 4, fn);
    expect(st.pico).toBe(4); // sequencial daria 1
  });

  it('NUNCA passa do limite', async () => {
    // O teto é o que impede o remédio (tick mais rápido) de virar rajada de
    // varreduras paginadas simultâneas no Redmine.
    const { st, fn } = rastreador();
    await mapPool(
      Array.from({ length: 50 }, (_, i) => i),
      4,
      fn,
    );
    expect(st.pico).toBeLessThanOrEqual(4);
  });

  it('processa TODOS os itens, sem pular nem repetir', async () => {
    // Um item pulado aqui é uma pessoa que não recebe notificação nenhuma
    // naquele tick, em silêncio.
    const { st, fn } = rastreador();
    const itens = Array.from({ length: 10 }, (_, i) => i);
    await mapPool(itens, 3, fn); // 10 não divide por 3
    expect([...st.vistos].sort((a, b) => a - b)).toEqual(itens);
  });

  it('limite maior que a lista não quebra', async () => {
    const { st, fn } = rastreador();
    await mapPool([1, 2], 10, fn);
    expect(st.vistos).toHaveLength(2);
    expect(st.pico).toBe(2);
  });

  it('lista vazia não faz nada', async () => {
    const fn = vi.fn();
    await mapPool([], 4, fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('espera TODOS terminarem antes de resolver', async () => {
    // pollPush faz `saveSubs()` logo depois: se o mapPool resolvesse antes, os
    // `seen` atualizados dos que ainda estavam rodando não iriam para o disco e
    // seriam re-notificados no tick seguinte (notificação duplicada).
    const terminados = [];
    await mapPool([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      terminados.push(ms);
    });
    expect(terminados).toHaveLength(3);
  });

  it('uma tarefa lenta não impede as outras de avançarem', async () => {
    // O caso real: uma inscrição com rede pendurada (timeout de 20s) travava o
    // laço inteiro atrás dela.
    const ordem = [];
    await mapPool([50, 1, 1, 1], 4, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      ordem.push(ms);
    });
    expect(ordem[ordem.length - 1]).toBe(50); // a lenta termina por último
  });
});

describe('PUSH_POLL_CONCURRENCY', () => {
  it('é maior que 1 — senão o laço continua sequencial', () => {
    expect(push.__testables.PUSH_POLL_CONCURRENCY).toBeGreaterThan(1);
  });

  it('é conservadora: cada item é uma varredura paginada, não um request', () => {
    // O polling do Talk usa 6 porque lá cada item é UMA listagem barata. Aqui
    // cada item custa 1 + 4 buscas paginadas; subir muito troca o tick lento por
    // rajada de requisições no Redmine.
    expect(push.__testables.PUSH_POLL_CONCURRENCY).toBeLessThanOrEqual(6);
  });
});

describe('isolamento de erro no pool', () => {
  it('um item que rejeita derruba o pool inteiro', async () => {
    // Esta é a razão de `pollOneSubscription` envolver tudo num try/catch: o
    // mapPool propaga a exceção, então um erro que escapasse (credencial
    // vencida, rede fora) mataria o worker e as inscrições ainda na fila dele
    // ficariam sem varredura naquele tick — sem notificação e sem log.
    await expect(
      mapPool([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('credencial vencida');
      }),
    ).rejects.toThrow('credencial vencida');
  });

  it('com o erro contido, os demais itens seguem', async () => {
    // O contrato que pollOneSubscription cumpre: engolir o próprio erro para
    // que o pool termine a lista.
    const feitos = [];
    await mapPool([1, 2, 3], 2, async (n) => {
      try {
        if (n === 2) throw new Error('credencial vencida');
        feitos.push(n);
      } catch {
        /* como pollOneSubscription faz */
      }
    });
    expect(feitos.sort()).toEqual([1, 3]);
  });
});

describe('remoção de inscrição sob concorrência', () => {
  // Com o polling paralelo, dois sendPush podem receber 404/410 ao mesmo tempo.
  // A remoção precisa MUTAR o array: por reatribuição (`subs = subs.filter()`),
  // o segundo parte de uma cópia que não tem a remoção do primeiro e
  // RESSUSCITA uma inscrição morta — que volta a ser varrida e notificada.
  const { removeSubscriptionByEndpoint } = push.__testables;

  it('remove mutando o array (quem já tem a referência enxerga)', () => {
    const subs = push.getSubscriptions();
    subs.length = 0;
    subs.push({ endpoint: 'a' }, { endpoint: 'b' }, { endpoint: 'c' });

    const mesmaRef = subs; // como um worker do pool que capturou a referência
    removeSubscriptionByEndpoint('b');

    expect(mesmaRef.map((s) => s.endpoint)).toEqual(['a', 'c']);
    expect(push.getSubscriptions()).toBe(mesmaRef); // não trocou de array
  });

  it('duas remoções seguidas não ressuscitam a primeira', () => {
    const subs = push.getSubscriptions();
    subs.length = 0;
    subs.push({ endpoint: 'a' }, { endpoint: 'b' }, { endpoint: 'c' });

    removeSubscriptionByEndpoint('a');
    removeSubscriptionByEndpoint('c');

    expect(push.getSubscriptions().map((s) => s.endpoint)).toEqual(['b']);
  });

  it('endpoint inexistente devolve false e não mexe na lista', () => {
    const subs = push.getSubscriptions();
    subs.length = 0;
    subs.push({ endpoint: 'a' });

    expect(removeSubscriptionByEndpoint('nao-existe')).toBe(false);
    expect(push.getSubscriptions()).toHaveLength(1);
  });
});
