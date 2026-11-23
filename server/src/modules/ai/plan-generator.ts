import type { AiPlanRequest, AiPlanResult, AiPlanStep } from '@ict/contracts';
import { z } from 'zod';
import { AppError, notFound } from '../../core/errors.js';
import type { Llm } from './llm-client.js';
import { PLAN_SYSTEM, planPrompt, THINKING_ROOM } from './prompts.js';
import { cleanText } from './quiz-generator.js';

const Drafted = z.object({
  objectives: z.array(z.string()),
  steps: z.array(z.object({ minutes: z.number(), title: z.string(), what: z.string() })),
  checks: z.array(z.string()),
  homework: z.string(),
});
const PLAN_ROOM = 2500;
const NO_PLAN = () => new AppError(502, 'AI_NO_ANSWER', 'The AI did not write a usable plan. Try again, or word the topic differently.');

export type LibraryItem = AiPlanResult['library'][number];
// What each kind of library item is called in the prompt, so the plan does not call a video a book.
const KIND_WORDS: Record<string, string> = { pdf: 'book', video: 'video', image: 'picture', audio: 'sound', link: 'web link', activity: 'activity' };

// Makes the steps' minutes add up to exactly `total`, keeping their shares. A model is told the
// total but often lands a few minutes off; the teacher should never have to add them up.
export function fitMinutes(steps: AiPlanStep[], total: number): AiPlanStep[] {
  const asked = steps.map((s) => (Number.isFinite(s.minutes) && s.minutes > 0 ? s.minutes : 1));
  const sum = asked.reduce((a, b) => a + b, 0);
  // Each step gets at least a minute; the rest is shared out by size, and rounding leftovers go to the biggest shares.
  const exact = asked.map((m) => (m / sum) * total);
  const fitted = exact.map((m) => Math.max(1, Math.floor(m)));
  let left = total - fitted.reduce((a, b) => a + b, 0);
  const order = exact.map((m, i) => ({ i, rest: m - Math.floor(m) })).sort((a, b) => b.rest - a.rest);
  for (let k = 0; left > 0; k++, left--) fitted[order[k % order.length]!.i]! += 1;
  // More steps than minutes cannot be fitted by sharing; take the extra back from the longest steps.
  for (; left < 0; left++) fitted[fitted.indexOf(Math.max(...fitted))]! -= 1;
  return steps.map((s, i) => ({ ...s, minutes: fitted[i]! }));
}

// Spec 4.3 "Plan a lesson (AI)": one request to the model, then the plan is tidied by code: empty
// lines dropped, odd marks cleaned, and the minutes made to add up.
export class PlanGenerator {
  constructor(
    private readonly llm: Llm,
    private readonly className: (classId: string) => string | null,
    // What the library already holds for this class and subject, to offer in the plan.
    private readonly library: (classId: string, subject: string) => LibraryItem[] = () => [],
  ) {}

  async plan(req: AiPlanRequest, signal: AbortSignal): Promise<AiPlanResult> {
    const className = this.className(req.classId);
    if (!className) throw notFound('Class');
    const library = this.library(req.classId, req.subject).slice(0, 8);
    const draft = await this.llm.json({
      system: PLAN_SYSTEM,
      user: planPrompt({ className, subject: req.subject, topic: req.topic, minutes: req.minutes, language: req.language, library: library.map((i) => `${i.title} (${KIND_WORDS[i.kind] ?? i.kind})`) }),
      schema: Drafted, maxTokens: PLAN_ROOM + THINKING_ROOM, signal,
    });
    const lines = (list: string[]) => list.map(cleanText).filter(Boolean);
    const steps = draft.steps.map((s) => ({ minutes: s.minutes, title: cleanText(s.title), what: cleanText(s.what) })).filter((s) => s.title || s.what);
    // A plan needs steps, and each step at least a minute.
    if (steps.length === 0 || steps.length > req.minutes) throw NO_PLAN();
    return {
      objectives: lines(draft.objectives),
      steps: fitMinutes(steps.map((s) => ({ ...s, title: s.title || 'Step' })), req.minutes),
      checks: lines(draft.checks),
      homework: cleanText(draft.homework),
      library,
    };
  }
}
