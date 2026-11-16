// Frentes pessoais: regras e escolhas manuais de classificação das tarefas.
// Por usuário do Redmine e cifradas em repouso via DPAPI, como sprints/boards.
//
// Guarda só a configuração (poucas dezenas de linhas). A frente de cada tarefa
// é recalculada a cada carga a partir dos campos do Redmine — ver lib/frentes.js.
const { dataFile, readJsonSecure, writeJsonSecure } = require('../lib/secureStore');
const { defaultConfig, sanitizeConfig } = require('../lib/frentes');

const FRENTES_FILE = dataFile('frentes.json');

// { [userId]: Config } — já sanitizado na carga, para getConfig ser barato
// (é chamado a cada busca de tarefas).
let store = {};
try {
  const raw = readJsonSecure(FRENTES_FILE, {});
  for (const [uid, cfg] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    store[uid] = sanitizeConfig(cfg);
  }
} catch {
  store = {};
}

const persist = () => writeJsonSecure(FRENTES_FILE, store);

// Quem nunca mexeu recebe a configuração padrão; nada é gravado até a 1ª alteração.
function getConfig(userId) {
  return store[userId] || defaultConfig();
}

function isCustomized(userId) {
  return !!store[userId];
}

function saveConfig(userId, cfg) {
  store[userId] = sanitizeConfig(cfg);
  persist();
  return store[userId];
}

// frenteId = null volta a tarefa para o automático.
function setManual(userId, issueId, frenteId) {
  const cfg = getConfig(userId);
  const manual = { ...cfg.manual };
  if (frenteId == null) delete manual[issueId];
  else manual[issueId] = frenteId;
  return saveConfig(userId, { ...cfg, manual });
}

module.exports = { getConfig, isCustomized, saveConfig, setManual };
