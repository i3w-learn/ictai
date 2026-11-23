import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { PollForStudent, RATING_MAX, pollRoom } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, ErrorNote, cn, useAction } from '../../ui/ui';

const ASK_EVERY_MS = 4000;

// The question the teacher is asking this student's class right now, if any. The server pushes it,
// and the app also asks every few seconds in case a push was missed.
export function useOpenPoll(): { poll: PollForStudent | null; set: (p: PollForStudent) => void } {
  const { relay, call, state } = useApp();
  const p = state.session?.principal;
  const classId = p?.kind === 'student' ? p.classId : null;
  const [poll, setPoll] = useState<PollForStudent | null>(null);
  useEffect(() => {
    if (!classId) return;
    let alive = true;
    const take = (s: unknown) => {
      const parsed = PollForStudent.nullable().safeParse(s);
      if (alive && parsed.success) setPoll(parsed.data);
    };
    const leave = relay.subscribe(pollRoom(classId), take);
    const ask = () => void call('GET /api/v1/polls/open').then(take, () => undefined);
    ask();
    const t = setInterval(ask, ASK_EVERY_MS);
    return () => { alive = false; leave(); clearInterval(t); setPoll(null); };
  }, [relay, call, classId]);
  return { poll, set: setPoll };
}

// Pops up over whatever the student is doing. One tap answers it; there is no right or wrong.
export function PollPopup({ poll, onAnswered, onLater }: { poll: PollForStudent; onAnswered: (p: PollForStudent) => void; onLater: () => void }) {
  const { call } = useApp();
  const answer = useAction(async (choice: number) => onAnswered(await call('POST /api/v1/polls/:id/answer', { params: { id: poll.id }, body: { choice } })));
  // The stars the pointer is over, so the row lights up to there before the tap.
  const [over, setOver] = useState(0);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" role="dialog" aria-modal="true" aria-labelledby="poll-popup-title">
      <Card className="grid w-full max-w-lg gap-5 p-8 text-center">
        <span className="text-sm font-semibold tracking-[0.14em] text-primary uppercase">Your teacher asks</span>
        <h2 id="poll-popup-title" className="font-display text-3xl font-semibold text-balance">{poll.question}</h2>
        {poll.kind === 'choice' ? (
          <div className="grid gap-3">
            {poll.options.map((o, i) => (
              <Button key={i} className="min-h-14 text-lg" variant={poll.myChoice === i ? 'primary' : 'quiet'} disabled={answer.busy} onClick={() => answer.run(i)}>{o}</Button>
            ))}
          </div>
        ) : (
          <div className="flex justify-center gap-1" onPointerLeave={() => setOver(0)}>
            {Array.from({ length: RATING_MAX }, (_, i) => i + 1).map((n) => (
              <button
                key={n} type="button" aria-label={`${n} star${n === 1 ? '' : 's'}`} disabled={answer.busy}
                className="cursor-pointer rounded-2xl p-2 transition-transform hover:scale-110 disabled:opacity-50"
                onPointerEnter={() => setOver(n)} onClick={() => answer.run(n)}
              >
                <Star className={cn('size-12', n <= (over || poll.myChoice || 0) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/50')} strokeWidth={1.5} />
              </button>
            ))}
          </div>
        )}
        <p className="text-sm text-muted-foreground">There is no right or wrong answer, and no marks.</p>
        <Button variant="quiet" onClick={onLater}>Not now</Button>
        <ErrorNote message={answer.error} />
      </Card>
    </div>
  );
}
