import { describe, expect, it } from 'vitest';
import { AnswerGenerator } from '../src/modules/ai/answer-generator.js';
import type { Llm, LlmRequest } from '../src/modules/ai/llm-client.js';

// A model that remembers what it was asked and always gives the same answer.
function fakeLlm(answer: string) {
  const asked: LlmRequest<unknown>[] = [];
  const llm: Llm = {
    async json<T>(req: LlmRequest<T>) {
      asked.push(req);
      return { answer } as T;
    },
  };
  return { llm, asked };
}

const signal = new AbortController().signal;

describe('AI answer generator', () => {
  it('sends the question and language to the model and returns its answer trimmed', async () => {
    const { llm, asked } = fakeLlm('  Because air scatters blue light the most.  ');
    const out = await new AnswerGenerator(llm).answer({ question: 'Why is the sky blue?', language: 'hi' }, signal);
    expect(out).toEqual({ answer: 'Because air scatters blue light the most.' });
    expect(asked[0]!.user).toContain('Why is the sky blue?');
    expect(asked[0]!.user).toContain('Hindi');
    expect(asked[0]!.signal).toBe(signal);
  });

  it('fails with a clear message when the model answers nothing', async () => {
    const { llm } = fakeLlm('   ');
    await expect(new AnswerGenerator(llm).answer({ question: 'Hello?', language: 'en' }, signal))
      .rejects.toThrow('The AI gave no answer. Try asking in a different way.');
  });
});
