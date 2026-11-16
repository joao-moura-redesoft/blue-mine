// Frentes: classificação das tarefas por "o que elas são" (CRM, Implantação,
// Consync, iFood…), independente do projeto do Redmine onde foram abertas.
//
// Cada tarefa tem no máximo UMA frente, decidida nesta ordem:
//   1. escolha manual do usuário (`manual[issueId]`);
//   2. a primeira regra ligada que casar (campos do Redmine: Área, Versão…);
//   3. a frente-padrão (`fallback`), se configurada;
//   4. nenhuma — a tarefa cai na fila "sem frente".
//
// Tudo aqui é função pura (sem I/O): o servidor calcula a frente a cada carga
// das tarefas, então tarefa nova já chega classificada e nada fica defasado.
const { REDMINE_CF } = require('./config');

// Campos do Redmine que uma regra pode olhar. `area` e `natureza` são listas
// do Redmine: a API devolve o ID da opção ("160"), não o nome — por isso a regra
// guarda o ID (e o nome só como rótulo de exibição).
const FIELDS = ['titulo', 'area', 'natureza', 'versao', 'projeto'];
const ID_FIELDS = new Set(['area', 'natureza']);
const OPS = ['eq', 'has'];

const LIMITS = { frentes: 40, rules: 300, text: 200, manual: 5000 };

// Sem acento, minúsculo, espaços colapsados: "Módulo  Consync" == "modulo consync".
function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function cfValues(issue, cfId) {
  const f = (issue.custom_fields || []).find((c) => c.id === cfId);
  if (!f || f.value == null) return [];
  return (Array.isArray(f.value) ? f.value : [f.value]).map(String).filter((v) => v !== '');
}

// Valores que a tarefa tem para o campo — uma lista porque campo de lista do
// Redmine pode ser múltiplo.
function fieldValues(issue, field) {
  switch (field) {
    case 'titulo':
      return [issue.subject];
    case 'area':
      return cfValues(issue, REDMINE_CF.area);
    case 'natureza':
      return cfValues(issue, REDMINE_CF.nature);
    case 'versao':
      return issue.fixed_version?.name ? [issue.fixed_version.name] : [];
    case 'projeto':
      return issue.project?.name ? [issue.project.name] : [];
    default:
      return [];
  }
}

function ruleMatches(rule, issue) {
  const wanted = [norm(rule.value), rule.label ? norm(rule.label) : ''].filter(Boolean);
  if (!wanted.length) return false;
  // Campos de lista casam por igualdade: "has" em ID viraria "16" ⊂ "160".
  const op = ID_FIELDS.has(rule.field) ? 'eq' : rule.op;
  return fieldValues(issue, rule.field).some((raw) => {
    const v = norm(raw);
    return op === 'eq' ? wanted.includes(v) : wanted.some((w) => v.includes(w));
  });
}

// Frentes arquivadas somem da classificação e dos filtros, mas as regras e
// escolhas que apontam para elas ficam guardadas (desarquivar restaura tudo).
function liveFrentes(cfg) {
  return new Map(cfg.frentes.filter((f) => !f.archived).map((f) => [f.id, f]));
}

// Resultado: { id, src: 'manual'|'regra'|'padrao', ruleId? } ou null.
function classifyIssue(issue, cfg, live = liveFrentes(cfg)) {
  const manualId = cfg.manual?.[issue.id];
  if (manualId && live.has(manualId)) return { id: manualId, src: 'manual' };
  for (const rule of cfg.rules) {
    if (rule.on === false || !live.has(rule.frente)) continue;
    if (ruleMatches(rule, issue)) return { id: rule.frente, src: 'regra', ruleId: rule.id };
  }
  if (cfg.fallback && live.has(cfg.fallback)) return { id: cfg.fallback, src: 'padrao' };
  return null;
}

// Forma que vai junto de cada tarefa na resposta: já traz nome e cor, então
// nenhuma tela precisa cruzar com a configuração para desenhar o chip.
function describeFrente(match, live) {
  if (!match) return null;
  const f = live.get(match.id);
  const out = {
    id: f.id,
    name: f.name,
    color: f.color,
    hidden: !!f.hidden,
    src: match.src,
  };
  if (match.ruleId != null) out.ruleId = match.ruleId;
  return out;
}

// Regras que casariam com a tarefa mas perderam para outra — ajuda a entender
// por que a frente é a que é ("a primeira que casar vence" é invisível).
function alsoMatching(issue, cfg, chosenFrenteId) {
  const live = liveFrentes(cfg);
  return cfg.rules.filter(
    (r) =>
      r.on !== false && live.has(r.frente) && r.frente !== chosenFrenteId && ruleMatches(r, issue),
  );
}

// Anexa `frente` (objeto ou null) a cada tarefa. Não muda os objetos recebidos.
// withAlso (só para a tarefa aberta): lista as regras de OUTRAS frentes que
// também casam, em `frente.also`.
function annotateIssues(issues, cfg, { withAlso = false } = {}) {
  const live = liveFrentes(cfg);
  return issues.map((i) => {
    const frente = describeFrente(classifyIssue(i, cfg, live), live);
    if (frente && withAlso) {
      const also = alsoMatching(i, cfg, frente.id).map((r) => r.id);
      if (also.length) frente.also = also;
    }
    return { ...i, frente };
  });
}

// ── Configuração ─────────────────────────────────────────────────────────────

// Ponto de partida para quem nunca abriu a tela: as frentes do time de
// desenvolvimento da B2click. Os IDs de Área são os do Redmine de lá e o
// rótulo acompanha para a regra continuar legível (e casar pelo nome se o ID
// mudar). Nada é gravado até o usuário alterar algo.
function defaultConfig() {
  return {
    frentes: [
      { id: 'crm', name: 'CRM', color: '#3b82f6', area: 'CRM Redesoft' },
      { id: 'implantacao', name: 'Implantação', color: '#f97316', area: 'Módulo Implantação' },
      { id: 'consync', name: 'Consync', color: '#14b8a6', area: 'Módulo Consync' },
      { id: 'ifood', name: 'iFood', color: '#e11d48', area: 'Integração com Terceiros' },
      { id: 'dashboards', name: 'Dashboards', color: '#8b5cf6', area: 'Dashboard' },
      // Frentes por Área do Redmine. Custam nada no quadro de quem não tem tarefa
      // nelas (o chip só aparece com tarefa aberta) e servem ao time e ao Panorama.
      {
        id: 'operacional',
        name: 'Operação de posto',
        color: '#0ea5e9',
        area: 'Módulo Operacional',
      },
      { id: 'pdv', name: 'Frente de loja / PDV', color: '#a855f7', area: 'Frente de loja EXE' },
      { id: 'financeiro', name: 'Financeiro', color: '#22c55e', area: 'Módulo Financeiro' },
      { id: 'fiscal', name: 'Fiscal', color: '#eab308', area: 'Módulo Fiscal' },
      {
        id: 'integracoes',
        name: 'Integrações',
        color: '#f43f5e',
        area: 'Integração com Terceiros',
      },
      { id: 'pos', name: 'POS / TEF', color: '#06b6d4', area: 'Android (POS)' },
      { id: 'redesoft', name: 'Redesoft / CS', color: '#ec4899', area: 'Módulo Redesoft' },
      { id: 'apis', name: 'APIs próprias', color: '#84cc16', area: 'APIs próprias' },
      {
        id: 'estacionamento',
        name: 'Estacionamento',
        color: '#f59e0b',
        area: 'Módulo Estacionamento',
      },
      { id: 'outros', name: 'Outros módulos', color: '#78716c' },
      { id: 'avulsas', name: 'Avulsas', color: '#94a3b8' },
      { id: 'infra', name: 'Pedidos à infra', color: '#64748b', hidden: true },
    ],
    rules: [
      // BI Redesign vive no projeto REDES, o mesmo dos pedidos à infra: sem estas
      // três na frente, a regra de projeto abaixo esconderia trabalho de verdade.
      // ("- BI" casaria "PICHILAU - BICOS"; por isso "BI:" e "BI Redesign".)
      {
        id: 'r-bi-redesign',
        field: 'titulo',
        op: 'has',
        value: 'BI Redesign',
        frente: 'dashboards',
      },
      { id: 'r-bi-dois-pontos', field: 'titulo', op: 'has', value: 'BI:', frente: 'dashboards' },
      { id: 'r-bi-capital', field: 'titulo', op: 'has', value: 'BI Capital', frente: 'dashboards' },
      // Antes das demais: chamado aberto para a infra nunca é o trabalho em si,
      // mesmo quando o título cita Consync ou iFood.
      {
        id: 'r-infra-projeto',
        field: 'projeto',
        op: 'eq',
        value: 'REDES - SOLICITAÇÕES INTERNAS',
        frente: 'infra',
      },
      { id: 'r-crm-versao', field: 'versao', op: 'has', value: 'b2click CRM', frente: 'crm' },
      {
        id: 'r-crm-area',
        field: 'area',
        op: 'eq',
        value: '275',
        label: 'CRM Redesoft',
        frente: 'crm',
      },
      {
        id: 'r-impl-versao',
        field: 'versao',
        op: 'has',
        value: 'b2click Implantação',
        frente: 'implantacao',
      },
      {
        id: 'r-impl-area',
        field: 'area',
        op: 'eq',
        value: '276',
        label: 'Módulo Implantação',
        frente: 'implantacao',
      },
      { id: 'r-ifood-titulo', field: 'titulo', op: 'has', value: 'ifood', frente: 'ifood' },
      {
        id: 'r-consync-area',
        field: 'area',
        op: 'eq',
        value: '160',
        label: 'Módulo Consync',
        frente: 'consync',
      },
      { id: 'r-consync-titulo', field: 'titulo', op: 'has', value: 'consync', frente: 'consync' },
      {
        id: 'r-dash-area',
        field: 'area',
        op: 'eq',
        value: '164',
        label: 'Dashboard',
        frente: 'dashboards',
      },
      // Por Área (IDs do Redmine da B2click). Vêm por último: Consync, CRM etc. e o
      // iFood (título) são mais específicos que "Integração com Terceiros".
      ...[
        [158, 'Módulo Operacional', 'operacional'],
        [157, 'Frente de loja EXE', 'pdv'],
        [159, 'Módulo Financeiro', 'financeiro'],
        [161, 'Módulo Fiscal', 'fiscal'],
        [205, 'Integração com Terceiros', 'integracoes'],
        [209, 'Android (POS)', 'pos'],
        [250, 'TEF (Pinpad/Sitef/Paygo)', 'pos'],
        [269, 'Módulo Redesoft', 'redesoft'],
        [274, 'CS Redesoft', 'redesoft'],
        [165, 'APIs próprias', 'apis'],
        [247, 'Módulo Estacionamento', 'estacionamento'],
        [162, 'Módulo Contábil', 'outros'],
        [163, 'Gerador de Relatórios', 'outros'],
        [243, 'Módulo Padrão', 'outros'],
        [244, 'Módulo Vendas', 'outros'],
        [245, 'Módulo Compras', 'outros'],
        [246, 'Módulo Produção', 'outros'],
        [248, 'Módulo Serviço', 'outros'],
        [268, 'Módulo Service Desk', 'outros'],
        [270, 'Módulo Pay', 'outros'],
        [271, 'Frota', 'outros'],
        [249, 'Framework', 'outros'],
        [272, 'Fidelização de Clientes', 'outros'],
      ].map(([id, label, frente]) => ({
        id: `r-area-${id}`,
        field: 'area',
        op: 'eq',
        value: String(id),
        label,
        frente,
      })),
    ].map((r) => ({ ...r, on: true })),
    manual: {},
    fallback: null,
  };
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const text = (v, max = LIMITS.text) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function sanitizeFrentes(input) {
  const seen = new Set();
  const out = [];
  for (const f of Array.isArray(input) ? input.slice(0, LIMITS.frentes) : []) {
    if (!f || typeof f.id !== 'string' || !ID_RE.test(f.id) || seen.has(f.id)) continue;
    const name = text(f.name, 60);
    if (!name) continue;
    seen.add(f.id);
    const clean = {
      id: f.id,
      name,
      color: COLOR_RE.test(f.color) ? f.color.toLowerCase() : '#94a3b8',
    };
    const area = text(f.area, 80);
    if (area) clean.area = area;
    if (f.hidden) clean.hidden = true;
    if (f.archived) clean.archived = true;
    out.push(clean);
  }
  return out;
}

function sanitizeRules(input, frenteIds) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(input) ? input.slice(0, LIMITS.rules) : []) {
    if (!r || !FIELDS.includes(r.field) || !frenteIds.has(r.frente)) continue;
    const value = text(r.value);
    if (!value) continue;
    let id = typeof r.id === 'string' && r.id ? r.id.slice(0, 60) : '';
    if (!id || seen.has(id)) id = `r-${Date.now().toString(36)}-${out.length}`;
    seen.add(id);
    const clean = {
      id,
      field: r.field,
      op: ID_FIELDS.has(r.field) ? 'eq' : OPS.includes(r.op) ? r.op : 'has',
      value,
      frente: r.frente,
      on: r.on !== false,
    };
    const label = text(r.label, 120);
    if (label) clean.label = label;
    out.push(clean);
  }
  return out;
}

// Valida e normaliza uma configuração vinda do cliente (ou do disco). Nunca
// lança: o que não presta é descartado, para um arquivo corrompido não derrubar
// as tarefas do usuário.
function sanitizeConfig(input) {
  const src = input && typeof input === 'object' ? input : {};
  const frentes = sanitizeFrentes(src.frentes);
  const ids = new Set(frentes.map((f) => f.id));
  const manual = {};
  for (const [issueId, frenteId] of Object.entries(src.manual || {})) {
    if (Object.keys(manual).length >= LIMITS.manual) break;
    if (/^\d{1,9}$/.test(issueId) && ids.has(frenteId)) manual[issueId] = frenteId;
  }
  return {
    frentes,
    rules: sanitizeRules(src.rules, ids),
    manual,
    fallback: typeof src.fallback === 'string' && ids.has(src.fallback) ? src.fallback : null,
  };
}

module.exports = {
  FIELDS,
  ID_FIELDS,
  norm,
  fieldValues,
  ruleMatches,
  liveFrentes,
  classifyIssue,
  describeFrente,
  annotateIssues,
  alsoMatching,
  defaultConfig,
  sanitizeConfig,
};
