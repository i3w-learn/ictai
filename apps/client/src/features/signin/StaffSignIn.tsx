import { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { useApp } from '../../app/app-context';
import { Button, Card, ErrorNote, Field, useAction } from '../../ui/ui';
import { useT } from '../../i18n/i18n';

export function StaffSignIn() {
  const { call, dispatch } = useApp();
  const t = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const signIn = useAction(async () => {
    const session = await call('POST /api/v1/auth/staff', { body: { username, password } }, 'none');
    dispatch({ type: 'session', session });
  });

  return (
    <Card className="mx-auto mt-10 w-full max-w-md p-7 sm:p-9">
      <div className="mb-7 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary shadow-[0_8px_20px_-8px_var(--primary)]">
          <GraduationCap className="size-7 text-primary-foreground" strokeWidth={1.75} />
        </div>
        <h1 className="font-display text-3xl font-semibold">{t('Welcome back')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('Sign in to manage the lab')}</p>
      </div>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void signIn.run(); }}>
        <Field id="username" label={t('Username')} autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        <Field id="password" label={t('Password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorNote message={signIn.error} />
        <Button type="submit" className="h-14 rounded-2xl text-lg" disabled={signIn.busy || !username || !password}>
          {signIn.busy ? t('Signing in…') : t('Sign in')}
        </Button>
      </form>
    </Card>
  );
}
