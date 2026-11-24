import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { MAX_NOTES_PER_STUDENT, NOTE_BODY_MAX, type Note } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { ApiCallError } from '../../core/api-client';
import { Button, Card, ConfirmButton, ErrorNote, Field, PageTitle, SectionLabel, TextArea, cn, useAction, useLatest } from '../../ui/ui';
import { useLang } from '../../i18n/i18n';
import { afterSave, BLANK, draftOf, isDirty, saveDraft, snippet, subjectsOf, type Draft, type NotesApi } from './notes';

// How long after the last keystroke a note saves itself.
const AUTOSAVE_MS = 2000;

const day = (at: number, locale: string | undefined) => new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

// "My notes": the student's own notebook. Only they can read it, and it follows them to any lab PC.
// A note saves itself shortly after the student stops typing, and again before it is left
// (opening another, starting a new one, picking another page in the menu), so signing out loses at
// most a moment's typing.
export function MyNotes() {
  const { call } = useApp();
  const { t, locale } = useLang();
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  // Nothing can be written until the list has arrived: a late list would hide a note saved before it.
  const [loaded, setLoaded] = useState(false);
  const load = useAction(async () => {
    setNotes(await call('GET /api/v1/notes'));
    setLoaded(true);
  });
  const { run: loadNow } = load;
  useEffect(() => { void loadNow(); }, [loadNow]);

  const saved = draft?.id ? notes.find((n) => n.id === draft.id) : undefined;
  const dirty = draft != null && isDirty(draft, saved, t);

  const api: NotesApi = {
    create: (body) => call('POST /api/v1/notes', { body }),
    update: (id, body) => call('PUT /api/v1/notes/:id', { params: { id }, body }),
  };

  // Sends the open note to the server and puts it at the top of the list.
  // `d.id` is dropped too: a note deleted elsewhere comes back under a new id.
  async function persist(d: Draft): Promise<Note> {
    const note = await saveDraft(api, d, t);
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
      setError(e instanceof Error ? e.message : t('Something went wrong.'));
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
      throw new Error(`${t('Your note is not saved yet.')} ${e instanceof Error ? e.message : ''}`.trim(), { cause: e });
    }
  }

  const save = () => run('save', async () => {
    if (!draft) return;
    const note = await persist(draft);
    setDraft((cur) => afterSave(cur, draft, note));
  });
  const saveNow = useLatest(save);
  const open = (next: Draft) => run('leave', async () => {
    await saveFirst();
    setDraft(next);
  });
  // Picking another page in the menu takes this screen away at once, so what is typed and not yet
  // saved is sent on the way out. Not while a save is already going: that would make two copies
  // of a brand-new note.
  const atLeave = useLatest(() => { if (draft && dirty && !running.current) void saveDraft(api, draft, t).catch(() => undefined); });
  useEffect(() => () => atLeave.current(), [atLeave]);
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
    const timer = setTimeout(() => void saveNow.current(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, dirty, busy, saveNow]);

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
        <div className="flex-1">
          <PageTitle sub={t('Only you can read these. They are here on any lab PC you sign in to.')}>{t('My notes')}</PageTitle>
        </div>
        <Button disabled={!loaded || busy != null || full} onClick={() => void open({ ...BLANK })}><Plus className="size-4" strokeWidth={2.25} /> {t('New note')}</Button>
      </header>

      <ErrorNote message={error ?? load.error} />
      {!loaded && load.error && <div><Button variant="quiet" disabled={load.busy} onClick={() => void load.run()}>{t('Try again')}</Button></div>}
      {full && <p className="text-sm text-muted-foreground">{t('You have {max} notes, which is the most you can keep. Delete one to write a new one.', { max: MAX_NOTES_PER_STUDENT })}</p>}

      <div className="grid items-start gap-6 lg:grid-cols-[19rem_1fr]">
        <nav aria-label={t('Your notes')} className="grid gap-2">
          <SectionLabel>{!loaded ? t('Your notes') : notes.length === 1 ? t('1 note') : t('{n} notes', { n: notes.length })}</SectionLabel>
          {loaded && notes.length === 0 && (
            <p className="rounded-3xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {t('No notes yet. Click {button} to write your first one.', { button: t('New note') })}
            </p>
          )}
          <ul className="grid max-h-[60vh] gap-2 overflow-y-auto">
            {notes.map((n) => (
              <li key={n.id}>
                <button
                  type="button" disabled={busy != null} aria-current={draft?.id === n.id}
                  onClick={() => { if (draft?.id !== n.id) void open(draftOf(n)); }}
                  className={cn(
                    'grid w-full cursor-pointer gap-0.5 rounded-2xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/25',
                    draft?.id === n.id && 'border-primary bg-primary/5',
                  )}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{n.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{day(n.updatedAt, locale)}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{[n.subject, snippet(n.body)].filter(Boolean).join(' · ') || t('Empty note')}</span>
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
                <Field id="note-title" className="min-w-56 flex-1" label={t('Title')} placeholder={t('What is this note about?')} maxLength={120} autoFocus={!draft.id}
                  value={draft.title} onChange={(e) => edit({ title: e.target.value })} />
                <Field id="note-subject" className="w-44" label={t('Subject (optional)')} placeholder={t('e.g. Science')} maxLength={60} list="note-subjects"
                  value={draft.subject} onChange={(e) => edit({ subject: e.target.value })} />
                <datalist id="note-subjects">{subjectsOf(notes).map((s) => <option key={s} value={s} />)}</datalist>
              </div>
              <TextArea id="note-body" label={t('Your note')} rows={14} maxLength={NOTE_BODY_MAX} placeholder={t('Write what you learned, in your own words.')} value={draft.body} onChange={(e) => edit({ body: e.target.value })} />
              </fieldset>
              <fieldset disabled={busy != null} className="flex min-w-0 flex-wrap items-center gap-3">
                <Button type="submit" disabled={!dirty}>{t('Save')}</Button>
                <span className="flex-1 text-sm text-muted-foreground" role="status">
                  {busy === 'save' ? t('Saving…') : dirty ? t('Not saved yet') : draft.id ? t('Saved') : ''}
                </span>
                {saved && dirty && <Button type="button" variant="quiet" onClick={() => discard(draftOf(saved))}>{t('Undo changes')}</Button>}
                {draft.id
                  ? <ConfirmButton key={draft.id} question={t('Delete this note for good?')} onConfirm={() => void remove()}>{t('Delete')}</ConfirmButton>
                  : <Button type="button" variant="quiet" onClick={() => discard(null)}>{t('Cancel')}</Button>}
              </fieldset>
            </form>
          </Card>
        ) : (
          <p className="rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground">
            {!loaded ? (load.error ? t('Your notes could not be loaded.') : t('Loading your notes…')) : notes.length > 0 ? t('Pick a note to read or change it, or start a new one.') : t('Your notes will open here.')}
          </p>
        )}
      </div>
    </div>
  );
}
