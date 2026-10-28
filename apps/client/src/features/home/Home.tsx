import { useApp } from '../../app/app-context';
import { DevicesPanel } from './DevicesPanel';
import { StudentsPanel } from './StudentsPanel';

export function Home() {
  const { state } = useApp();
  const p = state.session!.principal;

  if (p.kind === 'student') {
    return (
      <div className="center">
        <h1>Hello, {p.name}</h1>
        <p className="muted">When your teacher starts a lesson, it will open here.</p>
      </div>
    );
  }

  if (p.kind === 'staff' && state.settings.role === 'console') {
    return (
      <div className="dash">
        <h1>Welcome, {p.displayName}</h1>
        {p.permissions.includes('setup.devices') && <DevicesPanel />}
        {p.permissions.includes('students.manage') && <StudentsPanel />}
      </div>
    );
  }

  return (
    <div className="center">
      <h1>Ready, {p.kind === 'staff' ? p.displayName : 'device'}</h1>
      <p className="muted">Live lessons arrive in the next milestone (M2).</p>
    </div>
  );
}
