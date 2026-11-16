import { Pin } from 'lucide-react';
import type { IssueFrente } from '../../types/redmine';

/* Chip colorido da frente. O fundo é a cor da frente com transparência e o
   texto segue o tema — funciona em claro/escuro com qualquer cor escolhida.
   Escolha manual leva um alfinete: quase toda frente é automática, então é a
   exceção (a que as regras não mexem mais) que merece marca. */
export function FrenteChip({
  frente,
  manual,
  className = '',
}: {
  frente: Pick<IssueFrente, 'name' | 'color'>;
  manual?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 max-w-full text-[11px] font-medium leading-none px-1.5 py-1 rounded-full border text-slate-700 dark:text-slate-200 ${className}`}
      style={{ backgroundColor: `${frente.color}22`, borderColor: `${frente.color}66` }}
      title={manual ? `${frente.name} — escolhida por você` : undefined}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: frente.color }}
      />
      <span className="truncate">{frente.name}</span>
      {manual && (
        <Pin size={9} className="flex-shrink-0 opacity-60" aria-label="escolhida por você" />
      )}
    </span>
  );
}
