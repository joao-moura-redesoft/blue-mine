import { createAuthedClient } from './client';

// Frentes: "o que a tarefa é" (CRM, Consync, iFood…), calculada por regras sobre
// campos do Redmine. Configuração pessoal, guardada no servidor.

// Campos do Redmine que uma regra pode olhar. `area` e `natureza` são listas:
// a regra guarda o ID da opção e o nome só como rótulo.
export type RuleField = 'titulo' | 'area' | 'natureza' | 'versao' | 'projeto';
export type RuleOp = 'eq' | 'has';

export interface Frente {
  id: string;
  name: string;
  color: string;
  /** Nome da Área do Redmine que corresponde a esta frente (sugestão). */
  area?: string;
  /** Some do quadro, a menos que o filtro de frente a inclua. */
  hidden?: boolean;
  archived?: boolean;
}

export interface FrenteRule {
  id: string;
  field: RuleField;
  op: RuleOp;
  value: string;
  /** Nome legível do `value` (campos de lista). */
  label?: string;
  frente: string;
  on: boolean;
}

export interface FrentesConfig {
  frentes: Frente[];
  rules: FrenteRule[];
  /** { [issueId]: frenteId } — escolhas suas, que vencem as regras. */
  manual: Record<string, string>;
  /** Frente que recebe o que nenhuma regra classificou (null = fila "sem frente"). */
  fallback: string | null;
  /** false = ainda é o padrão, nada gravado. */
  customized: boolean;
}

export interface FieldOption {
  value: string;
  label: string;
}

export interface FrenteFieldOptions {
  area: FieldOption[];
  natureza: FieldOption[];
}

export type FrentesDraft = Pick<FrentesConfig, 'frentes' | 'rules' | 'fallback'>;

export const FIELD_LABELS: Record<RuleField, string> = {
  titulo: 'Título',
  area: 'Área',
  natureza: 'Natureza',
  versao: 'Versão',
  projeto: 'Projeto',
};

const api = createAuthedClient();

export async function fetchFrentes(): Promise<FrentesConfig> {
  const { data } = await api.get<FrentesConfig>('/frentes');
  return data;
}

export async function saveFrentes(draft: FrentesDraft): Promise<FrentesConfig> {
  const { data } = await api.put<FrentesConfig>('/frentes', draft);
  return data;
}

export async function resetFrentes(): Promise<FrentesConfig> {
  const { data } = await api.post<FrentesConfig>('/frentes/reset');
  return data;
}

/** frenteId = null devolve a tarefa para a classificação automática. */
export async function setManualFrente(
  issueId: number,
  frenteId: string | null,
): Promise<FrentesConfig> {
  const { data } = await api.put<FrentesConfig>(`/frentes/manual/${issueId}`, {
    frente: frenteId,
  });
  return data;
}

export async function fetchFrenteOptions(): Promise<FrenteFieldOptions> {
  const { data } = await api.get<FrenteFieldOptions>('/frentes/options');
  return data;
}
