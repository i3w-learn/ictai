import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { MAX_NOTES_PER_STUDENT, NOTE_BODY_MAX, type Note } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { ApiCallError } from '../../core/api-client';
import { Button, Card, ConfirmButton, ErrorNote, Field, PageTitle, SectionLabel, cn, useAction } from '../../ui/ui';
import { afterSave, BLANK, draftOf, isDirty, saveDraft, snippet, subjectsOf, type Draft, type NotesApi } from './notes';

// How long after the last keystroke a note saves itself.
const AUTOSAVE_MS = 2000;

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

// "My notes": the student's own notebook. Only they can read it, and it follows them to any lab PC.
// A note saves itself shortly after the student stops typing, and again before it is left
// (opening another, starting a new one, going back), so signing out loses at most a moment's typing.
export function MyNotes({ onBack }: { onBack: () => void }) {
  const { call } = useApp();
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  // Nothing can be written until the list has arrived: a late list would hide a note saved before it.
  const [loaded, setLoaded] = useState(false);
  const load = useAction(async () => {
    setNotes(await call('GET /api/v1/notes'));
    setLoaded(true);
  });
  useEffect(() => { void load.run(); }, []);

  const saved = draft?.id ? notes.find((n) => n.id === draft.id) : undefined;
  const dirty = draft != null && isDirty(draft, saved);

  const api: NotesApi = {
    create: (body) => call('POST /api/v1/notes', { body }),
    update: (id, body) => call('PUT /api/v1/notes/:id', { params: { id }, body }),
  };

  // Sends the open note to the server and puts it at the top of the list.
  // `d.id` is dropped too: a note deleted elsewhere comes back under a new id.
  async function persist(d: Draft): Promise<Note> {
    const note = await saveDraft(api, d);
    setNotes((list) => [note, ...list.filter((n) => n.id !== note.id && n.id !== d.id)]);
    return note;
  }

  // One action at a time, and one message: the newest. An old failure never stays on screen
  // after something later worked.
  // `running` is checked, not `busy`: it changes at once, while `busy` only changes on the next
  // draw of the screen, and two saves of a brand-new note would make two copies of it.
  const [busy, setBusy] = useState<'save' | 'leave' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  // The text whose save last failed. It is not sent again by itself until the student types more.
  const tried = useRef<Draft | null>(null);
  async function run(kind: 'save' | 'leave', job: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(kind);
    setError(null);
    try {
      await job();
    } catch (e) {
      tried.current = draft;
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      running.current = false;
      setBusy(null);
    }
  }
  // Saving the open note before leaving it; says so if that is what failed.
  async function saveFirst() {
    if (!draft || !dirty) return;
    try {
      await persist(draft);
    } catch (e) {
      throw new Error(`Your note is not saved yet. ${e instanceof Error ? e.message : ''}`.trim());
    }
  }

  const save = () => run('save', async () => {
    if (!draft) return;
    const note = await persist(draft);
    setDraft((cur) => afterSave(cur, draft, note));
  });
  const open = (next: Draft) => run('leave', async () => {
    await saveFirst();
    setDraft(next);
  });
  const back = () => run('leave', async () => {
    await saveFirst();
    onBack();
  });
  const remove = () => run('leave', async () => {
    if (draft?.id) {
      // Already deleted somewhere else is the same result, not a failure.
      await call('DELETE /api/v1/notes/:id', { params: { id: draft.id } }).catch((e) => {
        if (!(e instanceof ApiCallError && e.status === 404)) throw e;
      });
      setNotes((list) => list.filter((n) => n.id !== draft.id));
    }
    setDraft(null);
  });
  // Saves by itself once the typing pauses. A save that failed is not tried again until the
  // student types more, so a server that is down does not flash errors every two seconds.
  useEffect(() => {
    if (!draft || !dirty || busy || tried.current === draft) return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [draft, dirty, busy]);

  // Throwing typed text away needs no server, so it always works, even when saving does not.
  const discard = (to: Draft | null) => { setError(null); setDraft(to); };

  // While the note is being left or deleted its boxes are locked, so nothing typed can be lost.
  // During a plain save they stay open: what is typed meanwhile is kept (see afterSave).
  const leaving = busy === 'leave';
  const full = notes.length >= MAX_NOTES_PER_STUDENT;
  const edit = (d: Partial<Draft>) => setDraft((cur) => cur && { ...cur, ...d });

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6">
      <header className="flex flex-wrap items-end gap-4">
        <Button variant="quiet" disabled={busy != null} onClick={() => void back()}><ArrowLeft className="size-4" /> Back</Button>
        <div className="flex-1">
          <PageTitle sub="Only you can read these. They are here on any lab PC you sign in to.">My notes</PageTitle>
        </div>
        <Button disabled={!loaded || busy != null || full} onClick={() => void open({ ...BLANK })}><Plus className="size-4" strokeWidth={2.25} /> New note</Button>
      </header>

      <ErrorNote message={error ?? load.error} />
      {!loaded && load.error && <div><Button variant="quiet" disabled={load.busy} onClick={() => void load.run()}>Try again</Button></div>}
      {full && <p className="text-sm text-muted-foreground">You have {MAX_NOTES_PER_STUDENT} notes, which is the most you can keep. Delete one to write a new one.</p>}

      <div className="grid items-start gap-6 lg:grid-cols-[19rem_1fr]">
        <nav aria-label="Your notes" className="grid gap-2">
          <SectionLabel>{!loaded ? 'Your notes' : notes.length === 1 ? '1 note' : `${notes.length} notes`}</SectionLabel>
          {loaded && notes.length === 0 && (
            <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No notes yet. Click <b className="text-foreground">New note</b> to write your first one.
            </p>
          )}
          <ul className="grid max-h-[60vh] gap-2 overflow-y-auto">
            {notes.map((n) => (
              <li key={n.id}>
                <button
                  type="button" disabled={busy != null} aria-current={draft?.id === n.id}
                  onClick={() => { if (draft?.id !== n.id) void open(draftOf(n)); }}
                  className={cn(
                    'grid w-full cursor-pointer gap-0.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/25',
                    draft?.id === n.id && 'border-primary bg-primary/5',
                  )}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{n.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{day(n.updatedAt)}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{[n.subject, snippet(n.body)].filter(Boolean).join(' · ') || 'Empty note'}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {draft ? (
          <Card className="grid gap-4 p-5 lg:p-6">
            <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (dirty) void save(); }}>
              <fieldset disabled={leaving} className="grid min-w-0 gap-4">
              <div className="flex flex-wrap gap-3">
                <Field id="note-title" className="min-w-56 flex-1" label="Title" placeholder="What is this note about?" maxLength={120} autoFocus={!draft.id}
                  value={draft.title} onChange={(e) => edit({ title: e.target.value })} />
                <Field id="note-subject" className="w-44" label="Subject (optional)" placeholder="e.g. Science" maxLength={60} list="note-subjects"
                  value={draft.subject} onChange={(e) => edit({ subject: e.target.value })} />
                <datalist id="note-subjects">{subjectsOf(notes).map((s) => <option key={s} value={s} />)}</datalist>
              </div>
              <label className="grid gap-1.5" htmlFor="note-body">
                <span className="text-[13px] font-medium text-muted-foreground">Your note</span>
                <textarea
                  id="note-body" rows={14} maxLength={NOTE_BODY_MAX} placeholder="Write what you learned, in your own words."
                  className="w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/60"
                  value={draft.body} onChange={(e) => edit({ body: e.target.value })}
                />
              </label>
              </fieldset>
              <fieldset disabled={busy != null} className="flex min-w-0 flex-wrap items-center gap-3">
                <Button type="submit" disabled={!dirty}>Save</Button>
                <span className="flex-1 text-sm text-muted-foreground" role="status">
                  {busy === 'save' ? 'Saving…' : dirty ? 'Not saved yet' : draft.id ? 'Saved' : ''}
                </span>
                {saved && dirty && <Button type="button" variant="quiet" onClick={() => discard(draftOf(saved))}>Undo changes</Button>}
                {draft.id
                  ? <ConfirmButton key={draft.id} question="Delete this note for good?" onConfirm={() => void remove()}>Delete</ConfirmButton>
                  : <Button type="button" variant="quiet" onClick={() => discard(null)}>Cancel</Button>}
              </fieldset>
            </form>
          </Card>
        ) : (
          <p className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            {!loaded ? (load.error ? 'Your notes could not be loaded.' : 'Loading your notes…') : notes.length > 0 ? 'Pick a note to read or change it, or start a new one.' : 'Your notes will open here.'}
          </p>
        )}
      </div>
    </div>
  );
}
