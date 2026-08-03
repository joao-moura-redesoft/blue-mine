import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTalkMatchFor } from '../hooks/useTalk';
import { getTalkAuth } from '../api/talk';

interface Props {
  redmineUserId?: number;
  name: string;
  size?: number;
  className?: string;
  /** Se informado e houver vínculo com o Talk, o avatar vira clicável e abre a conversa 1:1 */
  onOpenTalk?: (ncUid: string) => void;
  /** ncUid da conversa sendo aberta agora, ou null — mostra um spinner sobre o avatar */
  openingTalkFor?: string | null;
}

// Avatar de uma pessoa do Redmine: mostra a foto real do Nextcloud Talk quando há
// vínculo por nome (server/services/talkMatch.js); cai pras iniciais quando não há
// vínculo, sem foto, ou o Talk não está configurado nesta sessão.
export function PersonAvatar({
  redmineUserId,
  name,
  size = 28,
  className = '',
  onOpenTalk,
  openingTalkFor,
}: Props) {
  const match = useTalkMatchFor(redmineUserId);
  const ncUid = match?.ncUid;
  const auth = getTalkAuth();
  const pending = !!openingTalkFor && openingTalkFor === ncUid;

  const { data: src } = useQuery({
    queryKey: ['talk-avatar', ncUid, size],
    queryFn: async () => {
      const r = await fetch(`/api/talk/avatar/${encodeURIComponent(ncUid!)}?size=${size}`);
      if (!r.ok) return null;
      return URL.createObjectURL(await r.blob());
    },
    enabled: !!auth && !!ncUid,
    staleTime: 10 * 60 * 1000,
  });

  const initials = name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const clickable = !!ncUid && !!onOpenTalk;

  return (
    <div
      onClick={
        clickable
          ? (e) => {
              e.stopPropagation();
              onOpenTalk!(ncUid!);
            }
          : undefined
      }
      title={clickable ? `Conversar no Talk (${match?.ncName ?? name})` : name}
      className={`rounded-full overflow-hidden bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold flex-shrink-0 ${
        clickable ? 'cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all' : ''
      } ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {pending ? (
        <Loader2 size={Math.round(size * 0.5)} className="animate-spin" />
      ) : src ? (
        <img src={src} alt={name} className="w-full h-full object-cover" />
      ) : (
        initials
      )}
    </div>
  );
}
