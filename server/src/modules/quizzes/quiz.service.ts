import { randomUUID } from 'node:crypto';
import type { Quiz, QuizInput, QuizSummary, StaffPrincipal } from '@ict/contracts';
import type { Clock } from '../../core/clock.js';
import { AppError, notFound } from '../../core/errors.js';
import { checkMyClass, checkQuiz, checkSubject, scopeOf, seesQuiz, type Scope } from '../../core/scope.js';
import type { ClassRepository } from '../students/class.repository.js';
import type { QuizRepository } from './quiz.repository.js';
import type { RunRepository } from './run.repository.js';

const running = () => new AppError(409, 'QUIZ_RUNNING', 'This quiz is running in Lab Mode. End it first.');

// Spec 4.3: teachers write quizzes by hand (AI generation comes in M5).
export class QuizService {
  constructor(
    private readonly now: Clock,
    private readonly quizzes: QuizRepository,
    private readonly runs: RunRepository,
    private readonly classes: ClassRepository,
  ) {}

  list(scope: Scope, classId?: string): QuizSummary[] {
    if (classId) checkMyClass(this.classes, scope, classId);
    return this.quizzes.list(classId).filter((q) => seesQuiz(scope, q));
  }

  get(scope: Scope, id: string): Quiz {
    const quiz = this.quizzes.get(id);
    if (!quiz) throw notFound('Quiz');
    checkQuiz(scope, quiz);
    return quiz;
  }

  create(actor: StaffPrincipal, q: QuizInput): Quiz {
    const scope = scopeOf(actor);
    this.checkInput(scope, q);
    const id = randomUUID();
    this.quizzes.insert(id, q, actor.userId, this.now());
    return this.get(scope, id);
  }

  // Changing a quiz mid-run would change the questions under the students, so it waits.
  replace(scope: Scope, id: string, q: QuizInput): Quiz {
    this.get(scope, id);
    this.checkInput(scope, q);
    if (this.runs.hasOpenRun(id)) throw running();
    this.quizzes.replace(id, q, this.now());
    return this.get(scope, id);
  }

  remove(scope: Scope, id: string) {
    this.get(scope, id);
    if (this.runs.hasOpenRun(id)) throw running();
    this.quizzes.markDeleted(id, this.now());
  }

  private checkInput(scope: Scope, q: QuizInput) {
    checkMyClass(this.classes, scope, q.classId);
    checkSubject(scope, q.subject);
  }
}
