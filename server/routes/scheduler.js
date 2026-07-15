// Rotas do agendador de mensagens/lembretes do Talk. O uid vem do Redmine logado.
const express = require('express');
const router = express.Router();
const handle = require('../lib/handle');
const { getMyUserId } = require('../lib/redmine');
const scheduler = require('../services/scheduler');

// Lista itens pendentes do usuário atual.
router.get(
  '/scheduler/talk',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    res.json({ items: scheduler.list(uid) });
  }),
);

// Cria um agendamento (mensagem ou lembrete).
router.post(
  '/scheduler/talk',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    const { type, roomToken, roomName, text, fireAt } = req.body || {};
    const item = scheduler.create({ uid, type, roomToken, roomName, text, fireAt });
    res.json(item);
  }),
);

// Cancela um agendamento do próprio usuário.
router.delete(
  '/scheduler/talk/:id',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    const ok = scheduler.cancel(uid, req.params.id);
    res.json({ ok });
  }),
);

module.exports = router;
