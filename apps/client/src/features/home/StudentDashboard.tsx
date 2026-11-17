import { useEffect, useState, type ReactNode } from 'react';
import { BookOpen, Medal, Target } from 'lucide-react';
import type { ContentItem, MyProgress, Todo } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Block, CoverCard, Empty, ProgressRow, ResultBar } from '../../ui/dashboard';
import { Button } from '../../ui/ui';
import { KIND_WORDS } from '../content/files';
import { KIND_ICON } from '../content/MyBooks';
import { Viewer } from '../content/Viewer';
import { LabToday } from '../timetable/LabToday';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// How many of each thing fit on the home screen; the rest is one press away on its own page.
const BOOKS = 2, SUBJECTS = 6, TODOS = 2;

// The student's home screen: today's lab periods, books, results and things to do, all at a glance.
// Each part is a small look at a page in the menu, and its button goes to that page.
export function StudentDashboard({ name, top, go }: { name: string; top?: ReactNode; go: (page: 'books' | 'progress' | 'todo') => void }) {
  const { call } = useApp();
  // null = not arrived yet, so nothing says "nothing here" before the server has answered.
  const [books, setBooks] = useState<ContentItem[] | null>(null);
  const [progress, setProgress] = useState<MyProgress | null>(null);
  const [todo, setTodo] = useState<Todo[] | null>(null);
  const [open, setOpen] = useState<ContentItem | null>(null);
  useEffect(() => {
    let alive = true;
    // A part that cannot load stays quiet here: its own page says what went wrong.
    const into = <T,>(set: (v: T) => void) => (v: T) => { if (alive) set(v); };
    call('GET /api/v1/content/mine').then(into(setBooks), () => undefined);
    call('GET /api/v1/me/progress').then(into(setProgress), () => undefined);
    call('GET /api/v1/todo').then(into(setTodo), () => undefined);
    return () => { alive = false; };
  }, [call]);

  if (open) return <Viewer item={open} onBack={() => setOpen(null)} />;

  const subjects = progress?.subjects.slice(0, SUBJECTS) ?? [];
  // One bar is picked out: the best subject (the first of them, if two are level).
  const best = subjects.reduce((at, s, i) => (s.average > subjects[at]!.average ? i : at), 0);
  // What is not finished comes first: that is what the student should see.
  const lists = todo ? [...todo].sort((a, b) => Number(a.doneSteps === a.steps.length) - Number(b.doneSteps === b.steps.length)).slice(0, TODOS) : [];
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8">
      {top}
      <div className="grid gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Block first title={`${greeting()}, ${name}`}>
          <LabToday />
        </Block>

        <Block title="My books" action={<Button variant="quiet" onClick={() => go('books')}>See all</Button>}>
          {books?.length === 0 && <Empty icon={BookOpen}>Nothing here yet. When your teacher adds something for your class, it shows here.</Empty>}
          {books && books.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              {books.slice(0, BOOKS).map((b) => (
                <CoverCard key={b.id} title={b.title} kind={b.subject ?? KIND_WORDS[b.kind]} colourFrom={b.subject ?? b.kind} icon={KIND_ICON[b.kind]} onClick={() => setOpen(b)} />
              ))}
            </div>
          )}
        </Block>

        <Block title="My results" action={<Button variant="quiet" onClick={() => go('progress')}>How I am doing</Button>}>
          {progress && subjects.length === 0 && <Empty icon={Medal}>After your first quiz, your results will be here.</Empty>}
          {subjects.length > 0 && (
            <div className="-mx-4 -mt-2 -mb-8 flex gap-4 overflow-x-auto px-4 pt-2 pb-10">
              {subjects.map((s, i) => <ResultBar key={s.subject} label={s.subject} percent={s.average} strong={i === best} />)}
            </div>
          )}
        </Block>

        <Block title="Things to do" action={<Button variant="quiet" onClick={() => go('todo')}>See all</Button>}>
          {todo?.length === 0 && <Empty icon={Target}>Nothing to do right now.</Empty>}
          {lists.length > 0 && (
            <div className="grid gap-4">
              {lists.map((q) => {
                const next = q.steps.find((s) => s.id === q.nextStepId);
                return <ProgressRow key={q.id} title={q.title} sub={next ? `Next: ${next.title}` : q.subject ?? undefined} done={q.doneSteps} total={q.steps.length} onClick={() => go('todo')} />;
              })}
            </div>
          )}
        </Block>
      </div>
    </div>
  );
}
