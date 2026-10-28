import { useState } from 'react';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Field, useAction } from '../../ui/ui';

export function StaffSignIn() {
  const { call, dispatch } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const signIn = useAction(async () => {
    const session = await call('POST /api/v1/auth/staff', { body: { username, password } }, 'none');
    dispatch({ type: 'session', session });
  });

  return (
    <div className="center narrow">
      <h1>Teacher sign-in</h1>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void signIn.run(); }}>
        <Field id="username" label="Username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        <Field id="password" label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorNote message={signIn.error} />
        <Button type="submit" disabled={signIn.busy || !username || !password}>Sign in</Button>
      </form>
    </div>
  );
}
