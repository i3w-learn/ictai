import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Trophy } from 'lucide-react';
import { ActivityDone, type ActivityScores, type ContentItem, type MyActivityBest } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, ErrorNote, Note, useAction, useLatest } from '../../ui/ui';
import { useT } from '../../i18n/i18n';

// Spec 4.3 "Activities": runs one activity (a single web page file) in a closed box. The box may run
// its own script and nothing else: it cannot reach the app around it, the network or the PC. All it
// can do is tell us the score when the student is done (see contracts/activities.ts).
// A student's score is sent to the server. A teacher trying the activity is shown the score, and
// under it how the class has done.
export function ActivityPlayer({ item, url }: { item: ContentItem; url: string }) {
  const { call, state } = useApp();
  const t = useT();
  const staff = state.session?.principal.kind === 'staff';
  const frame = useRef<HTMLIFrameElement>(null);
  const [openedAt] = useState(() => Date.now());
  const [done, setDone] = useState<{ score: number; max: number } | null>(null);
  const [best, setBest] = useState<MyActivityBest | null>(null);

  const save = useAction(async (score: number, max: number) => {
    setDone({ score, max });
    if (staff) return;
    const seconds = Math.min(24 * 3600, Math.round((Date.now() - openedAt) / 1000));
    setBest(await call('POST /api/v1/activities/:id/results', { params: { id: item.id }, body: { score, max, seconds } }));
  });
  const saveNow = useLatest(save.run);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only this activity's own box is listened to, and only the one message it may send.
      if (e.source !== frame.current?.contentWindow) return;
      const msg = ActivityDone.safeParse(e.data);
      if (msg.success) void saveNow.current(msg.data.score, msg.data.max);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [saveNow]);

  return (
    <div className="grid gap-4">
      {done && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3" role="status">
          <Trophy className="size-6 shrink-0 text-primary" />
          <p className="flex-1 text-lg">
            {t('You got {score} of {max}.', { score: done.score, max: done.max })}
            {best && best.tries > 1 && <span className="text-muted-foreground"> {t('Your best is {best} of {max}, in {tries} tries.', { best: best.best, max: best.max, tries: best.tries })}</span>}
            {staff && <span className="text-muted-foreground"> {t("This was a try by you; only students' scores are kept.")}</span>}
          </p>
        </div>
      )}
      <ErrorNote message={save.error && t('Your score could not be saved: {error}', { error: save.error })} />
      <iframe
        ref={frame} src={url} title={item.title} sandbox="allow-scripts"
        className="h-[72vh] w-full rounded-2xl border border-border bg-white"
      />
      {staff && <ActivityScoresTable item={item} />}
    </div>
  );
}

// For the teacher: every student of the class with their best try.
function ActivityScoresTable({ item }: { item: ContentItem }) {
  const { call } = useApp();
  const t = useT();
  const [scores, setScores] = useState<ActivityScores | null>(null);
  const load = useAction(async () => setScores(await call('GET /api/v1/activities/:id/results', { params: { id: item.id } })));
  const { run: loadNow } = load;
  useEffect(() => { void loadNow(); }, [loadNow, item.id]);
  const played = scores?.rows.filter((r) => r.best !== null).length ?? 0;
  return (
    <Card className="grid gap-4 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 font-display text-lg font-semibold">{t('How Class {name} has done', { name: item.className })}{scores && scores.rows.length > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">{t('{played} of {total} have finished it', { played, total: scores.rows.length })}</span>}</h2>
        <Button variant="quiet" disabled={load.busy} onClick={() => load.run()}><RefreshCw className="size-4" /> {t('Refresh')}</Button>
      </header>
      {scores && (scores.rows.length === 0 ? (
        <Note>{t('No students in this class yet.')}</Note>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr><th className="py-2 font-medium">{t('Roll')}</th><th className="font-medium">{t('Name')}</th><th className="font-medium">{t('Best score')}</th><th className="font-medium">{t('Tries')}</th></tr>
          </thead>
          <tbody>
            {scores.rows.map((r) => (
              <tr key={r.studentId} className="border-t border-border">
                <td className="py-2 tabular-nums">{r.rollNo ?? '—'}</td>
                <td className="font-medium">{r.name}</td>
                <td className="tabular-nums">{r.best === null ? <span className="text-muted-foreground">{t('Not done yet')}</span> : t('{score} of {max}', { score: r.best, max: r.max ?? '' })}</td>
                <td className="tabular-nums">{r.tries || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <p className="text-sm text-muted-foreground">{t('An activity is for practice. Its scores are not used for report cards.')}</p>
      <ErrorNote message={load.error} />
    </Card>
  );
}
