/**
 * Config embutida no .exe (scripts/embed-config.cjs).
 *
 * A regra que importa é a PRECEDÊNCIA: o embutido é padrão de fábrica, nunca
 * sobreposição. Se ele vencesse o ambiente, um .env ao lado do executável (o jeito
 * de apontar para outro Redmine/Zimbra sem gerar build) passaria a ser ignorado —
 * silenciosamente, que é o pior modo de quebrar configuração.
 */
import { describe, it, expect } from 'vitest';
import { applyDefaults } from './embeddedConfig.js';

describe('applyDefaults', () => {
  it('preenche apenas o que está faltando', () => {
    const target = { VITE_ZIMBRA_HOST: 'email.outro.org' };
    const applied = applyDefaults(
      { VITE_ZIMBRA_HOST: 'email.redesoft.org', SSRF_WHITELIST: 'drive.b2click.com' },
      target,
    );
    expect(target.VITE_ZIMBRA_HOST).toBe('email.outro.org'); // ambiente vence
    expect(target.SSRF_WHITELIST).toBe('drive.b2click.com'); // faltava: embutido entra
    expect(applied).toEqual(['SSRF_WHITELIST']);
  });

  it('trata string vazia como ausente', () => {
    // `VAR=` no .env chega como '' e deixaria o host vazio — que é justamente o
    // estado que derruba o e-mail em 503.
    const target = { VITE_ZIMBRA_HOST: '' };
    applyDefaults({ VITE_ZIMBRA_HOST: 'email.redesoft.org' }, target);
    expect(target.VITE_ZIMBRA_HOST).toBe('email.redesoft.org');
  });

  it('sem config embutida (dev) é no-op', () => {
    expect(applyDefaults(null, {})).toEqual([]);
    expect(applyDefaults(undefined, {})).toEqual([]);
  });
});
