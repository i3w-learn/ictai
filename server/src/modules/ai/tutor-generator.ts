import type { AiTutorRequest, AiTutorResult } from '@ict/contracts';
import { z } from 'zod';
import { AppError } from '../../core/errors.js';
import type { Llm } from './llm-client.js';
import { THINKING_ROOM, tutorSystem } from './prompts.js';

const Answered = z.object({ answer: z.string() });
const ANSWER_ROOM = 600;

// PRD student "Ask": one question from a student becomes one short, simple hint.
// The class name is added by the server from who is signed in, never taken from the request.
export type TutorJobRequest = AiTutorRequest & { className?: string | null };

export class TutorGenerator {
  constructor(private readonly llm: Llm) {}

  async answer(req: TutorJobRequest, signal: AbortSignal): Promise<AiTutorResult> {
    const { answer } = await this.llm.json({ system: tutorSystem(req.className ?? null), user: req.question, schema: Answered, maxTokens: ANSWER_ROOM + THINKING_ROOM, signal });
    const text = answer.trim();
    if (!text) throw new AppError(502, 'AI_NO_ANSWER', 'The tutor had no answer. Try asking in a different way.');
    return { answer: text };
  }
}
