import { useEffect, useState, type ReactNode } from 'react';
import type { RosterEntry, SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, Centered, ErrorNote, Field, PageTitle, useAction } from '../../ui/ui';

type Step = { at: 'class' } | { at: 'name'; cls: SchoolClass } | { at: 'pin'; student: RosterEntry } | { at: 'first-time' };

// Big tap target for the class and name grids (students use touch screens).
function Tile({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      className="cursor-pointer rounded-2xl border border-border bg-card px-3 py-6 text-lg font-semibold shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-md"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// Spec 6: pick class, tap your name, enter your PIN. First time: a code from the teacher.
export function StudentSignIn() {
  const { call, dispatch } = useApp();
  const [step, setStep] = useState<Step>({ at: 'class' });
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');

  const loadClasses = useAction(async () => setClasses(await call('GET /api/v1/auth/student/classes', {}, 'device')));
  useEffect(() => {
    void loadClasses.run();
  }, []);

  const openClass = useAction(async (cls: SchoolClass) => {
    setRoster(await call('GET /api/v1/auth/student/roster', { query: { classId: cls.id } }, 'device'));
    setStep({ at: 'name', cls });
  });

  const withPin = useAction(async (studentId: string) => {
    const session = await call('POST /api/v1/auth/student/pin', { body: { studentId, pin } }, 'device');
    dispatch({ type: 'session', session });
  });

  const firstTime = useAction(async () => {
    const session = await call('POST /api/v1/auth/student/enrol', { body: { code, pin } }, 'device');
    dispatch({ type: 'session', session });
  });

  const back = (to: Step) => () => { setPin(''); setStep(to); };
  const error = loadClasses.error ?? openClass.error ?? withPin.error ?? firstTime.error;
  const tiles = 'grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3';

  return (
    <Centered narrow={step.at === 'pin' || step.at === 'first-time'}>
      {step.at === 'class' && (
        <>
          <PageTitle eyebrow="Sign in">Which class are you in?</PageTitle>
          <div className={tiles}>
            {classes.map((c) => <Tile key={c.id} onClick={() => openClass.run(c)}>{c.name}</Tile>)}
          </div>
          <div><Button variant="quiet" onClick={back({ at: 'first-time' })}>First time here? Use a code</Button></div>
        </>
      )}

      {step.at === 'name' && (
        <>
          <PageTitle eyebrow={`Class ${step.cls.name}`}>Tap your name</PageTitle>
          <div className={tiles}>
            {roster.map((s) => <Tile key={s.id} onClick={() => setStep({ at: 'pin', student: s })}>{s.name}</Tile>)}
          </div>
          <div><Button variant="quiet" onClick={back({ at: 'class' })}>Back</Button></div>
        </>
      )}

      {step.at === 'pin' && (
        <Card className="p-6 sm:p-8">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void withPin.run(step.student.id); }}>
            <PageTitle>Hi {step.student.name}</PageTitle>
            <Field id="pin" label="Your 4-digit PIN" type="password" inputMode="numeric" maxLength={4} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            <Button type="submit" className="h-12" disabled={withPin.busy || pin.length !== 4}>Sign in</Button>
            <Button type="button" variant="quiet" onClick={back({ at: 'class' })}>Not you?</Button>
          </form>
        </Card>
      )}

      {step.at === 'first-time' && (
        <Card className="p-6 sm:p-8">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void firstTime.run(); }}>
            <PageTitle>First sign-in</PageTitle>
            <Field id="first-code" label="Code from your teacher" inputMode="numeric" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <Field id="new-pin" label="Choose a 4-digit PIN" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            <Button type="submit" className="h-12" disabled={firstTime.busy || code.length !== 6 || pin.length !== 4}>Start</Button>
            <Button type="button" variant="quiet" onClick={back({ at: 'class' })}>Back</Button>
          </form>
        </Card>
      )}

      <ErrorNote message={error} />
    </Centered>
  );
}
