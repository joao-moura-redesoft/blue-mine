/// <reference types="vite/client" />

/**
 * Variáveis de build expostas ao frontend. Vivem no `.env` da raiz do repo
 * (o Vite lê de lá via `envDir` — ver vite.config.ts) e são embutidas no bundle
 * durante o `vite build`. Consumidas por `utils/appDefaults.ts`.
 *
 * Só o prefixo `VITE_` chega ao cliente. Não declare segredo aqui.
 */
interface ImportMetaEnv {
  /** URL base do Redmine, ex.: https://redmine.b2click.com */
  readonly VITE_REDMINE_URL?: string;
  /** URL do Nextcloud (Talk/Drive/Notas), ex.: https://drive.b2click.com */
  readonly VITE_NEXTCLOUD_URL?: string;
  /** Host do Zimbra, só o domínio, ex.: email.redesoft.org */
  readonly VITE_ZIMBRA_HOST?: string;
  /** Domínio do Jitsi, ex.: meet.b2click.com */
  readonly VITE_JITSI_DOMAIN?: string;
  /** Host do DokuWiki, só o domínio, ex.: wiki.redesoft.com.br */
  readonly VITE_DOKUWIKI_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
