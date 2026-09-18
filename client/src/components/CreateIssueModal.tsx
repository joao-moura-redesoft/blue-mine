import { useState, useRef, useEffect } from 'react';
import {
  X,
  Plus,
  Paperclip,
  Image as ImageIcon,
  Loader2,
  AlertCircle,
  Sparkles,
  BookTemplate,
  Trash2,
  Save,
  Ban,
  FileText,
  Settings2,
} from 'lucide-react';
import {
  saveTemplate,
  deleteTemplate,
  useIssueTemplates,
  type IssueTemplate,
} from '../utils/issueTemplates';
import { useTemplates } from '../utils/templates';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateIssue,
  useProjects,
  useTrackers,
  usePriorities,
  useProjectMembers,
} from '../hooks/useRedmine';
import { redmineApi } from '../api/redmine';
import { markdownToTextile } from '../utils/markdownToTextile';
import { prepareMermaidForRedmine } from '../utils/mermaid';
import { getAIKey } from '../utils/aiConfig';
import { PersonSelect } from './PersonSelect';
import { ConfirmDialog } from './workflow/ConfirmDialog';
import {
  errorStatus,
  errorList,
  errorDetail,
  errorMessage,
  isNetworkError,
} from '../utils/httpError';

interface Props {
  onClose: () => void;
  defaultStatusId?: number;
  // Pré-preenchimento (ex.: criar tarefa a partir de um e-mail do Zimbra / captura rápida).
  initialSubject?: string;
  initialDescription?: string;
  initialPriorityId?: number;
  initialDueDate?: string;
  // Anexos já resolvidos (ex.: imagem de uma mensagem do Talk).
  initialFiles?: File[];
  // Chamado com o id da tarefa recém-criada — dá pra abrir o modal dela em seguida
  // (feedback visual de que a criação funcionou, em vez de só fechar sem mais nada).
  onCreated?: (id: number) => void;
  // Só pra exibição: a tarefa que esta aqui vai impedir (o vínculo em si — por
  // comentário nas duas — é feito por quem chama, depois do onCreated).
  blockingIssue?: { id: number; subject: string };
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const FORM_ID = 'create-issue-form';
const inputCls =
  'w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
const labelCls = 'block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1';

/**
 * Menu de templates do modal de nova tarefa. Junta as duas famílias que existiam
 * separadas (e por isso pareciam "não funcionar"): os modelos de tarefa
 * (`utils/issueTemplates`) e os textos prontos cadastrados em "Gerenciar
 * templates" (`utils/templates`), que antes nunca apareciam aqui.
 */
function TemplatesMenu({
  current,
  describe,
  onApply,
  onInsertText,
}: {
  current: {
    subject: string;
    description: string;
    trackerId: number | '';
    priorityId: number | '';
    projectId: number | '';
    assignedTo: number | '';
    projectName?: string;
    assignedToName?: string;
  };
  /** Resumo legível do modelo (projeto · responsável), pra listar no menu */
  describe: (t: IssueTemplate) => string;
  onApply: (t: IssueTemplate) => void;
  onInsertText: (body: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const issueTemplates = useIssueTemplates();
  const textTemplates = useTemplates();

  // Projeto/responsável sozinhos já valem um modelo — não exige texto.
  const hasContent = !!(
    current.subject.trim() ||
    current.description.trim() ||
    current.projectId ||
    current.assignedTo
  );

  const close = () => {
    setOpen(false);
    setNaming(false);
    setName('');
  };

  const save = () => {
    const n = name.trim();
    if (!n) return;
    saveTemplate({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: n,
      subject: current.subject,
      description: current.description,
      ...(current.trackerId ? { tracker_id: current.trackerId as number } : {}),
      ...(current.priorityId ? { priority_id: current.priorityId as number } : {}),
      ...(current.projectId
        ? { project_id: current.projectId as number, project_name: current.projectName }
        : {}),
      ...(current.assignedTo
        ? { assigned_to_id: current.assignedTo as number, assigned_to_name: current.assignedToName }
        : {}),
    });
    setNaming(false);
    setName('');
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        title="Modelos de tarefa e textos prontos"
        className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${
          open
            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
        }`}
      >
        <BookTemplate size={13} /> Templates
      </button>

      {open && (
        <>
          {/* clique fora fecha o menu */}
          <div className="fixed inset-0 z-20" onClick={close} />
          <div
            className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-30 flex flex-col overflow-hidden"
            style={{ maxHeight: 360 }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
          >
            <div className="overflow-y-auto scrollbar-thin">
              {/* Modelos de tarefa completos */}
              <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Modelos de tarefa
              </div>
              {issueTemplates.length === 0 && (
                <p className="px-3 pb-2 text-xs text-slate-400">
                  Nenhum ainda. Preencha os campos e salve abaixo.
                </p>
              )}
              {issueTemplates.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-1 px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 group"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onApply(t);
                      close();
                    }}
                    className="flex-1 min-w-0 text-left"
                  >
                    <span className="block text-xs text-slate-700 dark:text-slate-200 truncate">
                      {t.name}
                    </span>
                    {describe(t) && (
                      <span className="block text-[10px] text-slate-400 truncate">
                        {describe(t)}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteTemplate(t.id)}
                    title="Excluir modelo"
                    className="p-1 rounded text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 flex-shrink-0"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}

              {/* Textos prontos (compartilhados com o compositor de comentário) */}
              <div className="border-t border-slate-100 dark:border-slate-700 mt-1">
                <div className="flex items-center gap-1 px-3 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    Textos prontos
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('bluemine:manage-templates'));
                      close();
                    }}
                    title="Gerenciar textos prontos"
                    className="ml-auto text-slate-400 hover:text-blue-600 dark:hover:text-blue-400"
                  >
                    <Settings2 size={12} />
                  </button>
                </div>
                {textTemplates.length === 0 && (
                  <p className="px-3 pb-2 text-xs text-slate-400">
                    Nenhum texto pronto cadastrado.
                  </p>
                )}
                {textTemplates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      onInsertText(t.body);
                      close();
                    }}
                    title="Inserir na descrição"
                    className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                  >
                    <FileText size={11} className="text-slate-400 flex-shrink-0" />
                    <span className="truncate">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Salvar o que está preenchido como novo modelo */}
            <div className="border-t border-slate-100 dark:border-slate-700 px-2 py-2 flex-shrink-0">
              {naming ? (
                <div className="flex gap-1">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      // Sem isso o Enter borbulha e submete o <form>: era o motivo de
                      // "salvar template" criar a tarefa em vez de salvar o modelo.
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        save();
                      }
                    }}
                    placeholder="Nome do modelo…"
                    className="flex-1 min-w-0 text-xs border border-slate-200 dark:border-slate-700 dark:bg-slate-900 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <button
                    type="button"
                    onClick={save}
                    disabled={!name.trim()}
                    className="px-2 py-1 bg-blue-600 disabled:opacity-40 text-white text-[10px] rounded flex-shrink-0"
                  >
                    OK
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setNaming(true)}
                  disabled={!hasContent}
                  title={hasContent ? undefined : 'Preencha ao menos título, descrição ou projeto'}
                  className="w-full flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-40 disabled:hover:text-blue-600 py-0.5"
                >
                  <Save size={11} /> Salvar campos atuais como modelo
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function CreateIssueModal({
  onClose,
  initialSubject,
  initialDescription,
  initialPriorityId,
  initialDueDate,
  initialFiles,
  onCreated,
  blockingIssue,
}: Props) {
  const { data: projects } = useProjects();
  const { data: trackers } = useTrackers();
  const { data: priorities } = usePriorities();
  const createIssue = useCreateIssue();
  const qc = useQueryClient();

  const [subject, setSubject] = useState(initialSubject ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [projectId, setProjectId] = useState<number | ''>('');
  const [trackerId, setTrackerId] = useState<number | ''>('');
  const [priorityId, setPriorityId] = useState<number | ''>(initialPriorityId ?? '');
  const [dueDate, setDueDate] = useState(initialDueDate ?? '');
  const [assignedTo, setAssignedTo] = useState<number | ''>('');
  const [files, setFiles] = useState<File[]>(initialFiles ?? []);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [forceCreate, setForceCreate] = useState(false);
  const [intermediateProjectId, setIntermediateProjectId] = useState<number | ''>('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  const { data: members } = useProjectMembers(projectId || undefined);

  const busy = uploading || createIssue.isPending;
  const dirty = !!(
    subject.trim() ||
    description.trim() ||
    projectId ||
    trackerId ||
    priorityId ||
    dueDate ||
    assignedTo ||
    files.length
  );

  // Fechar descartando o que foi digitado exige confirmação — antes, um clique
  // fora do modal jogava fora a tarefa inteira sem aviso.
  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  const addFiles = (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (arr.length) setFiles((f) => [...f, ...arr]);
  };
  const removeFile = (i: number) => setFiles((f) => f.filter((_, idx) => idx !== i));

  const insertInDescription = (body: string) => {
    setDescription((d) => (d.trim() ? `${d.replace(/\s*$/, '')}\n\n${body}` : body));
    requestAnimationFrame(() => descRef.current?.focus());
  };

  const applyTemplate = (t: IssueTemplate) => {
    if (t.subject) setSubject(t.subject);
    if (t.description) setDescription(t.description);
    if (t.tracker_id) setTrackerId(t.tracker_id);
    if (t.priority_id) setPriorityId(t.priority_id);
    if (t.project_id) setProjectId(t.project_id);
    // Ao trocar de projeto no <select> o responsável é limpo de propósito; aqui não,
    // porque o modelo traz o par projeto+pessoa junto. Se a pessoa não for membro do
    // projeto, o efeito abaixo limpa quando a lista de membros chegar.
    if (t.assigned_to_id) setAssignedTo(t.assigned_to_id);
    setError(null);
  };

  // Responsável que não é membro do projeto selecionado seria recusado pelo Redmine
  // (422). Acontece ao aplicar um modelo antigo ou trocar o projeto do modelo.
  useEffect(() => {
    if (!members || !assignedTo) return;
    if (!members.some((m) => m.id === assignedTo)) setAssignedTo('');
  }, [members, assignedTo]);

  const projectName = projects?.find((p) => p.id === projectId)?.name;
  const assignedToName = members?.find((m) => m.id === assignedTo)?.name;

  // Linha de apoio de cada modelo no menu: projeto · responsável (ou o assunto).
  const describeTemplate = (t: IssueTemplate) =>
    [t.project_name, t.assigned_to_name].filter(Boolean).join(' · ') || t.subject;

  const buildPayload = async (targetProjectId: number) => {
    // Diagramas Mermaid da descrição viram PNG anexado + referência à imagem,
    // para aparecerem também para quem abre a tarefa fora do Bluemine.
    const mmd = await prepareMermaidForRedmine(description.trim());
    const uploads = [];
    for (const f of [...files, ...mmd.files]) {
      try {
        uploads.push(await redmineApi.uploadFile(f));
      } catch {
        throw new Error(`Falha ao enviar o arquivo "${f.name}". Verifique o tamanho (máx 50 MB).`);
      }
    }
    return {
      subject: subject.trim(),
      project_id: targetProjectId,
      ...(trackerId ? { tracker_id: trackerId as number } : {}),
      ...(priorityId ? { priority_id: priorityId as number } : {}),
      ...(assignedTo ? { assigned_to_id: assignedTo as number } : {}),
      ...(mmd.text.trim() ? { description: markdownToTextile(mmd.text) } : {}),
      ...(dueDate ? { due_date: dueDate } : {}),
      ...(uploads.length ? { uploads } : {}),
    };
  };

  const handleAISuggest = async () => {
    if (!subject.trim() || aiSuggesting) return;
    setAiSuggesting(true);
    setAiReasoning(null);
    try {
      const suggestion = await redmineApi.suggestFields(
        subject,
        description,
        trackers?.map((t) => ({ id: t.id, name: t.name })) ?? [],
        priorities?.map((p) => ({ id: p.id, name: p.name })) ?? [],
      );
      if (suggestion.tracker_id) setTrackerId(suggestion.tracker_id);
      if (suggestion.priority_id) setPriorityId(suggestion.priority_id);
      if (suggestion.reasoning) setAiReasoning(suggestion.reasoning);
    } catch {
      setAiReasoning('Não foi possível sugerir campos. Tente novamente.');
    } finally {
      setAiSuggesting(false);
    }
  };

  const handleApiError = (err: unknown) => {
    const status = errorStatus(err);
    const redmineErrors = errorList(err);
    if (redmineErrors) return setError(redmineErrors.join('\n'));
    if (status === 403) {
      setError('Sem permissão para criar tarefas neste projeto.');
      setForceCreate(true);
      return;
    }
    if (status === 422)
      return setError('O Redmine rejeitou a tarefa. Verifique os campos obrigatórios do projeto.');
    if (status === 404) return setError('Projeto não encontrado. Tente recarregar a página.');
    if (!navigator.onLine || isNetworkError(err)) return setError('Sem conexão com o servidor.');
    setError(errorDetail(err) ?? errorMessage(err) ?? 'Erro desconhecido ao criar a tarefa.');
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!subject.trim() || !projectId || busy) return;
    setError(null);
    setForceCreate(false);
    setUploading(true);
    try {
      const created = await createIssue.mutateAsync(await buildPayload(projectId as number));
      onClose();
      onCreated?.(created.id);
    } catch (err) {
      handleApiError(err);
    } finally {
      setUploading(false);
    }
  };

  const handleForceCreate = async () => {
    if (!intermediateProjectId || !projectId) return;
    setError(null);
    setForceCreate(false);
    setUploading(true);
    try {
      // Chama a API diretamente para não invalidar o cache entre as duas operações
      const created = await redmineApi.createIssue(
        await buildPayload(intermediateProjectId as number),
      );
      await redmineApi.updateIssue(created.id, { project_id: projectId });
      // Invalida só depois que a tarefa já está no projeto certo
      await qc.invalidateQueries({ queryKey: ['issues'] });
      onClose();
      onCreated?.(created.id);
    } catch (err) {
      handleApiError(err);
    } finally {
      setUploading(false);
    }
  };

  // Esc fecha (com guarda de descarte) e Ctrl/Cmd+Enter cria — os popovers internos
  // dão stopPropagation no Esc para fechar só a si mesmos.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmDiscard) {
        e.preventDefault();
        requestClose();
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void handleSubmit();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop"
        onClick={requestClose}
      >
        <div
          className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Cabeçalho */}
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Nova Tarefa
            </h2>
            <div className="ml-auto flex items-center gap-1">
              <TemplatesMenu
                current={{
                  subject,
                  description,
                  trackerId,
                  priorityId,
                  projectId,
                  assignedTo,
                  projectName,
                  assignedToName,
                }}
                describe={describeTemplate}
                onApply={applyTemplate}
                onInsertText={insertInDescription}
              />
              <button
                type="button"
                onClick={requestClose}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X size={18} className="text-slate-500 dark:text-slate-400" />
              </button>
            </div>
          </div>

          {/* Corpo rolável — antes o modal não rolava e o botão Criar sumia da tela
            quando havia anexos ou o painel de permissão. */}
          <form
            id={FORM_ID}
            onSubmit={handleSubmit}
            className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-4"
          >
            {blockingIssue && (
              <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2.5 text-sm text-red-700 dark:text-red-300">
                <Ban size={15} className="mt-0.5 flex-shrink-0" />
                <p>
                  Vai impedir a tarefa{' '}
                  <span className="font-semibold">
                    #{blockingIssue.id} {blockingIssue.subject}
                  </span>
                  . Ao criar, um comentário linkando as duas é postado automaticamente.
                </p>
              </div>
            )}

            {/* Projeto vem primeiro: define quem pode ser atribuído */}
            <div>
              <label className={labelCls}>Projeto *</label>
              <select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value ? Number(e.target.value) : '');
                  setAssignedTo('');
                  setError(null);
                }}
                required
                className={inputCls}
              >
                <option value="">Selecionar...</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                  Título *
                </label>
                {getAIKey() && (
                  <button
                    type="button"
                    onClick={handleAISuggest}
                    disabled={!subject.trim() || aiSuggesting}
                    title="Sugerir tracker e prioridade com IA"
                    className="flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 disabled:opacity-40 transition-colors"
                  >
                    {aiSuggesting ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Sparkles size={11} />
                    )}
                    {aiSuggesting ? 'Sugerindo…' : 'Sugerir com IA'}
                  </button>
                )}
              </div>
              <input
                type="text"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setError(null);
                  setAiReasoning(null);
                }}
                placeholder="Descreva brevemente a tarefa..."
                required
                autoFocus
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Tracker</label>
                <select
                  value={trackerId}
                  onChange={(e) => setTrackerId(e.target.value ? Number(e.target.value) : '')}
                  className={inputCls}
                >
                  <option value="">Padrão</option>
                  {trackers?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>Prioridade</label>
                <select
                  value={priorityId}
                  onChange={(e) => setPriorityId(e.target.value ? Number(e.target.value) : '')}
                  className={inputCls}
                >
                  <option value="">Padrão</option>
                  {priorities?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {aiReasoning && (
              <div className="flex items-start gap-2 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg px-3 py-2 text-xs text-purple-700 dark:text-purple-300">
                <Sparkles size={12} className="mt-0.5 flex-shrink-0" />
                <span>{aiReasoning}</span>
                <button
                  type="button"
                  onClick={() => setAiReasoning(null)}
                  className="ml-auto text-purple-400 dark:text-purple-500 hover:text-purple-600 dark:hover:text-purple-400 flex-shrink-0"
                >
                  <X size={12} />
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Atribuído para</label>
                <PersonSelect
                  value={assignedTo}
                  onChange={setAssignedTo}
                  people={members}
                  disabled={!projectId}
                  placeholder={projectId ? 'Ninguém' : 'Escolha o projeto'}
                />
              </div>

              <div>
                <label className={labelCls}>Prazo</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                  Descrição
                </label>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  <Paperclip size={13} /> Anexar
                </button>
              </div>
              <textarea
                ref={descRef}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
                }}
                onPaste={(e) => {
                  const imgs = Array.from(e.clipboardData.items)
                    .filter((i) => i.type.startsWith('image/'))
                    .map((i) => i.getAsFile())
                    .filter((f): f is File => !!f);
                  if (imgs.length) {
                    e.preventDefault();
                    addFiles(imgs);
                  }
                }}
                placeholder="Detalhes opcionais… (arraste ou cole imagens para anexar)"
                rows={4}
                className={`${inputCls} resize-none`}
              />
              {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {files.map((f, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md pl-2 pr-1 py-1"
                    >
                      {f.type.startsWith('image/') ? (
                        <ImageIcon size={12} />
                      ) : (
                        <Paperclip size={12} />
                      )}
                      <span className="max-w-40 truncate">{f.name}</span>
                      <span className="text-slate-400">{fmtSize(f.size)}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 ml-0.5"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>

            {error && !forceCreate && (
              <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2.5 text-sm text-red-700 dark:text-red-300">
                <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                <p className="whitespace-pre-line">{error}</p>
              </div>
            )}

            {forceCreate && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-2.5">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                  <AlertCircle size={13} />
                  Sem permissão direta neste projeto.
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Selecione um projeto intermediário onde você tem permissão de criação. A tarefa
                  será criada lá e movida automaticamente para o projeto desejado.
                </p>
                <select
                  value={intermediateProjectId}
                  onChange={(e) =>
                    setIntermediateProjectId(e.target.value ? Number(e.target.value) : '')
                  }
                  className="w-full text-sm border border-amber-300 dark:border-amber-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="">Selecionar projeto intermediário…</option>
                  {projects
                    ?.filter((p) => p.id !== projectId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setForceCreate(false);
                      setError(null);
                    }}
                    className="flex-1 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-lg transition-colors border border-amber-200 dark:border-amber-700"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleForceCreate}
                    disabled={!intermediateProjectId || busy}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    {busy ? (
                      <>
                        <Loader2 size={12} className="animate-spin" /> Criando…
                      </>
                    ) : (
                      'Criar e mover automaticamente'
                    )}
                  </button>
                </div>
              </div>
            )}
          </form>

          {/* Rodapé fixo — sempre visível, não rola junto */}
          <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
            <span className="text-[11px] text-slate-400 dark:text-slate-500 hidden sm:inline">
              Ctrl+Enter para criar
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={requestClose}
                className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                form={FORM_ID}
                disabled={busy || !subject.trim() || !projectId}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 disabled:opacity-50 disabled:shadow-none disabled:hover:scale-100 text-white text-sm font-semibold rounded-lg transition-all duration-200 hover:scale-[1.02] active:scale-95"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                {uploading && files.length > 0
                  ? 'Enviando anexos…'
                  : busy
                    ? 'Criando…'
                    : 'Criar Tarefa'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title="Descartar tarefa?"
          message="Os campos preenchidos serão perdidos."
          confirmLabel="Descartar"
          cancelLabel="Continuar editando"
          danger
          onConfirm={onClose}
          onClose={() => setConfirmDiscard(false)}
        />
      )}
    </>
  );
}
