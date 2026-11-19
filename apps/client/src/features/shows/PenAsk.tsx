import { Hand } from 'lucide-react';
import type { Show } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { useAction } from '../../ui/ui';

// The student's way to ask the teacher for the pen, in the dark header of a show. The server says
// where her ask stands (`myAsk`); this only sends the ask or takes it back.
export function PenAsk({ show }: { show: Pick<Show, 'id' | 'myAsk'> }) {
  const { call } = useApp();
  const params = { id: show.id };
  const ask = useAction(() => call('POST /api/v1/shows/:id/pen/ask', { params }));
  const unask = useAction(() => call('DELETE /api/v1/shows/:id/pen/ask', { params }));
  const busy = ask.busy || unask.busy;
  const problem = ask.error ?? unask.error;

  return (
    <>
      {show.myAsk === 'waiting' ? (
        <>
          <p className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium" role="status">You asked for the pen. Wait for your teacher.</p>
          <button type="button" disabled={busy} onClick={() => void unask.run()} className="cursor-pointer rounded-full px-4 py-2 text-sm font-medium hover:bg-white/15 focus-visible:outline-white disabled:opacity-50">Cancel</button>
        </>
      ) : (
        <>
          {show.myAsk === 'refused' && <p className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium" role="status">Your teacher said not now.</p>}
          <button type="button" disabled={busy} onClick={() => void ask.run()} className="flex cursor-pointer items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-white disabled:opacity-50"><Hand className="size-4" /> Ask for the pen</button>
        </>
      )}
      {problem && <p className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium" role="alert">{problem}</p>}
    </>
  );
}
