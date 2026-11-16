import { FIELD_LABELS, type FrenteRule } from '../../api/frentes';

// "Área é Módulo Consync", "Título contém ifood" — para explicar por que a
// tarefa caiu numa frente.
export function describeRule(r: Pick<FrenteRule, 'field' | 'op' | 'value' | 'label'>): string {
  const op = r.field === 'area' || r.field === 'natureza' || r.op === 'eq' ? 'é' : 'contém';
  return `${FIELD_LABELS[r.field]} ${op} "${r.label || r.value}"`;
}
