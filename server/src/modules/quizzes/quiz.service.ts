import { randomUUID } from 'node:crypto';
import type { Quiz, QuizInput, QuizSummary, StaffPrincipal } from '@ict/contracts';
import type { Clock } from '../../core/clock.js';
import { AppError, notFound } from '../../core/errors.js';
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

  list(classId?: string): QuizSummary[] {
    return this.quizzes.list(classId);
  }

  get(id: string): Quiz {
    const quiz = this.quizzes.get(id);
    if (!quiz) throw notFound('Quiz');
    return quiz;
  }

  create(actor: StaffPrincipal, q: QuizInput): Quiz {
    if (!this.classes.classExists(q.classId)) throw notFound('Class');
    const id = randomUUID();
    this.quizzes.insert(id, q, actor.userId, this.now());
    return this.get(id);
  }

  // Changing a quiz mid-run would change the questions under the students, so it waits.
  replace(id: string, q: QuizInput): Quiz {
    this.get(id);
    if (!this.classes.classExists(q.classId)) throw notFound('Class');
    if (this.runs.hasOpenRun(id)) throw running();
    this.quizzes.replace(id, q, this.now());
    return this.get(id);
  }

  remove(id: string) {
    this.get(id);
    if (this.runs.hasOpenRun(id)) throw running();
    this.quizzes.markDeleted(id, this.now());
  }
}
