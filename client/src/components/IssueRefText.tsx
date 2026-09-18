import { useMemo } from 'react';
import { issueRefRegex } from '../utils/issueRef';
import { statusDotColor, issueRefTooltip } from '../utils/issueStatus';
import { useIssueRefs } from '../hooks/useIssueRefs';

const NO_REFS: number[] = [];

/**
 * Texto puro (sem markdown) com as referências #92313 clicáveis — para os
 * campos da coluna de detalhes, que renderizam texto cru. Referência que não
 * existe fica como texto, igual ao <Markdown>.
 *
 * Usa <span role="link"> em vez de <button> porque estes campos ficam dentro do
 * botão que abre a edição inline (botão dentro de botão é HTML inválido).
 */
export function IssueRefText({
  text,
  onIssueClick,
}: {
  text: string;
  onIssueClick?: (id: number) => void;
}) {
  const parts = useMemo(() => text.split(issueRefRegex()), [text]);
  // Booleano, não a função (que o pai recria a cada render) — ver <Markdown>.
  const canLink = !!onIssueClick;
  const ids = useMemo(
    () => (canLink ? [...new Set(parts.filter((_, i) => i % 2 === 1).map(Number))] : NO_REFS),
    [parts, canLink],
  );
  const { byId } = useIssueRefs(ids);

  if (!onIssueClick || parts.length === 1) return <>{text}</>;

  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part;
        const id = Number(part);
        const info = byId.get(id) ?? null;
        if (byId.has(id) && !info) return `#${id}`; // não existe: texto puro
        return (
          <span
            key={i}
            role="link"
            tabIndex={0}
            title={issueRefTooltip(info, id)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onIssueClick(id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onIssueClick(id);
              }
            }}
            className="inline-flex items-baseline gap-1 px-1 rounded font-mono text-xs font-semibold cursor-pointer bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40"
          >
            {info && (
              <span
                className={`self-center w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotColor(
                  info.status?.name,
                )}`}
              />
            )}
            #{id}
          </span>
        );
      })}
    </>
  );
}
