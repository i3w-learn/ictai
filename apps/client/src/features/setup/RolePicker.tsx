import { useApp } from '../../app/app-context';
import type { Role } from '../../app/app-state';

const ROLES: { role: Role; title: string; detail: string }[] = [
  { role: 'console', title: 'Server PC', detail: 'The lab’s main PC. Admin and teachers manage the lab here.' },
  { role: 'student', title: 'Student PC', detail: 'A lab PC that students sign in to.' },
  { role: 'board', title: 'Smart board', detail: 'The board at the front of the class.' },
];

export function RolePicker() {
  const { dispatch } = useApp();
  return (
    <div className="center">
      <h1>What is this device?</h1>
      <p className="muted">Pick once. You can change it later from Settings.</p>
      <div className="choices">
        {ROLES.map((r) => (
          <button key={r.role} className="choice" onClick={() => dispatch({ type: 'role', role: r.role })}>
            <strong>{r.title}</strong>
            <span>{r.detail}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
