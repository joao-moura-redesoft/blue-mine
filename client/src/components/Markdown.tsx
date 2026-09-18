import { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Attachment } from '../types/redmine';
import { attachmentUrl } from '../api/redmine';
import { textileToMarkdown } from '../utils/textileToMarkdown';
import { extractIssueRefs, linkIssueRefs } from '../utils/issueRefLinks';
import { useIssueRefs } from '../hooks/useIssueRefs';
import { splitMermaid } from '../utils/mermaid';
import { MermaidDiagram } from './MermaidDiagram';

marked.setOptions({ breaks: true, gfm: true });

interface Props {
  text: string;
  attachments?: Attachment[];
  className?: string;
  /** Converte o texto de Textile (formato do Redmine) para Markdown antes de renderizar */
  textile?: boolean;
  /** Torna as referências #12345 clicáveis (abre a tarefa) */
  onIssueClick?: (id: number) => void;
}

// Sintaxe de imagem do Redmine (Textile): !arquivo.png!, !>img.png!, !{width:300px}img.png!, !http://.../x.png!
const IMG_RE = /!(?:\{[^}]*\}|[<>=])*([^!\s]+?\.(?:png|jpe?g|gif|webp|svg|bmp))!/gi;

// Nomes de arquivos que o Markdown renderiza inline (sintaxe Textile de imagem).
// Usado para evitar duplicar previews de anexos que já aparecem na nota.
export function inlineImageNames(text?: string): Set<string> {
  const names = new Set<string>();
  if (!text) return names;
  for (const m of text.matchAll(IMG_RE)) {
    const file = m[1];
    if (/^https?:\/\//i.test(file)) continue; // URL externa, não é anexo
    names.add(file);
    try {
      names.add(decodeURIComponent(file));
    } catch {
      /* mantém */
    }
  }
  return names;
}

function preprocess(text: string, attachments?: Attachment[]): string {
  if (!text) return '';
  const byName = new Map<string, Attachment>();
  (attachments ?? []).forEach((a) => {
    if (!byName.has(a.filename)) byName.set(a.filename, a);
  });

  return text.replace(IMG_RE, (match, file: string) => {
    // URL externa → usa direto
    if (/^https?:\/\//i.test(file)) return `![imagem](${file})`;
    // O texto pode vir URL-encodado (ex: %20 = espaço). Tenta casar pelo nome
    // decodificado e pelo cru, contra os nomes reais dos anexos.
    let decoded = file;
    try {
      decoded = decodeURIComponent(file);
    } catch {
      /* mantém */
    }
    const att = byName.get(decoded) || byName.get(file);
    if (att) return `![${att.filename}](${attachmentUrl(att.id, att.filename)})`;
    return match; // não encontrou anexo: deixa como está
  });
}

const NO_REFS: number[] = [];

/** Segue o tema do app (classe `dark` no <html>) para renderizar os diagramas. */
function useDarkMode(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains('dark')));
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export function Markdown({
  text,
  attachments,
  className = '',
  textile = false,
  onIssueClick,
}: Props) {
  const pre = useMemo(
    () => preprocess(textile ? textileToMarkdown(text) : text, attachments),
    [text, attachments, textile],
  );
  // Booleano, não a função: o onIssueClick costuma ser recriado a cada render
  // do pai, e refazer o parse do markdown de toda nota nisso sai caro.
  const canLink = !!onIssueClick;
  const refIds = useMemo(() => (canLink ? extractIssueRefs(pre) : NO_REFS), [pre, canLink]);
  const { byId, sig } = useIssueRefs(refIds);
  const dark = useDarkMode();

  // Os diagramas Mermaid são componentes React, não HTML — o texto é fatiado nas
  // cercas ```mermaid e cada pedaço de Markdown é parseado separadamente.
  const parts = useMemo(() => {
    const md = canLink ? linkIssueRefs(pre, byId) : pre;
    return splitMermaid(md).map((part) =>
      part.type === 'mermaid'
        ? part
        : {
            type: 'html' as const,
            html: DOMPurify.sanitize(marked.parse(part.content, { async: false }) as string, {
              ADD_ATTR: ['target'],
            }),
          },
    );
    // byId é derivado de sig — ver useIssueRefs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pre, canLink, sig]);

  const handleClick = onIssueClick
    ? (e: React.MouseEvent<HTMLDivElement>) => {
        const anchor = (e.target as HTMLElement).closest('a');
        if (!anchor) return;
        const m = /^#rk-issue-(\d+)$/.exec(anchor.getAttribute('href') || '');
        if (m) {
          e.preventDefault();
          e.stopPropagation();
          onIssueClick(Number(m[1]));
        }
      }
    : undefined;

  return (
    <div className={`prose-redmine ${className}`} onClick={handleClick}>
      {parts.map((part, i) =>
        part.type === 'mermaid' ? (
          <MermaidDiagram key={i} code={part.content} dark={dark} />
        ) : (
          <div key={i} dangerouslySetInnerHTML={{ __html: part.html }} />
        ),
      )}
    </div>
  );
}
