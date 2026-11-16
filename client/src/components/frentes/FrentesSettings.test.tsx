/**
 * Editor de frentes: o resumo conta só tarefas abertas (a API não manda
 * `status.is_closed`, então "fechada" vem de /issue_statuses) e o Salvar não
 * deixa passar o que o servidor descartaria em silêncio.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FrentesConfig } from '../../api/frentes';
import type { Issue } from '../../types/redmine';
import { FrentesSettings } from './FrentesSettings';

const CFG: FrentesConfig = {
  frentes: [
    { id: 'crm', name: 'CRM', color: '#3b82f6' },
    { id: 'consync', name: 'Consync', color: '#14b8a6' },
  ],
  rules: [{ id: 'r1', field: 'titulo', op: 'has', value: 'crm', frente: 'crm', on: true }],
  manual: {},
  fallback: null,
  customized: true,
};

const issue = (id: number, status: { id: number; name: string }, frente: Issue['frente']) =>
  ({ id, subject: `t${id}`, status, frente }) as unknown as Issue;

const ABERTA = { id: 1, name: 'Pendente Análise' };
const FECHADA = { id: 5, name: 'Fechado' };
const crm = { id: 'crm', name: 'CRM', color: '#3b82f6', hidden: false, src: 'regra' as const };

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['frentes'], CFG);
  qc.setQueryData(
    ['statuses'],
    [
      { ...ABERTA, is_closed: false },
      { ...FECHADA, is_closed: true },
    ],
  );
  qc.setQueryData(
    ['issues', undefined],
    [
      issue(1, ABERTA, { ...crm, ruleId: 'r1' }),
      issue(2, ABERTA, null),
      issue(3, FECHADA, { ...crm, ruleId: 'r1' }),
      issue(4, FECHADA, null),
    ],
  );
  render(
    <QueryClientProvider client={qc}>
      <FrentesSettings />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

const save = () => screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement;

describe('FrentesSettings', () => {
  it('o resumo ignora tarefas fechadas', () => {
    renderEditor();
    const resumo = screen.getByText(
      (_, el) => el?.tagName === 'P' && /Hoje:/.test(el.textContent ?? ''),
    );
    expect(resumo.textContent).toMatch(/Hoje: 1 de 2 abertas classificadas, 1 sem frente/);
  });

  it('a contagem por frente e por regra também só tem abertas', () => {
    renderEditor();
    // CRM: 1 aberta (a fechada não entra); Consync: 0.
    expect(screen.getAllByText('1 aberta').length).toBeGreaterThanOrEqual(2); // frente + regra
    expect(screen.queryByText('2 abertas')).toBeNull();
  });

  it('Salvar começa desligado e liga ao editar', () => {
    renderEditor();
    expect(save().disabled).toBe(true);
    fireEvent.change(screen.getAllByLabelText('Nome da frente')[0], { target: { value: 'CRM 2' } });
    expect(save().disabled).toBe(false);
  });

  it('frente sem nome trava o Salvar e explica', () => {
    renderEditor();
    fireEvent.change(screen.getAllByLabelText('Nome da frente')[0], { target: { value: '  ' } });
    expect(save().disabled).toBe(true);
    expect(screen.getByText(/Toda frente precisa de um nome/)).toBeTruthy();
  });

  it('regra com valor vazio trava o Salvar', () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText('Valor da regra'), { target: { value: '' } });
    expect(save().disabled).toBe(true);
    expect(screen.getByText(/Toda regra precisa de um valor/)).toBeTruthy();
  });

  it('subir/descer frente muda a ordem e habilita o Salvar', () => {
    renderEditor();
    const nomes = () =>
      screen.getAllByLabelText('Nome da frente').map((e) => (e as HTMLInputElement).value);
    expect(nomes()).toEqual(['CRM', 'Consync']);
    fireEvent.click(screen.getAllByLabelText('Descer frente')[0]);
    expect(nomes()).toEqual(['Consync', 'CRM']);
    expect(save().disabled).toBe(false);
  });

  it('excluir uma frente leva as regras dela junto', () => {
    renderEditor();
    expect(screen.getAllByLabelText('Valor da regra')).toHaveLength(1);
    // ConfirmButton: 1º clique arma, 2º confirma.
    fireEvent.click(screen.getAllByTitle('Excluir frente e as regras dela')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.queryByLabelText('Valor da regra')).toBeNull();
  });
});
