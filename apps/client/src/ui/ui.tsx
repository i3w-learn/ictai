import { useCallback, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Joins class names; later Tailwind classes win over earlier ones.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const BUTTON = {
  primary: 'bg-primary text-primary-foreground shadow-[0_2px_8px_-2px_var(--primary)] hover:bg-primary/90',
  quiet: 'border border-border bg-card text-foreground hover:border-foreground/25',
} as const;

// Large targets (44px) so buttons work on touch boards.
export function Button({ variant = 'primary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON[variant],
        className,
      )}
    />
  );
}

const CONTROL = 'h-11 w-full rounded-xl border border-border bg-card px-3 text-[15px] text-foreground placeholder:text-muted-foreground/60';

export function Field({ label, id, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <label className={cn('grid gap-1.5', className)} htmlFor={id}>
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <input id={id} {...props} className={CONTROL} />
    </label>
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(CONTROL, 'w-auto min-w-48', className)} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-3xl border border-card-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.03),0_16px_40px_-20px_rgba(49,46,129,0.2)]', className)}>
      {children}
    </div>
  );
}

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Card className="grid gap-5 p-6 lg:p-7">
      <header className="flex items-center justify-between gap-3">
        <SectionLabel>{title}</SectionLabel>
        {actions}
      </header>
      {children}
    </Card>
  );
}

// The heading of a panel or a block.
export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-lg font-semibold tracking-tight">{children}</h2>;
}

// Page title with an optional small line above it.
export function PageTitle({ eyebrow, children, sub }: { eyebrow?: ReactNode; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="grid gap-2">
      {eyebrow && <p className="text-[15px] font-medium text-secondary-foreground">{eyebrow}</p>}
      <h1 className="font-display text-3xl font-semibold tracking-tight text-balance">{children}</h1>
      {sub && <p className="text-muted-foreground">{sub}</p>}
    </div>
  );
}

// Centred column for setup and sign-in screens.
export function Centered({ narrow, children }: { narrow?: boolean; children: ReactNode }) {
  return <div className={cn('mx-auto mt-10 grid w-full gap-6', narrow ? 'max-w-md' : 'max-w-3xl')}>{children}</div>;
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-border bg-secondary px-4 py-3 text-sm text-secondary-foreground">{children}</div>;
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{message}</p> : null;
}

// A button that asks "Sure?" inline before acting. No browser confirm(): it blocks the webview.
export function ConfirmButton({ children, question, onConfirm }: { children: ReactNode; question: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  // type="button" throughout: inside a form these must never count as the form's Save.
  if (!asking) return <Button type="button" variant="quiet" onClick={() => setAsking(true)}>{children}</Button>;
  return (
    <span className="flex items-center gap-2 text-sm">
      {question}
      <Button type="button" className="bg-destructive text-white shadow-none hover:bg-destructive/90" onClick={() => { setAsking(false); onConfirm(); }}>Yes</Button>
      <Button type="button" variant="quiet" onClick={() => setAsking(false)}>No</Button>
    </span>
  );
}

// Holds the newest `value` for code that runs later (timers, replies from the server), so that code
// never works with an old copy. It is set before any effect of the same render runs.
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => { ref.current = value; });
  return ref;
}

// Runs an async action with a busy flag and a readable error; the shared pattern for every form.
export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `run` is one and the same function for as long as the screen lives, and always does the newest `fn`.
  const latest = useLatest(fn);
  const run = useCallback(async (...args: A) => {
    setBusy(true);
    setError(null);
    try {
      await latest.current(...args);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }, [latest]);
  const clear = useCallback(() => setError(null), []);
  return { run, busy, error, clear };
}
