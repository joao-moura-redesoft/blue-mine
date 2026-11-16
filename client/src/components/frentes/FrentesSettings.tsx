import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  Archive,
  ArchiveRestore,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import {
  FIELD_LABELS,
  type Frente,
  type FrenteRule,
  type FrentesConfig,
  type FrentesDraft,
  type RuleField,
  type RuleOp,
} from '../../api/frentes';
import {
  useFrentes,
  useFrenteOptions,
  useLoadedIssues,
  useSaveFrentes,
  useResetFrentes,
} from '../../hooks/useFrentes';
import { useStatuses } from '../../hooks/useRedmine';
import { makeIsClosedIssue } from '../../utils/closedIssue';
import { ConfirmButton } from '../sprints/ConfirmButton';
import { describeRule } from './describeRule';

const PALETTE = ['#3b82f6', '#f97316', '#14b8a6', '#e11d48', '#8b5cf6', '#eab308', '#22c55e'];

const toDraft = (c: FrentesConfig): FrentesDraft => ({
  frentes: c.frentes,
  rules: c.rules,
  fallback: c.fallback,
});

const uid = (p: string) =>
  `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const inputCls =
  'text-xs px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 min-w-0';
const iconBtn =
  'p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-400 flex-shrink-0';

const isListField = (f: RuleField) => f === 'area' || f === 'natureza';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* Editor das frentes e das regras que classificam as tarefas. Trabalha num
   rascunho e só grava no "Salvar": cada gravação reclassifica todas as tarefas
   (rebusca as listas), então não faz sentido salvar a cada tecla. */
export function FrentesSettings() {
  const { data: cfg, isLoading } = useFrentes();
  const issues = useLoadedIssues();
  const { data: statuses } = useStatuses();
  const save = useSaveFrentes();
  const reset = useResetFrentes();
  const [draft, setDraft] = useState<FrentesDraft | null>(null);

  // Primeira carga: o rascunho parte do que o servidor tem. Depois disso só
  // muda por edição, por Salvar/Descartar ou por Restaurar padrão.
  useEffect(() => {
    if (cfg && !draft) setDraft(toDraft(cfg));
  }, [cfg, draft]);

  const dirty = useMemo(
    () => !!cfg && !!draft && JSON.stringify(draft) !== JSON.stringify(toDraft(cfg)),
    [cfg, draft],
  );

  // Quantas tarefas abertas cada regra/frente classificou hoje (nas listas já carregadas).
  const hits = useMemo(() => {
    const byRule = new Map<string, number>();
    const byFrente = new Map<string, number>();
    let open = 0;
    let none = 0;
    const isClosed = makeIsClosedIssue(statuses);
    for (const i of issues) {
      if (isClosed(i)) continue;
      open++;
      if (!i.frente) none++;
      else {
        byFrente.set(i.frente.id, (byFrente.get(i.frente.id) ?? 0) + 1);
        if (i.frente.ruleId) byRule.set(i.frente.ruleId, (byRule.get(i.frente.ruleId) ?? 0) + 1);
      }
    }
    return { byRule, byFrente, open, none };
  }, [issues, statuses]);

  if (isLoading || !draft || !cfg) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Loader2 size={13} className="animate-spin" /> Carregando frentes…
      </div>
    );
  }

  const patch = (p: Partial<FrentesDraft>) => setDraft({ ...draft, ...p });

  const setFrente = (id: string, p: Partial<Frente>) =>
    patch({ frentes: draft.frentes.map((f) => (f.id === id ? { ...f, ...p } : f)) });
  const addFrente = () => {
    const color = PALETTE[draft.frentes.length % PALETTE.length];
    patch({ frentes: [...draft.frentes, { id: uid('f'), name: 'Nova frente', color }] });
  };
  const moveFrente = (id: string, dir: -1 | 1) => {
    const i = draft.frentes.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= draft.frentes.length) return;
    const frentes = [...draft.frentes];
    [frentes[i], frentes[j]] = [frentes[j], frentes[i]];
    patch({ frentes });
  };
  const removeFrente = (id: string) =>
    patch({
      frentes: draft.frentes.filter((f) => f.id !== id),
      rules: draft.rules.filter((r) => r.frente !== id),
      fallback: draft.fallback === id ? null : draft.fallback,
    });

  const setRule = (id: string, p: Partial<FrenteRule>) =>
    patch({ rules: draft.rules.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const moveRule = (id: string, dir: -1 | 1) => {
    const i = draft.rules.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= draft.rules.length) return;
    const rules = [...draft.rules];
    [rules[i], rules[j]] = [rules[j], rules[i]];
    patch({ rules });
  };

  const activeFrentes = draft.frentes.filter((f) => !f.archived);
  // O servidor descarta frente sem nome (e as regras dela) em silêncio — melhor
  // travar o Salvar aqui do que sumir com coisa.
  const emptyNames = draft.frentes.filter((f) => !f.name.trim());
  const emptyRules = draft.rules.filter((r) => !r.value.trim());
  const invalid = emptyNames.length > 0 || emptyRules.length > 0;

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        Frente é <strong>o que a tarefa é</strong> (CRM, Consync, iFood…), não onde foi aberta. A
        primeira regra ligada que casar define a frente; uma escolha sua numa tarefa sempre vence.{' '}
        {hits.open > 0 && (
          <>
            Hoje: <strong>{hits.open - hits.none}</strong> de {hits.open} abertas classificadas
            {hits.none > 0 && (
              <>
                , <strong className="text-amber-600 dark:text-amber-400">{hits.none}</strong> sem
                frente
              </>
            )}
            .
          </>
        )}
      </p>

      {/* ── Frentes ── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
            Frentes
          </h4>
          <button
            onClick={addFrente}
            className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            <Plus size={12} /> Nova frente
          </button>
        </div>
        <div className="space-y-1.5">
          {draft.frentes.map((f, i) => (
            <div
              key={f.id}
              className={`flex items-center gap-1.5 ${f.archived ? 'opacity-50' : ''}`}
            >
              <input
                type="color"
                value={f.color}
                onChange={(e) => setFrente(f.id, { color: e.target.value })}
                aria-label={`Cor de ${f.name || 'frente'}`}
                className="w-7 h-7 rounded cursor-pointer border border-slate-200 dark:border-slate-600 bg-transparent p-0.5 flex-shrink-0"
              />
              <input
                value={f.name}
                maxLength={60}
                onChange={(e) => setFrente(f.id, { name: e.target.value })}
                aria-label="Nome da frente"
                aria-invalid={!f.name.trim()}
                placeholder="Nome da frente"
                className={`${inputCls} flex-1 ${!f.name.trim() ? 'border-red-400 dark:border-red-500' : ''}`}
              />
              <span className="text-[11px] text-slate-400 w-16 text-right flex-shrink-0 tabular-nums">
                {plural(hits.byFrente.get(f.id) ?? 0, 'aberta', 'abertas')}
              </span>
              <button
                onClick={() => moveFrente(f.id, -1)}
                disabled={i === 0}
                aria-label="Subir frente"
                title="Subir (muda a ordem das raias e dos atalhos 1–9)"
                className={iconBtn}
              >
                <ArrowUp size={13} />
              </button>
              <button
                onClick={() => moveFrente(f.id, 1)}
                disabled={i === draft.frentes.length - 1}
                aria-label="Descer frente"
                title="Descer (muda a ordem das raias e dos atalhos 1–9)"
                className={iconBtn}
              >
                <ArrowDown size={13} />
              </button>
              <button
                onClick={() => setFrente(f.id, { hidden: !f.hidden })}
                title={
                  f.hidden
                    ? 'Oculta do quadro (aparece ao filtrar por ela). Clique para mostrar.'
                    : 'Visível no quadro. Clique para ocultar por padrão.'
                }
                aria-label={f.hidden ? 'Mostrar no quadro' : 'Ocultar do quadro'}
                className={`${iconBtn} ${f.hidden ? '!text-amber-500' : ''}`}
              >
                {f.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                onClick={() => setFrente(f.id, { archived: !f.archived })}
                title={f.archived ? 'Desarquivar' : 'Arquivar (frente terminada)'}
                aria-label={f.archived ? 'Desarquivar frente' : 'Arquivar frente'}
                className={iconBtn}
              >
                {f.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              </button>
              <ConfirmButton
                onConfirm={() => removeFrente(f.id)}
                icon={<Trash2 size={14} />}
                title="Excluir frente e as regras dela"
                confirmLabel="Excluir"
              />
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          A ordem daqui é a das raias no quadro e dos atalhos 1–9 da fila. Olho riscado: a frente
          some do quadro até você filtrar por ela (bom para pedidos à infra). Arquivar tira a frente
          da classificação sem apagar as regras.
        </p>
      </section>

      {/* ── Regras ── */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
          Regras{' '}
          <span className="font-normal normal-case text-slate-400">(valem de cima para baixo)</span>
        </h4>
        {draft.rules.length === 0 && (
          <p className="text-xs text-slate-400">Nenhuma regra. Adicione uma abaixo.</p>
        )}
        <div className="space-y-1.5">
          {draft.rules.map((r, i) => (
            <div
              key={r.id}
              className={`flex items-center gap-2 p-2 rounded-lg border bg-slate-50/60 dark:bg-slate-800/40 ${
                r.value.trim()
                  ? 'border-slate-200 dark:border-slate-700'
                  : 'border-red-300 dark:border-red-700'
              } ${r.on ? '' : 'opacity-50'}`}
            >
              <input
                type="checkbox"
                checked={r.on}
                onChange={(e) => setRule(r.id, { on: e.target.checked })}
                aria-label="Regra ligada"
                className="accent-blue-600 flex-shrink-0"
              />
              {isListField(r.field) ? (
                <span className="flex-1 min-w-0 text-xs text-slate-700 dark:text-slate-200 break-words">
                  {describeRule(r)}
                </span>
              ) : (
                <span className="flex-1 min-w-0 flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200">
                  <span className="flex-shrink-0">
                    {FIELD_LABELS[r.field]} {r.op === 'eq' ? 'é' : 'contém'}
                  </span>
                  <input
                    value={r.value}
                    maxLength={200}
                    onChange={(e) => setRule(r.id, { value: e.target.value })}
                    aria-label="Valor da regra"
                    aria-invalid={!r.value.trim()}
                    className={`${inputCls} flex-1`}
                  />
                </span>
              )}
              <span className="text-slate-300 dark:text-slate-600 text-xs">→</span>
              <select
                value={r.frente}
                onChange={(e) => setRule(r.id, { frente: e.target.value })}
                aria-label="Frente da regra"
                className={`${inputCls} max-w-[9rem]`}
              >
                {draft.frentes.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name || '(sem nome)'}
                  </option>
                ))}
              </select>
              <span
                className="text-[11px] text-slate-400 w-16 text-right flex-shrink-0 tabular-nums"
                title="Tarefas abertas que esta regra classificou"
              >
                {plural(hits.byRule.get(r.id) ?? 0, 'aberta', 'abertas')}
              </span>
              <button
                onClick={() => moveRule(r.id, -1)}
                disabled={i === 0}
                aria-label="Subir regra"
                className={iconBtn}
              >
                <ArrowUp size={13} />
              </button>
              <button
                onClick={() => moveRule(r.id, 1)}
                disabled={i === draft.rules.length - 1}
                aria-label="Descer regra"
                className={iconBtn}
              >
                <ArrowDown size={13} />
              </button>
              <button
                onClick={() => patch({ rules: draft.rules.filter((x) => x.id !== r.id) })}
                aria-label="Remover regra"
                className={`${iconBtn} hover:!text-red-600`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        <NewRuleForm
          frentes={activeFrentes}
          onAdd={(rule) => patch({ rules: [...draft.rules, rule] })}
        />

        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 pt-1">
          Sem regra que case, usar
          <select
            value={draft.fallback ?? ''}
            onChange={(e) => patch({ fallback: e.target.value || null })}
            className={inputCls}
          >
            <option value="">nenhuma (vai para "Classificar")</option>
            {activeFrentes.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name || '(sem nome)'}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* ── Ações ── */}
      <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
        <button
          onClick={() => save.mutate(draft, { onSuccess: (c) => setDraft(toDraft(c)) })}
          disabled={!dirty || invalid || save.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {save.isPending && <Loader2 size={12} className="animate-spin" />}
          Salvar
        </button>
        <button
          onClick={() => setDraft(toDraft(cfg))}
          disabled={!dirty}
          className="px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
        >
          Descartar
        </button>
        <span className="flex-1" />
        <ConfirmButton
          onConfirm={() => reset.mutate(undefined, { onSuccess: (c) => setDraft(toDraft(c)) })}
          icon={
            <span className="flex items-center gap-1 text-xs">
              <RotateCcw size={12} /> Restaurar padrão
            </span>
          }
          title="Voltar frentes e regras ao padrão (suas escolhas por tarefa ficam)"
          confirmLabel="Restaurar mesmo"
          triggerClass="px-2 py-1 rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
        />
      </div>
      {invalid && (
        <p className="text-[11px] text-red-600 dark:text-red-400">
          {emptyNames.length > 0 && 'Toda frente precisa de um nome. '}
          {emptyRules.length > 0 && 'Toda regra precisa de um valor.'}
        </p>
      )}
      {dirty && !invalid && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Alterações não salvas. Ao salvar, todas as tarefas são reclassificadas.
        </p>
      )}
      {save.isError && (
        <p className="text-[11px] text-red-600 dark:text-red-400">
          Não foi possível salvar. Tente de novo.
        </p>
      )}
    </div>
  );
}

/* Linha de "nova regra": campo → valor (lista de opções para Área/Natureza) → frente. */
function NewRuleForm({ frentes, onAdd }: { frentes: Frente[]; onAdd: (rule: FrenteRule) => void }) {
  const [field, setField] = useState<RuleField>('area');
  const [op, setOp] = useState<RuleOp>('has');
  const [value, setValue] = useState('');
  const [frente, setFrente] = useState('');
  const isList = isListField(field);
  const { data: options, isLoading } = useFrenteOptions(isList);
  const list = (isList ? options?.[field as 'area' | 'natureza'] : undefined) ?? [];
  const target = frentes.some((f) => f.id === frente) ? frente : (frentes[0]?.id ?? '');
  // A API devolve o ID da opção, não o nome: um nome digitado nunca casaria.
  // Por isso campo de lista só aceita escolha da lista.
  const noOptions = isList && !isLoading && list.length === 0;

  const changeField = (f: RuleField) => {
    setField(f);
    setValue('');
  };

  const add = () => {
    const v = value.trim();
    if (!v || !target) return;
    const label = isList ? list.find((o) => o.value === v)?.label : undefined;
    onAdd({
      id: uid('r'),
      field,
      op: isList ? 'eq' : op,
      value: v,
      ...(label ? { label } : {}),
      frente: target,
      on: true,
    });
    setValue('');
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-600">
        <select
          value={field}
          onChange={(e) => changeField(e.target.value as RuleField)}
          aria-label="Campo"
          className={inputCls}
        >
          {(Object.keys(FIELD_LABELS) as RuleField[]).map((f) => (
            <option key={f} value={f}>
              {FIELD_LABELS[f]}
            </option>
          ))}
        </select>
        {isList ? (
          <span className="text-xs text-slate-500">é</span>
        ) : (
          <select
            value={op}
            onChange={(e) => setOp(e.target.value as RuleOp)}
            aria-label="Operador"
            className={inputCls}
          >
            <option value="has">contém</option>
            <option value="eq">é exatamente</option>
          </select>
        )}
        {isList ? (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={list.length === 0}
            aria-label="Valor"
            className={`${inputCls} flex-1 min-w-[8rem]`}
          >
            <option value="">
              {isLoading ? 'carregando…' : list.length === 0 ? 'sem opções' : 'escolha…'}
            </option>
            {list.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="texto"
            aria-label="Valor"
            className={`${inputCls} flex-1 min-w-[8rem]`}
          />
        )}
        <span className="text-slate-300 dark:text-slate-600 text-xs">→</span>
        <select
          value={target}
          onChange={(e) => setFrente(e.target.value)}
          aria-label="Frente"
          className={inputCls}
        >
          {frentes.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name || '(sem nome)'}
            </option>
          ))}
        </select>
        <button
          onClick={add}
          disabled={!value.trim() || !target}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 disabled:opacity-40"
        >
          <Plus size={12} /> Adicionar
        </button>
      </div>
      {noOptions && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          Não encontrei as opções de {FIELD_LABELS[field]}: elas vêm de uma tarefa sua que tenha
          esse campo preenchido. Use Título, Versão ou Projeto, ou volte depois.
        </p>
      )}
    </div>
  );
}
