import { mailApi, type InlineAttachment } from '../api/mail';

// Converte as imagens embutidas como data URI no corpo do e-mail (rodapé
// padrão, logo colada) em anexos inline referenciados por `cid:`.
//
// Por que não deixar o data URI: Gmail e Outlook descartam <img src="data:">,
// então o rodapé simplesmente sumiria para boa parte dos destinatários. O
// caminho que funciona em todo lugar é a imagem viajar como parte MIME dentro
// de multipart/related, com Content-ID — que é o que o servidor monta a partir
// de `inlineAttachments`.

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } | null {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  const meta = dataUrl.slice('data:'.length, comma);
  const payload = dataUrl.slice(comma + 1);
  const contentType = meta.split(';')[0] || 'application/octet-stream';
  try {
    const raw = /;base64/i.test(meta) ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return { bytes, contentType };
  } catch {
    return null;
  }
}

function newCid(): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${rand}@bluemine`;
}

/**
 * Sobe ao Zimbra cada imagem em data URI do HTML e devolve o corpo com os
 * `src` trocados por `cid:…`, junto da lista de anexos inline correspondente.
 *
 * Imagens idênticas repetidas são enviadas uma única vez. Se o upload de uma
 * imagem falhar, ela é deixada como está em vez de abortar o envio inteiro —
 * perder o rodapé é melhor do que perder a mensagem.
 */
export async function inlineDataImages(
  html: string,
): Promise<{ html: string; inlineAttachments: InlineAttachment[] }> {
  if (!html || !html.includes('data:image')) return { html, inlineAttachments: [] };

  const found = new Set<string>();
  const srcRe = /src\s*=\s*(["'])(data:image\/[^"']+)\1/gi;
  for (const m of html.matchAll(srcRe)) found.add(m[2]);
  if (found.size === 0) return { html, inlineAttachments: [] };

  const inlineAttachments: InlineAttachment[] = [];
  const cidByDataUrl = new Map<string, string>();

  let index = 0;
  for (const dataUrl of found) {
    const decoded = dataUrlToBytes(dataUrl);
    if (!decoded) continue;
    const ext = EXT_BY_TYPE[decoded.contentType] || 'img';
    try {
      const up = await mailApi.uploadBytes(
        decoded.bytes,
        `imagem-${++index}.${ext}`,
        decoded.contentType,
      );
      const cid = newCid();
      cidByDataUrl.set(dataUrl, cid);
      inlineAttachments.push({ aid: up.aid, cid, contentType: decoded.contentType });
    } catch {
      /* mantém o data URI original — ver docstring */
    }
  }

  const out = html.replace(srcRe, (full, quote: string, dataUrl: string) => {
    const cid = cidByDataUrl.get(dataUrl);
    return cid ? `src=${quote}cid:${cid}${quote}` : full;
  });

  return { html: out, inlineAttachments };
}
