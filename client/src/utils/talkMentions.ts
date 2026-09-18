/**
 * Menções do Talk: dois textos para a mesma mensagem.
 *
 * O que a pessoa escreve e lê é "@João Victor Nunes de Moura"; o que vai para o
 * servidor é "@<id do usuário>" — que aqui é o UUID do LDAP, não o login (ver
 * [[talk-actor-id-uuid]]). O Nextcloud resolve a menção pelo id, guarda como
 * parâmetro da mensagem e devolve o nome de volta, então essa tradução só
 * precisa acontecer na hora de enviar.
 */
export type MentionMap = Record<string, string>; // nome exibido → actorId

// Id "simples" vai sem aspas — é a forma que já era enviada e que o servidor
// resolve. Qualquer coisa fora disso (espaço, acento) usa a forma citada.
const SIMPLE_ID = /^[\w.@-]+$/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Texto de exibição → texto do servidor. */
export function applyMentions(text: string, map: MentionMap): string {
  // Nome mais longo primeiro: "Ana Maria" tem que casar antes de "Ana".
  const names = Object.keys(map).sort((a, b) => b.length - a.length);
  let out = text;
  for (const name of names) {
    const id = map[name];
    if (!id || !name) continue;
    const mention = SIMPLE_ID.test(id) ? `@${id}` : `@"${id}"`;
    out = out.replace(new RegExp(`@${escapeRe(name)}`, 'g'), mention);
  }
  return out;
}

/**
 * Fatia o texto em trechos comuns e trechos "@Nome" já escolhidos na lista —
 * usado para desenhar o realce atrás da caixa de mensagem.
 */
export function mentionSegments(
  text: string,
  mentions: MentionMap,
): { t: string; isMention: boolean }[] {
  const labels = Object.keys(mentions)
    .filter(Boolean) // nome vazio viraria alternativa que casa com tudo
    .sort((a, b) => b.length - a.length)
    .map(escapeRe);
  if (labels.length === 0) return [{ t: text, isMention: false }];
  const re = new RegExp(`(@(?:${labels.join('|')}))`, 'g');
  return text.split(re).map((t, i) => ({ t, isMention: i % 2 === 1 }));
}

type Param = { type?: string; id?: string; name?: string; 'mention-id'?: string };

/**
 * Mapa a partir dos parâmetros de uma mensagem já enviada — usado ao EDITAR:
 * o editor abre com "@Nome" (expandido de {mention-user1}) e precisa saber
 * voltar para o id, senão a edição transforma a menção em texto solto.
 */
export function mentionsFromParams(params?: Record<string, Param>): MentionMap {
  const map: MentionMap = {};
  for (const p of Object.values(params ?? {})) {
    if (!p?.name) continue;
    // "call" é a menção a todos os participantes: volta como @all, não como o
    // token da sala.
    if (p.type === 'call') map[p.name] = 'all';
    else if (p.type === 'user') {
      const id = p['mention-id'] ?? p.id;
      if (id) map[p.name] = id;
    }
  }
  return map;
}
