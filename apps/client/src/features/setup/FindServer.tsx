import { useEffect, useState } from 'react';
import { Loader2, Server } from 'lucide-react';
import { Health } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { baseUrl } from '../../core/settings';
import type { FoundServer } from '../../platform/platform';
import { Button, Card, Centered, ErrorNote, Field, Note, PageTitle, useAction } from '../../ui/ui';

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
    <Centered>
      <PageTitle eyebrow="Setup" sub="Looking on the school network…">Find the school server</PageTitle>

      {search.busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Searching…
        </p>
      )}
      {found && found.length > 0 && (
        <ul className="grid gap-3">
          {found.map((f) => (
            <li key={f.serverId}>
              <Card className="flex items-center gap-4 p-4">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Server className="size-5" strokeWidth={1.75} />
                </span>
                <div className="grid flex-1">
                  <strong className="font-semibold">{f.name}</strong>
                  <span className="font-mono text-xs text-muted-foreground">{f.from}:{f.port}</span>
                </div>
                <Button disabled={pick.busy} onClick={() => pick.run(f)}>Connect</Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {found && found.length === 0 && <Note>No server answered. Check the server PC is on and on the same network.</Note>}
      <ErrorNote message={search.error ?? pick.error} />
      <div>
        <Button variant="quiet" disabled={search.busy} onClick={() => search.run()}>Search again</Button>
      </div>

      <form className="flex items-end gap-3 border-t border-border pt-6" onSubmit={(e) => { e.preventDefault(); void connectManual.run(); }}>
        <Field id="manual-addr" className="max-w-xs flex-1" label="Or type the server address" placeholder="192.168.1.20" value={manual} onChange={(e) => setManual(e.target.value)} />
        <Button type="submit" variant="quiet" disabled={connectManual.busy}>Connect</Button>
      </form>
      <ErrorNote message={connectManual.error} />
    </Centered>
  );
}
