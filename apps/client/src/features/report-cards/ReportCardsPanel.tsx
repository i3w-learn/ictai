import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import type { CardStatus, ReportCard, SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ConfirmButton, ErrorNote, Field, Note, Panel, Select, cn, useAction } from '../../ui/ui';
import { tk, useLang, useT } from '../../i18n/i18n';

const STATUS_WORDS: Record<CardStatus, string> = { draft: tk('Draft'), published: tk('Published'), frozen: tk('Frozen') };
const STATUS_TAG: Record<CardStatus, string> = { draft: 'bg-secondary text-secondary-foreground', published: 'bg-primary/10 text-primary', frozen: 'bg-success/10 text-success' };

// PRD "Report cards": pick a class and a term, make the cards from the marks, write remarks, publish,
// then freeze. A frozen card can never change again. Print the published and frozen ones.
export function ReportCardsPanel({ refresh }: { refresh: number }) {
  const { call } = useApp();
  const t = useT();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState('');
  const [terms, setTerms] = useState<string[]>([]);
  const [term, setTerm] = useState('');
  const [cards, setCards] = useState<ReportCard[] | null>(null);
  // The term the cards on screen belong to. The Term box can say something else while a new term is typed.
  const [shownTerm, setShownTerm] = useState('');
  // What the last press of Make report cards did, as counts, so it is said in the language on screen.
  const [made, setMade] = useState<{ made: number; refreshed: number; kept: number } | null>(null);
  const [printing, setPrinting] = useState(false);

  const loadClasses = useAction(async () => setClasses(await call('GET /api/v1/classes')));
  const { run: loadClassesNow } = loadClasses;
  useEffect(() => { void loadClassesNow(); }, [loadClassesNow, refresh]);

  // Picking a class offers its latest term straight away.
  const pickClass = useAction(async (id: string) => {
    setClassId(id); setCards(null); setMade(null); setTerms([]);
    if (!id) return;
    const found = await call('GET /api/v1/report-cards/terms', { query: { classId: id } });
    setTerms(found);
    if (found[0]) { setTerm(found[0]); setCards(await call('GET /api/v1/report-cards', { query: { classId: id, term: found[0] } })); setShownTerm(found[0]); }
  });
  const open = useAction(async (name: string) => { setTerm(name); setMade(null); setCards(await call('GET /api/v1/report-cards', { query: { classId, term: name } })); setShownTerm(name); });
  const make = useAction(async () => {
    const r = await call('POST /api/v1/report-cards/make', { body: { classId, term } });
    setCards(r.cards);
    setShownTerm(term.trim());
    setTerms((list) => (list.includes(term.trim()) ? list : [term.trim(), ...list]));
    setMade({ made: r.made, refreshed: r.refreshed, kept: r.kept });
  });
  const put = (card: ReportCard) => setCards((list) => list?.map((c) => (c.id === card.id ? card : c)) ?? null);

  const madeWords = made && ([
    made.made && t('{n} new', { n: made.made }),
    made.refreshed && (made.refreshed === 1 ? t('{n} draft brought up to date', { n: made.refreshed }) : t('{n} drafts brought up to date', { n: made.refreshed })),
    made.kept && t('{n} published or frozen left as they were', { n: made.kept }),
  ].filter(Boolean).join(', ') || t('No students in this class yet'));

  const printable = cards?.filter((c) => c.status !== 'draft') ?? [];
  return (
    <Panel title={t('Report cards')}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5">
          <span className="text-[0.8125rem] font-medium text-muted-foreground">{t('Class')}</span>
          <Select aria-label={t('Report cards for class')} value={classId} onChange={(e) => void pickClass.run(e.target.value)}>
            <option value="">{t('Choose a class')}</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{t('Class {name}', { name: c.name })}</option>)}
          </Select>
        </label>
        <Field id="cards-term" className="w-52" label={t('Term')} placeholder={t('Term 1 2026')} maxLength={40} value={term} onChange={(e) => { setTerm(e.target.value); setMade(null); }} />
        <Button disabled={!classId || !term.trim() || make.busy} onClick={() => make.run()}>{t('Make report cards')}</Button>
        {terms.filter((name) => name !== shownTerm).map((name) => <Button key={name} variant="quiet" onClick={() => void open.run(name)}>{t('Open {term}', { term: name })}</Button>)}
        {printable.length > 0 && <Button variant="quiet" onClick={() => setPrinting(true)}><Printer className="size-4" /> {t('Print {n}', { n: printable.length })}</Button>}
      </div>
      <p className="text-sm text-muted-foreground">{t('Cards are made from quiz results and marked work. Making them again brings drafts up to date and leaves published and frozen cards alone.')}</p>
      {madeWords && <Note>{madeWords}.</Note>}
      <ErrorNote message={loadClasses.error ?? pickClass.error ?? open.error ?? make.error} />

      {cards && cards.length > 0 && (
        <p className="font-display text-lg font-semibold">
          {t('Class {name}', { name: classes.find((c) => c.id === classId)?.name ?? '' })} · {shownTerm}
          {term.trim() !== shownTerm && (
            <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
              {t('These are the {term} cards.', { term: shownTerm })}{term.trim() && ` ${t('Press Make report cards to make {term}.', { term: term.trim() })}`}
            </span>
          )}
        </p>
      )}
      {cards && cards.length > 0 && (
        <ul className="grid gap-2">
          {cards.map((c) => <CardRow key={c.id} card={c} onChange={put} />)}
        </ul>
      )}
      {printing && <CardsSheet cards={printable} onClose={() => setPrinting(false)} />}
    </Panel>
  );
}

function CardRow({ card: c, onChange }: { card: ReportCard; onChange: (c: ReportCard) => void }) {
  const { call, state } = useApp();
  const t = useT();
  const me = state.session?.principal;
  // Freezing can never be undone, so only the Super Admin is offered it (the server refuses anyone else).
  const canFreeze = me?.kind === 'staff' && me.permissions.includes('settings.manage');
  const [remarks, setRemarks] = useState(c.remarks);
  // Remarks saved somewhere else replace what is typed here.
  const [saved, setSaved] = useState(c.remarks);
  if (saved !== c.remarks) {
    setSaved(c.remarks);
    setRemarks(c.remarks);
  }
  const save = useAction(async () => onChange(await call('PUT /api/v1/report-cards/:id/remarks', { params: { id: c.id }, body: { remarks } })));
  const move = useAction(async (status: CardStatus) => onChange(await call('PUT /api/v1/report-cards/:id/status', { params: { id: c.id }, body: { status } })));
  const frozen = c.status === 'frozen';
  const q = c.marks.quizzes;

  return (
    <li className="grid gap-2 rounded-2xl border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-44 flex-1">
          <span className="font-medium">{c.student.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{[c.student.rollNo && t('Roll {roll}', { roll: c.student.rollNo }), q.average === null ? t('no quizzes yet') : t('quiz average {average}% · grade {grade}', { average: q.average, grade: q.grade ?? '' }), c.marks.work.marksPercent !== null && t('work {percent}%', { percent: c.marks.work.marksPercent })].filter(Boolean).join(' · ')}</span>
        </span>
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_TAG[c.status])}>{t(STATUS_WORDS[c.status])}</span>
        {c.status === 'draft' && <Button variant="quiet" disabled={move.busy} onClick={() => move.run('published')}>{t('Publish')}</Button>}
        {c.status === 'published' && (
          <>
            <Button variant="quiet" disabled={move.busy} onClick={() => move.run('draft')}>{t('Back to draft')}</Button>
            {canFreeze && <ConfirmButton question={t('Freeze for good? It can never be changed again.')} onConfirm={() => void move.run('frozen')}>{t('Freeze')}</ConfirmButton>}
          </>
        )}
      </div>
      {frozen ? (
        c.remarks && <p className="text-sm"><span className="text-muted-foreground">{t('Remarks:')} </span>{c.remarks}</p>
      ) : (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
          <Field id={`remarks-${c.id}`} className="min-w-64 flex-1" label={t("Teacher's remarks")} maxLength={600} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          <Button type="submit" variant="quiet" disabled={remarks.trim() === c.remarks || save.busy}>{t('Save remarks')}</Button>
        </form>
      )}
      <ErrorNote message={save.error ?? move.error} />
    </li>
  );
}

// One card per printed page. The print window can send it to a printer or save it as a PDF.
function CardsSheet({ cards, onClose }: { cards: ReportCard[]; onClose: () => void }) {
  const { t, locale } = useLang();
  return createPortal(
    <div className="print-sheet fixed inset-0 z-50 overflow-y-auto bg-card px-6 py-6 text-foreground">
      <div className="no-print mb-5 flex flex-wrap items-center gap-3">
        <h2 className="flex-1 font-display text-xl font-semibold">{cards.length === 1 ? t('{n} report card', { n: cards.length }) : t('{n} report cards', { n: cards.length })}</h2>
        <Button onClick={() => window.print()}>{t('Print or save as PDF')}</Button>
        <Button variant="quiet" onClick={onClose}>{t('Close')}</Button>
      </div>
      {cards.map((c) => {
        const place = c.student.sectionName ? t('Class {name} {section}', { name: c.student.className, section: c.student.sectionName }) : t('Class {name}', { name: c.student.className });
        const taken = new Date(c.marks.takenAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
        return (
        <article key={c.id} className="mx-auto mb-8 max-w-2xl break-after-page rounded-2xl border border-border p-6 print:border-0 print:p-0">
          <h3 className="font-display text-2xl font-semibold">{t('Report card · {term}', { term: c.term })}</h3>
          <p className="mt-1 text-lg">{c.student.name}</p>
          <p className="text-sm text-muted-foreground">{c.student.rollNo ? t('{place} · Roll {roll}', { place, roll: c.student.rollNo }) : place}</p>
          <table className="mt-5 w-full text-left text-sm">
            <thead className="text-muted-foreground"><tr><th className="py-2 pr-4">{t('Subject')}</th><th className="py-2 pr-4">{t('Quizzes')}</th><th className="py-2 pr-4">{t('Average')}</th><th className="py-2">{t('Grade')}</th></tr></thead>
            <tbody>
              {c.marks.subjects.map((s) => <tr key={s.subject} className="border-t border-border"><td className="py-2 pr-4">{s.subject}</td><td className="py-2 pr-4 tabular-nums">{s.attempts}</td><td className="py-2 pr-4 tabular-nums">{s.average}%</td><td className="py-2">{s.grade}</td></tr>)}
              {c.marks.subjects.length === 0 && <tr className="border-t border-border"><td className="py-2 text-muted-foreground" colSpan={4}>{t('No quizzes taken this term.')}</td></tr>}
            </tbody>
          </table>
          <p className="mt-4"><b>{t('Overall:')}</b> {c.marks.quizzes.average === null ? t('no quiz results') : t('{average}% · grade {grade}', { average: c.marks.quizzes.average, grade: c.marks.quizzes.grade ?? '' })}{c.marks.work.marksPercent !== null && ` · ${t('marked work {percent}%', { percent: c.marks.work.marksPercent })}`}</p>
          <p className="mt-4"><b>{t("Teacher's remarks:")}</b> {c.remarks || '—'}</p>
          <p className="mt-8 text-sm text-muted-foreground">{c.status === 'frozen' ? t('Marks as on {date} · final', { date: taken }) : t('Marks as on {date}', { date: taken })}</p>
        </article>
        );
      })}
    </div>,
    document.body,
  );
}
