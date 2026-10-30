import type { AiFlag, AiLanguage, AiQuizRequest, AiQuizResult, Question } from '@ict/contracts';
import { z, ZodError } from 'zod';
import { AppError, notFound } from '../../core/errors.js';
import type { Llm } from './llm-client.js';
import { ANSWER_SYSTEM, answerPrompt, WRITE_SYSTEM, writeQuizPrompt } from './prompts.js';

type Raw = { text: string; options: string[]; correct: number };

const Written = z.object({
  questions: z.array(z.object({
    text: z.string(),
    options: z.array(z.string()).min(4).max(4),
    correct: z.number().int().min(0).max(3),
  })),
});

const DEVANAGARI = /[ऀ-ॿ]/;
const LETTER = /\p{L}/u;
const EXTRA_ROUNDS = 2;
const PLEASE_CHECK = 'Please check: the AI gave a different answer when asked again.';

// Code checks on one question. Returns why it fails, or null when it passes.
export function checkQuestion(q: Raw, language: AiLanguage): string | null {
  const options = q.options.map((o) => o.trim());
  if (options.length !== 4) return 'needs exactly 4 options';
  if (options.some((o) => !o)) return 'has an empty option';
  if (new Set(options.map((o) => o.toLowerCase())).size !== 4) return 'has two options the same';
  if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) return 'has no valid right answer';
  if (!q.text.trim() || q.text.length > 500 || options.some((o) => o.length > 200)) return 'is empty or too long';
  const all = [q.text, ...options];
  if (language === 'en' && all.some((s) => DEVANAGARI.test(s))) return 'is not in English';
  if (language === 'hi') {
    if (!DEVANAGARI.test(q.text)) return 'is not in Hindi';
    // Numbers like "25" are fine in Hindi; words must be in Devanagari.
    if (options.some((o) => LETTER.test(o) && !DEVANAGARI.test(o))) return 'has an option not in Hindi';
  }
  return null;
}

// Question i is shown with its options rotated, so the right answer moves before the model is asked again.
const shiftOf = (i: number) => (i % 3) + 1;

// Spec 9 /ai/quiz: write → check in code (top up what was dropped) → ask the model again to answer
// each question blind; a different answer marks the question "Please check" for the teacher.
export class QuizGenerator {
  constructor(
    private readonly llm: Llm,
    private readonly className: (classId: string) => string | null,
  ) {}

  async generate(req: AiQuizRequest, signal: AbortSignal): Promise<AiQuizResult> {
    const className = this.className(req.classId);
    if (!className) throw notFound('Class');

    const kept: Raw[] = [];
    for (let round = 0; round <= EXTRA_ROUNDS && kept.length < req.count; round++) {
      signal.throwIfAborted();
      for (const q of await this.write(req, className, req.count - kept.length, kept, signal)) {
        const seen = kept.some((k) => k.text.trim().toLowerCase() === q.text.trim().toLowerCase());
        if (!seen && !checkQuestion(q, req.language) && kept.length < req.count) {
          kept.push({ text: q.text.trim(), options: q.options.map((o) => o.trim()), correct: q.correct });
        }
      }
    }
    if (!kept.length) {
      throw new AppError(422, 'AI_NO_QUESTIONS', 'The AI could not write questions that passed the checks. Try a different topic.');
    }

    signal.throwIfAborted();
    const flags = await this.askAgain(kept, signal);
    return {
      questions: kept.map((q): Question => ({ ...q, marks: 1 })),
      flags,
      note: kept.length < req.count ? `Only ${kept.length} of ${req.count} questions passed the checks.` : null,
    };
  }

  // A reply that breaks the shape counts as a round with no good questions.
  private async write(req: AiQuizRequest, className: string, count: number, kept: Raw[], signal: AbortSignal): Promise<Raw[]> {
    try {
      const out = await this.llm.json({
        system: WRITE_SYSTEM,
        user: writeQuizPrompt({ className, subject: req.subject, topic: req.topic, count, language: req.language, avoid: kept.map((k) => k.text) }),
        schema: Written,
        maxTokens: 300 * count + 200,
        signal,
      });
      return out.questions;
    } catch (err) {
      if (err instanceof ZodError || err instanceof SyntaxError) return [];
      throw err;
    }
  }

  // All questions in one request (faster than one each); options rotated so position gives nothing away.
  private async askAgain(kept: Raw[], signal: AbortSignal): Promise<AiFlag[]> {
    const shown = kept.map((q, i) => ({ text: q.text, options: q.options.map((_, p) => q.options[(p + shiftOf(i)) % 4]!) }));
    const Answers = z.object({ answers: z.array(z.number().int().min(-1).max(3)).length(kept.length) });
    let answers: number[];
    try {
      answers = (await this.llm.json({ system: ANSWER_SYSTEM, user: answerPrompt(shown), schema: Answers, maxTokens: 20 * kept.length + 50, signal })).answers;
    } catch (err) {
      if (!(err instanceof ZodError || err instanceof SyntaxError)) throw err;
      answers = kept.map(() => -1);
    }
    return kept.map((q, i) => {
      const pick = answers[i] ?? -1;
      const ok = pick >= 0 && (pick + shiftOf(i)) % 4 === q.correct;
      return ok ? { ok: true, note: null } : { ok: false, note: PLEASE_CHECK };
    });
  }
}
