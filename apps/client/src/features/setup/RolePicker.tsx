import { Monitor, Presentation, Server, type LucideIcon } from 'lucide-react';
import { useApp } from '../../app/app-context';
import type { Role } from '../../app/app-state';
import { Centered, PageTitle } from '../../ui/ui';

const ROLES: { role: Role; title: string; detail: string; icon: LucideIcon }[] = [
  { role: 'console', title: 'Server PC', detail: 'The lab’s main PC. Admin and teachers manage the lab here.', icon: Server },
  { role: 'student', title: 'Student PC', detail: 'A lab PC that students sign in to.', icon: Monitor },
  { role: 'board', title: 'Smart board', detail: 'The board at the front of the class.', icon: Presentation },
];

export function RolePicker() {
  const { dispatch } = useApp();
  return (
    <Centered>
      <PageTitle eyebrow="Setup" sub="Pick once. You can change it later from Settings.">What is this device?</PageTitle>
      <div className="grid gap-4 sm:grid-cols-3">
        {ROLES.map((r) => (
          <button
            key={r.role}
            className="group grid cursor-pointer gap-3 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-md"
            onClick={() => dispatch({ type: 'role', role: r.role })}
          >
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <r.icon className="size-5" strokeWidth={1.75} />
            </span>
            <strong className="font-display text-lg font-semibold">{r.title}</strong>
            <span className="text-sm text-muted-foreground">{r.detail}</span>
          </button>
        ))}
      </div>
    </Centered>
  );
}
