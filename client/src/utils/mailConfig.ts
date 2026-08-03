import { hasEffectiveCreds, needsADCreds } from './adConfig';
import { appDefaults } from './appDefaults';

const KEY = 'rk_mail_config';
/**
 * Host do Zimbra usado quando o usuário não definiu nada. Vem do build
 * (VITE_ZIMBRA_HOST); '' se o build não configurou — nesse caso o servidor
 * responde 503 com instrução, em vez de tentar uma URL malformada.
 */
export const DEFAULT_HOST = appDefaults.zimbraHost.value;

// Modelo de e-mail reutilizável, escolhido no compositor. `bodyHtml` é HTML
// (produzido pelo editor rico).
export interface MailTemplate {
  id: string;
  name: string;
  subject?: string;
  bodyHtml: string;
}

// Imagem de rodapé padrão (banner/logo) anexada abaixo da assinatura em toda
// mensagem nova. Guardamos os bytes como data URI; no envio ela é subida ao
// Zimbra e vira anexo inline (cid:), que é o que os clientes de e-mail exibem
// sem o destinatário precisar liberar imagens externas.
export interface MailFooterImage {
  dataUrl: string;
  filename: string;
  contentType: string;
  /** Largura de exibição em px. Vazio = tamanho natural da imagem. */
  width?: number;
}

export interface MailConfig {
  host?: string;
  // Assinatura/rodapé em HTML, aplicada automaticamente em novas mensagens.
  signature?: string;
  footerImage?: MailFooterImage | null;
  templates?: MailTemplate[];
}

// Lê o objeto cru do localStorage (sem descartar campos, ao contrário do
// getMailConfig legado que só devolvia host).
function readRaw(): MailConfig {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as MailConfig;
  } catch {
    return {};
  }
}

export function getMailConfig(): MailConfig {
  return readRaw();
}

export function saveMailConfig(cfg: MailConfig) {
  const existing = readRaw();
  localStorage.setItem(
    KEY,
    JSON.stringify({ ...existing, host: (cfg.host || '').trim() || DEFAULT_HOST }),
  );
}

export function getSignature(): string {
  return readRaw().signature || '';
}

export function saveSignature(html: string) {
  const existing = readRaw();
  localStorage.setItem(KEY, JSON.stringify({ ...existing, signature: html || '' }));
}

export function getFooterImage(): MailFooterImage | null {
  const f = readRaw().footerImage;
  return f && f.dataUrl ? f : null;
}

export function saveFooterImage(img: MailFooterImage | null) {
  const existing = readRaw();
  localStorage.setItem(KEY, JSON.stringify({ ...existing, footerImage: img }));
}

/**
 * Rodapé de imagem como HTML, pronto para entrar no corpo. O `src` sai como
 * data URI e é convertido em `cid:` na hora do envio (ver inlineDataImages).
 */
export function getFooterImageHtml(): string {
  const img = getFooterImage();
  if (!img) return '';
  const width = img.width ? ` width="${img.width}"` : '';
  return `<img src="${img.dataUrl}" alt=""${width}>`;
}

export function getTemplates(): MailTemplate[] {
  const t = readRaw().templates;
  return Array.isArray(t) ? t : [];
}

export function saveTemplates(list: MailTemplate[]) {
  const existing = readRaw();
  localStorage.setItem(KEY, JSON.stringify({ ...existing, templates: list }));
}

export function clearMailConfig() {
  localStorage.removeItem(KEY);
}

export function getMailHost(): string {
  // O host definido no build vence o que estiver salvo: se a organização fixou
  // o servidor, um valor antigo em localStorage não pode continuar em uso.
  const fixed = appDefaults.zimbraHost;
  if (fixed.locked) return fixed.value;
  return getMailConfig().host || DEFAULT_HOST;
}

export function isMailAvailable(): boolean {
  return hasEffectiveCreds();
}

export function needsMailConfig(): boolean {
  return needsADCreds();
}
