import { useEffect, useState } from 'react';
import { Health } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { baseUrl } from '../../core/settings';
import type { FoundServer } from '../../platform/platform';
import { Button, ErrorNote, Field, useAction } from '../../ui/ui';

// Spec 8.1: find the server by broadcast; typing an address is the fallback.
export function FindServer() {
  const { locator, platform, dispatch } = useApp();
  const [found, setFound] = useState<FoundServer[] | null>(null);
  const [manual, setManual] = useState('');

  const search = useAction(async () => {
    setFound(null);
    setFound(await locator!.discover());
  });

  useEffect(() => {
    void search.run();
  }, [locator]);

  const pick = useAction(async (f: FoundServer) => {
    if (!f.certFp) throw new Error('This server has no certificate yet. Restart the server and try again.');
    const target = await locator!.confirm(f, f.certFp);
    if (!target) throw new Error(`Found "${f.name}" but could not connect to it. Check the firewall on the server PC.`);
    dispatch({ type: 'server', server: target });
  });

  const connectManual = useAction(async () => {
    const [addr, portText] = manual.trim().split(':');
    const port = Number(portText ?? 7700);
    if (!addr || !port) throw new Error('Type an address like 192.168.1.20');
    const probe = await platform.probe(baseUrl({ addr, port }));
    const health = Health.parse(probe.health);
    dispatch({ type: 'server', server: { serverId: health.serverId, name: health.name, certFp: probe.certFp, addr, port } });
  });

  return (
    <div className="center">
      <h1>Find the school server</h1>
      <p className="muted">Looking on the school network…</p>

      {found && found.length > 0 && (
        <ul className="list">
          {found.map((f) => (
            <li key={f.serverId}>
              <div>
                <strong>{f.name}</strong>
                <span className="muted mono">{f.from}:{f.port}</span>
              </div>
              <Button disabled={pick.busy} onClick={() => pick.run(f)}>Connect</Button>
            </li>
          ))}
        </ul>
      )}
      {found && found.length === 0 && (
        <p className="note">No server answered. Check the server PC is on and on the same network.</p>
      )}
      <ErrorNote message={search.error ?? pick.error} />
      <Button variant="quiet" disabled={search.busy} onClick={() => search.run()}>
        {search.busy ? 'Searching…' : 'Search again'}
      </Button>

      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void connectManual.run(); }}>
        <Field id="manual-addr" label="Or type the server address" placeholder="192.168.1.20" value={manual} onChange={(e) => setManual(e.target.value)} />
        <Button type="submit" variant="quiet" disabled={connectManual.busy}>Connect</Button>
      </form>
      <ErrorNote message={connectManual.error} />
    </div>
  );
}
