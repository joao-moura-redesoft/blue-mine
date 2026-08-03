import { describe, it, expect, vi } from 'vitest';
import errorMiddlewareModule from './errorMiddleware.js';
import AppError from './AppError.js';

const errorMiddleware = errorMiddlewareModule;
const { shouldDropStaleSession } = errorMiddlewareModule;

function mockRes() {
  const res = { statusCode: 0, body: null };
  res.status = vi.fn((c) => {
    res.statusCode = c;
    return res;
  });
  res.json = vi.fn((b) => {
    res.body = b;
    return res;
  });
  res.clearCookie = vi.fn();
  return res;
}
const req = { method: 'GET', path: '/api/x' };
const reqLogged = { ...req, cookies: { session_id: 'sess-1' } };

describe('errorMiddleware', () => {
  it('repassa mensagem de AppError (isSafe)', () => {
    const res = mockRes();
    errorMiddleware(new AppError(400, 'mensagem segura'), req, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'mensagem segura' });
  });

  it('esconde detalhes internos em erro 500', () => {
    const res = mockRes();
    const err = new Error('stack secreta com detalhes internos');
    errorMiddleware(err, req, res, () => {});
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Ocorreu um erro interno no servidor.' });
  });

  it('normaliza 401/403 numa mensagem genérica de credenciais', () => {
    const res = mockRes();
    errorMiddleware({ response: { status: 403, data: { secret: 'x' } } }, req, res, () => {});
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Credenciais inválidas ou sem permissão.' });
  });

  it('repassa apenas o array errors do Redmine em 4xx, nunca o corpo bruto', () => {
    const res = mockRes();
    errorMiddleware(
      { response: { status: 422, data: { errors: ['Assunto obrigatório'], secreto: 'x' } } },
      req,
      res,
      () => {},
    );
    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({ errors: ['Assunto obrigatório'] });
  });

  // Senha trocada no AD: sem derrubar a sessão (que vale 30 dias e guarda a
  // senha antiga), o app fica "logado" e quebrado até o cookie expirar.
  describe('shouldDropStaleSession', () => {
    const stale = () => {
      const e = new AppError(401, 'senha alterada');
      e.credentialsStale = true;
      return e;
    };

    it('derruba quando a credencial foi marcada como vencida', () => {
      expect(shouldDropStaleSession(stale(), reqLogged)).toBe(true);
    });

    it('NÃO derruba num 403 comum — key não-admin toma 403 em rotas legítimas', () => {
      expect(shouldDropStaleSession({ response: { status: 403 } }, reqLogged)).toBe(false);
    });

    it('NÃO derruba num 401 sem a marca (ex.: 401 de serviço opcional)', () => {
      expect(shouldDropStaleSession({ response: { status: 401 } }, reqLogged)).toBe(false);
    });

    it('não quebra quando não há cookie de sessão', () => {
      expect(shouldDropStaleSession(stale(), req)).toBe(false);
      expect(shouldDropStaleSession(stale(), {})).toBe(false);
    });

    it('a mensagem intencional continua chegando ao cliente', () => {
      const res = mockRes();
      errorMiddleware(stale(), req, res, () => {});
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'senha alterada' });
    });
  });
});
