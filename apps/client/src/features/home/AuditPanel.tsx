import { useEffect, useState } from 'react';
import type { AuditEntry } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Panel, useAction } from '../../ui/ui';
import { tk, useLang } from '../../i18n/i18n';
import { cardStudent, rich } from './audit-words';

// Each logged action as a whole sentence, so every language can put the names where they belong.
// `named` is the sentence when the line has something to name at its end (a teacher, a class, a quiz,
// a topic); `plain` is said when it has not. Unknown actions show their raw key.
const ACTION: Record<string, { plain: string; named?: string }> = {
  signin: { plain: tk('{actor} signed in'), named: tk('{actor} signed in on {target}') },
  'signin.failed': { plain: tk('{actor} failed to sign in'), named: tk('{actor} failed to sign in as {target}') },
  'staff.add': { plain: tk('{actor} added teacher'), named: tk('{actor} added teacher {target}') },
  'staff.update': { plain: tk('{actor} changed teacher'), named: tk('{actor} changed teacher {target}') },
  'staff.password': { plain: tk('{actor} reset the password of'), named: tk('{actor} reset the password of {target}') },
  'staff.delete': { plain: tk('{actor} deleted teacher'), named: tk('{actor} deleted teacher {target}') },
  'student.delete': { plain: tk('{actor} deleted student'), named: tk('{actor} deleted student {target}') },
  'student.import': { plain: tk('{actor} added students from a file to class'), named: tk('{actor} added students from a file to class {target}') },
  'student.signin.failed': { plain: tk('{actor} had a wrong student sign-in try'), named: tk('{actor} had a wrong student sign-in try for {target}') },
  'quiz.delete': { plain: tk('{actor} deleted the quiz'), named: tk('{actor} deleted the quiz {target}') },
  'class.promote': { plain: tk('{actor} moved all students out of class'), named: tk('{actor} moved all students out of class {target}') },
  'class.codes': { plain: tk('{actor} made first sign-in codes for class'), named: tk('{actor} made first sign-in codes for class {target}') },
  'class.cards': { plain: tk('{actor} printed sign-in cards for class'), named: tk('{actor} printed sign-in cards for class {target}') },
  'enrol_window.open': { plain: tk('{actor} opened device joining') },
  'lab.lock': { plain: tk('{actor} locked the lab against new devices') },
  'lab.unlock': { plain: tk('{actor} unlocked the lab for new devices') },
  'device.enrol': { plain: tk('{actor} joined the lab') },
  'device.remove': { plain: tk('{actor} removed a device from the lab') },
  'quiz.open': { plain: tk('{actor} opened Lab Mode for'), named: tk('{actor} opened Lab Mode for {target}') },
  'quiz.practice': { plain: tk('{actor} gave as practice the quiz'), named: tk('{actor} gave as practice the quiz {target}') },
  'quiz.start': { plain: tk('{actor} started the quiz'), named: tk('{actor} started the quiz {target}') },
  'quiz.end': { plain: tk('{actor} ended the quiz'), named: tk('{actor} ended the quiz {target}') },
  'ai.quiz.request': { plain: tk('{actor} asked the AI for a quiz'), named: tk('{actor} asked the AI for a quiz on {target}') },
  'ai.ask.request': { plain: tk('{actor} asked the AI a question') },
  'ai.tutor.request': { plain: tk('{actor} asked the AI tutor a question') },
  'settings.change': { plain: tk('{actor} changed the school settings') },
  'playlist.create': { plain: tk('{actor} made the playlist') },
  'playlist.delete': { plain: tk('{actor} removed the playlist') },
  'path.create': { plain: tk('{actor} made the learning path') },
  'path.delete': { plain: tk('{actor} removed the learning path') },
  'content.add': { plain: tk('{actor} added to the library') },
  'content.delete': { plain: tk('{actor} removed from the library') },
  'report_cards.make': { plain: tk('{actor} made report cards for class'), named: tk('{actor} made report cards for class {target}') },
  'report_card.published': { plain: tk('{actor} published the report card of'), named: tk('{actor} published the report card of {target}') },
  'report_card.draft': { plain: tk('{actor} took back to draft the report card of'), named: tk('{actor} took back to draft the report card of {target}') },
  'report_card.frozen': { plain: tk('{actor} froze the report card of'), named: tk('{actor} froze the report card of {target}') },
  'work.set': { plain: tk('{actor} set work for a class') },
  'work.delete': { plain: tk('{actor} took away a piece of work') },
  'timetable.set': { plain: tk('{actor} booked the lab in the timetable') },
  'timetable.clear': { plain: tk('{actor} freed a lab period in the timetable') },
  'show.start': { plain: tk('{actor} started showing to the class') },
  'show.stop': { plain: tk('{actor} stopped showing') },
  'notice.create': { plain: tk('{actor} put up a notice') },
  'notice.delete': { plain: tk('{actor} took down a notice') },
};

// Who did it, for a line the server has no name for.
const KIND: Record<AuditEntry['actorKind'], string> = { staff: tk('staff'), student: tk('student'), device: tk('device'), system: tk('system') };

// What the line names at its end, if anything: the report card's student, the quiz topic asked for
// (forgotten after 90 days; the line then just says a quiz was asked for), the username tried, or
// the teacher, student, device, class or quiz the action was done to.
function targetOf(e: AuditEntry): string | null {
  if (e.action === 'signin.failed') return e.target || null;
  if (e.action === 'ai.quiz.request') return (e.detail as { topic?: string } | null)?.topic || null;
  return cardStudent(e) ?? (e.targetName && e.actorName !== e.targetName ? e.targetName : null);
}

// A long question is cut so one line of the log stays one line.
const shorten = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const when = (ms: number, locale: string | undefined) => new Date(ms).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Spec 4.1: who did what and when. Super Admin only.
export function AuditPanel() {
  const { call } = useApp();
  const { t, locale } = useLang();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [more, setMore] = useState(true);

  const load = useAction(async (before?: number) => {
    const page = await call('GET /api/v1/audit', { query: before ? { before } : {} });
    setEntries((prev) => (before ? [...prev, ...page] : page));
    setMore(page.length === 100);
  });
  const { run: loadNow } = load;
  useEffect(() => { void loadNow(); }, [loadNow]);

  return (
    <Panel title={t('Activity log')} actions={<Button variant="quiet" onClick={() => load.run()}>{t('Refresh')}</Button>}>
      <ul className="grid gap-1 text-sm">
        {entries.map((e) => {
          const words = ACTION[e.action];
          const target = targetOf(e);
          const actor = <b className="font-semibold">{e.actorName ?? (e.action === 'signin.failed' ? t('Someone') : t(KIND[e.actorKind]))}</b>;
          const named = target && (e.action === 'signin.failed' ? <span className="text-muted-foreground">“{target}”</span> : <b className="font-semibold">{target}</b>);
          return (
          <li key={e.id} className="flex flex-wrap gap-x-3 border-b border-border py-2 last:border-0">
            <span className="w-32 shrink-0 tabular-nums text-muted-foreground">{when(e.at, locale)}</span>
            <span className="min-w-0 flex-1">
              {words && named && words.named
                ? rich(t(words.named), { actor, target: named })
                : <>{words ? rich(t(words.plain), { actor }) : <>{actor} {e.action}</>}{named && <> {named}</>}</>}
              {e.action === 'ai.ask.request' && (e.detail as { question?: string } | null)?.question && <>: <i>“{shorten((e.detail as { question: string }).question)}”</i></>}
              {(e.action === 'show.start' || e.action === 'show.stop') && (e.detail as { title?: string } | null)?.title && <>: <b className="font-semibold">{(e.detail as { title: string }).title}</b></>}
            </span>
          </li>
          );
        })}
      </ul>
      {more && entries.length > 0 && (
        <Button variant="quiet" disabled={load.busy} onClick={() => load.run(entries[entries.length - 1]!.id)}>{t('Show older')}</Button>
      )}
      <ErrorNote message={load.error} />
    </Panel>
  );
}
