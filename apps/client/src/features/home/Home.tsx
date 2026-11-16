import { useState, type ReactNode } from 'react';
import { ClipboardList, GraduationCap, House, School, Wrench } from 'lucide-react';
import type { ContentItem, SchoolSettings } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Shell, SideMenu, type MenuItem } from '../../ui/dashboard';
import { Centered, PageTitle } from '../../ui/ui';
import { StudentHome } from './StudentHome';
import { AuditPanel } from './AuditPanel';
import { DevicesPanel } from './DevicesPanel';
import { StaffPanel } from './StaffPanel';
import { StudentsPanel } from './StudentsPanel';
import { LabSession } from '../quizzes/LabSession';
import { QuizEditor } from '../quizzes/QuizEditor';
import { QuizzesPanel } from '../quizzes/QuizzesPanel';
import { AiQuizMaker, type AiDraft } from '../quizzes/AiQuizMaker';
import { AskAi } from '../quizzes/AskAi';
import { ContentPanel } from '../content/ContentPanel';
import { Viewer } from '../content/Viewer';
import { NoticesPanel } from '../notices/NoticesPanel';
import { ReportCardsPanel } from '../report-cards/ReportCardsPanel';
import { SequencesPanel } from '../sequences/SequencesPanel';
import { SettingsPanel } from '../settings/SettingsPanel';
import { TimetablePanel } from '../timetable/TimetablePanel';
import { MarkWork } from '../work/MarkWork';
import { WorkPanel } from '../work/WorkPanel';
import { ResultsPanel } from '../results/ResultsPanel';
import { StudentResultsPage } from '../results/StudentResultsPage';
import { TeachersPanel } from '../results/TeachersPanel';

// The pages in the console's side menu.
type Page = 'today' | 'teach' | 'reports' | 'school' | 'system';
const MENU: MenuItem<Page>[] = [
  { key: 'today', label: 'Today', icon: House },
  { key: 'teach', label: 'Teach', icon: GraduationCap },
  { key: 'reports', label: 'Reports', icon: ClipboardList },
  { key: 'school', label: 'School', icon: School },
  { key: 'system', label: 'System', icon: Wrench },
];

// The console's screens that open over a menu page.
type View =
  | { kind: 'dash' }
  | { kind: 'edit-quiz'; quizId: string | null; draft?: AiDraft }
  | { kind: 'lab'; runId: string }
  | { kind: 'ai-quiz' }
  | { kind: 'ask-ai' }
  | { kind: 'mark-work'; id: string }
  | { kind: 'content'; item: ContentItem }
  | { kind: 'student'; studentId: string };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function Home() {
  const { state, dispatch } = useApp();
  const p = state.session!.principal;
  const [view, setView] = useState<View>({ kind: 'dash' });
  const [page, setPage] = useState<Page>('today');
  // Goes up when one panel changes something another panel lists (a class, a period, a library item, a
  // piece of work), so every panel shows it at once.
  const [refresh, setRefresh] = useState(0);
  const changed = () => setRefresh((n) => n + 1);
  // The header shows the server by the name it had when this PC found it; a new school name goes there too.
  const settingsSaved = (s: SchoolSettings) => {
    changed();
    const server = state.settings.server;
    if (server && server.name !== s.schoolName) dispatch({ type: 'server', server: { ...server, name: s.schoolName } });
  };

  if (p.kind === 'student') return <StudentHome name={p.name} />;
  if (p.kind === 'staff' && state.settings.role === 'console') {
    // These cover the whole page and have their own Back, so the menu steps aside for them.
    const back = () => setView({ kind: 'dash' });
    if (view.kind === 'edit-quiz') return <Shell><QuizEditor quizId={view.quizId} draft={view.draft} onDone={back} /></Shell>;
    if (view.kind === 'ai-quiz') return <Shell><AiQuizMaker onDraft={(draft) => setView({ kind: 'edit-quiz', quizId: null, draft })} onBack={back} /></Shell>;
    if (view.kind === 'content') return <Shell><Viewer item={view.item} onBack={back} /></Shell>;
    if (view.kind === 'mark-work') return <Shell><MarkWork id={view.id} onBack={back} /></Shell>;
    if (view.kind === 'ask-ai') return <Shell><AskAi onBack={back} /></Shell>;
    if (view.kind === 'lab') return <Shell><LabSession runId={view.runId} onExit={back} /></Shell>;
    if (view.kind === 'student') return <Shell><StudentResultsPage studentId={view.studentId} onBack={back} /></Shell>;

    const can = (permission: (typeof p.permissions)[number]) => p.permissions.includes(permission);
    // What each menu page holds. A panel is there only for someone allowed to use it, and a page
    // with no panels left is not in the menu.
    const panels: Record<Page, ReactNode[]> = {
      today: [
        can('results.view') && <ResultsPanel key="results" refresh={refresh} onStudent={(studentId) => setView({ kind: 'student', studentId })} />,
        can('teaching.manage') && <QuizzesPanel key="quizzes" refresh={refresh} onEdit={(quizId) => setView({ kind: 'edit-quiz', quizId })} onLab={(runId) => setView({ kind: 'lab', runId })} onAi={() => setView({ kind: 'ai-quiz' })} onAsk={() => setView({ kind: 'ask-ai' })} />,
      ],
      teach: [
        can('teaching.manage') && <ContentPanel key="content" refresh={refresh} onChanged={changed} onOpen={(item) => setView({ kind: 'content', item })} />,
        can('teaching.manage') && <SequencesPanel key="sequences" refresh={refresh} />,
        can('teaching.manage') && <WorkPanel key="work" refresh={refresh} onChanged={changed} onOpen={(id) => setView({ kind: 'mark-work', id })} />,
        can('teaching.manage') && <NoticesPanel key="notices" refresh={refresh} />,
      ],
      reports: [
        can('results.view') && <ReportCardsPanel key="cards" refresh={refresh} />,
        can('staff.manage') && <TeachersPanel key="teachers" />,
      ],
      school: [
        can('setup.timetable') && <TimetablePanel key="timetable" refresh={refresh} />,
        can('students.manage') && <StudentsPanel key="students" onChanged={changed} />,
        can('staff.manage') && <StaffPanel key="staff" classesChanged={refresh} />,
        can('setup.devices') && <DevicesPanel key="devices" />,
      ],
      system: [
        can('settings.manage') && <SettingsPanel key="settings" onSaved={settingsSaved} />,
        can('server.manage') && <AuditPanel key="audit" />,
      ],
    };
    const menu = MENU.filter((m) => panels[m.key].some(Boolean));
    const current = menu.find((m) => m.key === page) ?? menu[0];
    const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    return (
      <Shell menu={menu.length > 1 && current && <SideMenu label="Pages" items={menu} current={current.key} onPick={setPage} />}>
        <div className="mx-auto grid max-w-6xl gap-8">
          <header className="pb-1">
            <PageTitle eyebrow={`${today} · ${greeting()}, ${p.displayName}`}>{current?.key === 'today' || !current ? 'Your lab today' : current.label}</PageTitle>
          </header>
          {current && panels[current.key]}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Centered>
        <PageTitle sub="Live lessons arrive in the next milestone (M2).">Ready, {p.kind === 'staff' ? p.displayName : 'device'}</PageTitle>
      </Centered>
    </Shell>
  );
}
