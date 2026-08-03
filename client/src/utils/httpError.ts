/**
 * Acesso tipado ao erro de request.
 *
 * Toda tela que trata falha de chamada lia `err.response.data.error` com o
 * parâmetro tipado como `any`, o que desliga a checagem no bloco inteiro do
 * catch — justamente onde o código é menos exercitado. Aqui o `unknown` é
 * estreitado uma vez só, e as telas usam os acessores abaixo.
 *
 * O formato cobre axios (`response.status`, `response.data`) e o corpo que o
 * nosso servidor devolve: `{ error: string }` no geral e `{ errors: string[] }`
 * quando é validação repassada do Redmine.
 */

export interface ApiErrorBody {
  error?: string;
  errors?: string[];
  message?: string;
}

export interface ApiError {
  response?: { status?: number; data?: ApiErrorBody };
  message?: string;
  /** Código do axios quando a request nem chegou a ter resposta. */
  code?: string;
}

/** Reinterpreta um erro desconhecido no formato acima. Nunca lança. */
export function asApiError(err: unknown): ApiError {
  return (err ?? {}) as ApiError;
}

/** Status HTTP da resposta, se o erro veio de uma request. */
export function errorStatus(err: unknown): number | undefined {
  return asApiError(err).response?.status;
}

/** Campo `error` do corpo — a mensagem pronta que o servidor mandou. */
export function errorDetail(err: unknown): string | undefined {
  const detail = asApiError(err).response?.data?.error;
  return typeof detail === 'string' && detail ? detail : undefined;
}

/** Campo `errors` do corpo — lista de validação do Redmine. */
export function errorList(err: unknown): string[] | undefined {
  const list = asApiError(err).response?.data?.errors;
  return Array.isArray(list) && list.length ? list : undefined;
}

/** Mensagem do próprio objeto de erro (rede fora do ar, timeout, etc). */
export function errorMessage(err: unknown): string | undefined {
  const msg = asApiError(err).message;
  return typeof msg === 'string' && msg ? msg : undefined;
}

/** true quando a request sequer alcançou o servidor. */
export function isNetworkError(err: unknown): boolean {
  return asApiError(err).code === 'ERR_NETWORK';
}
