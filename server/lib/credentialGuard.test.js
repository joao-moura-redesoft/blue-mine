import { describe, it, expect, beforeEach } from 'vitest';
import guard from './credentialGuard.js';

const { assertNotKnownBad, recordFailure, recordSuccess, isKnownBad, _reset } = guard;

describe('credentialGuard', () => {
  beforeEach(() => _reset());

  it('deixa passar credencial ainda não reprovada', () => {
    expect(() => assertNotKnownBad('redmine', 'joao.moura', 'senha-boa')).not.toThrow();
  });

  it('bloqueia a MESMA senha depois de reprovada, sem tocar na rede', () => {
    recordFailure('redmine', 'joao.moura', 'senha-velha');
    expect(() => assertNotKnownBad('redmine', 'joao.moura', 'senha-velha')).toThrow(
      /senha de rede parece ter sido alterada/i,
    );
  });

  it('marca o erro como 401 e seguro para o cliente', () => {
    recordFailure('redmine', 'joao.moura', 'senha-velha');
    try {
      assertNotKnownBad('redmine', 'joao.moura', 'senha-velha');
      throw new Error('devia ter lançado');
    } catch (e) {
      expect(e.statusCode).toBe(401);
      expect(e.isSafe).toBe(true);
      expect(e.credentialsStale).toBe(true);
    }
  });

  // O ponto central: quem troca a senha volta a funcionar na hora, sem reset
  // manual e sem esperar cooldown.
  it('libera imediatamente uma senha NOVA para o mesmo usuário', () => {
    recordFailure('redmine', 'joao.moura', 'senha-velha');
    expect(() => assertNotKnownBad('redmine', 'joao.moura', 'senha-nova')).not.toThrow();
  });

  it('não contamina outro usuário', () => {
    recordFailure('redmine', 'joao.moura', 'senha-velha');
    expect(() => assertNotKnownBad('redmine', 'outra.pessoa', 'senha-velha')).not.toThrow();
  });

  it('não contamina outro serviço', () => {
    recordFailure('zimbra', 'joao.moura', 'senha-velha');
    expect(() => assertNotKnownBad('redmine', 'joao.moura', 'senha-velha')).not.toThrow();
  });

  it('sucesso limpa a reprovação anterior', () => {
    recordFailure('zimbra', 'joao.moura', 'senha-velha');
    expect(isKnownBad('zimbra', 'joao.moura', 'senha-velha')).toBe(true);
    recordSuccess('zimbra', 'joao.moura');
    expect(isKnownBad('zimbra', 'joao.moura', 'senha-velha')).toBe(false);
  });

  it('trata o usuário sem diferenciar maiúsculas (AD é case-insensitive)', () => {
    recordFailure('redmine', 'Joao.Moura', 'senha-velha');
    expect(() => assertNotKnownBad('redmine', 'joao.moura', 'senha-velha')).toThrow();
  });

  it('não guarda a senha em claro em lugar nenhum', () => {
    recordFailure('redmine', 'joao.moura', 'senha-super-secreta');
    const dump = JSON.stringify(guard);
    expect(dump).not.toContain('senha-super-secreta');
  });
});
