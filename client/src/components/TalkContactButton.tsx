import { MessageCircle, Loader2 } from 'lucide-react';
import { useTalkMatchFor } from '../hooks/useTalk';

interface Props {
  redmineUserId?: number;
  onOpenTalk: (ncUid: string) => void;
  /** ncUid da conversa sendo aberta agora, ou null — comparado ao match desta pessoa */
  openingTalkFor?: string | null;
  className?: string;
}

// Botão "conversar no Talk" — só aparece quando há vínculo (exato ou por nome
// aproximado) pro usuário do Redmine em services/talkMatch.js. Casos ambíguos
// (mais de um candidato) ficam sem botão: melhor nada do que mandar pra pessoa errada.
export function TalkContactButton({
  redmineUserId,
  onOpenTalk,
  openingTalkFor,
  className = '',
}: Props) {
  const match = useTalkMatchFor(redmineUserId);
  if (!match?.ncUid) return null;
  const pending = !!openingTalkFor && openingTalkFor === match.ncUid;

  const title =
    match.matchType === 'fuzzy'
      ? `Conversar no Talk (nome aproximado: ${match.ncName})`
      : `Conversar no Talk (${match.ncName})`;

  return (
    <button
      type="button"
      title={title}
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        onOpenTalk(match.ncUid!);
      }}
      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 dark:hover:text-blue-400 disabled:opacity-50 transition-colors ${className}`}
    >
      {pending ? <Loader2 size={13} className="animate-spin" /> : <MessageCircle size={13} />}
    </button>
  );
}
