import { Hand } from 'lucide-react';
import { Button, Select } from '../../ui/ui';
import type { ShowHost } from './useShowHost';

// The teacher's pen controls in the show row: who has the pen and "Take the pen back", or the
// drop-down to give it. Under that, each student asking for the pen, oldest first, with Allow and
// Not now. Every piece is one height and pill-shaped so the row lines up; several askers wrap.
export function PenRow({ host }: { host: ShowHost }) {
  const { live, busy } = host;
  const watching = live?.watching ?? [];
  const asks = live?.asks ?? [];
  return (
    <>
      {live?.pen ? (
        <>
          <span className="flex h-11 items-center text-base"><b>{live.pen.name}</b>&nbsp;has the pen.</span>
          <Button variant="quiet" disabled={busy.pen} onClick={() => host.givePen(null)}>Take the pen back</Button>
        </>
      ) : (
        <Select aria-label="Give the pen to a student" className="w-auto rounded-full !text-base" value="" disabled={busy.pen || watching.length === 0} onChange={(e) => { if (e.target.value) void host.givePen(e.target.value); }}>
          <option value="">{watching.length ? 'Give the pen to…' : 'No student screen has it open yet'}</option>
          {watching.map((w) => <option key={w.studentId} value={w.studentId}>{w.name}</option>)}
        </Select>
      )}
      {asks.map((a) => (
        // One asker's pill and buttons stay together when the row wraps.
        <div key={a.studentId} className="flex items-center gap-2" role="status">
          <span className="flex h-11 items-center gap-2 rounded-full bg-secondary px-5 text-base"><Hand className="size-5 shrink-0" /><span><b>{a.name}</b> asks for the pen</span></span>
          <Button disabled={busy.pen} onClick={() => host.givePen(a.studentId)}>Allow</Button>
          <Button variant="quiet" disabled={busy.pen} onClick={() => host.refusePen(a.studentId)}>Not now</Button>
        </div>
      ))}
    </>
  );
}
