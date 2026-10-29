import { GraduationCap } from 'lucide-react';
import { EnrolDevice } from '../features/setup/EnrolDevice';
import { FindServer } from '../features/setup/FindServer';
import { RolePicker } from '../features/setup/RolePicker';
import { Home } from '../features/home/Home';
import { StaffSignIn } from '../features/signin/StaffSignIn';
import { StudentSignIn } from '../features/signin/StudentSignIn';
import { Button } from '../ui/ui';
import { useApp } from './app-context';
import type { Phase } from './app-state';

const ROLE_LABEL = { console: 'Server PC', student: 'Student PC', board: 'Smart board' } as const;

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
  const p = state.session?.principal;
  const who = p ? (p.kind === 'staff' ? p.displayName : p.kind === 'student' ? p.name : null) : null;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-card/90 px-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)] backdrop-blur-md lg:px-6">
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

        <div className="flex-1" />

        {server && (
          <span className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-[12px] font-medium text-success">
            <span className="size-2 rounded-full bg-success" />
            {server.name}
          </span>
        )}
        {server && !state.session && <Button variant="quiet" onClick={() => dispatch({ type: 'forget-server' })}>Change server</Button>}
        {role && !state.session && <Button variant="quiet" onClick={() => resetDevice()}>Reset device</Button>}
        {state.session && (
          <>
            {who && (
              <div className="flex size-9 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground" title={who}>
                {who.charAt(0).toUpperCase()}
              </div>
            )}
            <Button variant="quiet" onClick={() => signOut()}>Sign out</Button>
          </>
        )}
      </header>
      <main className="flex-1 overflow-y-auto px-6 py-9 lg:px-10">
        <Screen phase={phase} />
      </main>
    </div>
  );
}
