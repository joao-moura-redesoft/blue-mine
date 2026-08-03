import { useState } from 'react';
import { X, MessageSquare, ExternalLink, Copy, Check, Loader2, AlertCircle } from 'lucide-react';
import { getTalkAuth, getTalkAuthFailure } from '../api/talk';
import { useTalkLoginFlow } from '../hooks/useTalkLoginFlow';

/**
 * Reconexão do Talk quando a senha de app é revogada/expira.
 *
 * Existe como diálogo próprio porque o caminho anterior era um beco sem saída: o
 * aviso mandava para as Configurações, onde a seção do Nextcloud dizia
 * "Configurado ✓" e não oferecia nenhuma ação de reconectar — só "Remover", que
 * apagava o vínculo (inclusive no servidor) e ainda exigia redigitar a URL de
 * cabeça. Aqui a URL já vem preenchida e o vínculo antigo só é substituído
 * quando o novo funciona.
 */
export function TalkReconnectModal({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  const current = getTalkAuth();
  const failure = getTalkAuthFailure();
  const [url, setUrl] = useState(current?.url ?? '');
  const [copied, setCopied] = useState(false);

  const { phase, error, loginUrl, start, cancel, reopen } = useTalkLoginFlow(() => {
    // Sucesso: saveTalkAuth já avisou o app (TALK_AUTH_CHANGED). Fecha sozinho.
    setTimeout(onClose, 900);
  });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(loginUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sem clipboard: o link continua visível para copiar à mão */
    }
  };

  // A sessão do Redmine caiu — reconectar o Talk não resolve nada.
  if (failure.redmineSession) {
    return (
      <Shell onClose={onClose} title="Sessão do Bluemine expirou">
        <p className="text-xs text-slate-600 dark:text-slate-300">
          O problema não é o Talk: sua sessão do Bluemine expirou, então o servidor não consegue
          mais identificar você. Entre no app novamente — o chat volta junto, sem precisar
          reconectar o Nextcloud.
        </p>
        <button
          onClick={onClose}
          className="w-full py-2 text-xs font-semibold bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg transition-colors"
        >
          Entendi
        </button>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose} title="Reconectar o Talk">
      {phase === 'done' ? (
        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-xs text-green-700 dark:text-green-300">
          <Check size={14} className="flex-shrink-0" />
          <span>Conectado! O chat já voltou.</span>
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {current
              ? 'A senha de app usada pelo chat não é mais aceita — normalmente porque foi revogada no Nextcloud ou a senha de rede mudou. Autorize novamente para voltar a receber mensagens.'
              : 'Vincule sua conta do Nextcloud para usar o chat.'}
          </p>

          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Servidor Nextcloud
            </span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && phase !== 'waiting' && start(url)}
              placeholder="https://nextcloud.exemplo.com"
              disabled={phase === 'waiting' || phase === 'starting'}
              className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </label>

          {phase === 'waiting' ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-blue-700 dark:text-blue-300">
                <Loader2 size={14} className="flex-shrink-0 mt-0.5 animate-spin" />
                <span>
                  Abrimos o Nextcloud no navegador. Faça login e clique em{' '}
                  <strong>Conceder acesso</strong> — esta janela detecta sozinha.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={reopen}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg font-medium transition-colors"
                >
                  <ExternalLink size={12} /> Abrir de novo
                </button>
                <button
                  onClick={copyLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg font-medium transition-colors"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copiado' : 'Copiar link'}
                </button>
                <button
                  onClick={cancel}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 ml-auto"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => start(url)}
              disabled={!url.trim() || phase === 'starting'}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-sm shadow-blue-500/20 hover:shadow-blue-500/40 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-all duration-200"
            >
              {phase === 'starting' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <ExternalLink size={13} />
              )}
              {phase === 'error' ? 'Tentar de novo' : 'Entrar no Nextcloud'}
            </button>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {onOpenSettings && phase !== 'waiting' && (
            <button
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
              className="w-full text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              Prefiro usar um token manual (senha de app) →
            </button>
          )}
        </>
      )}
    </Shell>
  );
}

function Shell({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 modal-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <MessageSquare size={15} className="text-blue-600 flex-shrink-0" />
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}
