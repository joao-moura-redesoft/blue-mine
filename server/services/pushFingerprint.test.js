/**
 * Impressão digital da varredura do Redmine.
 *
 * É ela que decide se a janela aberta é avisada. O diff de IDs que já existia no
 * pollPush só enxerga tarefa que ENTRA ou SAI do conjunto — uma edição (mudança
 * de status, novo comentário, reatribuição) não mexe nos IDs e passaria batida,
 * deixando a tela desatualizada até o intervalo de segurança de 10 min.
 *
 * Um falso negativo aqui é justamente o modo de falha caro do desenho: tela
 * velha em silêncio. Daí os casos abaixo.
 */
import { describe, it, expect } from 'vitest';
import push from './push.js';

const { fingerprintOf } = push.__testables;

const mapOf = (...issues) => new Map(issues.map((i) => [i.id, i]));
const issue = (id, updated_on) => ({ id, updated_on });

describe('fingerprintOf', () => {
  it('mesmo conteúdo → mesma digital (não avisa à toa)', () => {
    const a = mapOf(issue(1, '2026-08-01T10:00:00Z'), issue(2, '2026-08-01T11:00:00Z'));
    const b = mapOf(issue(1, '2026-08-01T10:00:00Z'), issue(2, '2026-08-01T11:00:00Z'));
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
  });

  it('a ORDEM da varredura não muda a digital', () => {
    // As 4 buscas podem voltar em ordens diferentes entre ciclos; se isso mudasse
    // a digital, avisaríamos a cada 60s sem nada ter mudado — pior que o polling.
    const a = mapOf(issue(1, 'x'), issue(2, 'y'), issue(3, 'z'));
    const b = mapOf(issue(3, 'z'), issue(1, 'x'), issue(2, 'y'));
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
  });

  it('EDIÇÃO de tarefa existente muda a digital (o caso que o diff de IDs perde)', () => {
    const antes = mapOf(issue(1, '2026-08-01T10:00:00Z'));
    const depois = mapOf(issue(1, '2026-08-01T12:30:00Z')); // mesmo id, updated_on novo
    expect(fingerprintOf(depois)).not.toBe(fingerprintOf(antes));
  });

  it('tarefa nova muda a digital', () => {
    const antes = mapOf(issue(1, 'a'));
    const depois = mapOf(issue(1, 'a'), issue(2, 'b'));
    expect(fingerprintOf(depois)).not.toBe(fingerprintOf(antes));
  });

  it('tarefa que SAI do conjunto muda a digital', () => {
    // Reatribuída para outra pessoa: precisa sumir da tela.
    const antes = mapOf(issue(1, 'a'), issue(2, 'b'));
    const depois = mapOf(issue(1, 'a'));
    expect(fingerprintOf(depois)).not.toBe(fingerprintOf(antes));
  });

  it('troca de uma tarefa por outra muda a digital, mesmo com a contagem igual', () => {
    const antes = mapOf(issue(1, 'a'), issue(2, 'b'));
    const depois = mapOf(issue(1, 'a'), issue(3, 'b'));
    expect(fingerprintOf(depois)).not.toBe(fingerprintOf(antes));
  });

  it('conjunto vazio é estável', () => {
    expect(fingerprintOf(new Map())).toBe(fingerprintOf(new Map()));
  });

  it('updated_on ausente não quebra nem colide com o presente', () => {
    const sem = mapOf({ id: 1 });
    const com = mapOf(issue(1, '2026-08-01T10:00:00Z'));
    expect(() => fingerprintOf(sem)).not.toThrow();
    expect(fingerprintOf(sem)).not.toBe(fingerprintOf(com));
  });

  it('ids que se concatenariam igual não colidem (1,23 vs 12,3)', () => {
    // Sanidade do separador: sem ele "1:a" + "23:a" e "12:a" + "3:a" poderiam
    // gerar a mesma string de entrada.
    const a = mapOf(issue(1, 'a'), issue(23, 'a'));
    const b = mapOf(issue(12, 'a'), issue(3, 'a'));
    expect(fingerprintOf(a)).not.toBe(fingerprintOf(b));
  });
});
