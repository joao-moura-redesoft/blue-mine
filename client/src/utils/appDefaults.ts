/**
 * Endereços dos sistemas corporativos, definidos no build.
 *
 * Motivação: URL do Redmine, Nextcloud, Zimbra e Jitsi são as MESMAS para toda
 * a empresa, mas cada usuário tinha que digitá-las na primeira execução — fonte
 * garantida de erro de digitação e de chamado de suporte.
 *
 * Como funciona: os valores saem do `.env` da raiz do repositório na hora do
 * `vite build` (ver `envDir` em vite.config.ts) e ficam embutidos no bundle —
 * e portanto dentro do próprio bluemine.exe. O usuário recebe só o executável e
 * já abre tudo preenchido; não há arquivo de configuração para distribuir nem
 * para o usuário apagar sem querer.
 *
 * Trava: um campo só fica read-only quando a variável correspondente foi
 * definida no build. Sem ela, o campo continua editável normalmente — assim um
 * build sem `.env` (ou de outra empresa) segue utilizável, em vez de travar o
 * login num valor vazio.
 *
 * Importante: só variáveis com prefixo `VITE_` chegam ao frontend. É proposital
 * — impede que segredos do servidor (tokens de update, chaves) vazem para o
 * bundle por descuido. Nunca use este arquivo para segredo: o conteúdo é
 * legível por qualquer um que abra o .exe.
 */

/** Um valor de configuração e se ele veio travado do build. */
export interface AppDefault {
  /** Valor definido no build; '' quando não configurado. */
  value: string;
  /** true quando o build definiu o valor — a UI deve exibir o campo read-only. */
  locked: boolean;
}

function readDefault(raw: string | undefined): AppDefault {
  const value = (raw ?? '').trim();
  return { value, locked: !!value };
}

export const appDefaults = {
  /** URL base do Redmine — tela de login. */
  redmineUrl: readDefault(import.meta.env.VITE_REDMINE_URL),
  /** URL do Nextcloud — usada por Talk, Drive e Notas. */
  nextcloudUrl: readDefault(import.meta.env.VITE_NEXTCLOUD_URL),
  /** Host do Zimbra (só o domínio, sem https://) — aba E-mail. */
  zimbraHost: readDefault(import.meta.env.VITE_ZIMBRA_HOST),
  /** Domínio do servidor Jitsi — videochamadas. */
  jitsiDomain: readDefault(import.meta.env.VITE_JITSI_DOMAIN),
  /** Host do DokuWiki (só o domínio) — exibição e links "abrir no DokuWiki". */
  dokuwikiHost: readDefault(import.meta.env.VITE_DOKUWIKI_HOST),
} as const;

/** Host do DokuWiki para exibir/linkar. '' quando não configurado no build. */
export const dokuwikiHost = appDefaults.dokuwikiHost.value;

/** URL de uma página do DokuWiki; '' se o host não foi configurado. */
export function dokuwikiPageUrl(id: string): string {
  if (!dokuwikiHost) return '';
  return `https://${dokuwikiHost}/doku.php?id=${encodeURIComponent(id)}`;
}

export type AppDefaultKey = keyof typeof appDefaults;

/**
 * URL de uma tarefa no Redmine web.
 *
 * Prefere a URL com que o usuário realmente entrou (`base`) — é ela que vale
 * para a sessão em curso; o valor do build é só a reserva. '' quando não há
 * nenhuma das duas, e aí o link não deve ser exibido.
 */
export function redmineIssueUrl(issueId: number | undefined, base?: string): string {
  const root = (base || appDefaults.redmineUrl.value).replace(/\/$/, '');
  if (!root || !issueId) return '';
  return `${root}/issues/${issueId}`;
}

/** Texto do cadeado, igual em todos os campos travados. */
export const LOCKED_HINT = 'Definido pela sua organização no build do aplicativo.';
