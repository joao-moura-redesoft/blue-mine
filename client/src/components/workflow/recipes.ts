// Receitas: automações prontas que montam o grafo (nós posicionados e ligados)
// com um clique. Servem de onboarding e de exemplo das variáveis {{ }}.
//
// IMPORTANTE: ids de status, salas do Talk e destinatários de e-mail variam por
// instalação — não dá para adivinhar. As receitas deixam esses campos VAZIOS de
// propósito; o `validateNode` marca o nó em âmbar no canvas indicando o que
// completar. É guia, não gambiarra.
import {
  Bell,
  MessageSquare,
  CalendarClock,
  Sparkles,
  Shuffle,
  Briefcase,
  CircleDot,
  ScrollText,
  Inbox,
  KeyRound,
  Gauge,
  Power,
  Link,
  Play,
  Hourglass,
  RotateCcw,
  Users,
  Reply,
  Archive,
  TrendingUp,
  AlarmClock,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import type { WorkflowNode } from '../../api/workflows';

export type RecipeCategory = 'stale' | 'handoff' | 'talk' | 'email' | 'personal';

// Ordem de exibição na galeria (mais usadas primeiro).
export const RECIPE_CATEGORIES: Record<RecipeCategory, string> = {
  stale: 'Tarefas paradas & prazos',
  handoff: 'Atribuição & handoff',
  talk: 'Talk & presença',
  email: 'E-mail',
  personal: 'IA & produtividade pessoal',
};

export interface Recipe {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  category: RecipeCategory;
  /** O que o usuário precisa completar depois (mostrado no card). */
  todo?: string;
  build: () => WorkflowNode[];
}

let seq = 0;
const nid = () => `r${Date.now().toString(36)}-${(seq++).toString(36)}`;

type NodeInit = Omit<WorkflowNode, 'id' | 'nextIds'> & { nextIds?: string[] };
const mk = (init: NodeInit): WorkflowNode => ({ id: nid(), nextIds: [], ...init });

const COL = 0;
const ROW = 150;

export const RECIPES: Recipe[] = [
  {
    id: 'talk-on-status',
    name: 'Avisar no Talk ao mudar de status',
    description:
      'Quando o status de uma tarefa muda, manda uma mensagem numa sala do Talk com o link da tarefa.',
    icon: MessageSquare,
    category: 'talk',
    todo: 'Escolher a sala do Talk (e, se quiser, o status).',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.status_changed',
        config: { from: '', to: '' },
        position: { x: COL, y: 0 },
      });
      const send = mk({
        kind: 'action',
        type: 'talk.send',
        config: {
          roomToken: '',
          message: '#{{issue.id}} {{issue.subject}} → {{issue.status.name}}',
          onError: 'continue',
        },
        position: { x: COL, y: ROW },
      });
      trigger.nextIds = [send.id];
      return [trigger, send];
    },
  },

  {
    id: 'nudge-stale',
    name: 'Cutucar tarefas paradas',
    description:
      'Todo dia às 9h varre suas tarefas e, nas que estão há mais de 3 dias sem atualização, comenta e te notifica.',
    icon: CalendarClock,
    category: 'stale',
    todo: 'Nada — já funciona. Ajuste os dias se quiser.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.scan',
        config: {
          mode: 'daily',
          hour: 9,
          minute: 0,
          everyMinutes: 60,
          scope: 'assigned',
          // Sem cooldown, cutucaria a mesma tarefa todo dia.
          repeat: 'cooldown',
          cooldownDays: 3,
        },
        position: { x: COL, y: 0 },
      });
      const branch = mk({
        kind: 'branch',
        type: 'if',
        config: { op: 'and', rules: [{ field: 'issue.updated_days', operand: 'gt', value: '3' }] },
        position: { x: COL, y: ROW },
        elseIds: [],
      });
      const comment = mk({
        kind: 'action',
        type: 'issue.comment',
        config: {
          body: 'Esta tarefa está há mais de 3 dias sem atualização.',
          onError: 'continue',
        },
        position: { x: COL - 140, y: ROW * 2 },
      });
      const notify = mk({
        kind: 'action',
        type: 'notify',
        config: {
          title: 'Tarefa parada',
          body: '#{{issue.id}} {{issue.subject}}',
          onError: 'continue',
        },
        position: { x: COL + 140, y: ROW * 2 },
      });
      trigger.nextIds = [branch.id];
      branch.nextIds = [comment.id, notify.id]; // ramo "verdadeiro"
      return [trigger, branch, comment, notify];
    },
  },

  {
    id: 'ai-triage-mentions',
    name: 'Triagem de menções com IA',
    description:
      'Quando te mencionam no Talk, a IA classifica em urgente/normal. Se for urgente, te notifica e manda e-mail.',
    icon: Sparkles,
    category: 'talk',
    todo: 'Preencher o destinatário do e-mail. Exige IA configurada.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'talk.message',
        config: { roomToken: '', mentionsOnly: true },
        position: { x: COL, y: 0 },
      });
      const classify = mk({
        kind: 'action',
        type: 'ai.classify',
        config: {
          prompt: 'Mensagem de {{message.actor}} na sala {{room.name}}: "{{message.text}}"',
          labels: ['urgente', 'normal'],
          // Se a IA falhar, não faz sentido seguir ramificando.
          onError: 'stop',
        },
        position: { x: COL, y: ROW },
      });
      const branch = mk({
        kind: 'branch',
        type: 'if',
        config: { op: 'and', rules: [{ field: 'ai.label', operand: 'eq', value: 'urgente' }] },
        position: { x: COL, y: ROW * 2 },
        elseIds: [],
      });
      const notify = mk({
        kind: 'action',
        type: 'notify',
        config: {
          title: 'Menção urgente',
          body: '{{message.actor}}: {{message.text}}',
          onError: 'continue',
        },
        position: { x: COL - 140, y: ROW * 3 },
      });
      const email = mk({
        kind: 'action',
        type: 'email.send',
        config: {
          to: '',
          subject: 'Menção urgente no Talk',
          text: '{{message.actor}} em {{room.name}}: {{message.text}}',
          onError: 'continue',
        },
        position: { x: COL + 140, y: ROW * 3 },
      });
      trigger.nextIds = [classify.id];
      classify.nextIds = [branch.id];
      branch.nextIds = [notify.id, email.id];
      return [trigger, classify, branch, notify, email];
    },
  },

  {
    id: 'overdue-alert',
    name: 'Alerta de prazo',
    description:
      'Varre suas tarefas de manhã e avisa (push + telinha do teclado) as que passaram do prazo.',
    icon: Bell,
    category: 'stale',
    todo: 'Nada — já funciona.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.scan',
        config: {
          mode: 'daily',
          hour: 8,
          minute: 30,
          everyMinutes: 60,
          scope: 'assigned',
          repeat: 'cooldown',
          cooldownDays: 1,
        },
        position: { x: COL, y: 0 },
      });
      const branch = mk({
        kind: 'branch',
        type: 'if',
        config: { op: 'and', rules: [{ field: 'issue.due_days', operand: 'lt', value: '0' }] },
        position: { x: COL, y: ROW },
        elseIds: [],
      });
      const notify = mk({
        kind: 'action',
        type: 'notify',
        config: {
          title: 'Tarefa atrasada',
          body: '#{{issue.id}} {{issue.subject}}',
          onError: 'continue',
        },
        position: { x: COL - 140, y: ROW * 2 },
      });
      const k86 = mk({
        kind: 'action',
        type: 'k86.screen',
        config: {
          title: 'Atrasada',
          subtitle: '#{{issue.id}} {{issue.subject}}',
          onError: 'continue',
        },
        position: { x: COL + 140, y: ROW * 2 },
      });
      trigger.nextIds = [branch.id];
      branch.nextIds = [notify.id, k86.id];
      return [trigger, branch, notify, k86];
    },
  },

  {
    id: 'round-robin-new-issue',
    name: 'Rodízio de tarefas novas',
    description:
      'Quando entra uma tarefa nova (de um projeto escolhido), distribui por rodízio e avisa quem recebeu, no Talk.',
    icon: Shuffle,
    category: 'handoff',
    todo: 'Escolher o projeto, as pessoas do rodízio e a mensagem.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.created',
        config: { category: '' },
        position: { x: COL, y: 0 },
      });
      const filter = mk({
        kind: 'filter',
        type: 'filter',
        config: { op: 'and', rules: [{ field: 'project', operand: 'eq', value: '' }] },
        position: { x: COL, y: ROW },
      });
      const assign = mk({
        kind: 'action',
        type: 'issue.assign_next',
        config: { users: [], onError: 'stop' },
        position: { x: COL, y: ROW * 2 },
      });
      const notifyPerson = mk({
        kind: 'action',
        type: 'talk.notify_person',
        config: {
          who: 'fixed',
          userId: '{{assigned.id}}',
          message: 'Você recebeu a tarefa #{{issue.id}} {{issue.subject}} por rodízio.',
          onError: 'continue',
        },
        position: { x: COL, y: ROW * 3 },
      });
      trigger.nextIds = [filter.id];
      filter.nextIds = [assign.id];
      assign.nextIds = [notifyPerson.id];
      return [trigger, filter, assign, notifyPerson];
    },
  },

  {
    id: 'business-hours-notify',
    name: 'Só notificar em horário comercial',
    description:
      'Quando uma tarefa vem pra você, notifica na hora se for horário comercial; fora dele, espera e avisa depois.',
    icon: Briefcase,
    category: 'handoff',
    todo: 'Nada — já funciona. Ajuste o horário comercial se quiser.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.assigned_changed',
        config: { toMe: true },
        position: { x: COL, y: 0 },
      });
      const branch = mk({
        kind: 'branch',
        type: 'filter.is_business_hours',
        config: { startHour: 8, endHour: 18, days: [1, 2, 3, 4, 5] },
        position: { x: COL, y: ROW },
        elseIds: [],
      });
      const notifyNow = mk({
        kind: 'action',
        type: 'notify',
        config: {
          title: 'Nova tarefa atribuída a você',
          body: '#{{issue.id}} {{issue.subject}}',
          onError: 'continue',
        },
        position: { x: COL - 140, y: ROW * 2 },
      });
      const wait = mk({
        kind: 'action',
        type: 'wait',
        config: { amount: 8, unit: 'hours' },
        position: { x: COL + 140, y: ROW * 2 },
      });
      const notifyLater = mk({
        kind: 'action',
        type: 'notify',
        config: {
          title: 'Nova tarefa atribuída a você (fora do horário)',
          body: '#{{issue.id}} {{issue.subject}}',
          onError: 'continue',
        },
        position: { x: COL + 140, y: ROW * 3 },
      });
      trigger.nextIds = [branch.id];
      branch.nextIds = [notifyNow.id]; // verdadeiro: dentro do horário
      branch.elseIds = [wait.id]; // falso: fora do horário
      wait.nextIds = [notifyLater.id];
      return [trigger, branch, notifyNow, wait, notifyLater];
    },
  },

  {
    id: 'end-of-day-focus',
    name: 'Modo foco no fim do expediente',
    description: 'Todo dia às 18h muda seu status no Talk pra "Em foco" e toca um som de aviso.',
    icon: CircleDot,
    category: 'talk',
    todo: 'Nada — já funciona. Ajuste o horário se quiser.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'schedule',
        config: { mode: 'daily', hour: 18, minute: 0, everyMinutes: 60 },
        position: { x: COL, y: 0 },
      });
      const status = mk({
        kind: 'action',
        type: 'talk.change_status',
        config: { statusType: 'dnd', message: 'Fora do expediente', onError: 'continue' },
        position: { x: COL, y: ROW },
      });
      const sound = mk({
        kind: 'action',
        type: 'sound.play',
        config: { sound: 'success', onError: 'continue' },
        position: { x: COL, y: ROW * 2 },
      });
      trigger.nextIds = [status.id];
      status.nextIds = [sound.id];
      return [trigger, status, sound];
    },
  },

  {
    id: 'comment-summary',
    name: 'Resumir comentário novo com IA',
    description:
      'Quando alguém comenta numa tarefa sua, a IA resume a conversa inteira e te notifica com o resumo.',
    icon: ScrollText,
    category: 'personal',
    todo: 'Nada — já funciona. Exige IA configurada.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.commented',
        config: { fromOthers: true },
        position: { x: COL, y: 0 },
      });
      const summarize = mk({
        kind: 'action',
        type: 'ai.summarize',
        config: { source: 'comments', onError: 'stop' },
        position: { x: COL, y: ROW },
      });
      const notify = mk({
        kind: 'action',
        type: 'notify',
        config: {
          title: 'Novo comentário — resumo',
          body: '{{ai.summary}}',
          onError: 'continue',
        },
        position: { x: COL, y: ROW * 2 },
      });
      trigger.nextIds = [summarize.id];
      summarize.nextIds = [notify.id];
      return [trigger, summarize, notify];
    },
  },

  {
    id: 'email-to-issue',
    name: 'E-mail vira tarefa (com IA)',
    description:
      'Quando chega um e-mail (ex.: de um cliente), a IA extrai título e resumo do problema e cria a tarefa automaticamente.',
    icon: Inbox,
    category: 'email',
    todo: 'Preencher projeto/tracker e, se quiser, filtrar remetente/assunto. Exige IA configurada.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'email.received',
        config: { fromContains: '', subjectContains: '' },
        position: { x: COL, y: 0 },
      });
      const extract = mk({
        kind: 'action',
        type: 'ai.extract_data',
        config: {
          prompt: 'Extraia um título curto e um resumo do problema relatado neste e-mail.',
          fields: ['title', 'summary'],
          onError: 'stop',
        },
        position: { x: COL, y: ROW },
      });
      const create = mk({
        kind: 'action',
        type: 'issue.create',
        config: {
          project_id: '',
          tracker_id: '',
          subject: '{{ai.data.title}}',
          description: '{{ai.data.summary}}',
          assigned_to_id: '',
          priority_id: '',
          due_date: '',
          parent: 'none',
          onError: 'stop',
        },
        position: { x: COL, y: ROW * 2 },
      });
      const notify = mk({
        kind: 'action',
        type: 'notify',
        config: {
          title: 'Tarefa criada a partir de e-mail',
          body: '#{{created.id}} {{ai.data.title}}',
          onError: 'continue',
        },
        position: { x: COL, y: ROW * 3 },
      });
      trigger.nextIds = [extract.id];
      extract.nextIds = [create.id];
      create.nextIds = [notify.id];
      return [trigger, extract, create, notify];
    },
  },

  {
    id: 'totp-on-demand',
    name: 'Buscar código 2FA sob demanda',
    description:
      'Botão manual: busca o código TOTP atual de uma conta do cofre e cola como comentário na tarefa aberta.',
    icon: KeyRound,
    category: 'personal',
    todo: 'Escolher a conta (service) cadastrada no cofre TOTP.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'workflow.manual',
        config: {},
        position: { x: COL, y: 0 },
      });
      const totp = mk({
        kind: 'action',
        type: 'totp.fetch',
        config: { service: '', onError: 'stop' },
        position: { x: COL, y: ROW },
      });
      const comment = mk({
        kind: 'action',
        type: 'issue.comment',
        config: { body: 'Código: {{totp.code}}', onError: 'continue' },
        position: { x: COL, y: ROW * 2 },
      });
      trigger.nextIds = [totp.id];
      totp.nextIds = [comment.id];
      return [trigger, totp, comment];
    },
  },

  {
    id: 'budget-exceeded-webhook',
    name: 'Orçamento de horas: avisar e integrar',
    description:
      'Quando as horas apontadas passam da estimativa, comenta na tarefa e dispara um webhook (ex.: pra um painel externo).',
    icon: Gauge,
    category: 'stale',
    todo: 'Preencher a URL do webhook.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'time.budget_exceeded',
        config: {
          mode: 'daily',
          hour: 8,
          minute: 0,
          everyMinutes: 60,
          scope: 'assigned',
          maxIssues: 20,
          repeat: 'once',
        },
        position: { x: COL, y: 0 },
      });
      const comment = mk({
        kind: 'action',
        type: 'issue.comment',
        config: {
          body: 'Orçamento de horas desta tarefa foi ultrapassado.',
          onError: 'continue',
        },
        position: { x: COL, y: ROW },
      });
      const webhook = mk({
        kind: 'action',
        type: 'webhook',
        config: {
          url: '',
          method: 'POST',
          body: '{"issueId": {{issue.id}}, "event": "budget_exceeded"}',
          onError: 'continue',
        },
        position: { x: COL, y: ROW * 2 },
      });
      trigger.nextIds = [comment.id];
      comment.nextIds = [webhook.id];
      return [trigger, comment, webhook];
    },
  },

  {
    id: 'startup-greeting',
    name: 'Frase motivacional ao abrir o app',
    description: 'Ao iniciar o Bluemine, a IA escreve uma frase curta e te notifica.',
    icon: Power,
    category: 'personal',
    todo: 'Nada — já funciona. Exige IA configurada.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'app.startup',
        config: {},
        position: { x: COL, y: 0 },
      });
      const generate = mk({
        kind: 'action',
        type: 'ai.generate',
        config: {
          prompt: 'Escreva uma frase curta e motivadora para começar o dia de trabalho.',
          onError: 'stop',
        },
        position: { x: COL, y: ROW },
      });
      const notify = mk({
        kind: 'action',
        type: 'notify',
        config: { title: 'Bom dia!', body: '{{ai.text}}', onError: 'continue' },
        position: { x: COL, y: ROW * 2 },
      });
      trigger.nextIds = [generate.id];
      generate.nextIds = [notify.id];
      return [trigger, generate, notify];
    },
  },

  {
    id: 'link-duplicate-and-log',
    name: 'Vincular duplicada e apontar tempo',
    description:
      'Botão manual: marca a tarefa aberta como duplicata de outra e lança o tempo gasto identificando a duplicidade.',
    icon: Link,
    category: 'personal',
    todo: 'Preencher a tarefa alvo, as horas e a atividade.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'workflow.manual',
        config: {},
        position: { x: COL, y: 0 },
      });
      const link = mk({
        kind: 'action',
        type: 'issue.link_issues',
        config: { relationType: 'duplicates', targetIssueId: '', onError: 'continue' },
        position: { x: COL, y: ROW },
      });
      const time = mk({
        kind: 'action',
        type: 'time.log',
        config: {
          issue: 'event',
          issue_id: '',
          hours: '',
          activity_id: '',
          comments: 'Tempo identificando duplicidade',
          spent_on: '',
          onError: 'continue',
        },
        position: { x: COL, y: ROW * 2 },
      });
      trigger.nextIds = [link.id];
      link.nextIds = [time.id];
      return [trigger, link, time];
    },
  },

  {
    id: 'assume-and-time',
    name: 'Assumir tarefa e iniciar cronômetro',
    description:
      'Botão manual: atribui a tarefa aberta pra você e inicia o cronômetro de horas (clique de novo pra encerrar e apontar).',
    icon: Play,
    category: 'personal',
    todo: 'Escolher a atividade do cronômetro.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'workflow.manual',
        config: {},
        position: { x: COL, y: 0 },
      });
      const update = mk({
        kind: 'action',
        type: 'issue.update',
        config: { assigned_to_id: 'me', onError: 'continue' },
        position: { x: COL, y: ROW },
      });
      const timer = mk({
        kind: 'action',
        type: 'time.log_timer',
        config: { activity_id: '', comments: '', onError: 'continue' },
        position: { x: COL, y: ROW * 2 },
      });
      trigger.nextIds = [update.id];
      update.nextIds = [timer.id];
      return [trigger, update, timer];
    },
  },

  {
    id: 'sla-first-response',
    name: 'SLA de primeira resposta',
    description:
      'Quando uma tarefa nova chega, espera algumas horas; se o status ainda não mudou, sobe a prioridade e avisa o responsável no Talk.',
    icon: Hourglass,
    category: 'stale',
    todo: 'Escolher o status "ainda parada" e a nova prioridade.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.created',
        config: { category: '' },
        position: { x: COL, y: 0 },
      });
      const wait = mk({
        kind: 'action',
        type: 'wait',
        config: { amount: 4, unit: 'hours' },
        position: { x: COL, y: ROW },
      });
      const branch = mk({
        kind: 'branch',
        type: 'if',
        config: { op: 'and', rules: [{ field: 'status', operand: 'eq', value: '' }] },
        position: { x: COL, y: ROW * 2 },
        elseIds: [],
      });
      const update = mk({
        kind: 'action',
        type: 'issue.update',
        config: { priority_id: '', onError: 'continue' },
        position: { x: COL - 140, y: ROW * 3 },
      });
      const notifyPerson = mk({
        kind: 'action',
        type: 'talk.notify_person',
        config: {
          who: 'assigned_to',
          userId: '',
          message: 'SLA de primeira resposta estourado: #{{issue.id}} {{issue.subject}}',
          onError: 'continue',
        },
        position: { x: COL + 140, y: ROW * 3 },
      });
      trigger.nextIds = [wait.id];
      wait.nextIds = [branch.id];
      branch.nextIds = [update.id, notifyPerson.id]; // verdadeiro: ainda no status inicial
      return [trigger, wait, branch, update, notifyPerson];
    },
  },

  {
    id: 'reopen-by-comment',
    name: 'Reabrir tarefa fechada por comentário',
    description: 'Se alguém comenta numa tarefa já fechada, reabre automaticamente e te notifica.',
    icon: RotateCcw,
    category: 'stale',
    todo: 'Escolher o status "fechado" e o status de reabertura.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.commented',
        config: { fromOthers: true },
        position: { x: COL, y: 0 },
      });
      const branch = mk({
        kind: 'branch',
        type: 'if',
        config: { op: 'and', rules: [{ field: 'status', operand: 'eq', value: '' }] },
        position: { x: COL, y: ROW },
        elseIds: [],
      });
      const update = mk({
        kind: 'action',
        type: 'issue.update',
        config: { status_id: '', onError: 'continue' },
        position: { x: COL, y: ROW * 2 },
      });
      const notify = mk({
        kind: 'action',
        type: 'notify',
        config: {
          title: 'Tarefa reaberta',
          body: '#{{issue.id}} {{issue.subject}} recebeu um comentário e foi reaberta',
          onError: 'continue',
        },
        position: { x: COL, y: ROW * 3 },
      });
      trigger.nextIds = [branch.id];
      branch.nextIds = [update.id]; // verdadeiro: estava fechada
      update.nextIds = [notify.id];
      return [trigger, branch, update, notify];
    },
  },

  {
    id: 'handoff-review',
    name: 'Handoff pra revisão',
    description:
      'Quando a tarefa muda pro status de revisão, distribui entre os revisores por rodízio e avisa quem recebeu.',
    icon: Users,
    category: 'handoff',
    todo: 'Escolher o status "aguardando revisão" e os revisores do rodízio.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.status_changed',
        config: { from: '', to: '' },
        position: { x: COL, y: 0 },
      });
      const assign = mk({
        kind: 'action',
        type: 'issue.assign_next',
        config: { users: [], onError: 'stop' },
        position: { x: COL, y: ROW },
      });
      const notifyPerson = mk({
        kind: 'action',
        type: 'talk.notify_person',
        config: {
          who: 'fixed',
          userId: '{{assigned.id}}',
          message: 'Tarefa #{{issue.id}} {{issue.subject}} chegou pra sua revisão.',
          onError: 'continue',
        },
        position: { x: COL, y: ROW * 2 },
      });
      trigger.nextIds = [assign.id];
      assign.nextIds = [notifyPerson.id];
      return [trigger, assign, notifyPerson];
    },
  },

  {
    id: 'email-auto-reply',
    name: 'Auto-resposta de e-mail urgente',
    description:
      'Classifica o e-mail recebido com IA; se for urgente, responde automaticamente avisando que já viu e te notifica.',
    icon: Reply,
    category: 'email',
    todo: 'Ajustar o texto da resposta automática. Exige IA configurada.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'email.received',
        config: { fromContains: '', subjectContains: '' },
        position: { x: COL, y: 0 },
      });
      const classify = mk({
        kind: 'action',
        type: 'ai.classify',
        config: {
          prompt: 'E-mail de {{email.from}}, assunto "{{email.subject}}": {{email.snippet}}',
          labels: ['urgente', 'normal'],
          onError: 'stop',
        },
        position: { x: COL, y: ROW },
      });
      const branch = mk({
        kind: 'branch',
        type: 'if',
        config: { op: 'and', rules: [{ field: 'ai.label', operand: 'eq', value: 'urgente' }] },
        position: { x: COL, y: ROW * 2 },
        elseIds: [],
      });
      const reply = mk({
        kind: 'action',
        type: 'email.send',
        config: {
          to: '{{email.from}}',
          subject: 'Recebemos seu e-mail',
          text: 'Olá! Recebemos sua mensagem e vamos responder o quanto antes.',
          onError: 'continue',
        },
        position: { x: COL - 140, y: ROW * 3 },
      });
      const notify = mk({
        kind: 'action',
        type: 'notify',
        config: { title: 'E-mail urgente', body: '{{email.subject}}', onError: 'continue' },
        position: { x: COL + 140, y: ROW * 3 },
      });
      trigger.nextIds = [classify.id];
      classify.nextIds = [branch.id];
      branch.nextIds = [reply.id, notify.id]; // verdadeiro: urgente
      return [trigger, classify, branch, reply, notify];
    },
  },

  {
    id: 'archive-resolved-stale',
    name: 'Arquivar tarefas resolvidas e esquecidas',
    description:
      'Varre suas tarefas e fecha automaticamente as que estão "Resolvido" há mais de 7 dias sem ninguém reabrir.',
    icon: Archive,
    category: 'stale',
    todo: 'Escolher o status "resolvido" e o status final (fechado).',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.scan',
        config: {
          mode: 'daily',
          hour: 9,
          minute: 0,
          everyMinutes: 60,
          scope: 'assigned',
          maxIssues: 20,
          repeat: 'cooldown',
          cooldownDays: 7,
        },
        position: { x: COL, y: 0 },
      });
      const branch = mk({
        kind: 'branch',
        type: 'if',
        config: {
          op: 'and',
          rules: [
            { field: 'status', operand: 'eq', value: '' },
            { field: 'issue.updated_days', operand: 'gt', value: '7' },
          ],
        },
        position: { x: COL, y: ROW },
        elseIds: [],
      });
      const update = mk({
        kind: 'action',
        type: 'issue.update',
        config: { status_id: '', onError: 'continue' },
        position: { x: COL, y: ROW * 2 },
      });
      trigger.nextIds = [branch.id];
      branch.nextIds = [update.id]; // verdadeiro: resolvido e parado há mais de 7 dias
      return [trigger, branch, update];
    },
  },

  {
    id: 'escalate-stale',
    name: 'Escalonar tarefa parada',
    description:
      'Varre suas tarefas; nas que estão paradas há muito tempo, sobe a prioridade e avisa o AUTOR (não só você) no Talk.',
    icon: TrendingUp,
    category: 'stale',
    todo: 'Escolher a nova prioridade.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.scan',
        config: {
          mode: 'daily',
          hour: 9,
          minute: 30,
          everyMinutes: 60,
          scope: 'assigned',
          maxIssues: 20,
          repeat: 'cooldown',
          cooldownDays: 5,
        },
        position: { x: COL, y: 0 },
      });
      const branch = mk({
        kind: 'branch',
        type: 'if',
        config: { op: 'and', rules: [{ field: 'issue.updated_days', operand: 'gt', value: '5' }] },
        position: { x: COL, y: ROW },
        elseIds: [],
      });
      const update = mk({
        kind: 'action',
        type: 'issue.update',
        config: { priority_id: '', onError: 'continue' },
        position: { x: COL - 140, y: ROW * 2 },
      });
      const notifyPerson = mk({
        kind: 'action',
        type: 'talk.notify_person',
        config: {
          who: 'author',
          userId: '',
          message: 'Sua tarefa #{{issue.id}} {{issue.subject}} está parada há mais de 5 dias.',
          onError: 'continue',
        },
        position: { x: COL + 140, y: ROW * 2 },
      });
      trigger.nextIds = [branch.id];
      branch.nextIds = [update.id, notifyPerson.id];
      return [trigger, branch, update, notifyPerson];
    },
  },

  {
    id: 'remind-my-own-issue',
    name: 'Cutucar responsável de tarefa que você criou',
    description:
      'Quando você cria uma tarefa pra outra pessoa (ex.: abre um chamado pra Redes), espera um tempo e, se ainda não andou, avisa quem está com ela no Talk — não só você.',
    icon: AlarmClock,
    category: 'stale',
    todo: 'Escolher o status "ainda parada" e o tempo de espera.',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.created',
        config: { category: 'authored' },
        position: { x: COL, y: 0 },
      });
      const wait = mk({
        kind: 'action',
        type: 'wait',
        config: { amount: 1, unit: 'days' },
        position: { x: COL, y: ROW },
      });
      const branch = mk({
        kind: 'branch',
        type: 'if',
        config: { op: 'and', rules: [{ field: 'status', operand: 'eq', value: '' }] },
        position: { x: COL, y: ROW * 2 },
        elseIds: [],
      });
      const notifyPerson = mk({
        kind: 'action',
        type: 'talk.notify_person',
        config: {
          who: 'assigned_to', // se você mesmo se atribuiu, cai no auto-aviso (push + Nota para si mesmo)
          userId: '',
          message:
            'A tarefa #{{issue.id}} {{issue.subject}} está parada há um tempo. Dá pra dar uma olhada?',
          onError: 'continue',
        },
        position: { x: COL, y: ROW * 3 },
      });
      trigger.nextIds = [wait.id];
      wait.nextIds = [branch.id];
      branch.nextIds = [notifyPerson.id]; // verdadeiro: ainda no status inicial
      return [trigger, wait, branch, notifyPerson];
    },
  },

  {
    id: 'notify-author-on-done',
    name: 'Avisar autor quando a tarefa é concluída',
    description:
      'Quando a tarefa muda pro status de concluída, avisa quem a criou no Talk — fecha o ciclo sem precisar reatribuir nada.',
    icon: CheckCircle2,
    category: 'handoff',
    todo: 'Escolher o status "concluído".',
    build: () => {
      const trigger = mk({
        kind: 'trigger',
        type: 'issue.status_changed',
        config: { from: '', to: '' },
        position: { x: COL, y: 0 },
      });
      const notifyPerson = mk({
        kind: 'action',
        type: 'talk.notify_person',
        config: {
          who: 'author',
          userId: '',
          message: 'Sua tarefa #{{issue.id}} {{issue.subject}} foi concluída.',
          onError: 'continue',
        },
        position: { x: COL, y: ROW },
      });
      trigger.nextIds = [notifyPerson.id];
      return [trigger, notifyPerson];
    },
  },
];
