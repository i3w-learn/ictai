import { randomUUID } from 'node:crypto';
import { CARD_MOVES, type CardMarks, type CardStatus, type MakeCardsResult, type ReportCard, type StaffPrincipal } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError, notFound } from '../../core/errors.js';
import { checkMyClass, scopeOf, seesClass } from '../../core/scope.js';
import type { ResultsService } from '../results/results.service.js';
import type { ClassRepository } from '../students/class.repository.js';
import type { StudentRepository } from '../students/student.repository.js';
import type { WorkRepository } from '../work/work.repository.js';
import type { ReportCardRepository } from './report-card.repository.js';

const EVERYTHING = { classIds: null, subjects: null };

// PRD "Report cards". A card shows every subject, not only the ones the teacher making it teaches:
// it is the school's report on the child. Who may make and change cards is limited by class.
export class ReportCardService {
  constructor(
    private readonly now: Clock,
    private readonly cards: ReportCardRepository,
    private readonly classes: ClassRepository,
    private readonly students: StudentRepository,
    private readonly results: ResultsService,
    private readonly work: WorkRepository,
    private readonly audit: AuditLog,
  ) {}

  // Makes a draft card for each student who has none this term, and brings existing drafts up to date.
  // Published and frozen cards are left exactly as they are.
  make(actor: StaffPrincipal, classId: string, term: string): MakeCardsResult {
    checkMyClass(this.classes, scopeOf(actor), classId);
    const now = this.now();
    const count = { made: 0, refreshed: 0, kept: 0 };
    for (const s of this.students.roster(classId)) {
      const marks = this.marksOf(s.id, now);
      const existing = this.cards.find(s.id, term);
      if (!existing) {
        this.cards.insert({ id: randomUUID(), studentId: s.id, classId, term, marks, by: actor.userId, now });
        count.made++;
      } else if (existing.status === 'draft' && this.cards.setMarks(existing.id, marks, now)) count.refreshed++;
      else count.kept++;
    }
    this.audit.record({ kind: 'staff', id: actor.userId }, 'report_cards.make', classId, { term, ...count });
    return { ...count, cards: this.list(actor, classId, term) };
  }

  list(actor: StaffPrincipal, classId: string, term: string): ReportCard[] {
    checkMyClass(this.classes, scopeOf(actor), classId);
    return this.cards.forClass(classId, term).map(({ classId: _c, ...card }) => card);
  }

  terms(actor: StaffPrincipal, classId: string): string[] {
    checkMyClass(this.classes, scopeOf(actor), classId);
    return this.cards.terms(classId);
  }

  setRemarks(actor: StaffPrincipal, id: string, remarks: string): ReportCard {
    this.mine(actor, id);
    if (!this.cards.setRemarks(id, remarks, this.now())) throw frozen();
    return this.card(id);
  }

  setStatus(actor: StaffPrincipal, id: string, to: CardStatus): ReportCard {
    const card = this.mine(actor, id);
    if (card.status === to) return this.card(id);
    if (card.status === 'frozen') throw frozen();
    if (!CARD_MOVES[card.status].includes(to)) {
      throw new AppError(409, 'BAD_MOVE', to === 'frozen' ? 'Publish the report card before you freeze it.' : `A ${card.status} report card cannot become ${to}.`);
    }
    if (!this.cards.setStatus(id, card.status, to, this.now())) throw new AppError(409, 'CHANGED', 'This report card was just changed by someone else. Open it again.');
    this.audit.record({ kind: 'staff', id: actor.userId }, `report_card.${to}`, id, { student: card.student.name, term: card.term });
    return this.card(id);
  }

  private card(id: string): ReportCard {
    const { classId: _c, ...card } = this.cards.get(id)!;
    return card;
  }

  private mine(actor: StaffPrincipal, id: string) {
    const card = this.cards.get(id);
    if (!card || !seesClass(scopeOf(actor), card.classId)) throw notFound('Report card');
    return card;
  }

  private marksOf(studentId: string, now: number): CardMarks {
    const r = this.results.student(EVERYTHING, studentId);
    const marked = this.work.forStudent(studentId, now).filter((w) => w.mark);
    const possible = marked.reduce((n, w) => n + w.maxMarks, 0);
    const earned = marked.reduce((n, w) => n + w.mark!.marks, 0);
    return {
      quizzes: { taken: r.attempts, average: r.average, grade: r.grade },
      subjects: r.subjects,
      work: { marked: marked.length, marksPercent: possible > 0 ? Math.round((earned / possible) * 100) : null },
      takenAt: now,
    };
  }
}

const frozen = () => new AppError(409, 'FROZEN', 'This report card is frozen and can no longer be changed.');
