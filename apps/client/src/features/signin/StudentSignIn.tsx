import { useEffect, useRef, useState, type ReactNode } from 'react';
import jsQR from 'jsqr';
import type { RosterEntry, SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, Centered, ErrorNote, Field, PageTitle, useAction } from '../../ui/ui';

type Step = { at: 'class' } | { at: 'name'; cls: SchoolClass } | { at: 'pin'; student: RosterEntry } | { at: 'first-time' } | { at: 'card' };

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

// Shows the webcam and reports the first QR code it sees. A PC with no camera shows nothing here;
// the card scanner field below still works.
function CardCamera({ onRead }: { onRead: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(!navigator.mediaDevices?.getUserMedia);
  const report = useRef(onRead);
  report.current = onRead;

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const canvas = document.createElement('canvas');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } } }).then(async (s) => {
      stream = s;
      const el = video.current;
      if (stopped || !el) return s.getTracks().forEach((t) => t.stop());
      el.srcObject = s;
      await el.play().catch(() => undefined);
      const paint = canvas.getContext('2d', { willReadFrequently: true });
      let last = '';
      timer = setInterval(() => {
        if (!paint || el.readyState < 2 || !el.videoWidth) return;
        canvas.width = el.videoWidth;
        canvas.height = el.videoHeight;
        paint.drawImage(el, 0, 0);
        const frame = paint.getImageData(0, 0, canvas.width, canvas.height);
        const text = jsQR(frame.data, frame.width, frame.height)?.data;
        // The same card held still is reported once, not four times a second.
        if (text && text !== last) { last = text; report.current(text); }
      }, 250);
    }).catch(() => setFailed(true));
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (failed) return null;
  return <video ref={video} muted playsInline className="aspect-video w-full rounded-xl bg-secondary object-cover" />;
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

  // A card's QR holds a long sign-in token. A hand scanner types it and presses Enter; the camera reads it directly.
  const [cardText, setCardText] = useState('');
  const withCard = useAction(async (qrToken: string) => {
    setCardText('');
    const session = await call('POST /api/v1/auth/student/qr', { body: { qrToken: qrToken.trim() } }, 'device');
    dispatch({ type: 'session', session });
  });

  const back = (to: Step) => () => { setPin(''); setStep(to); };
  const error = loadClasses.error ?? openClass.error ?? withPin.error ?? firstTime.error ?? withCard.error;
  const tiles = 'grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3';

  return (
    <Centered narrow={step.at === 'pin' || step.at === 'first-time' || step.at === 'card'}>
      {step.at === 'class' && (
        <>
          <PageTitle eyebrow="Sign in">Which class are you in?</PageTitle>
          <div className={tiles}>
            {classes.map((c) => <Tile key={c.id} onClick={() => openClass.run(c)}>{c.name}</Tile>)}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="quiet" onClick={back({ at: 'card' })}>Scan my card</Button>
            <Button variant="quiet" onClick={back({ at: 'first-time' })}>First time here? Use a code</Button>
          </div>
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

      {step.at === 'card' && (
        <Card className="p-6 sm:p-8">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (cardText.trim().length >= 16) void withCard.run(cardText); }}>
            <PageTitle sub="Hold your sign-in card up to the camera, or scan it with the scanner.">Scan your card</PageTitle>
            <CardCamera onRead={(text) => { if (!withCard.busy) void withCard.run(text); }} />
            <Field id="card-token" label="Card scanner" type="password" autoComplete="off" autoFocus value={cardText} onChange={(e) => setCardText(e.target.value)} />
            <Button type="button" variant="quiet" onClick={back({ at: 'class' })}>Back</Button>
          </form>
        </Card>
      )}

      <ErrorNote message={error} />
    </Centered>
  );
}
