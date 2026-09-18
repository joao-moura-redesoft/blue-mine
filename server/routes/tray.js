// Rotas do ícone da bandeja (services/tray.js). Montadas ANTES do authMiddleware
// de propósito: o processo da bandeja é um powershell.exe, não tem sessão. Quem
// protege é o token efêmero deste boot + origem loopback (isTrayRequest).
const express = require('express');
const { isTrayRequest, openWindow } = require('../services/tray');
const { requestShutdown } = require('../lib/shutdown');

const router = express.Router();

router.use('/tray', (req, res, next) => {
  if (!isTrayRequest(req)) return res.status(403).json({ error: 'Proibido' });
  next();
});

// Reabre a janela do app (item "Abrir Bluemine" / duplo clique no ícone).
router.post('/tray/open', (req, res) => {
  openWindow();
  res.json({ ok: true });
});

// Encerra o servidor (item "Sair"). Responde ANTES de sair para a bandeja saber
// que deu certo e remover o ícone sem precisar do fallback de matar o processo.
router.post('/tray/quit', (req, res) => {
  res.json({ ok: true });
  setTimeout(() => requestShutdown('tray'), 150);
});

module.exports = router;
