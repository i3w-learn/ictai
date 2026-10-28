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
      return <div className="center muted">Starting…</div>;
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
  const { state, phase, signOut, resetDevice } = useApp();
  const { role, server, device } = state.settings;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">ICT App</span>
        {role && <span className="chip">{ROLE_LABEL[role]}{device ? ` · ${device.name}` : ''}</span>}
        {server && <span className="chip chip-ok">Connected to {server.name}</span>}
        <span className="spacer" />
        {state.session && <Button variant="quiet" onClick={() => signOut()}>Sign out</Button>}
        {role && !state.session && <Button variant="quiet" onClick={() => resetDevice()}>Reset device</Button>}
      </header>
      <main>
        <Screen phase={phase} />
      </main>
    </div>
  );
}
