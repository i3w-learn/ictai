import { useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, LockOpen, Monitor, Presentation } from 'lucide-react';
import type { Device } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ConfirmButton, ErrorNote, Panel, useAction } from '../../ui/ui';

const KIND = { lab_pc: { label: 'Lab PC', icon: Monitor }, board: { label: 'Board', icon: Presentation } } as const;

// "10:42" for today, "12 Nov, 10:42" for an earlier day.
function lastSeen(at: number, now: number) {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

// `canLock`: this person may run a lesson, so may lock and unlock screens.
export function DevicesPanel({ canLock }: { canLock: boolean }) {
  const { call } = useApp();
  const [devices, setDevices] = useState<Device[]>([]);
  // New PCs join by themselves. Staff can lock the lab so that no further device gets in.
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useAction(async () => {
    const [list, joining] = await Promise.all([call('GET /api/v1/devices'), call('GET /api/v1/devices/joining')]);
    setDevices(list);
    setOpen(joining.open);
  });
  const setJoining = useAction(async (to: boolean) => setOpen((await call('PUT /api/v1/devices/joining', { body: { open: to } })).open));
  const remove = useAction(async (id: string) => {
    await call('DELETE /api/v1/devices/:id', { params: { id } });
    await refresh.run();
  });
  // Spec 4.2: lock one screen, or every lab PC at once, to get the class to look up.
  const lockAll = useAction(async (locked: boolean) => setDevices(await call('PUT /api/v1/devices/lock', { body: { locked } })));
  const lockOne = useAction(async (id: string, locked: boolean) => setDevices(await call('PUT /api/v1/devices/:id/lock', { params: { id }, body: { locked } })));
  const lockedCount = devices.filter((d) => d.locked).length;
  const labPcs = devices.filter((d) => d.kind === 'lab_pc').length;
  // Re-read every few seconds: PCs join, switch on and off, and students sign in and out.
  const { run: refreshNow } = refresh;
  useEffect(() => {
    void refreshNow();
    const t = setInterval(() => {
      setNow(Date.now());
      void refreshNow();
    }, 5000);
    return () => clearInterval(t);
  }, [refreshNow]);

  return (
    <Panel
      title={devices.length === 0 ? 'Devices' : `Devices · ${devices.filter((d) => d.connected).length} of ${devices.length} connected`}
      actions={<>
        {canLock && lockedCount > 0 && <Button disabled={lockAll.busy} onClick={() => lockAll.run(false)}><Eye className="size-4" strokeWidth={2} /> Unlock all screens</Button>}
        {canLock && labPcs > 0 && lockedCount < labPcs && <Button variant="quiet" disabled={lockAll.busy} onClick={() => lockAll.run(true)}><EyeOff className="size-4" strokeWidth={2} /> Lock all screens</Button>}
        {open ? (
          <Button variant="quiet" disabled={setJoining.busy} onClick={() => setJoining.run(false)}><Lock className="size-4" strokeWidth={2} /> Lock the lab</Button>
        ) : (
          <Button disabled={setJoining.busy} onClick={() => setJoining.run(true)}><LockOpen className="size-4" strokeWidth={2} /> Unlock the lab</Button>
        )}
      </>}
    >
      <p className="text-sm text-muted-foreground">
        {open
          ? <>A new PC joins by itself when the ICT app is opened on it. See a PC you do not know? Press <b className="text-foreground">Remove</b> on its line. When every PC is in, <b className="text-foreground">Lock the lab</b> stops any other device from joining.</>
          : <>The lab is locked: no new PC or board can join. The ones below keep working.</>}
        {canLock && <> <b className="text-foreground">Lock all screens</b> covers every student's screen until you unlock it, so the class looks at you.</>}
      </p>
      {devices.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground">No devices yet. Open the ICT app on a lab PC and it shows up here.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[0.6875rem] tracking-[0.14em] text-muted-foreground uppercase">
              <th className="py-2.5 pr-3 font-semibold">Name</th>
              <th className="py-2.5 pr-3 font-semibold">Type</th>
              <th className="py-2.5 pr-3 font-semibold">Connection</th>
              <th className="py-2.5 pr-3 font-semibold">Student</th>
              <th className="py-2.5 pr-3 font-semibold">Version</th>
              <th className="py-2.5" />
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => {
              const Icon = KIND[d.kind].icon;
              return (
                <tr key={d.id} className="border-b border-border last:border-0">
                  <td className="py-3 pr-3 font-medium">
                    {d.name}
                    {d.locked && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-background"><EyeOff className="size-3" /> Screen locked</span>}
                  </td>
                  <td className="py-3 pr-3">
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Icon className="size-4" strokeWidth={1.75} /> {KIND[d.kind].label}</span>
                  </td>
                  <td className="py-3 pr-3">
                    {d.connected ? (
                      <span className="inline-flex items-center gap-2 font-medium text-emerald-700"><span className="size-2.5 rounded-full bg-emerald-500" /> Connected</span>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <span className="size-2.5 rounded-full bg-muted-foreground/40" /> Not connected
                        <span className="text-xs tabular-nums">{d.lastSeen ? `· last seen ${lastSeen(d.lastSeen, now)}` : '· never seen'}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    {d.student ? (
                      <span><span className="font-medium">{d.student.name ?? 'A student'}</span> <span className="text-muted-foreground">· Class {d.student.className}</span></span>
                    ) : (
                      <span className="text-muted-foreground">{d.kind === 'lab_pc' ? 'No one signed in' : '–'}</span>
                    )}
                  </td>
                  <td className="py-3 pr-3 font-mono text-xs text-muted-foreground">{d.appVersion ?? '–'}</td>
                  <td className="py-2 text-right">
                    <span className="inline-flex flex-wrap items-center justify-end gap-2">
                    {canLock && <Button variant="quiet" disabled={lockOne.busy} onClick={() => lockOne.run(d.id, !d.locked)}>{d.locked ? 'Unlock screen' : 'Lock screen'}</Button>}
                    <ConfirmButton question={`Remove ${d.name} from the lab?`} onConfirm={() => void remove.run(d.id)}>Remove</ConfirmButton>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <ErrorNote message={refresh.error ?? setJoining.error ?? remove.error ?? lockAll.error ?? lockOne.error} />
    </Panel>
  );
}
