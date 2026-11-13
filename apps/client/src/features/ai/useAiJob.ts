import { useEffect, useState } from 'react';
import type { AiJob, AiJobOf, AiStatus } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { useAction } from '../../ui/ui';
import { acceptPoll, isOpen, otherKindOpen, pollTrouble } from './ai-jobs';

const POLL_MS = 3000;

// The shared heart of the teacher's AI screens: the AI's status, this person's earlier requests of one
// kind, and the request being followed right now, polled every few seconds until it is finished.
export function useAiJob<K extends 'quiz' | 'ask'>(kind: K) {
  type Job = AiJobOf<K>;
  const { call } = useApp();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [recent, setRecent] = useState<Job[]>([]);
  // Kept as the whole union inside: TypeScript cannot look into Extract<…, K> while K is still open.
  const [job, setJob] = useState<AiJob | null>(null);
  const [busyElsewhere, setBusyElsewhere] = useState(false);
  const [failures, setFailures] = useState(0);

  const load = useAction(async () => {
    const [s, mine, all] = await Promise.all([
      call('GET /api/v1/ai/status'),
      call('GET /api/v1/ai/jobs', { query: { kind } }),
      call('GET /api/v1/ai/jobs', { query: {} }),
    ]);
    const ofKind = mine.filter((j) => j.kind === kind) as Job[];
    setStatus(s);
    setRecent(ofKind);
    setBusyElsewhere(otherKindOpen(all, kind));
    // Pick up a request still in progress, e.g. after leaving this screen.
    setJob((cur) => cur ?? ofKind.find(isOpen) ?? null);
  });
  useEffect(() => { void load.run(); }, []);

  const waiting = !!job && isOpen(job);
  useEffect(() => {
    if (!waiting || !job) return;
    const timer = setInterval(() => {
      call('GET /api/v1/ai/jobs/:id', { params: { id: job.id } }).then(
        (j) => {
          setFailures(0);
          if (j.kind !== kind) return;
          setJob((cur) => acceptPoll(cur, j));
          if (!isOpen(j)) void load.run();
        },
        () => setFailures((n) => n + 1),
      );
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, job?.id]);

  // A new request from this screen: it becomes the one followed.
  const follow = (j: Job) => { setFailures(0); setJob(j); };

  return {
    status, recent, job: job as Job | null, follow, load, waiting, busyElsewhere,
    // Nothing may start while a request of any kind is still in progress.
    canStart: !waiting && !busyElsewhere,
    trouble: waiting ? pollTrouble(failures) : null,
    usable: !!status && status.enabled && status.installed,
  };
}
