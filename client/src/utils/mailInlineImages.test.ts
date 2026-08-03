import { describe, it, expect, vi, beforeEach } from 'vitest';
import DOMPurify from 'dompurify';

const uploadBytes = vi.fn();
vi.mock('../api/mail', () => ({
  mailApi: { uploadBytes: (...a: unknown[]) => uploadBytes(...a) },
}));

const { inlineDataImages } = await import('./mailInlineImages');

// PNG 1x1 transparente.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('inlineDataImages', () => {
  beforeEach(() => {
    uploadBytes.mockReset();
    uploadBytes.mockResolvedValue({ aid: 'aid-1', filename: 'x', size: 1 });
  });

  it('troca o data URI por cid: e devolve o anexo inline', async () => {
    const { html, inlineAttachments } = await inlineDataImages(`<p>oi</p><img src="${PNG}">`);

    expect(inlineAttachments).toHaveLength(1);
    expect(inlineAttachments[0].aid).toBe('aid-1');
    expect(inlineAttachments[0].contentType).toBe('image/png');
    expect(html).toContain(`src="cid:${inlineAttachments[0].cid}"`);
    expect(html).not.toContain('data:image');
  });

  it('decodifica o base64 para os bytes reais do PNG', async () => {
    await inlineDataImages(`<img src="${PNG}">`);
    const bytes = uploadBytes.mock.calls[0][0] as Uint8Array;
    // Assinatura de arquivo PNG: 89 50 4E 47.
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(uploadBytes.mock.calls[0][2]).toBe('image/png');
  });

  it('sobe uma vez só quando a mesma imagem aparece duas vezes', async () => {
    const { inlineAttachments } = await inlineDataImages(
      `<img src="${PNG}"><p>x</p><img src="${PNG}">`,
    );
    expect(uploadBytes).toHaveBeenCalledTimes(1);
    expect(inlineAttachments).toHaveLength(1);
  });

  it('mantém a imagem no corpo se o upload falhar, em vez de abortar o envio', async () => {
    uploadBytes.mockRejectedValue(new Error('zimbra fora'));
    const { html, inlineAttachments } = await inlineDataImages(`<img src="${PNG}">`);
    expect(inlineAttachments).toHaveLength(0);
    expect(html).toContain('data:image');
  });

  it('não mexe em corpo sem imagem embutida', async () => {
    const src = '<p>oi</p><img src="https://exemplo.com/a.png">';
    const { html, inlineAttachments } = await inlineDataImages(src);
    expect(html).toBe(src);
    expect(inlineAttachments).toHaveLength(0);
    expect(uploadBytes).not.toHaveBeenCalled();
  });
});

// O compositor sanitiza ANTES de converter, então o DOMPurify precisa preservar
// `data:` em <img>; e o corpo final, já com cid:, passa pelo mesmo filtro no
// caminho de leitura. Se uma versão futura mudar isso, o rodapé some — daí o teste.
describe('DOMPurify e URIs de imagem', () => {
  it('preserva data: e cid: no src de <img>', () => {
    expect(DOMPurify.sanitize(`<img src="${PNG}">`)).toContain('data:image/png');
    expect(DOMPurify.sanitize('<img src="cid:abc@bluemine">')).toContain('cid:abc@bluemine');
  });
});
