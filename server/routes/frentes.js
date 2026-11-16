// FRENTES — classificação pessoal das tarefas por "o que são" (CRM, Consync…).
// Por usuário. A frente de cada tarefa é calculada em /issues (ver lib/frentes.js);
// aqui só se lê e grava a configuração.
const express = require('express');
const router = express.Router();
const { getMyUserId, makeRedmine, DEFAULT_URL, DEFAULT_KEY } = require('../lib/redmine');
const handle = require('../lib/handle');
const { defaultConfig } = require('../lib/frentes');
const store = require('../services/frentesStore');
const { getFieldOptions } = require('../services/frenteOptions');

const view = (uid) => ({ ...store.getConfig(uid), customized: store.isCustomized(uid) });

router.get(
  '/frentes',
  handle(async (req, res) => {
    res.json(view(await getMyUserId(req)));
  }),
);

// Substitui frentes, regras e frente-padrão. As escolhas manuais ficam como
// estão (o sanitize só descarta as que apontam para frente removida).
router.put(
  '/frentes',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    const body = req.body || {};
    // Corpo sem as listas não pode virar "apague tudo": o sanitize trataria
    // `undefined` como lista vazia e levaria as frentes e as escolhas manuais.
    if (!Array.isArray(body.frentes) || !Array.isArray(body.rules)) {
      return res.status(400).json({ error: 'frentes e rules devem ser listas' });
    }
    store.saveConfig(uid, {
      frentes: body.frentes,
      rules: body.rules,
      fallback: body.fallback,
      manual: store.getConfig(uid).manual,
    });
    res.json(view(uid));
  }),
);

// Volta frentes e regras ao padrão. As escolhas manuais são suas, ficam.
router.post(
  '/frentes/reset',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    store.saveConfig(uid, { ...defaultConfig(), manual: store.getConfig(uid).manual });
    res.json(view(uid));
  }),
);

// Escolha manual de uma tarefa. { frente: "<id>" } fixa; { frente: null } volta
// para o automático.
router.put(
  '/frentes/manual/:issueId',
  handle(async (req, res) => {
    const issueId = Number(req.params.issueId);
    if (!Number.isInteger(issueId) || issueId <= 0) {
      return res.status(400).json({ error: 'tarefa inválida' });
    }
    const uid = await getMyUserId(req);
    const frenteId = req.body?.frente ?? null;
    if (frenteId !== null) {
      const ok = store.getConfig(uid).frentes.some((f) => f.id === frenteId && !f.archived);
      if (!ok) return res.status(400).json({ error: 'frente não encontrada' });
    }
    store.setManual(uid, issueId, frenteId);
    res.json(view(uid));
  }),
);

// Opções de Área e Natureza (ID + nome) para o editor de regras.
router.get(
  '/frentes/options',
  handle(async (req, res) => {
    const url = req.headers['x-redmine-url'] || DEFAULT_URL;
    const key = req.headers['x-redmine-key'] || DEFAULT_KEY;
    const cred =
      key || `${req.headers['x-redmine-user'] || ''}:${req.headers['x-redmine-pass'] || ''}`;
    res.json(await getFieldOptions(makeRedmine(req), `${url}:${cred}`));
  }),
);

module.exports = router;
