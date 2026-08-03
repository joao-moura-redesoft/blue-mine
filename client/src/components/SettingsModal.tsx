import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ConfirmDialog } from './workflow/ConfirmDialog';
import {
  X,
  KeyRound,
  Eye,
  EyeOff,
  Check,
  Loader2,
  Trash2,
  Sparkles,
  ChevronDown,
  MessageSquare,
  LogIn,
  Mail,
  Shield,
  RefreshCw,
  Lock,
} from 'lucide-react';
import { useTalkRedmineMatch, useRefreshTalkRedmineMatch } from '../hooks/useTalk';
import {
  getConfiguredProviders,
  saveAIKey,
  clearAIKey,
  getActiveAIProvider,
  type AIProvider,
} from '../utils/aiConfig';
import { getTalkAuth, saveTalkAuth, clearTalkAuth } from '../api/talk';
import { getTalkPrefs, saveTalkPrefs, type TalkPrefs } from '../utils/talkPrefs';
import { useTalkLoginFlow } from '../hooks/useTalkLoginFlow';
import { TalkReconnectModal } from './TalkReconnectModal';
import { getMailConfig, saveMailConfig, DEFAULT_HOST } from '../utils/mailConfig';
import { getStoredAuth, redmineApi, type AIUsage } from '../api/redmine';
import { mailApi } from '../api/mail';
import { adConfigured, saveADCreds, clearADCreds, hasEffectiveCreds } from '../utils/adConfig';
import { errorDetail } from '../utils/httpError';
import { appDefaults, LOCKED_HINT, dokuwikiHost } from '../utils/appDefaults';

interface Props {
  onClose: () => void;
}

interface ProviderConfig {
  id: AIProvider;
  name: string;
  // Prefixo esperado da chave — usado só para validação de conveniência.
  // Opcional: deixe vazio quando o provider emite chaves em formatos variados (ex.: Gemini via Antigravity).
  prefix?: string;
  placeholder: string;
  docsUrl: string;
  color: string;
  badge: string;
  badgeDark: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    prefix: 'sk-ant-',
    placeholder: 'sk-ant-api03-...',
    docsUrl: 'console.anthropic.com',
    color: 'text-orange-600 dark:text-orange-400',
    badge: 'bg-orange-50 border-orange-200 text-orange-700',
    badgeDark: 'dark:bg-orange-900/20 dark:border-orange-800 dark:text-orange-300',
  },
  {
    id: 'openai',
    name: 'ChatGPT (OpenAI)',
    prefix: 'sk-',
    placeholder: 'sk-proj-...',
    docsUrl: 'platform.openai.com/api-keys',
    color: 'text-emerald-600 dark:text-emerald-400',
    badge: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    badgeDark: 'dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300',
  },
  {
    id: 'gemini',
    name: 'Gemini (Google)',
    // Sem prefixo fixo: AI Studio emite chaves "AIza...", mas Antigravity usa "AQ...".
    placeholder: 'AIza... ou AQ...',
    docsUrl: 'aistudio.google.com/apikey',
    color: 'text-blue-600 dark:text-blue-400',
    badge: 'bg-blue-50 border-blue-200 text-blue-700',
    badgeDark: 'dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300',
  },
  {
    id: 'local',
    name: 'IA local (on-prem)',
    // Servidor OpenAI-compatible (Ollama/vLLM/LM Studio). O endpoint e o modelo
    // são definidos por env no servidor (AI_LOCAL_BASE_URL, AI_MODEL_LOCAL);
    // aqui basta um token (ou deixe vazio p/ usar o sentinela "local").
    placeholder: 'token (opcional) — deixe vazio p/ Ollama',
    docsUrl: 'ollama.com / vLLM / LM Studio',
    color: 'text-teal-600 dark:text-teal-400',
    badge: 'bg-teal-50 border-teal-200 text-teal-700',
    badgeDark: 'dark:bg-teal-900/20 dark:border-teal-800 dark:text-teal-300',
  },
];

const PROVIDER_NAMES: Record<AIProvider, string> = {
  anthropic: 'Claude (Anthropic)',
  openai: 'ChatGPT (OpenAI)',
  gemini: 'Gemini (Google)',
  local: 'IA local (on-prem)',
};

// Painel compacto de uso/custo de IA (tokens acumulados). Lê /ai/usage.
function AIUsagePanel() {
  const [usage, setUsage] = useState<AIUsage | null>(null);
  useEffect(() => {
    redmineApi
      .getAIUsage()
      .then(setUsage)
      .catch(() => setUsage(null));
  }, []);
  const total = usage?.total;
  if (!total || total.calls === 0) return null;
  const fmt = (n: number) => n.toLocaleString('pt-BR');
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 space-y-2">
      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
        Uso de IA
      </p>
      <div className="flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-300">
        <span>
          <strong>{fmt(total.calls)}</strong> chamadas
        </span>
        <span>
          <strong>{fmt(total.inputTokens)}</strong> tokens entrada
        </span>
        <span>
          <strong>{fmt(total.outputTokens)}</strong> tokens saída
        </span>
      </div>
      {Object.keys(usage.byProvider).length > 1 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {Object.entries(usage.byProvider).map(([prov, b]) => (
            <span
              key={prov}
              className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
            >
              {PROVIDER_NAMES[prov as AIProvider] ?? prov}: {fmt(b.inputTokens + b.outputTokens)}{' '}
              tok
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderSection({ config, active }: { config: ProviderConfig; active: boolean }) {
  const [configured, setConfigured] = useState(() => getConfiguredProviders()[config.id]);
  const [input, setInput] = useState('');
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(() => getConfiguredProviders()[config.id] || active);

  const save = async () => {
    if (config.prefix && !input.trim().startsWith(config.prefix)) {
      setError(`A chave deve começar com ${config.prefix}`);
      return;
    }
    if (busy) return;
    // Provider local não exige key real: quando vazia, usa o sentinela "local".
    const value = config.id === 'local' && !input.trim() ? 'local' : input.trim();
    if (!value) {
      setError('Informe a chave.');
      return;
    }
    setBusy(true);
    try {
      await saveAIKey(config.id, value);
      setConfigured(true);
      setInput('');
      setSaved(true);
      setError('');
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setBusy(false);
    }
  };

  const [confirmRemove, setConfirmRemove] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await clearAIKey(config.id);
      setConfigured(false);
      setSaved(false);
      setError('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`border rounded-xl overflow-hidden transition-colors ${
        active
          ? 'border-purple-300 dark:border-purple-700'
          : 'border-slate-200 dark:border-slate-700'
      }`}
    >
      {/* Header do provedor */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className={`text-sm font-medium ${config.color}`}>{config.name}</span>
          {active && (
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${config.badge} ${config.badgeDark}`}
            >
              Em uso
            </span>
          )}
          {configured && !active && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-slate-100 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400">
              Configurado
            </span>
          )}
        </div>
        <ChevronDown
          size={14}
          className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3 bg-white dark:bg-slate-900">
          {configured ? (
            <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
                <Check size={12} />
                <span>Chave salva no servidor</span>
              </div>
              <button
                onClick={() => setConfirmRemove(true)}
                disabled={busy}
                className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 dark:hover:text-red-300 disabled:opacity-40 transition-colors"
              >
                <Trash2 size={11} />
                Remover
              </button>
              {confirmRemove && (
                <ConfirmDialog
                  title={`Remover chave da ${config.name}?`}
                  message="Recursos de IA que usam este provedor param de funcionar até uma nova chave ser configurada."
                  confirmLabel="Remover"
                  danger
                  onConfirm={remove}
                  onClose={() => setConfirmRemove(false)}
                />
              )}
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={show ? 'text' : 'password'}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      setError('');
                      setSaved(false);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && save()}
                    placeholder={config.placeholder}
                    autoComplete="new-password"
                    className="w-full text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 pr-8 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    {show ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <button
                  onClick={save}
                  disabled={!input.trim() || busy}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white rounded-lg font-medium transition-colors whitespace-nowrap"
                >
                  {saved ? (
                    <>
                      <Check size={11} /> Salvo!
                    </>
                  ) : (
                    <>
                      <KeyRound size={11} /> Salvar
                    </>
                  )}
                </button>
              </div>
              {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Obtenha sua chave em <span className="font-mono">{config.docsUrl}</span>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type FlowState = 'idle' | 'waiting' | 'error';

function NextcloudSection() {
  const [currentAuth, setCurrentAuth] = useState(() => getTalkAuth());
  const [open, setOpen] = useState(!!currentAuth);
  // Endereço do Nextcloud definido no build (VITE_NEXTCLOUD_URL): vale para os
  // dois modos de entrada (fluxo de login e usuário+token).
  const { value: defaultNcUrl, locked: ncLocked } = appDefaults.nextcloudUrl;
  const [url, setUrl] = useState(defaultNcUrl);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'flow' | 'manual'>('flow');
  const [mUser, setMUser] = useState('');
  const [mToken, setMToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<TalkPrefs>(() => getTalkPrefs());

  const updatePref = (patch: Partial<TalkPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveTalkPrefs(next); // dispara TALK_PREFS_EVENT → usePushNotifications re-inscreve
  };

  // Login Flow compartilhado com o diálogo de reconexão: tem timeout e mostra o
  // erro do poll, em vez de girar de 2 em 2s para sempre em silêncio.
  const flow = useTalkLoginFlow((auth) => {
    setCurrentAuth(auth);
    setUrl('');
  });
  const flowState: FlowState =
    flow.phase === 'waiting' || flow.phase === 'starting'
      ? 'waiting'
      : flow.phase === 'error'
        ? 'error'
        : 'idle';
  const flowError = flow.error;

  const startFlow = () => flow.start(url);
  const cancelFlow = () => flow.cancel();

  // Autenticação manual por token (senha de app do Nextcloud). Útil quando o Login Flow
  // não funciona (proxy reverso, etc.) ou quando já se tem uma senha de app gerada.
  const saveManual = async () => {
    const base = url.trim().replace(/\/$/, '');
    const user = mUser.trim();
    const token = mToken.trim();
    if (!base || !user || !token) return;
    setError('');
    setSaving(true);
    try {
      // Valida e persiste o token no servidor (store cifrado). O token nunca
      // fica no cliente — o localStorage guarda só metadados (url + user).
      const res = await fetch('/api/talk/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: base, user, token }),
      });
      if (!res.ok) throw new Error('auth');
      const auth = { url: base, user };
      saveTalkAuth(auth);
      setCurrentAuth(auth);
      setUrl('');
      setMUser('');
      setMToken('');
      setShowToken(false);
      setMode('flow');
    } catch {
      setError('Credenciais inválidas. Confira a URL, o usuário e o token (senha de app).');
    } finally {
      setSaving(false);
    }
  };

  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showReconnect, setShowReconnect] = useState(false);
  const remove = () => {
    clearTalkAuth();
    setCurrentAuth(null);
  };

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
            Nextcloud Talk
          </span>
          {currentAuth && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300">
              Configurado
            </span>
          )}
        </div>
        <ChevronDown
          size={14}
          className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3 bg-white dark:bg-slate-900">
          {currentAuth ? (
            <>
              <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                  <Check size={12} />
                  <span className="font-mono">
                    {currentAuth.user}@{currentAuth.url.replace(/^https?:\/\//, '')}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {/* Sem isto, um token revogado virava beco sem saída: a seção
                      dizia "Configurado" e a única ação era Remover — que apaga o
                      vínculo (inclusive no servidor) antes de haver um novo. */}
                  <button
                    onClick={() => setShowReconnect(true)}
                    title="Autorizar novamente no Nextcloud (mantém o vínculo atual até dar certo)"
                    className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 transition-colors"
                  >
                    <RefreshCw size={11} /> Reconectar
                  </button>
                  <button
                    onClick={() => setConfirmRemove(true)}
                    className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 size={11} /> Remover
                  </button>
                </div>
                {confirmRemove && (
                  <ConfirmDialog
                    title="Desvincular Nextcloud Talk?"
                    message="O chat interno para de funcionar até reconectar. Conversas no servidor não são apagadas."
                    confirmLabel="Desvincular"
                    danger
                    onConfirm={remove}
                    onClose={() => setConfirmRemove(false)}
                  />
                )}
                {showReconnect && (
                  <TalkReconnectModal
                    onClose={() => {
                      setShowReconnect(false);
                      setCurrentAuth(getTalkAuth());
                    }}
                  />
                )}
              </div>

              <div className="space-y-2 pt-1">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Notificações
                </p>
                <label className="flex items-start justify-between gap-3 cursor-pointer">
                  <span className="text-xs text-slate-600 dark:text-slate-300">
                    Em grupos, só notificar quando me mencionarem
                    <span className="block text-[11px] text-slate-400 dark:text-slate-500">
                      DMs sempre notificam. Reduz o ruído de chats movimentados.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={prefs.groupMentionsOnly}
                    onChange={(e) => updatePref({ groupMentionsOnly: e.target.checked })}
                    className="mt-0.5 h-4 w-4 accent-blue-600 flex-shrink-0"
                  />
                </label>
                <label className="flex items-start justify-between gap-3 cursor-pointer">
                  <span className="text-xs text-slate-600 dark:text-slate-300">
                    Modo tempo real
                    <span className="block text-[11px] text-slate-400 dark:text-slate-500">
                      Notificação quase instantânea com a aba fechada (~3s). Usa mais rede/bateria.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={prefs.realtime}
                    onChange={(e) => updatePref({ realtime: e.target.checked })}
                    className="mt-0.5 h-4 w-4 accent-blue-600 flex-shrink-0"
                  />
                </label>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Vínculo com o Redmine
                </p>
                <RedmineMatchRefresh />
              </div>
            </>
          ) : flowState === 'waiting' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2.5">
                <Loader2 size={13} className="animate-spin text-blue-500 flex-shrink-0" />
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  Faça login na janela que abriu e volte aqui — detectaremos automaticamente.
                </p>
              </div>
              <button
                onClick={cancelFlow}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <>
              <div className="flex gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  onClick={() => {
                    setMode('flow');
                    setError('');
                  }}
                  className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${mode === 'flow' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                >
                  Login automático
                </button>
                <button
                  onClick={() => {
                    setMode('manual');
                    setError('');
                  }}
                  className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${mode === 'manual' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                >
                  Token (senha de app)
                </button>
              </div>

              {mode === 'flow' ? (
                <>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="url"
                        value={url}
                        onChange={(e) => {
                          setUrl(e.target.value);
                          setError('');
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && startFlow()}
                        placeholder="https://drive.suaempresa.com"
                        readOnly={ncLocked}
                        title={ncLocked ? LOCKED_HINT : undefined}
                        className={`w-full text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                          ncLocked
                            ? 'bg-slate-50 dark:bg-slate-900/60 pr-8 cursor-default'
                            : 'bg-white dark:bg-slate-800'
                        }`}
                      />
                      {ncLocked && (
                        <Lock
                          size={11}
                          aria-hidden
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                        />
                      )}
                    </div>
                    <button
                      onClick={startFlow}
                      disabled={!url.trim()}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-sm shadow-blue-500/20 hover:shadow-blue-500/40 disabled:opacity-40 text-white rounded-lg font-medium transition-all duration-200 whitespace-nowrap"
                    >
                      <LogIn size={11} /> Entrar
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    Você será redirecionado para a página de login do Nextcloud — inclusive com 2FA.
                  </p>
                </>
              ) : (
                <>
                  <div className="relative">
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        setError('');
                      }}
                      placeholder="https://drive.suaempresa.com"
                      readOnly={ncLocked}
                      title={ncLocked ? LOCKED_HINT : undefined}
                      className={`w-full text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                        ncLocked
                          ? 'bg-slate-50 dark:bg-slate-900/60 pr-8 cursor-default'
                          : 'bg-white dark:bg-slate-800'
                      }`}
                    />
                    {ncLocked && (
                      <Lock
                        size={11}
                        aria-hidden
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                      />
                    )}
                  </div>
                  <input
                    type="text"
                    value={mUser}
                    onChange={(e) => {
                      setMUser(e.target.value);
                      setError('');
                    }}
                    placeholder="usuário"
                    autoComplete="username"
                    className="w-full text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <div className="relative">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={mToken}
                      onChange={(e) => {
                        setMToken(e.target.value);
                        setError('');
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && saveManual()}
                      placeholder="token / senha de app"
                      autoComplete="off"
                      className="w-full text-xs border border-slate-200 dark:border-slate-600 rounded-lg pl-3 pr-9 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    >
                      {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  <button
                    onClick={saveManual}
                    disabled={saving || !url.trim() || !mUser.trim() || !mToken.trim()}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-sm shadow-blue-500/20 hover:shadow-blue-500/40 disabled:opacity-40 text-white rounded-lg font-medium transition-all duration-200"
                  >
                    {saving ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <KeyRound size={11} />
                    )}
                    {saving ? 'Validando…' : 'Salvar'}
                  </button>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    Gere uma senha de app no Nextcloud em{' '}
                    <span className="font-medium">
                      Configurações → Segurança → Dispositivos &amp; sessões
                    </span>
                    . Use seu usuário e a senha gerada.
                  </p>
                </>
              )}
              {(error || flowError) && (
                <p className="text-xs text-red-500 dark:text-red-400">{error || flowError}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Mostra quando o vínculo Redmine↔Talk (por nome) foi montado e deixa forçar uma
// reconstrução agora — sem esperar o cache de 24h do servidor nem recarregar a página
// (o refresh já atualiza o cache do React Query direto, então o efeito é imediato em
// qualquer lugar do app que use o vínculo: PeopleView, avatares, o botão de conversa etc).
function RedmineMatchRefresh() {
  const { data, isLoading } = useTalkRedmineMatch();
  const refresh = useRefreshTalkRedmineMatch();

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {isLoading
          ? 'Carregando…'
          : data?.updatedAt
            ? `Atualizado ${formatDistanceToNow(data.updatedAt, { addSuffix: true, locale: ptBR })}`
            : 'Ainda não carregado'}
        <span className="block text-[11px] text-slate-400 dark:text-slate-500">
          Cruza nomes do Redmine com contas do Talk pra mostrar foto e permitir mensagem direta.
        </span>
      </p>
      <button
        onClick={() => refresh.mutate()}
        disabled={refresh.isPending}
        className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50 flex-shrink-0"
      >
        <RefreshCw size={12} className={refresh.isPending ? 'animate-spin' : ''} />
        Atualizar agora
      </button>
    </div>
  );
}

// Seção genérica de credenciais corporativas (AD) — cobre E-mail e Wiki.
// Se logado com usuário/senha no Redmine: automático. Se por API key: formulário.
function ADCredsSection() {
  const auth = getStoredAuth();
  // Logado por usuário/senha → AD automático (o servidor injeta a senha da sessão).
  const isAuto = !!auth?.username;
  const [configured, setConfigured] = useState(() => adConfigured());
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!isAuto && !adConfigured());

  const save = async () => {
    if (!user.trim() || !password || busy) return;
    setBusy(true);
    try {
      await saveADCreds({ username: user.trim(), password });
      setConfigured(true);
      setUser('');
      setPassword('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setBusy(false);
    }
  };

  const [confirmRemove, setConfirmRemove] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await clearADCreds();
      setConfigured(false);
      setSaved(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`border rounded-xl overflow-hidden ${isAuto ? 'border-green-200 dark:border-green-800' : configured ? 'border-blue-200 dark:border-blue-800' : 'border-slate-200 dark:border-slate-700'}`}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Usuário e senha do AD
          </span>
          {isAuto && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300">
              Automático
            </span>
          )}
          {!isAuto && configured && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300">
              Configurado
            </span>
          )}
          {!isAuto && !configured && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
              Necessário
            </span>
          )}
        </div>
        <ChevronDown
          size={14}
          className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3 bg-white dark:bg-slate-900">
          {isAuto ? (
            <div className="flex items-start gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2.5 text-xs text-green-700 dark:text-green-300">
              <Check size={13} className="flex-shrink-0 mt-0.5" />
              <span>
                Logado como <strong>{auth?.username}</strong> com usuário e senha — E-mail e Wiki
                usam as mesmas credenciais automaticamente.
              </span>
            </div>
          ) : configured ? (
            <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                <Check size={12} />
                <span>Credenciais AD salvas no servidor</span>
              </div>
              <button
                onClick={() => setConfirmRemove(true)}
                disabled={busy}
                className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors"
              >
                <Trash2 size={11} /> Remover
              </button>
              {confirmRemove && (
                <ConfirmDialog
                  title="Remover credenciais do AD?"
                  message="E-mail e Wiki param de funcionar até novas credenciais serem configuradas."
                  confirmLabel="Remover"
                  danger
                  onConfirm={remove}
                  onClose={() => setConfirmRemove(false)}
                />
              )}
            </div>
          ) : (
            <>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Informe seu usuário e senha do AD (Windows). Usados por <strong>E-mail</strong> e{' '}
                <strong>Wiki</strong>. O usuário é sem @domínio (ex.:{' '}
                <span className="font-mono">joao.moura</span>).
              </p>
              <div className="space-y-2">
                <input
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                  placeholder="Usuário (ex.: joao.moura)"
                  autoComplete="off"
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <div className="relative">
                  <input
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && save()}
                    placeholder="Senha do AD"
                    autoComplete="new-password"
                    className="w-full text-xs px-3 py-2 pr-8 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {show ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>
              <button
                onClick={save}
                disabled={!user.trim() || !password || busy}
                className="flex items-center gap-1.5 px-3 py-2 text-xs bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-sm shadow-blue-500/20 hover:shadow-blue-500/40 disabled:opacity-40 text-white rounded-lg font-medium transition-all duration-200"
              >
                {saved ? (
                  <>
                    <Check size={11} /> Salvo!
                  </>
                ) : (
                  <>
                    <KeyRound size={11} /> Salvar
                  </>
                )}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Seção E-mail — mostra status e permite customizar host se necessário.
function MailSection() {
  const available = hasEffectiveCreds();
  // Com VITE_ZIMBRA_HOST definido no build, o host é fixo e o campo trava —
  // o valor salvo antes não pode sobrepor a configuração da organização.
  const { value: defaultZimbra, locked: zimbraLocked } = appDefaults.zimbraHost;
  const [host, setHost] = useState(() =>
    zimbraLocked ? defaultZimbra : getMailConfig().host || DEFAULT_HOST,
  );
  const [saved, setSaved] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [open, setOpen] = useState(false);

  const saveHost = () => {
    saveMailConfig({ host });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const test = async () => {
    setTestState('testing');
    setTestError('');
    try {
      await mailApi.ping();
      setTestState('ok');
    } catch (e) {
      setTestState('error');
      setTestError(errorDetail(e) || 'Falha na conexão');
    }
  };

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
            E-mail (Zimbra)
          </span>
          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${available ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300' : 'bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-400'}`}
          >
            {available ? 'Disponível' : 'Sem credenciais'}
          </span>
        </div>
        <ChevronDown
          size={14}
          className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3 bg-white dark:bg-slate-900">
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Servidor Zimbra. Deixe o padrão se não souber qual usar.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setSaved(false);
                }}
                onKeyDown={(e) => e.key === 'Enter' && saveHost()}
                placeholder={DEFAULT_HOST}
                readOnly={zimbraLocked}
                title={zimbraLocked ? LOCKED_HINT : undefined}
                className={`w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                  zimbraLocked
                    ? 'bg-slate-50 dark:bg-slate-900/60 pr-8 cursor-default'
                    : 'bg-white dark:bg-slate-800'
                }`}
              />
              {zimbraLocked && (
                <Lock
                  size={11}
                  aria-hidden
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                />
              )}
            </div>
            <button
              onClick={saveHost}
              className="flex items-center gap-1 px-3 py-2 text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg font-medium transition-colors"
            >
              {saved ? <Check size={11} /> : null} Salvar
            </button>
          </div>
          {available && (
            <div className="flex items-center gap-2">
              <button
                onClick={test}
                disabled={testState === 'testing'}
                className="flex items-center gap-1.5 px-3 py-2 text-xs bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-sm shadow-blue-500/20 hover:shadow-blue-500/40 disabled:opacity-40 text-white rounded-lg font-medium transition-all duration-200"
              >
                {testState === 'testing' ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Check size={11} />
                )}
                Testar conexão
              </button>
              {testState === 'ok' && (
                <span className="text-xs text-green-600 dark:text-green-400">Conectado!</span>
              )}
              {testState === 'error' && <span className="text-xs text-red-500">{testError}</span>}
            </div>
          )}

          <p className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 dark:text-slate-500">
            Assinatura, rodapé de imagem e modelos ficam na engrenagem da aba{' '}
            <strong className="font-medium text-slate-500 dark:text-slate-400">E-mail</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

// Seção Wiki — só mostra status (credenciais vêm da seção AD acima).
function WikiSection() {
  const available = hasEffectiveCreds();
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            Wiki (DokuWiki)
          </span>
          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${available ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300' : 'bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-400'}`}
          >
            {available ? 'Disponível' : 'Sem credenciais'}
          </span>
        </div>
        <ChevronDown
          size={14}
          className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-4 py-3 bg-white dark:bg-slate-900">
          {available ? (
            <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2.5">
              <Check size={13} />
              <span>{dokuwikiHost} acessível com as credenciais configuradas.</span>
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Configure o <strong>Usuário e senha do AD</strong> acima para habilitar o acesso à
              Wiki.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

type SettingsTab = 'corporativo' | 'chat' | 'ia';

const TABS: { id: SettingsTab; label: string; icon: typeof Shield }[] = [
  { id: 'corporativo', label: 'Corporativo', icon: Shield },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'ia', label: 'IA', icon: Sparkles },
];

export function SettingsModal({ onClose }: Props) {
  const active = getActiveAIProvider();
  const [tab, setTab] = useState<SettingsTab>('corporativo');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[85vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (fixo) */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Configurações
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Abas (fixas) */}
        <div className="px-5 pt-4 flex-shrink-0">
          <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
            {TABS.map((t) => {
              const Icon = t.icon;
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                    isActive
                      ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon size={13} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Corpo (rolável) */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {tab === 'corporativo' && (
            <>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Shield size={14} className="text-slate-500" />
                  <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                    Credenciais corporativas
                  </h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Usuário e senha do AD (Windows). Necessários para E-mail e Wiki quando o login no
                  Redmine é feito por chave de API.
                </p>
                <ADCredsSection />
              </div>

              <div className="border-t border-slate-100 dark:border-slate-800" />

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Mail size={14} className="text-blue-500" />
                  <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                    Serviços corporativos
                  </h3>
                </div>
                <MailSection />
                <WikiSection />
              </div>
            </>
          )}

          {tab === 'chat' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="text-blue-500" />
                <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                  Nextcloud Talk
                </h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Conecte ao Talk da sua empresa para chat integrado no canto inferior direito do app.
              </p>
              <NextcloudSection />
            </div>
          )}

          {tab === 'ia' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-purple-500" />
                <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                  Inteligência Artificial
                </h3>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Configure uma ou mais chaves. A ordem de preferência é <strong>Claude</strong> →{' '}
                <strong>ChatGPT</strong> → <strong>Gemini</strong>. As chaves ficam salvas com
                segurança no servidor (cifradas).
              </p>

              {active && (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                  Usando:{' '}
                  <strong className="text-slate-700 dark:text-slate-200">
                    {PROVIDER_NAMES[active]}
                  </strong>
                </div>
              )}

              {PROVIDERS.map((p) => (
                <ProviderSection key={p.id} config={p} active={active === p.id} />
              ))}

              <AIUsagePanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
