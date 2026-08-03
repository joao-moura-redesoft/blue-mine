import { useRef, useState } from 'react';
import { X, Check, Plus, Pencil, Trash2 } from 'lucide-react';
import {
  getSignature,
  saveSignature,
  getFooterImage,
  saveFooterImage,
  getTemplates,
  saveTemplates,
  type MailTemplate,
  type MailFooterImage,
} from '../utils/mailConfig';
import { MailComposeEditor } from './MailComposeEditor';

// O banner é guardado em base64 no localStorage (cota ~5 MB, e base64 infla
// ~33%), então limitamos o arquivo. Um rodapé de assinatura raramente passa de
// algumas dezenas de KB — acima disso quase sempre é imagem não otimizada.
const FOOTER_MAX_BYTES = 512 * 1024;

/**
 * Preferências de escrita do e-mail — assinatura, rodapé de imagem e modelos.
 * Fica aqui, atrás da engrenagem da tela de E-mail, e não nas Configurações do
 * sistema: é preferência de conteúdo, não configuração de integração (o host do
 * Zimbra e o teste de conexão continuam lá).
 *
 * Tudo é por-usuário no localStorage, gravado na hora (sem "salvar tudo").
 */
export function MailSettingsModal({ onClose }: { onClose: () => void }) {
  const [signature, setSignature] = useState(() => getSignature());
  const [sigReset, setSigReset] = useState(0);
  const [sigSaved, setSigSaved] = useState(false);
  const [templates, setTemplates] = useState<MailTemplate[]>(() => getTemplates());
  const [editing, setEditing] = useState<MailTemplate | null>(null);
  const [footer, setFooter] = useState<MailFooterImage | null>(() => getFooterImage());
  const [footerError, setFooterError] = useState('');
  const footerRef = useRef<HTMLInputElement>(null);

  const persistSignature = () => {
    saveSignature(signature);
    setSigSaved(true);
    setTimeout(() => setSigSaved(false), 2000);
  };

  const persistFooter = (next: MailFooterImage | null) => {
    setFooter(next);
    saveFooterImage(next);
  };

  const onFooterFile = (file: File | undefined) => {
    if (!file) return;
    setFooterError('');
    if (!file.type.startsWith('image/')) {
      setFooterError('Escolha um arquivo de imagem.');
      return;
    }
    if (file.size > FOOTER_MAX_BYTES) {
      setFooterError(
        `Imagem muito grande (${Math.round(file.size / 1024)} KB). O limite é ${FOOTER_MAX_BYTES / 1024} KB — reduza a largura ou exporte comprimida.`,
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      persistFooter({
        dataUrl: String(reader.result || ''),
        filename: file.name,
        contentType: file.type,
        width: footer?.width,
      });
    reader.onerror = () => setFooterError('Não foi possível ler o arquivo.');
    reader.readAsDataURL(file);
    if (footerRef.current) footerRef.current.value = '';
  };

  const persistTemplates = (list: MailTemplate[]) => {
    setTemplates(list);
    saveTemplates(list);
  };

  const newTemplate = () =>
    setEditing({ id: `t_${Date.now()}`, name: '', subject: '', bodyHtml: '' });

  const saveTemplate = () => {
    if (!editing) return;
    const name = editing.name.trim() || 'Sem nome';
    const t = { ...editing, name };
    const exists = templates.some((x) => x.id === t.id);
    persistTemplates(exists ? templates.map((x) => (x.id === t.id ? t : x)) : [...templates, t]);
    setEditing(null);
  };

  const removeTemplate = (id: string) => persistTemplates(templates.filter((x) => x.id !== id));

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 modal-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Preferências de e-mail
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-5">
          {/* Assinatura */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Assinatura</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Aplicada automaticamente ao escrever uma nova mensagem.
            </p>
            <MailComposeEditor
              value={signature}
              onChange={setSignature}
              resetSignal={sigReset}
              minHeight={120}
              placeholder="Sua assinatura (nome, cargo, contato, logo…)"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={persistSignature}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg font-medium transition-colors"
              >
                {sigSaved ? <Check size={11} /> : null} Salvar assinatura
              </button>
              {signature && (
                <button
                  onClick={() => {
                    setSignature('');
                    setSigReset((n) => n + 1);
                    saveSignature('');
                  }}
                  className="text-xs text-slate-400 hover:text-red-500"
                >
                  Limpar
                </button>
              )}
            </div>
          </div>

          {/* Rodapé de imagem */}
          <div className="space-y-2 pt-4 border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Rodapé de imagem
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Banner/logo aplicado abaixo da assinatura em toda mensagem nova. Vai embutido no
              e-mail (anexo inline), então aparece sem o destinatário liberar imagens externas.
            </p>

            <input
              ref={footerRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onFooterFile(e.target.files?.[0])}
            />

            {footer ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
                  <img
                    src={footer.dataUrl}
                    alt=""
                    {...(footer.width ? { width: footer.width } : {})}
                    className="max-w-full"
                  />
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Largura
                  <input
                    type="number"
                    min={40}
                    max={1200}
                    placeholder="auto"
                    value={footer.width ?? ''}
                    onChange={(e) =>
                      persistFooter({
                        ...footer,
                        width: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                    className="w-20 px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                  px
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => footerRef.current?.click()}
                    className="px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg font-medium transition-colors"
                  >
                    Trocar imagem
                  </button>
                  <button
                    onClick={() => persistFooter(null)}
                    className="text-xs text-slate-400 hover:text-red-500"
                  >
                    Remover
                  </button>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                    {footer.filename}
                  </span>
                </div>
              </div>
            ) : (
              <button
                onClick={() => footerRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-3 py-4 text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                <Plus size={13} /> Escolher imagem do rodapé
              </button>
            )}

            {footerError && <p className="text-[11px] text-red-500">{footerError}</p>}
          </div>

          {/* Modelos */}
          <div className="space-y-2 pt-4 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Modelos</p>
              <button
                onClick={newTemplate}
                className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
              >
                <Plus size={12} /> Novo modelo
              </button>
            </div>
            {templates.length === 0 && !editing && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Nenhum modelo. Crie modelos reutilizáveis para o compositor.
              </p>
            )}
            {templates.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                <span className="text-xs text-slate-700 dark:text-slate-200 truncate">
                  {t.name}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditing(t)}
                    className="p-1 text-slate-400 hover:text-blue-500"
                    title="Editar"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => removeTemplate(t.id)}
                    className="p-1 text-slate-400 hover:text-red-500"
                    title="Remover"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}

            {editing && (
              <div className="space-y-2 p-3 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-900/10">
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Nome do modelo"
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <input
                  value={editing.subject || ''}
                  onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                  placeholder="Assunto (opcional)"
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <MailComposeEditor
                  value={editing.bodyHtml}
                  onChange={(html) => setEditing((cur) => (cur ? { ...cur, bodyHtml: html } : cur))}
                  minHeight={120}
                  placeholder="Corpo do modelo…"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={saveTemplate}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-sm shadow-blue-500/20 hover:shadow-blue-500/40 text-white rounded-lg font-medium transition-all duration-200"
                  >
                    <Check size={11} /> Salvar modelo
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
