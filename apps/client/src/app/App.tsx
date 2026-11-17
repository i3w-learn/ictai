import { GraduationCap, LogOut } from 'lucide-react';
import type { Principal } from '@ict/contracts';
import { EnrolDevice } from '../features/setup/EnrolDevice';
import { FindServer } from '../features/setup/FindServer';
import { RolePicker } from '../features/setup/RolePicker';
import { Home } from '../features/home/Home';
import { RelayChip } from '../features/quizzes/RelayChip';
import { StaffSignIn } from '../features/signin/StaffSignIn';
import { StudentSignIn } from '../features/signin/StudentSignIn';
import { AuthShell } from '../ui/auth';
import { Button, ConfirmButton, cn } from '../ui/ui';
import { useApp } from './app-context';
import type { Phase } from './app-state';

const ROLE_LABEL = { console: 'Server PC', student: 'Student PC', board: 'Smart board' } as const;

// Like a school ID card: the name, and the role under it in that role's colour.
// The coloured line across the top makes the role readable from across the room.
const PERSON = {
  admin: { label: 'Super Admin', bar: 'border-t-role-admin', text: 'text-role-admin', fill: 'bg-role-admin' },
  teacher: { label: 'Teacher', bar: 'border-t-role-teacher', text: 'text-role-teacher', fill: 'bg-role-teacher' },
  student: { label: 'Student', bar: 'border-t-role-student', text: 'text-role-student', fill: 'bg-role-student' },
} as const;

// "Asha Verma" -> "AV": the letters in the round badge beside the name.
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

// What the coloured panel says beside the setup and sign-in screens.
const WELCOME = {
  setup: { heading: 'Let us set up this device', sub: 'It takes a minute, and you only do it once.' },
  student: { heading: 'Hello! Ready to learn?', sub: 'Pick your class and type your roll number to begin.' },
  staff: { heading: 'Your lab, in one place', sub: 'Quizzes, books, work and results for every class.' },
} as const;

function personOf(p: Principal | undefined): { kind: keyof typeof PERSON; name: string } | null {
  if (p?.kind === 'staff') return { kind: p.role === 'super_admin' ? 'admin' : 'teacher', name: p.displayName };
  if (p?.kind === 'student') return { kind: 'student', name: p.name };
  return null;
}

function Screen({ phase }: { phase: Exclude<Phase, 'home'> }) {
  const { state } = useApp();
  switch (phase) {
    case 'loading':
      return <div className="mt-20 text-center text-muted-foreground">Starting…</div>;
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

export function App() {
  const { state, phase, dispatch, signOut, resetDevice } = useApp();
  const { role, server, device } = state.settings;
  const person = personOf(state.session?.principal);
  const look = person && PERSON[person.kind];

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      <header className={cn('ui-topbar flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:px-6', look && ['border-t-4', look.bar])}>
        {/* The school comes first: it is what everyone in the room has in common. */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="ui-logo flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary shadow-[0_2px_8px_-2px_var(--primary)]">
            <GraduationCap className="size-5 text-primary-foreground" strokeWidth={2} />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="ui-school truncate font-display text-[1.0625rem] font-semibold tracking-tight">{server?.name ?? 'ICT App'}</p>
            <p className="ui-device truncate text-[0.75rem] text-muted-foreground">{[server && 'ICT App', role && ROLE_LABEL[role], device?.name].filter(Boolean).join(' · ')}</p>
          </div>
        </div>

        <div className="flex-1" />

        {state.session && <RelayChip />}
        {/* Both wipe what this PC knows, and it then has to join the lab again, so they ask first. */}
        {server && !state.session && <ConfirmButton question="Leave this server? This PC must join the lab again." onConfirm={() => dispatch({ type: 'forget-server' })}>Change server</ConfirmButton>}
        {role && !state.session && <ConfirmButton question="Wipe this PC's setup? It must be set up again." onConfirm={() => void resetDevice()}>Reset device</ConfirmButton>}
        {person && look && (
          <div className="flex min-w-0 items-center gap-2.5 border-l border-border pl-3">
            <span className={cn('ui-avatar grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-background', look.fill)} aria-hidden>{initials(person.name)}</span>
            <div className="hidden min-w-0 leading-tight sm:block">
              <p className="truncate text-[0.9375rem] font-semibold">{person.name}</p>
              <p className={cn('text-[0.75rem] font-semibold', look.text)}>{look.label}</p>
            </div>
          </div>
        )}
        {state.session && <Button variant="quiet" onClick={() => signOut()}><LogOut className="size-4" /> Sign out</Button>}
      </header>
      {/* The home screens bring their own side menu, so they lay themselves out. */}
      {phase === 'home' ? <Home /> : <AuthShell {...WELCOME[phase === 'sign-in' ? (role === 'student' ? 'student' : 'staff') : 'setup']}><Screen phase={phase} /></AuthShell>}
    </div>
  );
}
