import { useState } from 'react';
import { ChevronDown, Wand2, Check, Loader2 } from 'lucide-react';
import { useFrentes, useSetManualFrente } from '../../hooks/useFrentes';
import type { Issue } from '../../types/redmine';
import { FrenteChip } from './FrenteChip';
import { describeRule } from './describeRule';

/* Seletor de frente no detalhe da tarefa. Mostra a frente atual, por que ela é
   essa (regra ou escolha sua) e deixa fixar outra ou voltar ao automático. */
export function FrenteField({ issue }: { issue: Issue }) {
  const { data: cfg } = useFrentes();
  const setManual = useSetManualFrente();
  const [open, setOpen] = useState(false);
  const current = issue.frente ?? null;

  const choose = (frenteId: string | null) => {
    setOpen(false);
    setManual.mutate({ issueId: issue.id, frenteId });
  };

  const rule = cfg?.rules.find((r) => r.id === current?.ruleId);
  const alsoRules = (current?.also ?? [])
    .map((id) => cfg?.rules.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => !!r);
  const frenteName = (id: string) => cfg?.frentes.find((f) => f.id === id)?.name ?? id;
  const active = (cfg?.frentes ?? []).filter((f) => !f.archived);

  const why = !current
    ? 'Nenhuma regra casou com esta tarefa.'
    : current.src === 'manual'
      ? 'Escolhida por você — as regras não mexem mais nela.'
      : current.src === 'padrao'
        ? 'Nenhuma regra casou; caiu na frente-padrão.'
        : rule
          ? `Regra: ${describeRule(rule)}`
          : 'Definida por regra.';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 -ml-1 px-1 py-0.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors max-w-full"
        title="Alterar frente"
      >
        {current ? (
          <FrenteChip frente={current} manual={current.src === 'manual'} />
        ) : (
          <span className="text-sm text-slate-400 dark:text-slate-500">Sem frente</span>
        )}
        {setManual.isPending ? (
          <Loader2 size={12} className="animate-spin text-slate-400" />
        ) : (
          <ChevronDown size={12} className="text-slate-400 flex-shrink-0" />
        )}
      </button>
      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">{why}</p>
      {alsoRules.length > 0 && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-snug">
          Também casaria com:{' '}
          {alsoRules.map((r) => `${frenteName(r.frente)} (${describeRule(r)})`).join('; ')}
        </p>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 max-h-72 overflow-y-auto">
            {active.map((f) => (
              <button
                key={f.id}
                onClick={() => choose(f.id)}
                className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors"
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: f.color }}
                />
                <span className="flex-1 truncate text-slate-700 dark:text-slate-200">{f.name}</span>
                {current?.id === f.id && <Check size={13} className="text-blue-500" />}
              </button>
            ))}
            {current?.src === 'manual' && (
              <>
                <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                <button
                  onClick={() => choose(null)}
                  className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <Wand2 size={13} /> Voltar ao automático
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
