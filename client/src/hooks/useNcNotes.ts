import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchNcNotes,
  updateNcNote,
  deleteNcNote,
  pushNoteToNc,
  type NcNote,
  type NcPatch,
} from '../api/ncnotes';
import { getStoredAuth } from '../api/redmine';

const KEY = ['ncnotes'];

// Notas do Nextcloud (app Notes). Query separada das notas locais (['notes']); o
// NotesView mescla as duas listas. Falha silenciosa (Talk/Nextcloud não vinculado
// devolve 401) — a aba de notas continua funcionando só com as locais.
export function useNcNotes() {
  return useQuery({
    queryKey: KEY,
    queryFn: fetchNcNotes,
    enabled: !!getStoredAuth(),
    staleTime: 15_000,
    // Reflete edições feitas direto no QuickNotes web ao voltar para esta aba.
    refetchOnWindowFocus: true,
    retry: false, // sem Nextcloud vinculado, não adianta insistir
  });
}

export function useUpdateNcNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ncId, patch }: { ncId: number; patch: NcPatch }) => updateNcNote(ncId, patch),
    // Atualização otimista (autosave sem flicker, igual às notas locais). `ncColor` é a
    // cor real; os demais campos do patch batem com o shape de Note.
    onMutate: async ({ ncId, patch }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<NcNote[]>(KEY);
      qc.setQueryData<NcNote[]>(KEY, (old = []) =>
        old.map((n) => (n.ncId === ncId ? { ...n, ...patch, updatedAt: Date.now() } : n)),
      );
      return { prev };
    },
    onSuccess: (note) => {
      qc.setQueryData<NcNote[]>(KEY, (old = []) =>
        old.map((n) => (n.ncId === note.ncId ? note : n)),
      );
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}

export function useDeleteNcNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ncId: number) => deleteNcNote(ncId),
    onMutate: async (ncId) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<NcNote[]>(KEY);
      qc.setQueryData<NcNote[]>(KEY, (old = []) => old.filter((n) => n.ncId !== ncId));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}

// Bridge: envia uma nota local para o Nextcloud (ou cria uma nota nova no NC). A nota
// devolvida pelo POST é autoritativa — inserimos direto no cache para poder selecioná-la
// na hora. NÃO invalidamos aqui: um refetch imediato da lista corre contra a nota recém
// criada (o QuickNotes pode ainda não devolvê-la na listagem) e a apagaria do cache,
// fazendo a seleção "piscar e sumir". A reconciliação natural acontece no próximo
// refetchOnWindowFocus / expiração do staleTime.
export function usePushNoteToNc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ title, body }: { title: string; body: string }) => pushNoteToNc(title, body),
    onSuccess: (note) => {
      // O create do QuickNotes às vezes não devolve `timestamp` → updatedAt: 0, o que
      // jogaria a nota para o fim da lista (ordenada por recência). Garante que uma nota
      // recém-criada apareça no topo.
      const fresh: NcNote = note.updatedAt ? note : { ...note, updatedAt: Date.now() };
      qc.setQueryData<NcNote[]>(KEY, (old = []) => [
        fresh,
        ...old.filter((n) => n.id !== fresh.id), // idempotente: substitui se já existir
      ]);
    },
  });
}
