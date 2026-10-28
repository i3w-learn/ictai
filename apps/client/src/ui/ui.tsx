import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

export function Button({ variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' }) {
  return <button {...props} className={`btn btn-${variant} ${props.className ?? ''}`} />;
}

export function Field({ label, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} {...props} />
    </label>
  );
}

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? <p className="error" role="alert">{message}</p> : null;
}

// Runs an async action with a busy flag and a readable error; the shared pattern for every form.
export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (...args: A) => {
    setBusy(true);
    setError(null);
    try {
      await fn(...args);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error };
}
