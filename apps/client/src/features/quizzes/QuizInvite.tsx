import { useEffect, useState } from 'react';
import type { OpenRunForStudent, StudentRunState } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, ErrorNote, Panel, useAction } from '../../ui/ui';

const ASK_EVERY_MS = 4000;

// The quiz the teacher has opened for this student's class, if any. The app asks the server every few
// seconds, so the student never types a code: the quiz simply shows up. `clear` forgets the quiz at once
// and asks again, for the moment the student has just handed one in: otherwise the old answer could pop
// the same quiz up again until the next ask.
export function useOpenQuiz(): { quiz: OpenRunForStudent | null; clear: () => void } {
  const { call } = useApp();
  const [quiz, setQuiz] = useState<OpenRunForStudent | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let alive = true;
    // A missed ask is not worth a message: the next one comes in a few seconds.
    const ask = () => void call('GET /api/v1/quiz-runs/open').then((runs) => { if (alive) setQuiz(runs[0] ?? null); }, () => undefined);
    ask();
    const t = setInterval(ask, ASK_EVERY_MS);
    return () => { alive = false; clearInterval(t); };
  }, [asked]);
  return { quiz, clear: () => { setQuiz(null); setAsked((n) => n + 1); } };
}

function useJoin(quiz: OpenRunForStudent, onJoined: (s: StudentRunState) => void) {
  const { call } = useApp();
  return useAction(async () => onJoined(await call('POST /api/v1/quiz-runs/:id/join', { params: { id: quiz.runId } })));
}

// Pops up over whatever the student is doing as soon as the teacher opens a quiz for their class.
export function QuizPopup({ quiz, onJoined, onLater }: { quiz: OpenRunForStudent; onJoined: (s: StudentRunState) => void; onLater: () => void }) {
  const join = useJoin(quiz, onJoined);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" role="dialog" aria-modal="true" aria-labelledby="quiz-popup-title">
      <Card className="grid w-full max-w-md gap-4 p-8 text-center">
        <span className="text-sm font-semibold tracking-[0.14em] text-primary uppercase">{quiz.status === 'active' ? 'Quiz has started' : 'Quiz is starting'}</span>
        <h2 id="quiz-popup-title" className="font-display text-3xl font-semibold">{quiz.title}</h2>
        <p className="text-muted-foreground">Your teacher has opened this quiz for your class.</p>
        <Button className="h-14 text-lg" autoFocus disabled={join.busy} onClick={() => join.run()}>Join the quiz</Button>
        <Button variant="quiet" onClick={onLater}>Not now</Button>
        <ErrorNote message={join.error} />
      </Card>
    </div>
  );
}

// Stays on the home screen for a student who pressed "Not now", so they can still get in.
export function QuizWaiting({ quiz, onJoined }: { quiz: OpenRunForStudent; onJoined: (s: StudentRunState) => void }) {
  const join = useJoin(quiz, onJoined);
  return (
    <Panel title="Quiz" actions={<Button disabled={join.busy} onClick={() => join.run()}>Join the quiz</Button>}>
      <p><b>{quiz.title}</b> <span className="text-muted-foreground">· {quiz.status === 'active' ? 'has started' : 'is about to start'}</span></p>
      <ErrorNote message={join.error} />
    </Panel>
  );
}
