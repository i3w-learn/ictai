import { useEffect, useRef, useState } from 'react';
import { Link2, Upload } from 'lucide-react';
import { MAX_FILE_BYTES, type ContentItem, type SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ConfirmButton, ErrorNote, Field, Panel, Select, useAction } from '../../ui/ui';
import { SubjectField } from '../quizzes/SubjectField';
import { fileProblem, KIND_WORDS, sendFile, sizeWords } from './files';

const BLANK = { title: '', classId: '', subject: '', chapter: '', url: '' };

// PRD "Content": the school's library. A teacher adds a file or a web link and files it under a class,
// subject and chapter. Students find it under My books.
export function ContentPanel({ onOpen, refresh, onChanged }: { onOpen: (item: ContentItem) => void; refresh: number; onChanged: () => void }) {
  const { call, state } = useApp();
  const p = state.session?.principal;
  const canAdd = p?.kind === 'staff' && p.permissions.includes('setup.content');
  const [items, setItems] = useState<ContentItem[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(BLANK);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const load = useAction(async () => {
    const [i, c] = await Promise.all([call('GET /api/v1/content', { query: {} }), call('GET /api/v1/classes')]);
    setItems(i);
    setClasses(c);
  });
  useEffect(() => { void load.run(); }, [refresh]);

  const filing = { title: form.title, classId: form.classId, subject: form.subject || null, chapter: form.chapter || null };
  const done = async () => {
    setForm({ ...BLANK, classId: form.classId, subject: form.subject, chapter: form.chapter });
    setFile(null);
    if (picker.current) picker.current.value = '';
    onChanged();
  };

  const addFile = useAction(async () => {
    setProgress([0, 1]);
    try {
      const uploadId = await sendFile(
        {
          start: (fileName, size) => call('POST /api/v1/content/uploads', { body: { fileName, size } }),
          piece: (id, index, data) => call('PUT /api/v1/content/uploads/:id/chunks', { params: { id }, body: { index, data } }),
        },
        file!, (d, t) => setProgress([d, t]),
      );
      await call('POST /api/v1/content/uploads/:id/finish', { params: { id: uploadId }, body: filing });
      await done();
    } finally {
      setProgress(null);
    }
  });
  const addLink = useAction(async () => {
    await call('POST /api/v1/content/links', { body: { ...filing, url: form.url } });
    await done();
  });
  const remove = useAction(async (id: string) => {
    await call('DELETE /api/v1/content/:id', { params: { id } });
    onChanged();
  });

  const tooBig = file ? fileProblem(file) : null;
  const problem = !form.title.trim() ? 'Type a title.' : !form.classId ? 'Pick a class.' : null;
  const busy = addFile.busy || addLink.busy;
  const shown = filter ? items.filter((i) => i.classId === filter) : items;

  return (
    <Panel title="Library">
      {canAdd && (
        <form className="grid gap-3" onSubmit={(e) => e.preventDefault()}>
          <div className="flex flex-wrap items-end gap-3">
            <Field id="content-title" className="w-72" label="Title" placeholder="Water cycle diagram" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <label className="grid gap-1.5">
              <span className="text-[13px] font-medium text-muted-foreground">Class</span>
              <Select aria-label="Library class" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
                <option value="">Choose a class</option>
                {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
              </Select>
            </label>
            <SubjectField id="content-subject" placeholder="Science" value={form.subject} onChange={(subject) => setForm({ ...form, subject })} />
            <Field id="content-chapter" className="w-48" label="Chapter (optional)" placeholder="Water" maxLength={80} value={form.chapter} onChange={(e) => setForm({ ...form, chapter: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5" htmlFor="content-file">
              <span className="text-[13px] font-medium text-muted-foreground">A file: PDF, picture, video or sound (up to {sizeWords(MAX_FILE_BYTES)})</span>
              <input
                id="content-file" ref={picker} type="file" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mp3,.wav,.ogg,.m4a"
                className="h-11 rounded-xl border border-border bg-card px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-1"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <Button type="button" disabled={!!problem || !file || !!tooBig || busy} onClick={() => addFile.run()}><Upload className="size-4" /> Add file</Button>
            <span className="pb-2.5 text-sm text-muted-foreground">or</span>
            <Field id="content-url" className="w-72" label="A web link" placeholder="https://…" maxLength={500} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <Button type="button" variant="quiet" disabled={!!problem || !form.url.trim() || busy} onClick={() => addLink.run()}><Link2 className="size-4" /> Add link</Button>
          </div>
          {progress && (
            <div className="grid gap-1">
              <span className="text-sm text-muted-foreground">Sending {file?.name}… {Math.round((progress[0] / progress[1]) * 100)}%</span>
              <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Sending the file" aria-valuenow={Math.round((progress[0] / progress[1]) * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(progress[0] / progress[1]) * 100}%` }} />
              </div>
            </div>
          )}
          <span className="text-sm text-muted-foreground">{tooBig ?? ((file || form.url) && problem)}</span>
          <ErrorNote message={addFile.error ?? addLink.error} />
        </form>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Show library of" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
        </Select>
        <span className="text-sm text-muted-foreground">{shown.length} {shown.length === 1 ? 'item' : 'items'}</span>
      </div>
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">Nothing in the library yet. Students see what you add under My books.</p>
      ) : (
        <ul className="grid gap-2">
          {shown.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2.5">
              <span className="min-w-56 flex-1">
                <span className="font-medium">{i.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {[KIND_WORDS[i.kind], `Class ${i.className}`, i.subject, i.chapter, i.size ? sizeWords(i.size) : null, i.needsInternet ? 'needs internet' : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Button variant="quiet" onClick={() => onOpen(i)}>Open</Button>
              {canAdd && <ConfirmButton question={`Remove "${i.title}"?`} onConfirm={() => void remove.run(i.id)}>Remove</ConfirmButton>}
            </li>
          ))}
        </ul>
      )}
      <ErrorNote message={load.error ?? remove.error} />
    </Panel>
  );
}
