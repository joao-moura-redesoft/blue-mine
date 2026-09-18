/**
 * Impedimentos lidos de volta dos comentários.
 *
 * A key da API não é admin e /relations.json responde 403, então impedimento
 * é registrado como comentário nas duas tarefas (ver linkBlockerComments em
 * App.tsx). Aqui a gente lê esses comentários e reconstrói quem impede quem.
 *
 * O ⛔ é opcional de propósito: há tarefas antigas com o texto escrito na mão.
 */
const BLOCKED_BY_RE = /impedida\s+pela\s+(?:tarefa\s+)?#(\d+)/gi;
const BLOCKS_RE = /impede\s+a\s+(?:tarefa\s+)?#(\d+)/gi;

function refsInNotes(journals: { notes?: string }[] | undefined, re: RegExp): number[] {
  const ids: number[] = [];
  for (const j of journals ?? []) {
    if (!j.notes) continue;
    for (const m of j.notes.matchAll(re)) {
      const id = Number(m[1]);
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

export interface Blockers {
  /** Tarefas que impedem esta */
  blockedBy: number[];
  /** Tarefas que esta impede */
  blocks: number[];
}

export function parseBlockers(journals?: { notes?: string }[]): Blockers {
  return {
    blockedBy: refsInNotes(journals, BLOCKED_BY_RE),
    blocks: refsInNotes(journals, BLOCKS_RE),
  };
}
