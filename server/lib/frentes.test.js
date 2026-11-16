/**
 * Classificação em frentes. Os casos vêm das tarefas reais: "CONSIYNC" escrito
 * errado só cai certo pela Área, o iFood só existe no título, a Área numérica
 * ("160") é o que a API devolve, e a escolha manual vence qualquer regra.
 */
import { describe, it, expect } from 'vitest';
import {
  norm,
  ruleMatches,
  classifyIssue,
  annotateIssues,
  alsoMatching,
  defaultConfig,
  sanitizeConfig,
} from './frentes.js';

// IDs dos campos custom vêm de REDMINE_CF (111 = Área, 113 = Natureza).
const issue = (over = {}) => ({
  id: 1,
  subject: 'Tarefa qualquer',
  project: { id: 1, name: 'DESENVOLVIMENTO - ATIVIDADES INTERNAS' },
  custom_fields: [],
  ...over,
});
const area = (value) => ({ id: 111, name: 'DEV/SUP Área', value });

describe('norm', () => {
  it('ignora acento, caixa e espaços repetidos', () => {
    expect(norm('  Módulo   CONSYNC ')).toBe('modulo consync');
    expect(norm(null)).toBe('');
  });
});

describe('classifyIssue com a configuração padrão', () => {
  const cfg = defaultConfig();
  const frenteOf = (i) => classifyIssue(i, cfg)?.id ?? null;

  it('Área numérica casa pelo ID da opção', () => {
    expect(frenteOf(issue({ custom_fields: [area('160')] }))).toBe('consync');
    expect(frenteOf(issue({ custom_fields: [area('275')] }))).toBe('crm');
    expect(frenteOf(issue({ custom_fields: [area('276')] }))).toBe('implantacao');
    expect(frenteOf(issue({ custom_fields: [area('164')] }))).toBe('dashboards');
  });

  it('"CONSIYNC" (erro de digitação) cai em Consync pela Área, não pelo título', () => {
    const t = issue({ subject: 'ERRO CONSIYNC/ALUGUEL MAQUINETAS', custom_fields: [area('160')] });
    expect(classifyIssue(t, cfg)).toMatchObject({
      id: 'consync',
      src: 'regra',
      ruleId: 'r-consync-area',
    });
  });

  it('iFood só se acha pelo título (a Área é a genérica "Integração com Terceiros")', () => {
    const t = issue({
      subject: '[Ordem 2/3] iFood: collection de homologação',
      custom_fields: [area('205')],
    });
    expect(frenteOf(t)).toBe('ifood');
    // Sem "iFood" no título sobra a Área genérica, que agora tem frente própria.
    expect(frenteOf(issue({ custom_fields: [area('205')] }))).toBe('integracoes');
  });

  it('Versão casa por "contém": versão nova do CRM continua valendo', () => {
    expect(frenteOf(issue({ fixed_version: { id: 9, name: 'b2click CRM' } }))).toBe('crm');
    expect(frenteOf(issue({ fixed_version: { id: 10, name: 'b2click CRM 2' } }))).toBe('crm');
  });

  it('pedido à infra vence o título que cita Consync', () => {
    const t = issue({
      subject: 'Atualizar banco do Consync na VM',
      project: { id: 2, name: 'REDES - SOLICITAÇÕES INTERNAS' },
    });
    expect(frenteOf(t)).toBe('infra');
  });

  it('sem regra que case devolve null', () => {
    expect(frenteOf(issue({ custom_fields: [area('999')] }))).toBeNull();
    expect(frenteOf(issue({ custom_fields: [{ id: 111, value: '' }] }))).toBeNull();
  });
});

describe('configuração padrão: frentes por Área e BI', () => {
  const cfg = defaultConfig();
  const REDES = { id: 9, name: 'REDES - SOLICITAÇÕES INTERNAS' };
  const frenteOf = (i) => classifyIssue(i, cfg)?.id ?? null;

  it('trabalho de BI aberto no projeto REDES não cai em "infra" (que é oculta)', () => {
    for (const subject of [
      'E12 - BI Redesign piloto: Módulo Operacional',
      'E03 - BI: período escrito diferente do período filtrado',
      'E04 - BI Capital de giro: ciclo financeiro diferente',
    ]) {
      expect(frenteOf(issue({ subject, project: REDES }))).toBe('dashboards');
    }
  });

  it('pedido à infra comum continua em "infra", mesmo citando um módulo', () => {
    expect(frenteOf(issue({ subject: 'Acesso claude', project: REDES }))).toBe('infra');
    expect(frenteOf(issue({ subject: 'Atualizar banco do Consync na VM', project: REDES }))).toBe(
      'infra',
    );
  });

  it('"- BICOS" não é BI', () => {
    expect(frenteOf(issue({ subject: 'PICHILAU - BICOS NAO APARECEM NA CONSULTA' }))).toBeNull();
  });

  it('cada Área grande vai para a sua frente', () => {
    const casos = {
      158: 'operacional',
      157: 'pdv',
      159: 'financeiro',
      161: 'fiscal',
      205: 'integracoes',
      209: 'pos',
      250: 'pos',
      269: 'redesoft',
      274: 'redesoft',
      165: 'apis',
      247: 'estacionamento',
      162: 'outros',
      249: 'outros',
    };
    for (const [id, frente] of Object.entries(casos)) {
      expect(frenteOf(issue({ custom_fields: [area(id)] })), `Área ${id}`).toBe(frente);
    }
  });

  it('as frentes específicas ganham da Área genérica', () => {
    // iFood é "Integração com Terceiros" na Área, mas o título decide.
    expect(frenteOf(issue({ subject: 'iFood: homologação', custom_fields: [area('205')] }))).toBe(
      'ifood',
    );
    // Consync pela Área vence qualquer outra.
    expect(frenteOf(issue({ custom_fields: [area('160')] }))).toBe('consync');
  });

  it('toda regra aponta para uma frente que existe e os IDs são únicos', () => {
    const ids = new Set(cfg.frentes.map((f) => f.id));
    expect(cfg.rules.every((r) => ids.has(r.frente))).toBe(true);
    expect(new Set(cfg.rules.map((r) => r.id)).size).toBe(cfg.rules.length);
    expect(new Set(cfg.frentes.map((f) => f.id)).size).toBe(cfg.frentes.length);
  });
});

describe('prioridade: manual > regra > padrão', () => {
  const base = defaultConfig();

  it('escolha manual vence a regra', () => {
    const cfg = { ...base, manual: { 5: 'crm' } };
    const t = issue({ id: 5, custom_fields: [area('160')] });
    expect(classifyIssue(t, cfg)).toEqual({ id: 'crm', src: 'manual' });
  });

  it('manual para frente que não existe mais é ignorado', () => {
    const cfg = { ...base, manual: { 5: 'fantasma' } };
    expect(classifyIssue(issue({ id: 5, custom_fields: [area('160')] }), cfg).id).toBe('consync');
  });

  it('frente arquivada não recebe tarefa, nem por regra nem por escolha', () => {
    const frentes = base.frentes.map((f) => (f.id === 'consync' ? { ...f, archived: true } : f));
    const cfg = { ...base, frentes, manual: { 7: 'consync' } };
    expect(classifyIssue(issue({ id: 7 }), cfg)).toBeNull();
    expect(classifyIssue(issue({ custom_fields: [area('160')] }), cfg)).toBeNull();
  });

  it('regra desligada é pulada; a seguinte da mesma frente ainda pode casar', () => {
    const rules = base.rules.map((r) => (r.id === 'r-consync-area' ? { ...r, on: false } : r));
    const t = issue({ subject: 'Ajuste no consync web', custom_fields: [area('160')] });
    expect(classifyIssue(t, { ...base, rules })).toMatchObject({
      id: 'consync',
      ruleId: 'r-consync-titulo',
    });
  });

  it('frente-padrão pega o que sobrou', () => {
    const cfg = { ...base, fallback: 'avulsas' };
    expect(classifyIssue(issue(), cfg)).toEqual({ id: 'avulsas', src: 'padrao' });
  });
});

describe('ruleMatches', () => {
  it('campo de lista ignora "contém": "16" não casa com "160"', () => {
    const rule = { field: 'area', op: 'has', value: '16' };
    expect(ruleMatches(rule, issue({ custom_fields: [area('160')] }))).toBe(false);
  });

  it('casa pelo rótulo quando o ID mudou', () => {
    const rule = { field: 'area', op: 'eq', value: '999', label: 'Módulo Consync' };
    expect(ruleMatches(rule, issue({ custom_fields: [area('Modulo consync')] }))).toBe(true);
  });

  it('campo múltiplo: basta um valor', () => {
    const rule = { field: 'area', op: 'eq', value: '160' };
    expect(ruleMatches(rule, issue({ custom_fields: [area(['249', '160'])] }))).toBe(true);
  });

  it('valor vazio nunca casa (não vira "tudo")', () => {
    expect(ruleMatches({ field: 'titulo', op: 'has', value: '' }, issue())).toBe(false);
  });
});

describe('annotateIssues', () => {
  it('anexa nome e cor, sem mexer nos originais', () => {
    const cfg = defaultConfig();
    const original = issue({ id: 3, custom_fields: [area('275')] });
    const [a, b] = annotateIssues([original, issue({ id: 4 })], cfg);
    expect(a.frente).toEqual({
      id: 'crm',
      name: 'CRM',
      color: '#3b82f6',
      hidden: false,
      src: 'regra',
      ruleId: 'r-crm-area',
    });
    expect(b.frente).toBeNull();
    expect(original.frente).toBeUndefined();
  });

  it('frente oculta sai marcada para o quadro esconder', () => {
    const t = issue({ project: { id: 2, name: 'REDES - SOLICITAÇÕES INTERNAS' } });
    expect(annotateIssues([t], defaultConfig())[0].frente.hidden).toBe(true);
  });
});

describe('annotateIssues com withAlso', () => {
  it('o detalhe recebe as regras que perderam; a lista não', () => {
    const cfg = defaultConfig();
    const t = issue({ subject: 'iFood no consync', custom_fields: [area('160')] });
    const [detalhe] = annotateIssues([t], cfg, { withAlso: true });
    expect(detalhe.frente.also).toEqual(['r-consync-area', 'r-consync-titulo']);
    expect(annotateIssues([t], cfg)[0].frente.also).toBeUndefined();
  });
});

describe('alsoMatching', () => {
  it('lista regras de outras frentes que também casariam', () => {
    const cfg = defaultConfig();
    const t = issue({
      subject: 'iFood no consync',
      custom_fields: [area('160')],
    });
    const chosen = classifyIssue(t, cfg).id;
    expect(chosen).toBe('ifood'); // título vem antes na ordem
    expect(alsoMatching(t, cfg, chosen).map((r) => r.frente)).toEqual(['consync', 'consync']);
  });
});

describe('sanitizeConfig', () => {
  it('lixo vira configuração vazia, sem lançar', () => {
    expect(sanitizeConfig(null)).toEqual({ frentes: [], rules: [], manual: {}, fallback: null });
    expect(sanitizeConfig('x')).toEqual({ frentes: [], rules: [], manual: {}, fallback: null });
  });

  it('descarta regra que aponta para frente inexistente e campo desconhecido', () => {
    const cfg = sanitizeConfig({
      frentes: [{ id: 'a', name: 'A', color: '#112233' }],
      rules: [
        { field: 'titulo', op: 'has', value: 'x', frente: 'a' },
        { field: 'titulo', op: 'has', value: 'x', frente: 'zzz' },
        { field: 'assignee', op: 'eq', value: 'x', frente: 'a' },
        { field: 'titulo', op: 'has', value: '   ', frente: 'a' },
      ],
    });
    expect(cfg.rules).toHaveLength(1);
  });

  it('força "é" em campo de lista e corrige cor inválida', () => {
    const cfg = sanitizeConfig({
      frentes: [{ id: 'a', name: 'A', color: 'vermelho' }],
      rules: [{ field: 'area', op: 'has', value: '160', frente: 'a' }],
    });
    expect(cfg.rules[0].op).toBe('eq');
    expect(cfg.frentes[0].color).toBe('#94a3b8');
  });

  it('ids de frente e de regra repetidos não passam duas vezes', () => {
    const cfg = sanitizeConfig({
      frentes: [
        { id: 'a', name: 'A' },
        { id: 'a', name: 'Outra A' },
      ],
      rules: [
        { id: 'r', field: 'titulo', value: 'x', frente: 'a' },
        { id: 'r', field: 'titulo', value: 'y', frente: 'a' },
      ],
    });
    expect(cfg.frentes).toHaveLength(1);
    expect(new Set(cfg.rules.map((r) => r.id)).size).toBe(2);
  });

  it('manual: só IDs de tarefa numéricos apontando para frente existente', () => {
    const cfg = sanitizeConfig({
      frentes: [{ id: 'a', name: 'A' }],
      manual: { 90604: 'a', abc: 'a', 5: 'nao-existe' },
    });
    expect(cfg.manual).toEqual({ 90604: 'a' });
  });

  it('a configuração padrão atravessa a sanitização intacta', () => {
    const def = defaultConfig();
    const out = sanitizeConfig(def);
    expect(out.frentes).toHaveLength(def.frentes.length);
    expect(out.rules).toHaveLength(def.rules.length);
    expect(out.rules.map((r) => r.id)).toEqual(def.rules.map((r) => r.id));
  });
});
