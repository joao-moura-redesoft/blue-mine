// Config embutida no executável (gerada por scripts/embed-config.cjs no build SEA):
// as variáveis não-secretas do .env e a CA interna viajam DENTRO do .exe, para que
// distribuir o binário sozinho já funcione numa máquina nova.
//
// Precedência: ambiente real > .env em disco > embutido. O embutido é só o PADRÃO —
// quem precisar apontar para outro Redmine/Zimbra continua colocando um .env ao lado
// do .exe sem gerar build novo.
//
// Ausente em dev (o arquivo é gerado no build): o require falha e tudo vira no-op.
let embedded = null;
try {
  // eslint-disable-next-line global-require
  embedded = require('../config-embedded.cjs');
} catch {
  embedded = null;
}

// Copia para `target` só as chaves ainda NÃO definidas — é isto que garante a
// precedência (ambiente/.env vencem o embutido). Devolve as chaves aplicadas.
function applyDefaults(env, target) {
  if (!env) return [];
  const applied = [];
  for (const [k, v] of Object.entries(env)) {
    if (target[k] === undefined || target[k] === '') {
      target[k] = v;
      applied.push(k);
    }
  }
  return applied;
}

// Precisa rodar depois do dotenv.config() e antes de qualquer módulo que leia
// process.env no topo (zimbra.js, dokuwiki.js e o logger fazem isso).
function applyEmbeddedEnv() {
  return applyDefaults(embedded?.env, process.env);
}

// PEM da CA interna embutida (ou null). Consumido por lib/internalCa.js.
function embeddedCa() {
  return embedded?.ca || null;
}

module.exports = { applyDefaults, applyEmbeddedEnv, embeddedCa };
