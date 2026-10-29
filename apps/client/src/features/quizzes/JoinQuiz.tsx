import { useState } from 'react';
import type { StudentRunState } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Panel, useAction } from '../../ui/ui';

// Spec 6 "Today": join with the 6-digit code shown on the board.
export function JoinQuiz({ onJoined }: { onJoined: (s: StudentRunState) => void }) {
  const { call } = useApp();
  const [code, setCode] = useState('');
  const join = useAction(async () => onJoined(await call('POST /api/v1/quiz-runs/join', { body: { code } })));

  return (
    <Panel title="Join a quiz">
      <form className="flex flex-wrap items-center gap-3" onSubmit={(e) => { e.preventDefault(); void join.run(); }}>
        <input
          id="join-code" aria-label="Quiz code" inputMode="numeric" autoComplete="off" maxLength={6} placeholder="000000"
          className="h-14 w-52 rounded-xl border border-border bg-card px-4 text-center font-mono text-3xl tracking-[0.3em]"
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        <Button type="submit" disabled={code.length !== 6 || join.busy}>Join</Button>
      </form>
      <p className="text-sm text-muted-foreground">Type the code your teacher shows on the board.</p>
      <ErrorNote message={join.error} />
    </Panel>
  );
}
