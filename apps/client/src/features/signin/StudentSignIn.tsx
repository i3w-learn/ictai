import { useEffect, useState } from 'react';
import type { RosterEntry, SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Field, useAction } from '../../ui/ui';

type Step = { at: 'class' } | { at: 'name'; cls: SchoolClass } | { at: 'pin'; student: RosterEntry } | { at: 'first-time' };

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

  return (
    <div className="center">
      {step.at === 'class' && (
        <>
          <h1>Which class are you in?</h1>
          <div className="tiles">
            {classes.map((c) => <button key={c.id} className="tile" onClick={() => openClass.run(c)}>{c.name}</button>)}
          </div>
          <Button variant="quiet" onClick={back({ at: 'first-time' })}>First time here? Use a code</Button>
        </>
      )}

      {step.at === 'name' && (
        <>
          <h1>Class {step.cls.name}: tap your name</h1>
          <div className="tiles">
            {roster.map((s) => <button key={s.id} className="tile" onClick={() => setStep({ at: 'pin', student: s })}>{s.name}</button>)}
          </div>
          <Button variant="quiet" onClick={back({ at: 'class' })}>Back</Button>
        </>
      )}

      {step.at === 'pin' && (
        <form className="stack narrow" onSubmit={(e) => { e.preventDefault(); void withPin.run(step.student.id); }}>
          <h1>Hi {step.student.name}</h1>
          <Field id="pin" label="Your 4-digit PIN" type="password" inputMode="numeric" maxLength={4} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          <Button type="submit" disabled={withPin.busy || pin.length !== 4}>Sign in</Button>
          <Button type="button" variant="quiet" onClick={back({ at: 'class' })}>Not you?</Button>
        </form>
      )}

      {step.at === 'first-time' && (
        <form className="stack narrow" onSubmit={(e) => { e.preventDefault(); void firstTime.run(); }}>
          <h1>First sign-in</h1>
          <Field id="first-code" label="Code from your teacher" inputMode="numeric" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <Field id="new-pin" label="Choose a 4-digit PIN" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          <Button type="submit" disabled={firstTime.busy || code.length !== 6 || pin.length !== 4}>Start</Button>
          <Button type="button" variant="quiet" onClick={back({ at: 'class' })}>Back</Button>
        </form>
      )}

      <ErrorNote message={error} />
    </div>
  );
}
