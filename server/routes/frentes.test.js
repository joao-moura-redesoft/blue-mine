/**
 * Frentes de ponta a ponta: store em disco (pasta temporária, cofre por chave de
 * ambiente), rotas /frentes e a anotação em /issues e /issues/:id, contra um
 * Redmine falso em HTTP. Pega o que o teste da função pura não pega: rota fora
 * de ordem, frente que não chega na resposta, escolha manual que não persiste.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bluemine-frentes-'));
process.env.BLUEMINE_DATA_DIR = tmp;
process.env.BLUEMINE_VAULT_KEY = crypto.randomBytes(32).toString('base64');

// Tarefas do "Redmine": Área 160 (Consync), título com iFood, e uma sem regra.
const ISSUES = [
  { id: 101, subject: 'ERRO CONSIYNC/ALUGUEL', custom_fields: [{ id: 111, value: '160' }] },
  { id: 102, subject: 'iFood: homologação', custom_fields: [{ id: 111, value: '205' }] },
  { id: 103, subject: 'Orquestrador', custom_fields: [{ id: 111, value: '999' }] },
];

const EDIT_FORM = `<form id="issue-form">
  <p><label for="issue_custom_field_values_111">DEV/SUP Área <span class="required">*</span></label>
  <select id="issue_custom_field_values_111"><option value="">--- Selecione ---</option>
  <option value="160">Módulo Consync</option><option value="275">CRM Redesoft</option></select></p>
  <p><label for="issue_custom_field_values_113">DEV/SUP Natureza</label>
  <select id="issue_custom_field_values_113"><option value="167">Defeito</option>
  <option value="273">Projeto</option></select></p></form>`;

let redmine;
let app;
let base;
const headers = (url) => ({
  'x-redmine-url': url,
  'x-redmine-key': 'k',
  'content-type': 'application/json',
});
let H;

beforeAll(async () => {
  redmine = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (o) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(o));
    };
    if (u.pathname === '/users/current.json') return json({ user: { id: 7 } });
    if (u.pathname === '/issues.json') {
      const offset = Number(u.searchParams.get('offset') || 0);
      return json({ issues: offset ? [] : ISSUES, total_count: ISSUES.length });
    }
    if (u.pathname === '/issues/101.json') return json({ issue: ISSUES[0] });
    if (u.pathname === '/issues/101') {
      res.setHeader('content-type', 'text/html');
      return res.end(EDIT_FORM);
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => redmine.listen(0, '127.0.0.1', r));
  H = headers(`http://127.0.0.1:${redmine.address().port}`);

  // Importa DEPOIS de fixar o ambiente: os stores leem a pasta de dados no load.
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const frentesRouter = require('./frentes.js');
  const issuesRouter = require('./issues.js');
  app = express();
  app.use(express.json());
  app.use('/api', issuesRouter);
  app.use('/api', frentesRouter);
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  app.locals.srv = srv;
  base = `http://127.0.0.1:${srv.address().port}/api`;
});

afterAll(async () => {
  await new Promise((r) => app.locals.srv.close(r));
  await new Promise((r) => redmine.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

const get = async (p) => (await fetch(base + p, { headers: H })).json();
const send = async (method, p, body) => {
  const r = await fetch(base + p, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
};
const frenteOf = (list, id) => list.find((i) => i.id === id).frente;

describe('frentes ponta a ponta', () => {
  it('usuário novo recebe a configuração padrão, sem nada gravado', async () => {
    const cfg = await get('/frentes');
    expect(cfg.customized).toBe(false);
    expect(cfg.frentes.map((f) => f.id)).toContain('consync');
    expect(fs.existsSync(path.join(tmp, 'frentes.json'))).toBe(false);
  });

  it('/issues volta com a frente de cada tarefa', async () => {
    const { issues } = await get('/issues');
    expect(frenteOf(issues, 101)).toMatchObject({ id: 'consync', name: 'Consync', src: 'regra' });
    expect(frenteOf(issues, 102)).toMatchObject({ id: 'ifood', src: 'regra' });
    expect(frenteOf(issues, 103)).toBeNull();
  });

  it('/issues/:id (detalhe) também traz a frente', async () => {
    const { issue } = await get('/issues/101');
    expect(issue.frente).toMatchObject({ id: 'consync' });
  });

  it('escolha manual persiste e vence a regra', async () => {
    const r = await send('PUT', '/frentes/manual/101', { frente: 'crm' });
    expect(r.status).toBe(200);
    expect(r.body.customized).toBe(true);
    const { issues } = await get('/issues');
    expect(frenteOf(issues, 101)).toMatchObject({ id: 'crm', src: 'manual' });
    expect(fs.existsSync(path.join(tmp, 'frentes.json'))).toBe(true);
  });

  it('"voltar ao automático" devolve a decisão para as regras', async () => {
    await send('PUT', '/frentes/manual/101', { frente: null });
    const { issues } = await get('/issues');
    expect(frenteOf(issues, 101)).toMatchObject({ id: 'consync', src: 'regra' });
  });

  it('recusa frente inexistente e tarefa inválida', async () => {
    expect((await send('PUT', '/frentes/manual/101', { frente: 'fantasma' })).status).toBe(400);
    expect((await send('PUT', '/frentes/manual/abc', { frente: 'crm' })).status).toBe(400);
  });

  it('PUT /frentes troca regras e mantém as escolhas manuais', async () => {
    await send('PUT', '/frentes/manual/103', { frente: 'avulsas' });
    const cfg = await get('/frentes');
    const rules = cfg.rules.filter((r) => r.id !== 'r-ifood-titulo');
    const r = await send('PUT', '/frentes', { frentes: cfg.frentes, rules, fallback: null });
    expect(r.body.rules.some((x) => x.id === 'r-ifood-titulo')).toBe(false);
    expect(r.body.manual).toEqual({ 103: 'avulsas' });
    const { issues } = await get('/issues');
    expect(frenteOf(issues, 102)).toMatchObject({ id: 'integracoes', src: 'regra' });
    expect(frenteOf(issues, 103)).toMatchObject({ id: 'avulsas', src: 'manual' });
  });

  it('PUT /frentes sem as listas é recusado e não apaga nada', async () => {
    const antes = await get('/frentes');
    expect((await send('PUT', '/frentes', {})).status).toBe(400);
    expect((await send('PUT', '/frentes', { frentes: antes.frentes })).status).toBe(400);
    const depois = await get('/frentes');
    expect(depois.frentes).toHaveLength(antes.frentes.length);
    expect(depois.manual).toEqual(antes.manual);
  });

  it('apagar uma frente leva embora as escolhas manuais dela', async () => {
    const cfg = await get('/frentes');
    const frentes = cfg.frentes.filter((f) => f.id !== 'avulsas');
    const r = await send('PUT', '/frentes', { frentes, rules: cfg.rules, fallback: null });
    expect(r.body.manual).toEqual({});
  });

  it('reset restaura frentes e regras e preserva as escolhas manuais', async () => {
    await send('PUT', '/frentes/manual/101', { frente: 'crm' });
    const r = await send('POST', '/frentes/reset');
    expect(r.body.rules.some((x) => x.id === 'r-ifood-titulo')).toBe(true);
    expect(r.body.manual).toEqual({ 101: 'crm' });
  });

  it('/frentes/options lê nomes de Área e Natureza do formulário de edição', async () => {
    const opts = await get('/frentes/options');
    expect(opts.area).toEqual([
      { value: '160', label: 'Módulo Consync' },
      { value: '275', label: 'CRM Redesoft' },
    ]);
    expect(opts.natureza.map((o) => o.label)).toEqual(['Defeito', 'Projeto']);
  });
});
