import { issueRefRegex } from './issueRef';
import { statusDotColor, issueRefTooltip, type IssueRefInfo } from './issueStatus';

/**
 * Conversão de "#92313" em chip clicável dentro de um texto Markdown.
 * Separado do componente para poder ser testado sem React.
 */

// Trechos onde "#12345" não é referência: código (cercado ou inline), alvo de
// link markdown, tag HTML e URL crua. Ficam de fora da conversão.
const NO_LINK_RE = /(```[\s\S]*?```|`[^`\n]*`|\[[^\]]*\]\([^)]*\)|<[^>]+>|https?:\/\/\S+)/g;

/** Fatia o texto: índices pares são onde uma referência conta. */
function refSegments(md: string): string[] {
  return md.split(NO_LINK_RE);
}

/** IDs citados no texto, sem repetir e na ordem em que aparecem. */
export function extractIssueRefs(md: string): number[] {
  const ids: number[] = [];
  refSegments(md).forEach((seg, i) => {
    if (i % 2 === 1) return;
    for (const m of seg.matchAll(issueRefRegex())) {
      const id = Number(m[1]);
      if (!ids.includes(id)) ids.push(id);
    }
  });
  return ids;
}

const escAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * #92313 → chip clicável (ponto de status + tooltip). O clique é tratado por
 * delegação em quem renderiza. Referência que o mapa diz não existir fica como
 * texto puro: número que passa no formato mas não é tarefa não vira link morto.
 */
export function linkIssueRefs(md: string, byId: Map<number, IssueRefInfo | null>): string {
  return refSegments(md)
    .map((seg, i) => {
      if (i % 2 === 1) return seg;
      return seg.replace(issueRefRegex(), (full, digits: string) => {
        const id = Number(digits);
        const info = byId.get(id) ?? null;
        if (byId.has(id) && !info) return full; // tarefa inexistente → não linka
        const dot = info
          ? `<span class="rk-issue-dot ${statusDotColor(info.status?.name)}"></span>`
          : '';
        const title = escAttr(issueRefTooltip(info, id));
        return `<a href="#rk-issue-${id}" class="rk-issue-ref" title="${title}">${dot}#${id}</a>`;
      });
    })
    .join('');
}
