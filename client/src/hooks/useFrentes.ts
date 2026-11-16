import { useSyncExternalStore } from 'react';
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  fetchFrentes,
  saveFrentes,
  resetFrentes,
  setManualFrente,
  fetchFrenteOptions,
  type FrentesConfig,
  type FrentesDraft,
  type FrenteFieldOptions,
} from '../api/frentes';
import { getStoredAuth } from '../api/redmine';
import type { Issue, IssueFrente } from '../types/redmine';

const KEY = ['frentes'] as const;

// Mesma regra de useRedmine.ts: ['issues', ...] ou ['issues-*', ...] guardam listas.
const isIssueListKey = (key: readonly unknown[]) =>
  key[0] === 'issues' || (typeof key[0] === 'string' && key[0].startsWith('issues-'));

export function useFrentes() {
  return useQuery({
    queryKey: KEY,
    queryFn: fetchFrentes,
    enabled: !!getStoredAuth(),
    staleTime: 60_000,
  });
}

// Nomes e IDs das listas de Área/Natureza. Vêm do formulário de edição de uma
// tarefa (a API não expõe), então só busca quando o editor de regras abre.
// Resposta vazia (ainda não há tarefa com Área) não fica em cache: sem isso o
// editor mostraria "sem opções" por 6 horas mesmo depois de a tarefa aparecer.
export function useFrenteOptions(enabled: boolean) {
  return useQuery<FrenteFieldOptions>({
    queryKey: ['frente-options'],
    queryFn: fetchFrenteOptions,
    enabled: enabled && !!getStoredAuth(),
    staleTime: (q) => (q.state.data?.area.length ? 6 * 60 * 60 * 1000 : 0),
  });
}

const NO_ISSUES: Issue[] = [];

// A maior lista de tarefas já carregada (qualquer projeto), SEM disparar busca.
// O editor de regras usa só para contar "quantas tarefas cada regra pegou";
// montar um useIssues() ali forçaria uma varredura completa do Redmine (e o
// polling de 60s) só por abrir as Configurações.
export function useLoadedIssues(): Issue[] {
  const qc = useQueryClient();
  const cache = qc.getQueryCache();
  const snapshot = () => {
    let best = NO_ISSUES;
    for (const [, data] of qc.getQueriesData<Issue[]>({
      predicate: (q) => q.queryKey[0] === 'issues',
    })) {
      if (Array.isArray(data) && data.length > best.length) best = data;
    }
    return best;
  };
  return useSyncExternalStore((cb) => cache.subscribe(cb), snapshot, snapshot);
}

// A classificação mudou: as listas guardam `frente` por tarefa, então precisam
// vir de novo do servidor (ele aplica as regras).
function refreshIssues(qc: QueryClient, issueId?: number) {
  qc.invalidateQueries({ predicate: (q) => isIssueListKey(q.queryKey) });
  if (issueId != null) qc.invalidateQueries({ queryKey: ['issue', issueId] });
}

type Snapshots = [readonly unknown[], unknown][];

// Troca `frente` de UMA tarefa em todas as listas em cache e no detalhe.
// Devolve o que existia antes (para o rollback).
function patchIssueFrente(qc: QueryClient, issueId: number, frente: IssueFrente): Snapshots {
  const snapshots: Snapshots = [];
  qc.getQueriesData<Issue[]>({ predicate: (q) => isIssueListKey(q.queryKey) }).forEach(
    ([key, data]) => {
      if (!Array.isArray(data) || !data.some((i) => i.id === issueId)) return;
      snapshots.push([key, data]);
      qc.setQueryData(
        key,
        data.map((i) => (i.id === issueId ? { ...i, frente } : i)),
      );
    },
  );
  const single = qc.getQueryData<Issue>(['issue', issueId]);
  if (single) {
    snapshots.push([['issue', issueId], single]);
    qc.setQueryData(['issue', issueId], { ...single, frente });
  }
  return snapshots;
}

// Escolha manual de frente para UMA tarefa. Fixar reflete na hora em todas as
// listas e no detalhe (a resposta do servidor é determinística: src 'manual').
// Voltar ao automático não dá para prever aqui (depende das regras), então
// só rebusca.
export function useSetManualFrente() {
  const qc = useQueryClient();
  const toFrente = (frenteId: string | null): IssueFrente | null => {
    const f = frenteId
      ? qc.getQueryData<FrentesConfig>(KEY)?.frentes.find((x) => x.id === frenteId)
      : undefined;
    return f ? { id: f.id, name: f.name, color: f.color, hidden: !!f.hidden, src: 'manual' } : null;
  };

  return useMutation({
    mutationFn: ({ issueId, frenteId }: { issueId: number; frenteId: string | null }) =>
      setManualFrente(issueId, frenteId),
    onMutate: async ({ issueId, frenteId }) => {
      await qc.cancelQueries({ predicate: (q) => isIssueListKey(q.queryKey) });
      await qc.cancelQueries({ queryKey: ['issue', issueId] });
      const frente = toFrente(frenteId);
      return { snapshots: frente ? patchIssueFrente(qc, issueId, frente) : [] };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSuccess: (cfg, { issueId, frenteId }) => {
      qc.setQueryData(KEY, cfg);
      // Uma busca que já estava a caminho quando o servidor gravou pode ter
      // devolvido a classificação antiga por cima do otimismo: reaplica.
      const frente = toFrente(frenteId);
      if (frente) patchIssueFrente(qc, issueId, frente);
    },
    onSettled: (_d, _e, { issueId, frenteId }) => {
      qc.invalidateQueries({ queryKey: KEY });
      if (frenteId === null) refreshIssues(qc, issueId);
    },
  });
}

export function useSaveFrentes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: FrentesDraft) => saveFrentes(draft),
    onSuccess: (cfg) => {
      qc.setQueryData(KEY, cfg);
      refreshIssues(qc);
    },
  });
}

export function useResetFrentes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => resetFrentes(),
    onSuccess: (cfg) => {
      qc.setQueryData(KEY, cfg);
      refreshIssues(qc);
    },
  });
}
