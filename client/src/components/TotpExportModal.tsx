import { useEffect, useRef, useState } from 'react';
import { X, Copy, Check, ShieldAlert, Loader2, Eye, EyeOff } from 'lucide-react';
import QRCode from 'qrcode';
import { exportTotp, type TotpEntry, type TotpExport } from '../api/totp';

// Exporta uma conta TOTP para outro dispositivo: QR code otpauth:// (lido por
// Google Authenticator, Authy, Microsoft Authenticator, 1Password, Bitwarden…)
// e, como reserva, o segredo em texto para digitação manual.
export function TotpExportModal({ account, onClose }: { account: TotpEntry; onClose: () => void }) {
  const [data, setData] = useState<TotpExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState<'secret' | 'uri' | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    exportTotp(account.id)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError('Não foi possível carregar os dados desta conta.'));
    return () => {
      alive = false;
    };
  }, [account.id]);

  // Desenha o QR só depois que o canvas existe no DOM.
  useEffect(() => {
    if (!data || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, data.uri, {
      width: 200,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    }).catch(() => setError('Não foi possível gerar o QR code.'));
  }, [data]);

  const copy = async (value: string, what: 'secret' | 'uri') => {
    await navigator.clipboard.writeText(value);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              Exportar "{account.name}"
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Escaneie no app autenticador do outro dispositivo.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 mb-4">
          <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            Quem tiver este código gera os mesmos tokens que você. Não compartilhe nem deixe a tela
            exposta.
          </span>
        </div>

        {error ? (
          <p className="text-sm text-red-600 text-center py-8">{error}</p>
        ) : !data ? (
          <div className="flex justify-center py-12 text-slate-400">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex justify-center mb-4">
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <canvas ref={canvasRef} />
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Segredo (para digitar manualmente)
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 break-all">
                    {showSecret ? data.secret : '•'.repeat(Math.min(data.secret.length, 32))}
                  </code>
                  <button
                    onClick={() => setShowSecret((v) => !v)}
                    title={showSecret ? 'Ocultar' : 'Mostrar'}
                    className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <button
                    onClick={() => copy(data.secret, 'secret')}
                    title="Copiar segredo"
                    className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                  >
                    {copied === 'secret' ? (
                      <Check size={15} className="text-green-500" />
                    ) : (
                      <Copy size={15} />
                    )}
                  </button>
                </div>
              </div>

              <button
                onClick={() => copy(data.uri, 'uri')}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                {copied === 'uri' ? (
                  <>
                    <Check size={14} className="text-green-500" />
                    Link copiado
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    Copiar link otpauth://
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
