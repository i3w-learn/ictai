import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/app-context';
import { ApiCallError } from '../../core/api-client';
import { Card, Centered, ErrorNote, PageTitle, useAction } from '../../ui/ui';

// A new lab PC or board joins by itself: nothing is typed or pressed, here or on the server PC. The server
// gives it its name ("Lab PC 7"). Only when staff have locked the lab does this screen stay, and keep asking.
export function EnrolDevice() {
  const { state, platform, call, dispatch } = useApp();
  const role = state.settings.role!;

  // One ask at a time, and none after joining: a second ask would add this PC to the lab twice.
  const asking = useRef(false);
  const [locked, setLocked] = useState(false);
  const join = useAction(async () => {
    if (asking.current) return;
    asking.current = true;
    const server = state.settings.server!;
    try {
      const res = await call('POST /api/v1/auth/device/enrol', { body: { kind: role === 'board' ? 'board' : 'lab_pc', appVersion: platform.appVersion } }, 'none');
      // Spec 8.2: the server confirms the certificate we pinned at discovery.
      if (res.serverId !== server.serverId || res.certFp !== server.certFp) {
        throw new Error('The server did not confirm its identity. Do not use this server; ask your admin.');
      }
      dispatch({ type: 'device', device: { deviceId: res.deviceId, token: res.token, name: res.name } });
      return;
    } catch (e) {
      asking.current = false;
      // Staff have locked the lab: say so plainly, and keep asking in case they unlock it.
      if (e instanceof ApiCallError && e.code === 'ENROL_CLOSED') return setLocked(true);
      throw e;
    }
  });

  useEffect(() => {
    void join.run();
    const t = setInterval(() => void join.run(), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <Centered narrow>
      <PageTitle
        eyebrow="Setup"
        sub={locked
          ? <>The lab is locked. On the server PC, open <b className="text-foreground">Devices</b> and press <b className="text-foreground">Unlock the lab</b>. This {role === 'board' ? 'board' : 'PC'} then joins by itself.</>
          : 'Nothing to type here.'}
      >
        {locked ? 'Ask your teacher' : 'Joining the lab…'}
      </PageTitle>
      <Card className="grid justify-items-center gap-3 p-8 text-center">
        <span className="size-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" aria-hidden />
        <ErrorNote message={join.error} />
      </Card>
    </Centered>
  );
}
