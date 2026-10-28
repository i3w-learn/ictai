import { useEffect, useState } from 'react';
import type { Device, EnrolWindow } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Panel, useAction } from '../../ui/ui';

const KIND_LABEL: Record<Device['kind'], string> = { lab_pc: 'Lab PC', board: 'Board' };

export function DevicesPanel() {
  const { call } = useApp();
  const [devices, setDevices] = useState<Device[]>([]);
  const [enrolWindow, setEnrolWindow] = useState<EnrolWindow | null>(null);
  const [now, setNow] = useState(Date.now());

  const refresh = useAction(async () => setDevices(await call('GET /api/v1/devices')));
  const open = useAction(async () => setEnrolWindow(await call('POST /api/v1/devices/enrol-window', { body: { minutes: 30 } })));
  const close = useAction(async () => {
    await call('DELETE /api/v1/devices/enrol-window');
    setEnrolWindow(null);
  });

  // While the window is open, tick the countdown and pick up newly added devices.
  useEffect(() => {
    void refresh.run();
    if (!enrolWindow) return;
    const t = setInterval(() => {
      setNow(Date.now());
      void refresh.run();
    }, 3000);
    return () => clearInterval(t);
  }, [enrolWindow]);

  const minutesLeft = enrolWindow ? Math.max(0, Math.ceil((enrolWindow.closesAt - now) / 60_000)) : 0;

  return (
    <Panel
      title="Devices"
      actions={enrolWindow ? <Button variant="quiet" onClick={() => close.run()}>Stop adding</Button> : <Button onClick={() => open.run()}>Add devices</Button>}
    >
      {enrolWindow && minutesLeft > 0 && (
        <div className="code-box">
          <span className="muted">Type this code on each new PC or board</span>
          <strong className="code">{enrolWindow.code}</strong>
          <span className="muted">Closes in {minutesLeft} min</span>
        </div>
      )}
      {devices.length === 0 ? (
        <p className="muted">No devices yet.</p>
      ) : (
        <table className="table">
          <thead><tr><th>Name</th><th>Type</th><th>Version</th><th>Last seen</th></tr></thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{KIND_LABEL[d.kind]}</td>
                <td className="mono">{d.appVersion ?? '–'}</td>
                <td>{d.lastSeen ? new Date(d.lastSeen).toLocaleTimeString() : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ErrorNote message={refresh.error ?? open.error ?? close.error} />
    </Panel>
  );
}
