// Estado LOCAL de leitura do Talk (por dispositivo), em localStorage.
//
// Por quê: o "não lido" de cada sala vem do poll de /rooms (15s) e o recálculo de
// não-lidas do Nextcloud é EVENTUAL — logo após marcar como lido, um poll pode voltar
// com a contagem antiga e "ressuscitar" o badge. Guardando aqui o id da última mensagem
// que o usuário de fato leu, conseguimos SUPRIMIR esse falso não-lido no client, sem
// depender do timing do servidor nem de o POST /read ter propagado.
//
// Regras de segurança do modelo:
//  • só ZERAMOS não-lidas (nunca aumentamos) → nunca escondemos mensagem NOVA: uma msg
//    nova tem id > readId, então não é suprimida;
//  • monotônico: só avança o readId, nunca retrocede;
//  • se o servidor já reporta 0 (lido em outro dispositivo), continua 0 — não interferimos.

const KEY = 'talk:lastRead';
type ReadMap = Record<string, number>;

function load(): ReadMap {
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function save(map: ReadMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // localStorage indisponível (modo privado/cota) — degrada para comportamento antigo.
  }
}

export const talkRead = {
  get(token: string): number {
    return load()[token] ?? 0;
  },
  // Avança o marcador local de leitura da sala (monotônico). Retorna true se mudou.
  set(token: string, messageId: number): boolean {
    if (!token || !messageId) return false;
    const map = load();
    if ((map[token] ?? 0) >= messageId) return false;
    map[token] = messageId;
    save(map);
    return true;
  },
};
