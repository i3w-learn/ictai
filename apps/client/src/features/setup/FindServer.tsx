import { useEffect, useState } from 'react';
import { Loader2, Server } from 'lucide-react';
import { Health } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { baseUrl } from '../../core/settings';
import type { FoundServer } from '../../platform/platform';
import { Button, Card, Centered, ErrorNote, Field, Note, PageTitle, useAction } from '../../ui/ui';
import { useT } from '../../i18n/i18n';

// Spec 8.1: find the server by broadcast; typing an address is the fallback.
export function FindServer() {
  const { locator, platform, dispatch } = useApp();
  const t = useT();
  const [found, setFound] = useState<FoundServer[] | null>(null);
  const [manual, setManual] = useState('');

  const search = useAction(async () => {
    setFound(null);
    setFound(await locator!.discover());
  });

  const { run: searchNow } = search;
  useEffect(() => {
    void searchNow();
  }, [searchNow, locator]);

  const pick = useAction(async (f: FoundServer) => {
    if (!f.certFp) throw new Error(t('This server has no certificate yet. Restart the server and try again.'));
    const target = await locator!.confirm(f, f.certFp);
    if (!target) throw new Error(t('Found "{name}" but could not connect to it. Check the firewall on the server PC.', { name: f.name }));
    dispatch({ type: 'server', server: target });
  });

  const connectManual = useAction(async () => {
    const [addr, portText] = manual.trim().split(':');
    const port = Number(portText ?? 7700);
    if (!addr || !port) throw new Error(t('Type an address like 192.168.1.20'));
    const probe = await platform.probe(baseUrl({ addr, port }));
    const health = Health.parse(probe.health);
    dispatch({ type: 'server', server: { serverId: health.serverId, name: health.name, certFp: probe.certFp, addr, port } });
  });

  return (
    <Centered>
      <PageTitle
        eyebrow={t('Setup')}
        sub={search.busy ? t('Looking on the school network…') : found && found.length > 0 ? t('Pick your server.') : t('Nothing found yet. Search again, or type the address shown on the server PC.')}
      >
        {t('Find the school server')}
      </PageTitle>

      {search.busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t('Searching…')}
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
                <Button disabled={pick.busy} onClick={() => pick.run(f)}>{t('Connect')}</Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {found && found.length === 0 && <Note>{t('No server answered. Check the server PC is on and on the same network.')}</Note>}
      <ErrorNote message={search.error ?? pick.error} />
      <div>
        <Button variant="quiet" disabled={search.busy} onClick={() => search.run()}>{t('Search again')}</Button>
      </div>

      <form className="flex items-end gap-3 border-t border-border pt-6" onSubmit={(e) => { e.preventDefault(); void connectManual.run(); }}>
        <Field id="manual-addr" className="max-w-xs flex-1" label={t('Or type the server address')} placeholder="192.168.1.20" value={manual} onChange={(e) => setManual(e.target.value)} />
        <Button type="submit" variant="quiet" disabled={connectManual.busy}>{t('Connect')}</Button>
      </form>
      <ErrorNote message={connectManual.error} />
    </Centered>
  );
}
