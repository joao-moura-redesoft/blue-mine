import { describe, it, expect } from 'vitest';
import zimbra from './zimbra.js';

const { buildMessagePart } = zimbra;

// A estrutura MIME do SendMsg é o ponto sensível do rodapé de imagem: se o
// multipart/related ou o Content-ID saírem errados, o destinatário vê um
// quadrado quebrado. Não dá para testar contra o Zimbra real, então travamos o
// formato do payload aqui.
describe('buildMessagePart', () => {
  const base = { to: 'alguem@exemplo.com', subject: 'Oi', text: 'texto', html: '<p>oi</p>' };

  it('mantém text/html direto quando não há imagem inline', () => {
    const m = buildMessagePart(base);
    const body = m.mp[0];
    expect(body.ct).toBe('multipart/alternative');
    expect(body.mp.map((p) => p.ct)).toEqual(['text/plain', 'text/html']);
  });

  it('envolve HTML e imagens em multipart/related com Content-ID', () => {
    const m = buildMessagePart({
      ...base,
      html: '<p>oi</p><img src="cid:abc@bluemine">',
      inlineAttachments: [{ aid: 'aid-1', cid: 'abc@bluemine', contentType: 'image/png' }],
    });

    const body = m.mp[0];
    expect(body.ct).toBe('multipart/alternative');
    const [plain, related] = body.mp;
    expect(plain.ct).toBe('text/plain');
    expect(related.ct).toBe('multipart/related');

    const [htmlPart, imagePart] = related.mp;
    expect(htmlPart.ct).toBe('text/html');
    expect(imagePart.ct).toBe('image/png');
    // O Content-ID vai entre <> e o HTML referencia sem os sinais.
    expect(imagePart.ci).toBe('<abc@bluemine>');
    expect(htmlPart.content._content).toContain('cid:abc@bluemine');
    expect(imagePart.attach).toEqual({ aid: 'aid-1' });
  });

  it('não duplica a imagem inline como anexo comum', () => {
    const m = buildMessagePart({
      ...base,
      inlineAttachments: [{ aid: 'aid-1', cid: 'abc@bluemine', contentType: 'image/png' }],
    });
    expect(m.attach).toBeUndefined();
  });

  it('mantém anexos normais junto das imagens inline', () => {
    const m = buildMessagePart({
      ...base,
      attachments: [{ aid: 'doc-1' }],
      inlineAttachments: [{ aid: 'img-1', cid: 'abc@bluemine', contentType: 'image/png' }],
    });
    expect(m.attach).toEqual({ aid: 'doc-1' });
    expect(m.mp[0].mp[1].mp[1].attach).toEqual({ aid: 'img-1' });
  });

  it('ignora entradas inline sem aid ou sem cid', () => {
    const m = buildMessagePart({
      ...base,
      inlineAttachments: [{ aid: 'x' }, { cid: 'y' }],
    });
    expect(m.mp[0].mp[1].ct).toBe('text/html');
  });
});
