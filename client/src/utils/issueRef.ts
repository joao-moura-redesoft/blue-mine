/**
 * Referências a tarefas do Redmine dentro de texto livre (#92313).
 *
 * Nem todo "#número" é tarefa: descrições e notas vêm cheias de numeração solta
 * ("item #012", "versão #3", "chamado #4"). Só vira link o que tem cara de ID
 * desta instância — 5 dígitos ou mais e sem zero à esquerda (#NNNNN, #NNNNNN).
 * O resto continua texto puro.
 *
 * Se um dia a instância passar dos 999999, o padrão já cobre (o mínimo é fixo,
 * o máximo é aberto); para afrouxar/apertar, mexa só em ISSUE_REF_DIGITS.
 */

/** Primeiro dígito não-zero + pelo menos mais 4 (total ≥ 5). */
const ISSUE_REF_DIGITS = '[1-9]\\d{4,}';

// Antes: nada de letra/dígito/_ (evita "abc#12345"), nem "&#" (entidade HTML
// tipo &#128512;) e nem "##". Depois: nada de letra/dígito (evita "#12345abc").
const ISSUE_REF_PATTERN = `(?<![\\w&#])#(${ISSUE_REF_DIGITS})(?!\\w)`;

/** Regex global nova a cada chamada (lastIndex é estado — não compartilhe). */
export function issueRefRegex(): RegExp {
  return new RegExp(ISSUE_REF_PATTERN, 'g');
}

/** O número tem cara de ID de tarefa? (mesma regra da regex, para IDs já extraídos) */
export function isIssueRef(id: number | string): boolean {
  return new RegExp(`^${ISSUE_REF_DIGITS}$`).test(String(id));
}
