import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Code, Loader2, Maximize2, X } from 'lucide-react';
import DOMPurify from 'dompurify';
import { renderMermaidSvg } from '../utils/mermaid';

interface Props {
  code: string;
  /** Renderiza no tema escuro do mermaid (segue o tema do app) */
  dark?: boolean;
}

/**
 * Um diagrama Mermaid renderizado. A lib entra por import() dinâmico dentro do
 * renderMermaidSvg, então o custo só aparece em nota que tem diagrama.
 *
 * Erro de sintaxe não vira tela vermelha: mostra o aviso e o código-fonte, que é
 * o que a pessoa precisa ver para corrigir.
 */
export function MermaidDiagram({ code, dark = false }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [zoom, setZoom] = useState(false);
  // Guarda contra setState depois do unmount (o render é assíncrono e o modal
  // de tarefa fecha/troca de issue no meio com frequência).
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    renderMermaidSvg(code, dark ? 'dark' : 'default')
      .then((out) => {
        if (cancelled || !aliveRef.current) return;
        // O mermaid gera o SVG a partir do texto do usuário; sanitizar mantém a
        // mesma barreira do resto do Markdown (o securityLevel da lib não é a
        // única linha de defesa).
        setSvg(DOMPurify.sanitize(out, { USE_PROFILES: { svg: true, svgFilters: true } }));
      })
      .catch((err: unknown) => {
        if (cancelled || !aliveRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg.split('\n')[0] || 'Diagrama inválido');
      });
    return () => {
      cancelled = true;
    };
  }, [code, dark]);

  if (error) {
    return (
      <div className="my-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 overflow-hidden">
        <p className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 border-b border-amber-200 dark:border-amber-800">
          <AlertTriangle size={12} className="flex-shrink-0" />
          Diagrama com erro de sintaxe: {error}
        </p>
        <pre className="px-3 py-2 text-xs overflow-x-auto scrollbar-thin text-slate-600 dark:text-slate-300">
          {code}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-2 flex items-center justify-center gap-2 h-24 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-400">
        <Loader2 size={13} className="animate-spin" />
        Desenhando diagrama…
      </div>
    );
  }

  return (
    <>
      <div className="group/mmd relative my-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 overflow-hidden">
        <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 opacity-0 group-hover/mmd:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            title={showSource ? 'Ver diagrama' : 'Ver código'}
            className="p-1 rounded bg-white/90 dark:bg-slate-700/90 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:text-slate-700 shadow-sm"
          >
            <Code size={12} />
          </button>
          <button
            type="button"
            onClick={() => setZoom(true)}
            title="Ampliar"
            className="p-1 rounded bg-white/90 dark:bg-slate-700/90 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:text-slate-700 shadow-sm"
          >
            <Maximize2 size={12} />
          </button>
        </div>
        {showSource ? (
          <pre className="px-3 py-2 text-xs overflow-x-auto scrollbar-thin text-slate-600 dark:text-slate-300">
            {code}
          </pre>
        ) : (
          <div
            className="mermaid-svg px-2 py-3 overflow-x-auto scrollbar-thin cursor-zoom-in"
            onClick={() => setZoom(true)}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>

      {zoom && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-6"
          onClick={() => setZoom(false)}
        >
          <div
            className="relative max-w-[95vw] max-h-[92vh] overflow-auto scrollbar-thin bg-white rounded-xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setZoom(false)}
              title="Fechar"
              className="absolute top-2 right-2 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={16} />
            </button>
            {/* Ampliado sempre no tema claro renderizado: o modal tem fundo branco */}
            <div
              className="mermaid-svg mermaid-svg-zoom"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      )}
    </>
  );
}
