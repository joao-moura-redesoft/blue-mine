import { useEffect, useState } from 'react';
import type { Issue } from '../types/redmine';

const KEY = 'rk_seen_issues';

function todayKey() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
}

/**
 * Detecta tarefas que entraram HOJE na lista atribuída ao usuário —
 * seja tarefa recém-criada ou recém-atribuída a ele.
 * Persiste a data em que cada tarefa foi vista pela primeira vez (localStorage),
 * então sobrevive a refresh e zera naturalmente na virada do dia.
 */
export function useNewToday(issues: Issue[] | undefined) {
  const [newToday, setNewToday] = useState<Issue[]>([]);

  useEffect(() => {
    if (!issues) return;
    const today = todayKey();

    let store: Record<string, string> = {};
    try {
      store = JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
      store = {};
    }

    const firstRun = Object.keys(store).length === 0;
    let changed = false;

    issues.forEach((i) => {
      if (!(String(i.id) in store)) {
        // No primeiro uso, marca tudo como antigo para não alertar a base inteira
        store[String(i.id)] = firstRun ? '1970-01-01' : today;
        changed = true;
      }
    });

    // Poda: remove marcadores de tarefas que saíram da lista atribuída e não foram
    // vistas hoje — senão o rk_seen_issues cresce sem limite. Mantém as atuais (para
    // não re-sinalizar) e as de hoje. Uma tarefa que sair e voltar pode reaparecer
    // como "nova" (falso positivo raro e inofensivo).
    const currentIds = new Set(issues.map((i) => String(i.id)));
    for (const key of Object.keys(store)) {
      if (!currentIds.has(key) && store[key] !== today) {
        delete store[key];
        changed = true;
      }
    }

    if (changed) localStorage.setItem(KEY, JSON.stringify(store));

    setNewToday(issues.filter((i) => store[String(i.id)] === today));
  }, [issues]);

  return newToday;
}
