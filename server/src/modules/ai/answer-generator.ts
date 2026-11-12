import type { AiAskRequest, AiAskResult } from '@ict/contracts';
import { z } from 'zod';
import { AppError } from '../../core/errors.js';
import type { Llm } from './llm-client.js';
import { ASK_SYSTEM, askPrompt, THINKING_ROOM } from './prompts.js';

const Answered = z.object({ answer: z.string() });
const ANSWER_ROOM = 1500;

// Spec 9 /ai/ask, first step: turns one question into one plain-text answer. Nothing else.
export class AnswerGenerator {
  constructor(private readonly llm: Llm) {}

  async answer(req: AiAskRequest, signal: AbortSignal): Promise<AiAskResult> {
    const { answer } = await this.llm.json({ system: ASK_SYSTEM, user: askPrompt(req), schema: Answered, maxTokens: ANSWER_ROOM + THINKING_ROOM, signal });
    const text = answer.trim();
    if (!text) throw new AppError(502, 'AI_NO_ANSWER', 'The AI gave no answer. Try asking in a different way.');
    return { answer: text };
  }
}
