import type { Issue } from '../types/redmine';

/**
 * Colunas "acompanhadas" do board: tarefas ligadas a mim que estão com outra
 * pessoa (ex.: Pendente Revisão, atribuída à revisora). Três fontes:
 *  - dev:      sou o DEV Desenvolvedor (a lista da tela de Monitoramento);
 *  - authored: fui eu que criei;
 *  - watched:  marquei como observada no Bluemine (lista local).
 * Sem projeto escolhido as três já estão em cache no app (nenhuma busca a
 * mais); com projeto, o board pede o recorte ao servidor, que inclui os
 * subprojetos.
 *
 * Preferência local do navegador, como as colunas fixadas e as cores.
 */
export type FollowSource = 'dev' | 'authored' | 'watched';

export const FOLLOW_SOURCES: { id: FollowSource; label: string; badge: string }[] = [
  { id: 'dev', label: 'Sou o DEV', badge: 'Sou DEV' },
  { id: 'authored', label: 'Criadas por mim', badge: 'Criada por mim' },
  { id: 'watched', label: 'Observadas', badge: 'Observada' },
];

export interface FollowConfig {
  /** Acompanhar em qualquer status (ignora `statusIds`). */
  all: boolean;
  /** Status acompanhados; também ficam visíveis no board mesmo vazios. */
  statusIds: number[];
  /** Esconde tudo de uma vez sem perder a escolha (botão da barra). */
  hidden: boolean;
  /** Fontes ligadas. Configuração antiga (sem o campo) = só DEV, como era. */
  sources: Record<FollowSource, boolean>;
}

export const FOLLOW_KEY = 'kanban-followed';

const DEFAULT_SOURCES: Record<FollowSource, boolean> = {
  dev: true,
  authored: false,
  watched: false,
};

const EMPTY: FollowConfig = { all: false, statusIds: [], hidden: false, sources: DEFAULT_SOURCES };

export function loadFollowConfig(): FollowConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLLOW_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return EMPTY;
    const src = raw.sources && typeof raw.sources === 'object' ? raw.sources : {};
    return {
      all: raw.all === true,
      statusIds: Array.isArray(raw.statusIds)
        ? raw.statusIds.filter((n: unknown): n is number => typeof n === 'number')
        : [],
      hidden: raw.hidden === true,
      sources: {
        dev: typeof src.dev === 'boolean' ? src.dev : DEFAULT_SOURCES.dev,
        authored: src.authored === true,
        watched: src.watched === true,
      },
    };
  } catch {
    return EMPTY;
  }
}

export function saveFollowConfig(cfg: FollowConfig) {
  try {
    localStorage.setItem(FOLLOW_KEY, JSON.stringify(cfg));
  } catch {
    /* sem storage: só não lembra para a próxima */
  }
}

/** Há alguma coluna acompanhada configurada (ligada ou escondida)? */
export const hasFollowSetup = (cfg: FollowConfig) =>
  (cfg.all || cfg.statusIds.length > 0) && Object.values(cfg.sources).some(Boolean);

export type FollowSourceLists = Partial<Record<FollowSource, Issue[] | undefined>>;

export interface FollowedSelection {
  issues: Issue[];
  /** Por que cada tarefa está ali (a primeira fonte que a trouxe, na ordem dev → criada → observada). */
  reasons: Map<number, FollowSource>;
}

/**
 * Candidatas a acompanhada: a união das fontes ligadas, sem repetir, fora o
 * que já é meu (a tarefa voltou para mim e virou card normal — as listas
 * podem estar um ciclo de polling atrasadas) e o que estiver fechado.
 * `respectStatuses: false` ignora a escolha de status (contagens do menu).
 */
export function collectFollowed(
  lists: FollowSourceLists,
  cfg: FollowConfig,
  myIssueIds: Set<number>,
  isClosed: (i: Issue) => boolean,
  respectStatuses = true,
): FollowedSelection {
  const issues: Issue[] = [];
  const reasons = new Map<number, FollowSource>();
  const statuses = new Set(cfg.statusIds);
  for (const { id: source } of FOLLOW_SOURCES) {
    if (!cfg.sources[source]) continue;
    for (const i of lists[source] ?? []) {
      if (reasons.has(i.id) || myIssueIds.has(i.id) || isClosed(i)) continue;
      if (respectStatuses && !cfg.all && !statuses.has(i.status.id)) continue;
      reasons.set(i.id, source);
      issues.push(i);
    }
  }
  return { issues, reasons };
}
