import { GraduationCap } from 'lucide-react';
import type { Principal } from '@ict/contracts';
import { EnrolDevice } from '../features/setup/EnrolDevice';
import { FindServer } from '../features/setup/FindServer';
import { RolePicker } from '../features/setup/RolePicker';
import { Home } from '../features/home/Home';
import { StaffSignIn } from '../features/signin/StaffSignIn';
import { StudentSignIn } from '../features/signin/StudentSignIn';
import { Button, cn } from '../ui/ui';
import { useApp } from './app-context';
import type { Phase } from './app-state';

const ROLE_LABEL = { console: 'Server PC', student: 'Student PC', board: 'Smart board' } as const;

// Like a school ID card: the name, and the role under it in that role's colour.
// The coloured line across the top makes the role readable from across the room.
const PERSON = {
  admin: { label: 'Super Admin', bar: 'border-t-role-admin', text: 'text-role-admin' },
  teacher: { label: 'Teacher', bar: 'border-t-role-teacher', text: 'text-role-teacher' },
  student: { label: 'Student', bar: 'border-t-role-student', text: 'text-role-student' },
} as const;

function personOf(p: Principal | undefined): { kind: keyof typeof PERSON; name: string } | null {
  if (p?.kind === 'staff') return { kind: p.role === 'super_admin' ? 'admin' : 'teacher', name: p.displayName };
  if (p?.kind === 'student') return { kind: 'student', name: p.name };
  return null;
}

function Screen({ phase }: { phase: Phase }) {
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
    case 'home':
      return <Home />;
  }
}

export function App() {
  const { state, phase, dispatch, signOut, resetDevice } = useApp();
  const { role, server, device } = state.settings;
  const person = personOf(state.session?.principal);
  const look = person && PERSON[person.kind];

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      <header className={cn('flex h-16 shrink-0 items-center gap-4 border-b border-border bg-card/90 px-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)] backdrop-blur-md lg:px-6', look && ['border-t-4', look.bar])}>
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary shadow-[0_2px_8px_-2px_var(--primary)]">
            <GraduationCap className="size-5 text-primary-foreground" strokeWidth={2} />
          </div>
          <div className="leading-tight">
            <p className="font-display text-[15px] font-semibold tracking-tight">ICT App</p>
            {role && (
              <p className="text-[11px] tracking-wide text-muted-foreground">
                {ROLE_LABEL[role]}
                {device ? ` · ${device.name}` : ''}
              </p>
            )}
          </div>
        </div>

        {person && look && (
          <div className="min-w-0 border-l border-border pl-4 leading-tight">
            <p className="truncate text-[15px] font-semibold">{person.name}</p>
            <p className={cn('text-[12px] font-semibold', look.text)}>{look.label}</p>
          </div>
        )}

        <div className="flex-1" />

        {server && (
          <span className="hidden text-[13px] text-muted-foreground sm:inline">
            Server: <span className="text-foreground">{server.name}</span>
          </span>
        )}
        {server && !state.session && <Button variant="quiet" onClick={() => dispatch({ type: 'forget-server' })}>Change server</Button>}
        {role && !state.session && <Button variant="quiet" onClick={() => resetDevice()}>Reset device</Button>}
        {state.session && <Button variant="quiet" onClick={() => signOut()}>Sign out</Button>}
      </header>
      <main className="flex-1 overflow-y-auto px-6 py-9 lg:px-10">
        <Screen phase={phase} />
      </main>
    </div>
  );
}
