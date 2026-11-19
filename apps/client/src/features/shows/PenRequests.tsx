import { Hand } from 'lucide-react';
import { Button } from '../../ui/ui';
import type { ShowHost } from './useShowHost';

// The students asking for the pen, oldest first, each with Allow and Not now. They get a row of
// their own under the show row, so that row (with "Stop showing" at its end) never breaks up when
// hands go up. Nothing is drawn, and no room is taken, while nobody is asking.
export function PenRequests({ host }: { host: ShowHost }) {
  const { live, busy } = host;
  const asks = live?.asks ?? [];
  if (!asks.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2" role="status" aria-label="Students asking for the pen">
      {asks.map((a) => (
        // One asker's pill and buttons stay together when the row wraps.
        <div key={a.studentId} className="flex items-center gap-2">
          <span className="flex h-11 items-center gap-2 rounded-full bg-secondary px-5 text-base"><Hand className="size-5 shrink-0" /><span><b>{a.name}</b> asks for the pen</span></span>
          <Button disabled={busy.pen} onClick={() => host.givePen(a.studentId)}>Allow</Button>
          <Button variant="quiet" disabled={busy.pen} onClick={() => host.refusePen(a.studentId)}>Not now</Button>
        </div>
      ))}
    </div>
  );
}
