import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import type { CardStatus, ReportCard, SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ConfirmButton, ErrorNote, Field, Note, Panel, Select, cn, useAction } from '../../ui/ui';

const STATUS_WORDS: Record<CardStatus, string> = { draft: 'Draft', published: 'Published', frozen: 'Frozen' };
const STATUS_TAG: Record<CardStatus, string> = { draft: 'bg-secondary text-secondary-foreground', published: 'bg-primary/10 text-primary', frozen: 'bg-success/10 text-success' };

// PRD "Report cards": pick a class and a term, make the cards from the marks, write remarks, publish,
// then freeze. A frozen card can never change again. Print the published and frozen ones.
export function ReportCardsPanel({ refresh }: { refresh: number }) {
  const { call } = useApp();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState('');
  const [terms, setTerms] = useState<string[]>([]);
  const [term, setTerm] = useState('');
  const [cards, setCards] = useState<ReportCard[] | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const loadClasses = useAction(async () => setClasses(await call('GET /api/v1/classes')));
  useEffect(() => { void loadClasses.run(); }, [refresh]);

  // Picking a class offers its latest term straight away.
  const pickClass = useAction(async (id: string) => {
    setClassId(id); setCards(null); setMade(null); setTerms([]);
    if (!id) return;
    const t = await call('GET /api/v1/report-cards/terms', { query: { classId: id } });
    setTerms(t);
    if (t[0]) { setTerm(t[0]); setCards(await call('GET /api/v1/report-cards', { query: { classId: id, term: t[0] } })); }
  });
  const open = useAction(async (t: string) => { setTerm(t); setMade(null); setCards(await call('GET /api/v1/report-cards', { query: { classId, term: t } })); });
  const make = useAction(async () => {
    const r = await call('POST /api/v1/report-cards/make', { body: { classId, term } });
    setCards(r.cards);
    setTerms((list) => (list.includes(term.trim()) ? list : [term.trim(), ...list]));
    setMade([r.made && `${r.made} new`, r.refreshed && `${r.refreshed} ${r.refreshed === 1 ? "draft" : "drafts"} brought up to date`, r.kept && `${r.kept} published or frozen left as they were`].filter(Boolean).join(', ') || 'No students in this class yet');
  });
  const put = (card: ReportCard) => setCards((list) => list?.map((c) => (c.id === card.id ? card : c)) ?? null);

  const printable = cards?.filter((c) => c.status !== 'draft') ?? [];
  return (
    <Panel title="Report cards">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5">
          <span className="text-[13px] font-medium text-muted-foreground">Class</span>
          <Select aria-label="Report cards for class" value={classId} onChange={(e) => void pickClass.run(e.target.value)}>
            <option value="">Choose a class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
          </Select>
        </label>
        <Field id="cards-term" className="w-52" label="Term" placeholder="Term 1 2026" maxLength={40} value={term} onChange={(e) => { setTerm(e.target.value); setMade(null); }} />
        <Button disabled={!classId || !term.trim() || make.busy} onClick={() => make.run()}>Make report cards</Button>
        {terms.filter((t) => t !== term.trim()).map((t) => <Button key={t} variant="quiet" onClick={() => void open.run(t)}>Open {t}</Button>)}
        {printable.length > 0 && <Button variant="quiet" onClick={() => setPrinting(true)}><Printer className="size-4" /> Print {printable.length}</Button>}
      </div>
      <p className="text-sm text-muted-foreground">Cards are made from quiz results and marked work. Making them again brings drafts up to date and leaves published and frozen cards alone.</p>
      {made && <Note>{made}.</Note>}
      <ErrorNote message={loadClasses.error ?? pickClass.error ?? open.error ?? make.error} />

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
  const me = state.session?.principal;
  // Freezing can never be undone, so only the Super Admin is offered it (the server refuses anyone else).
  const canFreeze = me?.kind === 'staff' && me.permissions.includes('settings.manage');
  const [remarks, setRemarks] = useState(c.remarks);
  useEffect(() => setRemarks(c.remarks), [c.remarks]);
  const save = useAction(async () => onChange(await call('PUT /api/v1/report-cards/:id/remarks', { params: { id: c.id }, body: { remarks } })));
  const move = useAction(async (status: CardStatus) => onChange(await call('PUT /api/v1/report-cards/:id/status', { params: { id: c.id }, body: { status } })));
  const frozen = c.status === 'frozen';
  const q = c.marks.quizzes;

  return (
    <li className="grid gap-2 rounded-xl border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-44 flex-1">
          <span className="font-medium">{c.student.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{[c.student.rollNo && `Roll ${c.student.rollNo}`, q.average === null ? 'no quizzes yet' : `quiz average ${q.average}% · grade ${q.grade}`, c.marks.work.marksPercent !== null && `work ${c.marks.work.marksPercent}%`].filter(Boolean).join(' · ')}</span>
        </span>
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_TAG[c.status])}>{STATUS_WORDS[c.status]}</span>
        {c.status === 'draft' && <Button variant="quiet" disabled={move.busy} onClick={() => move.run('published')}>Publish</Button>}
        {c.status === 'published' && (
          <>
            <Button variant="quiet" disabled={move.busy} onClick={() => move.run('draft')}>Back to draft</Button>
            {canFreeze && <ConfirmButton question="Freeze for good? It can never be changed again." onConfirm={() => void move.run('frozen')}>Freeze</ConfirmButton>}
          </>
        )}
      </div>
      {frozen ? (
        c.remarks && <p className="text-sm"><span className="text-muted-foreground">Remarks: </span>{c.remarks}</p>
      ) : (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
          <Field id={`remarks-${c.id}`} className="min-w-64 flex-1" label="Teacher's remarks" maxLength={600} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          <Button type="submit" variant="quiet" disabled={remarks.trim() === c.remarks || save.busy}>Save remarks</Button>
        </form>
      )}
      <ErrorNote message={save.error ?? move.error} />
    </li>
  );
}

// One card per printed page. The print window can send it to a printer or save it as a PDF.
function CardsSheet({ cards, onClose }: { cards: ReportCard[]; onClose: () => void }) {
  return createPortal(
    <div className="print-sheet fixed inset-0 z-50 overflow-y-auto bg-card px-6 py-6 text-foreground">
      <div className="no-print mb-5 flex flex-wrap items-center gap-3">
        <h2 className="flex-1 font-display text-xl font-semibold">{cards.length} report {cards.length === 1 ? 'card' : 'cards'}</h2>
        <Button onClick={() => window.print()}>Print or save as PDF</Button>
        <Button variant="quiet" onClick={onClose}>Close</Button>
      </div>
      {cards.map((c) => (
        <article key={c.id} className="mx-auto mb-8 max-w-2xl break-after-page rounded-xl border border-border p-6 print:border-0 print:p-0">
          <h3 className="font-display text-2xl font-semibold">Report card · {c.term}</h3>
          <p className="mt-1 text-lg">{c.student.name}</p>
          <p className="text-sm text-muted-foreground">{[`Class ${c.student.className}${c.student.sectionName ? ` ${c.student.sectionName}` : ''}`, c.student.rollNo && `Roll ${c.student.rollNo}`].filter(Boolean).join(' · ')}</p>
          <table className="mt-5 w-full text-left text-sm">
            <thead className="text-muted-foreground"><tr><th className="py-2 pr-4">Subject</th><th className="py-2 pr-4">Quizzes</th><th className="py-2 pr-4">Average</th><th className="py-2">Grade</th></tr></thead>
            <tbody>
              {c.marks.subjects.map((s) => <tr key={s.subject} className="border-t border-border"><td className="py-2 pr-4">{s.subject}</td><td className="py-2 pr-4 tabular-nums">{s.attempts}</td><td className="py-2 pr-4 tabular-nums">{s.average}%</td><td className="py-2">{s.grade}</td></tr>)}
              {c.marks.subjects.length === 0 && <tr className="border-t border-border"><td className="py-2 text-muted-foreground" colSpan={4}>No quizzes taken this term.</td></tr>}
            </tbody>
          </table>
          <p className="mt-4"><b>Overall:</b> {c.marks.quizzes.average === null ? 'no quiz results' : `${c.marks.quizzes.average}% · grade ${c.marks.quizzes.grade}`}{c.marks.work.marksPercent !== null && ` · marked work ${c.marks.work.marksPercent}%`}</p>
          <p className="mt-4"><b>Teacher's remarks:</b> {c.remarks || '—'}</p>
          <p className="mt-8 text-sm text-muted-foreground">Marks as on {new Date(c.marks.takenAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}{c.status === 'frozen' ? ' · final' : ''}</p>
        </article>
      ))}
    </div>,
    document.body,
  );
}
