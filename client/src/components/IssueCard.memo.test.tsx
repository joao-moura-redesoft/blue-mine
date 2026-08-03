/**
 * Trava o contrato de memoização do IssueCard.
 *
 * O `memo()` do card só rende alguma coisa se o board passar props estáveis —
 * um único callback recriado por render, ou o `timerFormatted` mandado para
 * todos os cards, e a memoização vira só custo sem ninguém perceber. Estes
 * testes falham quando isso acontece.
 *
 * O contador de renders é o próprio `usePrefetchIssue`: ele é chamado uma vez
 * por render do IssueCard, então contar chamadas dele conta renders sem
 * precisar instrumentar o componente.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useState } from 'react';
import type { Issue } from '../types/redmine';

const renderSpy = vi.fn();

vi.mock('../hooks/useRedmine', () => ({
  usePrefetchIssue: () => {
    renderSpy();
    return () => {};
  },
  useAllowedStatuses: () => ({ data: undefined, isFetching: false }),
  useCurrentUser: () => ({ data: { id: 1, login: 'eu', firstname: 'Eu', lastname: 'Teste' } }),
}));
vi.mock('../hooks/useJitsiPresence', () => ({
  useJitsiPresence: () => ({
    rooms: [],
    isLoaded: true,
    isLive: () => false,
    liveRoom: () => undefined,
  }),
}));
vi.mock('./jitsi/JitsiContext', () => ({ useJitsi: () => ({ startCall: () => {} }) }));
vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    isDragging: false,
  }),
}));
vi.mock('./IssueAIPanel', () => ({ IssueAIPanel: () => null }));
vi.mock('./PersonAvatar', () => ({ PersonAvatar: () => null }));

const { IssueCard } = await import('./IssueCard');

const makeIssue = (id: number): Issue =>
  ({
    id,
    subject: `Tarefa ${id}`,
    description: '',
    done_ratio: 0,
    status: { id: 1, name: 'Nova' },
    priority: { id: 2, name: 'Normal' },
    project: { id: 1, name: 'Projeto' },
    tracker: { id: 1, name: 'Tarefa' },
    author: { id: 1, name: 'Eu' },
    created_on: '2026-01-01T00:00:00Z',
    updated_on: '2026-01-01T00:00:00Z',
    custom_fields: [],
  }) as unknown as Issue;

const noop = () => {};

/**
 * Espelha exatamente como o KanbanBoard monta as props de cada card, incluindo
 * a regra de só o card do timer ativo receber `timerFormatted`. Se aquela regra
 * mudar lá e não mudar aqui, os testes abaixo param de refletir a realidade.
 */
function Column({
  issues,
  timerIssueId,
  timerFormatted,
}: {
  issues: Issue[];
  timerIssueId: number | null;
  timerFormatted: string;
}) {
  return (
    <>
      {issues.map((issue) => (
        <IssueCard
          key={issue.id}
          issue={issue}
          onClick={noop}
          navigable={false}
          activeTimerIssueId={timerIssueId}
          timerFormatted={timerIssueId === issue.id ? timerFormatted : undefined}
        />
      ))}
    </>
  );
}

describe('memoização do IssueCard', () => {
  beforeEach(() => renderSpy.mockClear());

  it('não redesenha quando o pai re-renderiza com as mesmas props', () => {
    const issues = [makeIssue(1)];
    const { rerender } = render(
      <Column issues={issues} timerIssueId={null} timerFormatted="00:00" />,
    );
    expect(renderSpy).toHaveBeenCalledTimes(1);

    rerender(<Column issues={issues} timerIssueId={null} timerFormatted="00:00" />);
    expect(renderSpy).toHaveBeenCalledTimes(1); // memo segurou
  });

  it('o tick do timer só redesenha o card dono do timer', () => {
    const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
    const { rerender } = render(<Column issues={issues} timerIssueId={2} timerFormatted="00:01" />);
    expect(renderSpy).toHaveBeenCalledTimes(3); // render inicial dos 3
    renderSpy.mockClear();

    // Um segundo se passa: o cronômetro muda, mais nada.
    rerender(<Column issues={issues} timerIssueId={2} timerFormatted="00:02" />);
    expect(renderSpy).toHaveBeenCalledTimes(1); // só a #2, não as 3
  });

  it('ainda redesenha quando a própria issue muda', () => {
    const issue = makeIssue(1);
    const { rerender } = render(
      <Column issues={[issue]} timerIssueId={null} timerFormatted="00:00" />,
    );
    renderSpy.mockClear();

    rerender(
      <Column
        issues={[{ ...issue, subject: 'Assunto novo' }]}
        timerIssueId={null}
        timerFormatted="00:00"
      />,
    );
    expect(renderSpy).toHaveBeenCalledTimes(1); // memo não pode cachear demais
  });

  it('callback instável no pai anula a memoização (regressão que o memo sozinho não pega)', () => {
    const issues = [makeIssue(1)];
    function Unstable({ tick }: { tick: number }) {
      return (
        <IssueCard
          issue={issues[0]}
          onClick={() => void tick} // recriado a cada render — o erro clássico
          navigable={false}
        />
      );
    }
    const { rerender } = render(<Unstable tick={1} />);
    renderSpy.mockClear();
    rerender(<Unstable tick={2} />);
    // Documenta o modo de falha: com prop instável o memo NÃO segura.
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });
});

describe('estabilidade de props (sanidade do harness)', () => {
  it('useState no pai não recria as props passadas ao card', () => {
    const issues = [makeIssue(1)];
    let bump: (n: number) => void = () => {};
    function Parent() {
      const [n, setN] = useState(0);
      bump = setN;
      return (
        <>
          <span>{n}</span>
          <Column issues={issues} timerIssueId={null} timerFormatted="00:00" />
        </>
      );
    }
    render(<Parent />);
    renderSpy.mockClear();
    // act() é obrigatório: sem ele o setState não dá flush e o teste passaria
    // mesmo com o memo removido — ou seja, não testaria nada.
    act(() => bump(1));
    expect(renderSpy).toHaveBeenCalledTimes(0); // estado do pai não toca no card
  });
});
