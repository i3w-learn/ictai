import { useState } from 'react';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Field, useAction } from '../../ui/ui';

// Spec 4.2: a lab PC or board joins with the 6-digit code shown on the console.
export function EnrolDevice() {
  const { state, platform, call, dispatch } = useApp();
  const role = state.settings.role!;
  const [code, setCode] = useState('');
  const [name, setName] = useState(role === 'board' ? 'BOARD-' : 'LAB-PC-');

  const enrol = useAction(async () => {
    const server = state.settings.server!;
    const res = await call(
      'POST /api/v1/auth/device/enrol',
      { body: { code, kind: role === 'board' ? 'board' : 'lab_pc', name, appVersion: platform.appVersion } },
      'none',
    );
    // Spec 8.2: the server confirms the certificate we pinned at discovery.
    if (res.serverId !== server.serverId || res.certFp !== server.certFp) {
      throw new Error('The server did not confirm its identity. Do not use this server; ask your admin.');
    }
    dispatch({ type: 'device', device: { deviceId: res.deviceId, token: res.token, name } });
  });

  return (
    <div className="center narrow">
      <h1>Add this {role === 'board' ? 'board' : 'PC'} to the lab</h1>
      <p className="muted">On the server PC, open <b>Devices → Add devices</b> and type the code shown there.</p>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void enrol.run(); }}>
        <Field id="enrol-code" label="Code" inputMode="numeric" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        <Field id="device-name" label="Name for this device" value={name} onChange={(e) => setName(e.target.value)} />
        <ErrorNote message={enrol.error} />
        <Button type="submit" disabled={enrol.busy || code.length !== 6 || !name.trim()}>Add to lab</Button>
      </form>
    </div>
  );
}
