import { useEffect, useRef, useState, type ReactNode } from 'react';
import jsQR from 'jsqr';
import { sameRoll, type RosterEntry, type SchoolClass, type Section } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { ApiCallError } from '../../core/api-client';
import { Button, Card, Centered, ErrorNote, Field, PageTitle, useAction } from '../../ui/ui';

// Where the student sits in the school: their class and, when the class has sections, their section.
type Place = { cls: SchoolClass; section: Section | null };
type Step =
  | { at: 'class' }
  | { at: 'section'; cls: SchoolClass; sections: Section[] }
  | { at: 'roll'; place: Place }
  | { at: 'confirm'; place: Place; student: RosterEntry }
  | { at: 'pin'; place: Place; student: RosterEntry }
  | { at: 'card' };

const placeLabel = (p: Place) => `Class ${p.cls.name}${p.section ? ` ${p.section.name}` : ''}`;

// Big tap target for the class and section grids (students use touch screens).
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

// Made for young students: pick your class, type your roll number, and you are in. No PIN and no code.
// Only a student the teacher has added gets in: the class, section and roll number are that student's ID.
export function StudentSignIn() {
  const { call, dispatch } = useApp();
  const [step, setStep] = useState<Step>({ at: 'class' });
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [rollNo, setRollNo] = useState('');
  const [pin, setPin] = useState('');

  const loadClasses = useAction(async () => setClasses(await call('GET /api/v1/auth/student/classes', {}, 'device')));
  useEffect(() => {
    void loadClasses.run();
  }, []);
  // A lab PC is often switched on before the server PC. Keep asking until the classes arrive,
  // so the screen fills in by itself and nobody has to restart the app.
  const waiting = step.at === 'class' && classes.length === 0;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void loadClasses.run(), 5000);
    return () => clearInterval(t);
  }, [waiting]);

  const openClass = useAction(async (cls: SchoolClass) => {
    const sections = await call('GET /api/v1/auth/student/sections', { query: { classId: cls.id } }, 'device');
    setStep(sections.length > 0 ? { at: 'section', cls, sections } : { at: 'roll', place: { cls, section: null } });
  });

  // Looks the roll number up in the class list the teacher made, and asks "is this you?".
  const findMe = useAction(async (place: Place) => {
    const roster = await call('GET /api/v1/auth/student/roster', { query: { classId: place.cls.id } }, 'device');
    const same = roster.filter((s) => sameRoll(s, place.section?.id ?? null, rollNo));
    if (same.length > 1) throw new Error(`More than one student has roll number ${rollNo.trim()}. Ask your teacher.`);
    if (!same[0]) throw new Error(`Roll number ${rollNo.trim()} is not in ${placeLabel(place)}. Ask your teacher to add you.`);
    setStep({ at: 'confirm', place, student: same[0] });
  });

  const signIn = useAction(async (place: Place) => {
    try {
      const session = await call('POST /api/v1/auth/student/roll', {
        body: { classId: place.cls.id, sectionId: place.section?.id ?? null, rollNo: rollNo.trim() },
      }, 'device');
      dispatch({ type: 'session', session });
    } catch (e) {
      // The teacher gave this student a PIN: ask for it.
      if (e instanceof ApiCallError && e.code === 'PIN_REQUIRED') {
        return setStep((s) => (s.at === 'confirm' ? { at: 'pin', place: s.place, student: s.student } : s));
      }
      throw e;
    }
  });

  const withPin = useAction(async (studentId: string) => {
    const session = await call('POST /api/v1/auth/student/pin', { body: { studentId, pin } }, 'device');
    dispatch({ type: 'session', session });
  });

  // A card's QR holds a long sign-in token. A hand scanner types it and presses Enter; the camera reads it directly.
  const [cardText, setCardText] = useState('');
  const withCard = useAction(async (qrToken: string) => {
    setCardText('');
    const session = await call('POST /api/v1/auth/student/qr', { body: { qrToken: qrToken.trim() } }, 'device');
    dispatch({ type: 'session', session });
  });

  // Going back wipes the trouble shown so far, so an old message does not follow the student to the next screen.
  const forget = () => [openClass, findMe, signIn, withPin, withCard].forEach((a) => a.clear());
  const go = (to: Step) => () => { forget(); setPin(''); setStep(to); };
  const startOver = () => { forget(); setRollNo(''); setPin(''); setStep({ at: 'class' }); };
  // Only the trouble that belongs to the screen in view.
  const error = {
    class: loadClasses.error ?? openClass.error,
    section: null,
    roll: findMe.error,
    confirm: signIn.error,
    pin: withPin.error,
    card: withCard.error,
  }[step.at];
  const tiles = 'grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3';
  const big = '[&_input]:h-14 [&_input]:text-center [&_input]:text-2xl [&_input]:font-semibold';

  return (
    <Centered narrow={step.at !== 'class' && step.at !== 'section'}>
      {step.at === 'class' && (
        <>
          <PageTitle eyebrow="Sign in">Which class are you in?</PageTitle>
          <div className={tiles}>
            {classes.map((c) => <Tile key={c.id} onClick={() => openClass.run(c)}>{c.name}</Tile>)}
          </div>
          {classes.length === 0 && !loadClasses.busy && !loadClasses.error && (
            <p className="text-muted-foreground">No classes yet. Ask your teacher to add your class on the server PC.</p>
          )}
          <div><Button variant="quiet" onClick={go({ at: 'card' })}>Scan my card</Button></div>
        </>
      )}

      {step.at === 'section' && (
        <>
          <PageTitle eyebrow={`Class ${step.cls.name}`}>Which section?</PageTitle>
          <div className={tiles}>
            {step.sections.map((x) => <Tile key={x.id} onClick={() => setStep({ at: 'roll', place: { cls: step.cls, section: x } })}>{x.name}</Tile>)}
          </div>
          <div><Button variant="quiet" onClick={startOver}>Back</Button></div>
        </>
      )}

      {step.at === 'roll' && (
        <Card className="p-6 sm:p-8">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (rollNo.trim()) void findMe.run(step.place); }}>
            <PageTitle eyebrow={placeLabel(step.place)}>What is your roll number?</PageTitle>
            <Field id="roll-no" label="Roll number" inputMode="numeric" maxLength={16} autoFocus autoComplete="off" className={big} value={rollNo} onChange={(e) => setRollNo(e.target.value)} />
            <Button type="submit" className="h-12" disabled={findMe.busy || !rollNo.trim()}>Next</Button>
            <Button type="button" variant="quiet" onClick={startOver}>Back</Button>
          </form>
        </Card>
      )}

      {step.at === 'confirm' && (
        <Card className="grid gap-4 p-6 sm:p-8">
          <PageTitle eyebrow={`${placeLabel(step.place)} · Roll ${step.student.rollNo ?? rollNo.trim()}`}>Are you {step.student.name}?</PageTitle>
          <Button className="h-14 text-lg" autoFocus disabled={signIn.busy} onClick={() => signIn.run(step.place)}>Yes, that is me</Button>
          <Button variant="quiet" onClick={go({ at: 'roll', place: step.place })}>No, go back</Button>
        </Card>
      )}

      {step.at === 'pin' && (
        <Card className="p-6 sm:p-8">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void withPin.run(step.student.id); }}>
            <PageTitle eyebrow={placeLabel(step.place)}>Hi {step.student.name}</PageTitle>
            <Field id="pin" label="Your 4-digit PIN" type="password" inputMode="numeric" maxLength={4} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            <Button type="submit" className="h-12" disabled={withPin.busy || pin.length !== 4}>Sign in</Button>
            <Button type="button" variant="quiet" onClick={go({ at: 'roll', place: step.place })}>Not you?</Button>
          </form>
        </Card>
      )}

      {step.at === 'card' && (
        <Card className="p-6 sm:p-8">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (cardText.trim().length >= 16) void withCard.run(cardText); }}>
            <PageTitle sub="Hold your sign-in card up to the camera, or scan it with the scanner.">Scan your card</PageTitle>
            <CardCamera onRead={(text) => { if (!withCard.busy) void withCard.run(text); }} />
            <Field id="card-token" label="Card scanner" type="password" autoComplete="off" autoFocus value={cardText} onChange={(e) => setCardText(e.target.value)} />
            <Button type="button" variant="quiet" onClick={startOver}>Back</Button>
          </form>
        </Card>
      )}

      <ErrorNote message={error} />
    </Centered>
  );
}
