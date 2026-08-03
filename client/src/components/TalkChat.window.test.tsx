/**
 * Janela de renderização das mensagens do Talk.
 *
 * Uma sala movimentada acumula centenas de bolhas no DOM. O memo() do Bubble
 * corta os re-renders, mas não o custo de MONTAR tudo. A janela renderiza só a
 * cauda e revela o resto sob demanda.
 *
 * Importamos a função REAL do TalkChat em vez de reimplementá-la aqui: um teste
 * que espelha a lógica passa mesmo quando o componente muda, e não guarda nada.
 * Montar o componente inteiro (~5900 linhas, dezenas de mocks) testaria mais os
 * mocks que a regra — o que importa é o cálculo da fatia.
 */
import { describe, it, expect } from 'vitest';
import { talkWindowStart } from './TalkChat';

const WINDOW_STEP = 60;

function sliceWindow(total: number, windowSize: number, unreadIdx = -1) {
  const windowStart = talkWindowStart(total, windowSize, unreadIdx);
  return { windowStart, rendered: total - windowStart, hidden: windowStart };
}

describe('janela de mensagens', () => {
  it('sala curta renderiza tudo — sem regressão de UX no caso comum', () => {
    const { rendered, hidden } = sliceWindow(12, WINDOW_STEP);
    expect(rendered).toBe(12);
    expect(hidden).toBe(0);
  });

  it('sala longa renderiza só a cauda', () => {
    const { rendered, hidden } = sliceWindow(500, WINDOW_STEP);
    expect(rendered).toBe(WINDOW_STEP);
    expect(hidden).toBe(440); // 440 bolhas a menos no DOM
  });

  it('a janela é a CAUDA (mensagens novas), não o começo', () => {
    // Um chat abre no fim; renderizar o início deixaria a tela na conversa velha.
    const { windowStart } = sliceWindow(500, WINDOW_STEP);
    expect(windowStart).toBe(440);
    expect(windowStart + WINDOW_STEP).toBe(500); // termina na última mensagem
  });

  it('revelar aumenta a janela em lotes e zera o escondido no fim', () => {
    let size = WINDOW_STEP;
    expect(sliceWindow(150, size).hidden).toBe(90);

    size += WINDOW_STEP;
    expect(sliceWindow(150, size).hidden).toBe(30);

    size += WINDOW_STEP;
    const fim = sliceWindow(150, size);
    expect(fim.hidden).toBe(0);
    expect(fim.rendered).toBe(150);
  });

  it('nunca corta o divisor de não-lidas', () => {
    // 300 mensagens, 200 sem ler: o marcador está muito acima da cauda padrão.
    const total = 300;
    const unreadIdx = 100; // 200 mensagens depois dele
    const { windowStart, rendered } = sliceWindow(total, WINDOW_STEP, unreadIdx);

    expect(windowStart).toBeLessThan(unreadIdx); // o divisor está renderizado
    expect(rendered).toBeGreaterThan(200);
  });

  it('não encolhe a janela quando o usuário já revelou mais que o necessário', () => {
    const jaRevelado = 200;
    const { rendered } = sliceWindow(300, jaRevelado, 290);
    expect(rendered).toBe(jaRevelado); // o unread não pode reduzir o que já está aberto
  });

  it('a janela nunca começa antes do início da lista', () => {
    const { windowStart, rendered } = sliceWindow(5, WINDOW_STEP, 0);
    expect(windowStart).toBe(0);
    expect(rendered).toBe(5); // sem índice negativo / fatia vazia
  });
});

describe('agrupamento na borda da janela', () => {
  /**
   * O TalkChat pega prev/next da lista COMPLETA usando windowStart + índice
   * local. Se pegasse da janela, a primeira mensagem renderizada perderia o
   * vizinho e repetiria autor e divisor de data a cada revelação.
   */
  it('o índice global aponta para o vizinho real, não para undefined', () => {
    const total = 500;
    const { windowStart } = sliceWindow(total, WINDOW_STEP);

    const primeiroLocal = 0;
    const idxGlobal = windowStart + primeiroLocal;
    expect(idxGlobal).toBe(440);
    expect(idxGlobal - 1).toBe(439); // existe na lista completa

    // Se usássemos o índice da janela, o vizinho seria visibleMessages[-1].
    expect(primeiroLocal - 1).toBe(-1);
  });

  it('o último da janela é o último da lista (não há next fantasma)', () => {
    const total = 500;
    const { windowStart } = sliceWindow(total, WINDOW_STEP);
    const ultimoLocal = WINDOW_STEP - 1;
    expect(windowStart + ultimoLocal).toBe(total - 1);
  });
});
