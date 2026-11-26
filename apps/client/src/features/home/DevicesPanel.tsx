import { useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, LockOpen, Monitor, Presentation } from 'lucide-react';
import type { Device } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ConfirmButton, ErrorNote, Panel, useAction } from '../../ui/ui';
import { tk, useLang } from '../../i18n/i18n';
import { rich } from './audit-words';

const KIND = { lab_pc: { label: tk('Lab PC'), icon: Monitor }, board: { label: tk('Board'), icon: Presentation } } as const;

// "10:42" for today, "12 Nov, 10:42" for an earlier day.
function lastSeen(at: number, now: number, locale: string | undefined) {
  const d = new Date(at);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}, ${time}`;
}

// `canLock`: this person may run a lesson, so may lock and unlock screens.
export function DevicesPanel({ canLock }: { canLock: boolean }) {
  const { call } = useApp();
  const { t, locale } = useLang();
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
    const timer = setInterval(() => {
      setNow(Date.now());
      void refreshNow();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshNow]);

  return (
    <Panel
      title={devices.length === 0 ? t('Devices') : t('Devices · {n} of {total} connected', { n: devices.filter((d) => d.connected).length, total: devices.length })}
      actions={<>
        {canLock && lockedCount > 0 && <Button disabled={lockAll.busy} onClick={() => lockAll.run(false)}><Eye className="size-4" strokeWidth={2} /> {t('Unlock all screens')}</Button>}
        {canLock && labPcs > 0 && lockedCount < labPcs && <Button variant="quiet" disabled={lockAll.busy} onClick={() => lockAll.run(true)}><EyeOff className="size-4" strokeWidth={2} /> {t('Lock all screens')}</Button>}
        {open ? (
          <Button variant="quiet" disabled={setJoining.busy} onClick={() => setJoining.run(false)}><Lock className="size-4" strokeWidth={2} /> {t('Lock the lab')}</Button>
        ) : (
          <Button disabled={setJoining.busy} onClick={() => setJoining.run(true)}><LockOpen className="size-4" strokeWidth={2} /> {t('Unlock the lab')}</Button>
        )}
      </>}
    >
      <p className="text-sm text-muted-foreground">
        {open
          ? <>{t('A new PC joins by itself when the ICT app is opened on it.')} {rich(t('See a PC you do not know? Press {button} on its line.'), { button: <b className="text-foreground">{t('Remove')}</b> })} {rich(t('When every PC is in, {button} stops any other device from joining.'), { button: <b className="text-foreground">{t('Lock the lab')}</b> })}</>
          : <>{t('The lab is locked: no new PC or board can join. The ones below keep working.')}</>}
        {canLock && <> {rich(t("{button} covers every student's screen until you unlock it, so the class looks at you."), { button: <b className="text-foreground">{t('Lock all screens')}</b> })}</>}
      </p>
      {devices.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground">{t('No devices yet. Open the ICT app on a lab PC and it shows up here.')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[0.6875rem] tracking-[0.14em] text-muted-foreground uppercase">
              <th className="py-2.5 pr-3 font-semibold">{t('Name')}</th>
              <th className="py-2.5 pr-3 font-semibold">{t('Type')}</th>
              <th className="py-2.5 pr-3 font-semibold">{t('Connection')}</th>
              <th className="py-2.5 pr-3 font-semibold">{t('Student')}</th>
              <th className="py-2.5 pr-3 font-semibold">{t('Version')}</th>
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
                    {d.locked && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-background"><EyeOff className="size-3" /> {t('Screen locked')}</span>}
                  </td>
                  <td className="py-3 pr-3">
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Icon className="size-4" strokeWidth={1.75} /> {t(KIND[d.kind].label)}</span>
                  </td>
                  <td className="py-3 pr-3">
                    {d.connected ? (
                      <span className="inline-flex items-center gap-2 font-medium text-emerald-700"><span className="size-2.5 rounded-full bg-emerald-500" /> {t('Connected')}</span>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <span className="size-2.5 rounded-full bg-muted-foreground/40" /> {t('Not connected')}
                        <span className="text-xs tabular-nums">· {d.lastSeen ? t('last seen {time}', { time: lastSeen(d.lastSeen, now, locale) }) : t('never seen')}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    {d.student ? (
                      <span><span className="font-medium">{d.student.name ?? t('A student')}</span> <span className="text-muted-foreground">· {t('Class {name}', { name: d.student.className })}</span></span>
                    ) : (
                      <span className="text-muted-foreground">{d.kind === 'lab_pc' ? t('No one signed in') : '–'}</span>
                    )}
                  </td>
                  <td className="py-3 pr-3 font-mono text-xs text-muted-foreground">{d.appVersion ?? '–'}</td>
                  <td className="py-2 text-right">
                    <span className="inline-flex flex-wrap items-center justify-end gap-2">
                    {canLock && <Button variant="quiet" disabled={lockOne.busy} onClick={() => lockOne.run(d.id, !d.locked)}>{d.locked ? t('Unlock screen') : t('Lock screen')}</Button>}
                    <ConfirmButton question={t('Remove {name} from the lab?', { name: d.name })} onConfirm={() => void remove.run(d.id)}>{t('Remove')}</ConfirmButton>
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
