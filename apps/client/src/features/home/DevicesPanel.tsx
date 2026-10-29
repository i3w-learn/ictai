import { useEffect, useState } from 'react';
import { Monitor, Plus, Presentation } from 'lucide-react';
import type { Device, EnrolWindow } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Panel, useAction } from '../../ui/ui';

const KIND = { lab_pc: { label: 'Lab PC', icon: Monitor }, board: { label: 'Board', icon: Presentation } } as const;

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
      title={`Devices · ${devices.length}`}
      actions={
        enrolWindow ? (
          <Button variant="quiet" onClick={() => close.run()}>Stop adding</Button>
        ) : (
          <Button onClick={() => open.run()}><Plus className="size-4" strokeWidth={2.25} /> Add devices</Button>
        )
      }
    >
      {enrolWindow && minutesLeft > 0 && (
        <div className="grid justify-items-center gap-1 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-6">
          <span className="text-sm text-muted-foreground">Type this code on each new PC or board</span>
          <strong className="font-mono text-5xl tracking-[0.2em] text-primary">{enrolWindow.code}</strong>
          <span className="text-sm text-muted-foreground">Closes in {minutesLeft} min</span>
        </div>
      )}
      {devices.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">No devices yet. Click <b className="text-foreground">Add devices</b> to start.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
              <th className="py-2.5 pr-3 font-semibold">Name</th>
              <th className="py-2.5 pr-3 font-semibold">Type</th>
              <th className="py-2.5 pr-3 font-semibold">Version</th>
              <th className="py-2.5 font-semibold">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => {
              const Icon = KIND[d.kind].icon;
              return (
                <tr key={d.id} className="border-b border-border last:border-0">
                  <td className="py-3 pr-3 font-medium">{d.name}</td>
                  <td className="py-3 pr-3">
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Icon className="size-4" strokeWidth={1.75} /> {KIND[d.kind].label}</span>
                  </td>
                  <td className="py-3 pr-3 font-mono text-xs text-muted-foreground">{d.appVersion ?? '–'}</td>
                  <td className="py-3 text-muted-foreground tabular-nums">{d.lastSeen ? new Date(d.lastSeen).toLocaleTimeString() : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <ErrorNote message={refresh.error ?? open.error ?? close.error} />
    </Panel>
  );
}
