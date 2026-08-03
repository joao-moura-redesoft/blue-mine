import { useState } from 'react';
import {
  Eye,
  EyeOff,
  Gem,
  Loader2,
  AlertCircle,
  ExternalLink,
  KeyRound,
  User,
  Lock,
} from 'lucide-react';
import { saveAuth, RedmineAuth, takeLogoutReason } from '../api/redmine';
import axios from 'axios';
import { errorStatus, errorDetail, errorMessage, isNetworkError } from '../utils/httpError';
import { appDefaults, LOCKED_HINT } from '../utils/appDefaults';

interface Props {
  onSuccess: () => void;
}

type AuthMode = 'token' | 'userpass';

export function Login({ onSuccess }: Props) {
  // Preenchido pelo build quando a organização definiu VITE_REDMINE_URL; nesse
  // caso o campo fica travado (ninguém precisa — nem consegue — digitar errado).
  const { value: defaultUrl, locked: urlLocked } = appDefaults.redmineUrl;
  const [url, setUrl] = useState(defaultUrl || 'https://');
  const [mode, setMode] = useState<AuthMode>('token');
  const [apiKey, setApiKey] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lido uma única vez: explica por que a sessão caiu (ex.: senha de rede trocada).
  const [expiredReason, setExpiredReason] = useState<string | null>(() => takeLogoutReason());

  const validate = async () => {
    setLoading(true);
    setError(null);
    setExpiredReason(null); // já entendeu o aviso; a partir daqui vale o resultado da tentativa

    const cleanUrl = url.replace(/\/$/, '');

    try {
      const payload: Record<string, string> = { url: cleanUrl };

      if (mode === 'token') {
        payload.apiKey = apiKey.trim();
      } else {
        payload.username = username.trim();
        payload.password = password;
      }

      await axios.post('/api/auth/login', payload, { withCredentials: true });

      // Save only safe metadata to localStorage, never passwords/keys
      const safeAuth: Partial<RedmineAuth> = { url: cleanUrl };
      if (mode === 'userpass') safeAuth.username = username.trim();
      saveAuth(safeAuth as RedmineAuth);

      onSuccess();
    } catch (err) {
      const status = errorStatus(err);
      if (status === 401 || status === 403) {
        setError(
          mode === 'token'
            ? 'Chave de API inválida ou sem permissão. Verifique e tente novamente.'
            : 'Usuário ou senha inválidos. Verifique e tente novamente.',
        );
      } else if (status === 404 || isNetworkError(err)) {
        setError('URL do Redmine não encontrada. Verifique o endereço e tente novamente.');
      } else {
        setError(`Erro ao conectar: ${errorDetail(err) || errorMessage(err)}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const canSubmit =
    url.length > 10 &&
    !loading &&
    (mode === 'token'
      ? apiKey.trim().length > 10
      : username.trim().length > 0 && password.length > 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-blue-50 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl flex items-center justify-center shadow-lg mb-4">
            <Gem size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Bluemine</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Entre com suas credenciais do Redmine
          </p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-6 space-y-5">
          {/* URL */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
              URL do Redmine
            </label>
            <div className="relative">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://redmine.suaempresa.com"
                readOnly={urlLocked}
                title={urlLocked ? LOCKED_HINT : undefined}
                autoFocus={!urlLocked}
                className={`w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 ${
                  urlLocked
                    ? 'bg-slate-50 dark:bg-slate-900/60 pr-9 cursor-default'
                    : 'bg-white dark:bg-slate-800'
                }`}
                onKeyDown={(e) => e.key === 'Enter' && canSubmit && validate()}
              />
              {urlLocked && (
                <Lock
                  size={13}
                  aria-hidden
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                />
              )}
            </div>
          </div>

          {/* Toggle de modo */}
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-900/40">
            <button
              type="button"
              onClick={() => {
                setMode('token');
                setError(null);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-md transition-all ${
                mode === 'token'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200 dark:border-slate-700'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <KeyRound size={13} />
              Token API
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('userpass');
                setError(null);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-md transition-all ${
                mode === 'userpass'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200 dark:border-slate-700'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <User size={13} />
              Usuário e Senha
            </button>
          </div>

          {/* Campos por modo */}
          {mode === 'token' ? (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                Chave de API
              </label>
              <div className="relative">
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="••••••••••••••••••••••••••••••••••••••••"
                  className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                  onKeyDown={(e) => e.key === 'Enter' && canSubmit && validate()}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
                >
                  {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5 flex items-center gap-1">
                Encontre em
                <a
                  href={`${url.length > 10 ? url : 'https://redmine'}/my/account`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5"
                >
                  Minha conta → Chave de acesso API
                  <ExternalLink size={11} />
                </a>
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                  Usuário
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="seu.usuario"
                  autoComplete="username"
                  className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                  onKeyDown={(e) => e.key === 'Enter' && canSubmit && validate()}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                  Senha
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    autoComplete="current-password"
                    className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                    onKeyDown={(e) => e.key === 'Enter' && canSubmit && validate()}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
                  >
                    {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Sessão encerrada por credencial vencida */}
          {expiredReason && !error && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-300">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
              <span>{expiredReason}</span>
            </div>
          )}

          {/* Erro */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Botão */}
          <button
            onClick={validate}
            disabled={!canSubmit}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-sm shadow-blue-500/20 hover:shadow-blue-500/40 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all duration-200"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Verificando…
              </>
            ) : (
              'Entrar'
            )}
          </button>
        </div>

        <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-4">
          As credenciais ficam salvas apenas neste navegador.
        </p>
      </div>
    </div>
  );
}
