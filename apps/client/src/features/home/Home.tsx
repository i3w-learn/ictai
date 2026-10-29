import { useApp } from '../../app/app-context';
import { Centered, PageTitle } from '../../ui/ui';
import { DevicesPanel } from './DevicesPanel';
import { StudentsPanel } from './StudentsPanel';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function Home() {
  const { state } = useApp();
  const p = state.session!.principal;

  if (p.kind === 'student') {
    return (
      <Centered>
        <PageTitle eyebrow={greeting()} sub="When your teacher starts a lesson, it will open here.">Hello, {p.name}</PageTitle>
      </Centered>
    );
  }

  if (p.kind === 'staff' && state.settings.role === 'console') {
    const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    return (
      <div className="mx-auto grid max-w-6xl gap-8">
        <header className="border-b border-border pb-7">
          <PageTitle eyebrow={`${today} · ${greeting()}, ${p.displayName}`}>Your lab today</PageTitle>
        </header>
        {p.permissions.includes('setup.devices') && <DevicesPanel />}
        {p.permissions.includes('students.manage') && <StudentsPanel />}
      </div>
    );
  }

  return (
    <Centered>
      <PageTitle sub="Live lessons arrive in the next milestone (M2).">Ready, {p.kind === 'staff' ? p.displayName : 'device'}</PageTitle>
    </Centered>
  );
}
