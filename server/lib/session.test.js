import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Ambos precisam existir ANTES do módulo carregar: DATA_DIR e a chave do cofre
// são resolvidos no boot. Sem o data dir próprio, o teste gravaria por cima do
// sessions.json do app de verdade.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-'));
process.env.BLUEMINE_DATA_DIR = dir;
process.env.BLUEMINE_VAULT_KEY = Buffer.alloc(32, 5).toString('base64');

let session;

beforeAll(async () => {
  session = (await import('./session.js')).default ?? (await import('./session.js'));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const URL_A = 'https://redmine.exemplo.com';
const login = (over = {}) =>
  session.createSession({ url: URL_A, username: 'joao.moura', password: 'senha-velha', ...over });

beforeEach(() => {
  for (const s of session.listSessions()) session.destroySession(s.id);
});

describe('listSessions', () => {
  it('devolve o id junto, para quem roda fora de uma requisição HTTP', () => {
    const id = login();
    const [s] = session.listSessions();
    expect(s.id).toBe(id);
    expect(s.username).toBe('joao.moura');
  });

  it('o id devolvido serve para destruir a sessão', () => {
    login();
    session.destroySession(session.listSessions()[0].id);
    expect(session.listSessions()).toHaveLength(0);
  });
});

// O caso real: 7 sessões órfãs de junho/julho com a senha antiga sobreviviam a
// todo login novo, porque o logout só derruba a do cookie atual. O motor de
// automações percorria todas a cada tick, e cada reinício do processo gastava
// mais um login falho no AD antes de a guarda (em memória) pegar.
describe('createSession expulsa gêmeas de credencial vencida', () => {
  it('remove a sessão do mesmo usuário que ficou com a senha antiga', () => {
    login();
    login();
    expect(session.listSessions()).toHaveLength(2);

    const novo = login({ password: 'senha-nova' });
    const restantes = session.listSessions();
    expect(restantes).toHaveLength(1);
    expect(restantes[0].id).toBe(novo);
  });

  it('mantém sessão em paralelo com a MESMA senha (app e navegador juntos)', () => {
    login();
    login();
    expect(session.listSessions()).toHaveLength(2);
  });

  it('não mexe em sessão de outro usuário', () => {
    login({ username: 'outra.pessoa' });
    login({ password: 'senha-nova' });
    const users = session.listSessions().map((s) => s.username);
    expect(users).toContain('outra.pessoa');
    expect(users).toHaveLength(2);
  });

  it('não mexe em sessão de outro servidor Redmine', () => {
    login({ url: 'https://outro.exemplo.com' });
    login({ password: 'senha-nova' });
    expect(session.listSessions()).toHaveLength(2);
  });

  it('não mexe em sessão de Token de API (não tem senha para vencer)', () => {
    session.createSession({ url: URL_A, apiKey: 'abc123' });
    login({ password: 'senha-nova' });
    expect(session.listSessions()).toHaveLength(2);
  });

  it('login por Token de API não expulsa ninguém', () => {
    login();
    session.createSession({ url: URL_A, apiKey: 'abc123' });
    expect(session.listSessions()).toHaveLength(2);
  });

  it('ignora diferença de maiúsculas no usuário (AD é case-insensitive)', () => {
    login({ username: 'Joao.Moura' });
    login({ password: 'senha-nova' });
    expect(session.listSessions()).toHaveLength(1);
  });
});
