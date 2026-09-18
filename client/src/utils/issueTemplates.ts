import { useSyncExternalStore } from 'react';

/**
 * Modelos de tarefa usados no modal de Nova Tarefa: guardam o formulário inteiro
 * (projeto e responsável inclusive), não só o texto. Diferente de
 * `utils/templates.ts`, que guarda textos prontos de comentário — aquele é só corpo.
 *
 * Campos ausentes no modelo não sobrescrevem o que já está preenchido na hora de
 * aplicar, então dá pra ter modelos parciais (ex.: só projeto + responsável).
 */
export interface IssueTemplate {
  id: string;
  name: string;
  subject: string;
  description: string;
  tracker_id?: number;
  priority_id?: number;
  project_id?: number;
  assigned_to_id?: number;
  /** Só pra exibir no menu — o nome do projeto/pessoa de outro projeto não está
   *  carregado na hora de listar os modelos. */
  project_name?: string;
  assigned_to_name?: string;
}

const KEY = 'issue-templates';

function read(): IssueTemplate[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(arr)
      ? (arr.filter((t) => t && typeof t.id === 'string') as IssueTemplate[])
      : [];
  } catch {
    return [];
  }
}

let current = read();
const listeners = new Set<() => void>();

function write(list: IssueTemplate[]) {
  current = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota */
  }
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      current = read();
      listeners.forEach((l) => l());
    }
  });
}

export function getTemplates(): IssueTemplate[] {
  return current;
}

export function saveTemplate(t: IssueTemplate): void {
  write([...current.filter((x) => x.id !== t.id), t]);
}

export function deleteTemplate(id: string): void {
  write(current.filter((x) => x.id !== id));
}

export function useIssueTemplates(): IssueTemplate[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getTemplates,
    getTemplates,
  );
}
