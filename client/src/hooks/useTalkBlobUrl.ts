import { useEffect, useState } from 'react';

/**
 * Deriva um object URL de um Blob e revoga automaticamente no cleanup/troca.
 *
 * Usada em cima de dados que já vêm de outra fonte (ex.: o cache do React
 * Query em TalkAvatar/RoomAvatar) — separa "buscar/cachear o Blob" de "manter
 * a URL viva só enquanto ela está montada", que é o pedaço que tinha ficado de
 * fora nesses dois e vazava memória numa sessão longa trocando de sala/rolando
 * a lista de conversas.
 */
export function useTalkBlobUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    // `instanceof Blob`, não só truthy: um valor antigo em cache (ex.: HMR
    // trocando a queryFn em dev, ou um formato de resposta inesperado) pode
    // chegar aqui sem ser um Blob de verdade — `createObjectURL` explode com
    // "Overload resolution failed" nesse caso, derrubando o componente inteiro
    // (TalkAvatar/RoomAvatar não tinham error boundary própria).
    if (!(blob instanceof Blob)) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  return url;
}

/**
 * Busca um Blob de uma URL do proxy do Talk (file-preview/file-download) e
 * devolve a object URL pronta — reúne o fetch+blob+URL+revoke que TalkImage,
 * TalkAudio e ShareThumb reimplementavam cada uma à sua maneira.
 *
 * `url === null` pula a busca (ex.: ShareThumb só busca quando o anexo é
 * imagem; TalkImage/TalkAudio quando falta `auth` ou o arquivo não tem id).
 * `transform` deixa o chamador ajustar o Blob antes de virar URL — usado por
 * TalkAudio para forçar o mimetype de áudio em gravações de voz que o
 * Nextcloud devolve como video/webm.
 */
export function useTalkFetchedBlobUrl(
  url: string | null,
  opts: { transform?: (blob: Blob) => Blob } = {},
): { src: string | null; failed: boolean } {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const transform = opts.transform;

  useEffect(() => {
    setBlob(null);
    setFailed(false);
    if (!url) return;
    let active = true;
    fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => {
        if (active) setBlob(transform ? transform(b) : b);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
    // `transform` é recriada a cada render nos chamadores que a usam (closure inline);
    // só a identidade da URL importa para refazer a busca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const src = useTalkBlobUrl(blob);
  return { src, failed };
}
