import type { ActivityResult, ActivityScores, MyActivityBest, StaffPrincipal, StudentPrincipal } from '@ict/contracts';
import type { Clock } from '../../core/clock.js';
import { notFound } from '../../core/errors.js';
import { scopeOf, seesQuiz } from '../../core/scope.js';
import type { ContentRepository } from '../content/content.repository.js';
import type { ActivityRepository } from './activity.repository.js';

// Spec 4.3 "Activities": a student plays an activity from their class's library and the app sends
// the score here. Every try is kept; the teacher is shown each student's best one.
// An activity is for practice. The score comes from the student's own PC, so it is not used for
// report cards.
export class ActivityService {
  constructor(
    private readonly now: Clock,
    private readonly results: ActivityRepository,
    private readonly content: ContentRepository,
  ) {}

  finished(me: StudentPrincipal, contentId: string, r: ActivityResult): MyActivityBest {
    const item = this.content.get(contentId);
    // An activity of another class looks missing.
    if (!item || item.kind !== 'activity' || item.classId !== me.classId) throw notFound('Activity');
    this.results.add({ contentId, studentId: me.studentId, score: r.score, max: r.max, seconds: r.seconds, now: this.now() });
    return this.results.bestOf(contentId, me.studentId)!;
  }

  scores(actor: StaffPrincipal, contentId: string): ActivityScores {
    const item = this.content.get(contentId);
    if (!item || item.kind !== 'activity' || !seesQuiz(scopeOf(actor), item)) throw notFound('Activity');
    return { title: item.title, className: item.className, rows: this.results.forClass(contentId, item.classId) };
  }
}
