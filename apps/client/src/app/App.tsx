import { useCallback, useSyncExternalStore } from 'react';
import { GraduationCap, Lock, LogOut, MonitorUp, MonitorX } from 'lucide-react';
import { deviceRoom, type Principal, type ScreenLockState } from '@ict/contracts';
import { EnrolDevice } from '../features/setup/EnrolDevice';
import { FindServer } from '../features/setup/FindServer';
import { RolePicker } from '../features/setup/RolePicker';
import { Home } from '../features/home/Home';
import { RelayChip } from '../features/quizzes/RelayChip';
import { StaffSignIn } from '../features/signin/StaffSignIn';
import { StudentSignIn } from '../features/signin/StudentSignIn';
import { AuthShell } from '../ui/auth';
import { Button, ConfirmButton, cn, useAction } from '../ui/ui';
import { LanguageProvider, LanguageSwitch, tk, useT } from '../i18n/i18n';
import { useApp, useRelayRoom } from './app-context';
import type { Phase } from './app-state';

const ROLE_LABEL = { console: tk('Server PC'), student: tk('Student PC'), board: tk('Smart board') } as const;

// Like a school ID card: the name, and the role under it in that role's colour.
// The coloured line across the top makes the role readable from across the room.
const PERSON = {
  admin: { label: tk('Super Admin'), bar: 'border-t-role-admin', text: 'text-role-admin', fill: 'bg-role-admin' },
  teacher: { label: tk('Teacher'), bar: 'border-t-role-teacher', text: 'text-role-teacher', fill: 'bg-role-teacher' },
  student: { label: tk('Student'), bar: 'border-t-role-student', text: 'text-role-student', fill: 'bg-role-student' },
} as const;

// "Asha Verma" -> "AV": the letters in the round badge beside the name.
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

// What the coloured panel says beside the setup and sign-in screens.
const WELCOME = {
  setup: { heading: tk('Let us set up this device'), sub: tk('It takes a minute, and you only do it once.') },
  student: { heading: tk('Hello! Ready to learn?'), sub: tk('Pick your class and type your roll number to begin.') },
  staff: { heading: tk('Your lab, in one place'), sub: tk('Quizzes, books, work and results for every class.') },
} as const;

function personOf(p: Principal | undefined): { kind: keyof typeof PERSON; name: string } | null {
  if (p?.kind === 'staff') return { kind: p.role === 'super_admin' ? 'admin' : 'teacher', name: p.displayName };
  if (p?.kind === 'student') return { kind: 'student', name: p.name };
  return null;
}

function Screen({ phase }: { phase: Exclude<Phase, 'home'> }) {
  const { state } = useApp();
  const t = useT();
  switch (phase) {
    case 'loading':
      return <div className="mt-20 text-center text-muted-foreground">{t('Starting…')}</div>;
    case 'pick-role':
      return <RolePicker />;
    case 'find-server':
      return <FindServer />;
    case 'enrol':
      return <EnrolDevice />;
    case 'sign-in':
      return state.settings.role === 'student' ? <StudentSignIn /> : <StaffSignIn />;
  }
}

// What a locked PC shows over everything else. There is nothing to press: only the teacher opens it.
function LockedScreen({ byTimetable }: { byTimetable: boolean }) {
  const t = useT();
  return (
    <div role="alertdialog" aria-label={t('This screen is locked')} className="fixed inset-0 z-[100] grid place-items-center bg-foreground/95 p-8 text-center text-background">
      <div className="grid justify-items-center gap-5">
        <span className="grid size-24 place-items-center rounded-full bg-background/15"><Lock className="size-11" strokeWidth={1.75} /></span>
        <h1 className="font-display text-5xl font-semibold tracking-tight">{byTimetable ? t('The lab is closed for now') : t('Look at your teacher')}</h1>
        <p className="max-w-xl text-xl text-background/80">{byTimetable
          ? t('No class has the lab right now. This screen opens when a lab period starts, or when a teacher unlocks it.')
          : t('Your teacher has locked this screen. It opens again when your teacher unlocks it.')}</p>
      </div>
    </div>
  );
}

// Opens and closes the board window: a second window with only the lesson, for a board plugged into
// this PC as a second screen. For staff who may show things to a class.
function BoardButton() {
  const { present, state } = useApp();
  const t = useT();
  const watch = useCallback((fn: () => void) => present?.onChange(fn) ?? (() => undefined), [present]);
  const open = useSyncExternalStore(watch, () => present?.isOpen ?? false);
  const flip = useAction(async () => { await (open ? present?.close() : present?.open()); });
  const me = state.session?.principal;
  if (!present || me?.kind !== 'staff' || !me.permissions.includes('lesson.present')) return null;
  return (
    <>
      {flip.error && <span className="text-sm font-medium text-destructive" role="alert">{t('The board window could not be opened.')}</span>}
      <Button variant="quiet" disabled={flip.busy} onClick={() => flip.run()} title={t('A second window with only the lesson, for a board plugged into this PC as a second screen.')}>
        {open ? <MonitorX className="size-4" /> : <MonitorUp className="size-4" />} {open ? t('Close the board window') : t('Open on the board')}
      </Button>
    </>
  );
}

// The setup and sign-in screens, beside the coloured panel that says what they are for.
function Welcome({ phase }: { phase: Exclude<Phase, 'home'> }) {
  const t = useT();
  const { state } = useApp();
  const words = WELCOME[phase === 'sign-in' ? (state.settings.role === 'student' ? 'student' : 'staff') : 'setup'];
  return <AuthShell heading={t(words.heading)} sub={t(words.sub)}><Screen phase={phase} /></AuthShell>;
}

// The language choice sits above everything, so the setup and sign-in screens have it too.
export function App() {
  return <LanguageProvider><AppScreens /></LanguageProvider>;
}

function AppScreens() {
  const t = useT();
  const { state, phase, dispatch, signOut, resetDevice } = useApp();
  const { role, server, device } = state.settings;
  const person = personOf(state.session?.principal);
  const look = person && PERSON[person.kind];
  // A lab PC or board listens for a teacher locking its screen, signed in or not.
  const lock = useRelayRoom<ScreenLockState>(device ? deviceRoom(device.deviceId) : null).state;
  const locked = lock?.locked === true;

  return (
    <>
    {locked && <LockedScreen byTimetable={lock?.byTimetable === true} />}
    {/* While locked, nothing behind the lock can be reached with the keyboard either. */}
    <div inert={locked} className="flex h-screen w-full flex-col overflow-hidden">
      <header className={cn('ui-topbar flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:px-6', look && ['border-t-4', look.bar])}>
        {/* The school comes first: it is what everyone in the room has in common. */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="ui-logo flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary shadow-[0_2px_8px_-2px_var(--primary)]">
            <GraduationCap className="size-5 text-primary-foreground" strokeWidth={2} />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="ui-school truncate font-display text-[1.0625rem] font-semibold tracking-tight">{server?.name ?? 'ICT App'}</p>
            <p className="ui-device truncate text-[0.75rem] text-muted-foreground">{[server && 'ICT App', role && t(ROLE_LABEL[role]), device?.name].filter(Boolean).join(' · ')}</p>
          </div>
        </div>

        <div className="flex-1" />

        <LanguageSwitch />
        {state.session && <RelayChip />}
        <BoardButton />
        {/* Both wipe what this PC knows, and it then has to join the lab again, so they ask first. */}
        {server && !state.session && <ConfirmButton question={t('Leave this server? This PC must join the lab again.')} onConfirm={() => dispatch({ type: 'forget-server' })}>{t('Change server')}</ConfirmButton>}
        {role && !state.session && <ConfirmButton question={t("Wipe this PC's setup? It must be set up again.")} onConfirm={() => void resetDevice()}>{t('Reset device')}</ConfirmButton>}
        {person && look && (
          <div className="flex min-w-0 items-center gap-2.5 border-l border-border pl-3">
            <span className={cn('ui-avatar grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-background', look.fill)} aria-hidden>{initials(person.name)}</span>
            <div className="hidden min-w-0 leading-tight sm:block">
              <p className="truncate text-[0.9375rem] font-semibold">{person.name}</p>
              <p className={cn('text-[0.75rem] font-semibold', look.text)}>{t(look.label)}</p>
            </div>
          </div>
        )}
        {state.session && <Button variant="quiet" onClick={() => signOut()}><LogOut className="size-4" /> {t('Sign out')}</Button>}
      </header>
      {/* The home screens bring their own side menu, so they lay themselves out. */}
      {phase === 'home' ? <Home /> : <Welcome phase={phase} />}
    </div>
    </>
  );
}
