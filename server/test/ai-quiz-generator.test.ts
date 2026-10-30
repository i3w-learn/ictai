import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AiQuizRequest } from '@ict/contracts';
import type { Llm, LlmRequest } from '../src/modules/ai/llm-client.js';
import { checkQuestion, cleanText, QuizGenerator } from '../src/modules/ai/quiz-generator.js';

type Raw = { text: string; options: string[]; correct: number };

// A model whose replies are scripted in order; it records every request.
function scripted(replies: unknown[]) {
  const requests: LlmRequest<unknown>[] = [];
  const llm: Llm = {
    async json<T>(req: LlmRequest<T>) {
      requests.push(req as LlmRequest<unknown>);
      if (!replies.length) throw new Error('no reply scripted');
      return replies.shift() as T;
    },
  };
  return { llm, requests };
}

const classId = randomUUID();
const req = (over: Partial<AiQuizRequest> = {}): AiQuizRequest =>
  ({ classId, subject: 'Maths', topic: 'Fractions', count: 3, language: 'en', ...over });
const gen = (llm: Llm) => new QuizGenerator(llm, (id) => (id === classId ? '7' : null));
const signal = () => new AbortController().signal;

const q = (n: number, correct = 1): Raw => ({ text: `Question ${n}?`, options: [`a${n}`, `b${n}`, `c${n}`, `d${n}`], correct });

// The generator shows option k of question i at position (k - shift + 4) % 4 with shift = (i % 3) + 1,
// so the model answering "the right one" picks (correct - shift + 4) % 4.
const rightPick = (i: number, correct: number) => (correct - ((i % 3) + 1) + 4) % 4;

describe('checkQuestion', () => {
  it('accepts a good question', () => expect(checkQuestion(q(1), 'en')).toBeNull());
  it('needs 4 options', () => expect(checkQuestion({ ...q(1), options: ['a', 'b', 'c'] }, 'en')).not.toBeNull());
  it('needs different options', () => expect(checkQuestion({ ...q(1), options: ['a', 'A ', 'c', 'd'] }, 'en')).not.toBeNull());
  it('needs no empty option', () => expect(checkQuestion({ ...q(1), options: ['a', ' ', 'c', 'd'] }, 'en')).not.toBeNull());
  it('needs a valid answer', () => expect(checkQuestion({ ...q(1), correct: 5 }, 'en')).not.toBeNull());
  it('English has no Hindi script', () => expect(checkQuestion({ ...q(1), text: 'आधा क्या है?' }, 'en')).not.toBeNull());
  it('Hindi needs Devanagari', () => {
    expect(checkQuestion(q(1), 'hi')).not.toBeNull();
    expect(checkQuestion({ text: '4 का आधा क्या है?', options: ['1', '2', '3', 'चार'], correct: 1 }, 'hi')).toBeNull();
  });
});

describe('cleanText', () => {
  it('turns LaTeX fractions into plain ones', () => expect(cleanText('Half is $\\frac{1}{2}$ and $1\\frac{1}{2}$')).toBe('Half is 1/2 and 1 1/2'));
  it('removes stray marker symbols', () => expect(cleanText('†3/4‡ of a †5†metre rope')).toBe('3/4 of a 5 metre rope'));
  it('leaves Hindi alone', () => expect(cleanText('4 का आधा क्या है?')).toBe('4 का आधा क्या है?'));
});

describe('QuizGenerator', () => {
  it('cleans the text of what it keeps', async () => {
    const odd: Raw = { text: 'Which is $\\frac{1}{2}$?', options: ['†1/2‡', '1/3', '1/4', '1/5'], correct: 0 };
    const { llm } = scripted([{ questions: [odd] }, { answers: [rightPick(0, 0)] }]);
    const out = await gen(llm).generate(req({ count: 1 }), signal());
    expect(out.questions[0]).toMatchObject({ text: 'Which is 1/2?', options: ['1/2', '1/3', '1/4', '1/5'] });
  });

  it('returns checked questions with ok flags', async () => {
    const { llm } = scripted([
      { questions: [q(0), q(1), q(2)] },
      { answers: [rightPick(0, 1), rightPick(1, 1), rightPick(2, 1)] },
    ]);
    const out = await gen(llm).generate(req(), signal());
    expect(out.questions).toHaveLength(3);
    expect(out.questions[0]).toEqual({ ...q(0), marks: 1 });
    expect(out.flags).toEqual([{ ok: true, note: null }, { ok: true, note: null }, { ok: true, note: null }]);
    expect(out.note).toBeNull();
  });

  it('flags a question when the second answer differs', async () => {
    const { llm } = scripted([
      { questions: [q(0), q(1), q(2)] },
      { answers: [rightPick(0, 1), (rightPick(1, 1) + 1) % 4, -1] },
    ]);
    const out = await gen(llm).generate(req(), signal());
    const check = { ok: false, note: 'Please check: the AI gave a different answer when asked again.' };
    expect(out.flags).toEqual([{ ok: true, note: null }, check, check]);
  });

  it('ask-again does not reveal the answer and shuffles the options', async () => {
    const { llm, requests } = scripted([{ questions: [q(0)] }, { answers: [rightPick(0, 1)] }]);
    await gen(llm).generate(req({ count: 1 }), signal());
    const ask = requests[1]!.user;
    expect(ask).not.toMatch(/correct|answer is/i);
    // shift 1 for question 0: shown order is b0, c0, d0, a0
    expect(ask.indexOf('b0')).toBeLessThan(ask.indexOf('a0'));
  });

  it('drops bad questions', async () => {
    const bad: Raw[] = [{ ...q(0), options: ['x', 'x', 'y', 'z'] }, { ...q(1), correct: 5 }, q(2)];
    const { llm } = scripted([{ questions: bad }, { questions: [] }, { questions: [] }, { answers: [rightPick(0, 1)] }]);
    const out = await gen(llm).generate(req(), signal());
    expect(out.questions.map((x) => x.text)).toEqual(['Question 2?']);
  });

  it('drops questions in the wrong language', async () => {
    const hindi: Raw = { text: '4 का आधा क्या है?', options: ['एक', 'दो', 'तीन', 'चार'], correct: 1 };
    const { llm } = scripted([{ questions: [hindi, q(1)] }, { questions: [] }, { questions: [] }, { answers: [rightPick(0, 1)] }]);
    const out = await gen(llm).generate(req({ language: 'hi', count: 2 }), signal());
    expect(out.questions.map((x) => x.text)).toEqual([hindi.text]);
  });

  it('drops a repeated question', async () => {
    const { llm } = scripted([{ questions: [q(0), q(0)] }, { questions: [] }, { questions: [] }, { answers: [rightPick(0, 1)] }]);
    const out = await gen(llm).generate(req({ count: 2 }), signal());
    expect(out.questions).toHaveLength(1);
  });

  it('tops up dropped questions', async () => {
    const { llm, requests } = scripted([
      { questions: [q(0), { ...q(9), correct: 7 }, { ...q(8), correct: 7 }] },
      { questions: [q(1), q(2)] },
      { answers: [rightPick(0, 1), rightPick(1, 1), rightPick(2, 1)] },
    ]);
    const out = await gen(llm).generate(req(), signal());
    expect(out.questions).toHaveLength(3);
    expect(requests[1]!.user).toContain('2 ');
  });

  it('stops after 2 extra rounds and says how many passed', async () => {
    const { llm, requests } = scripted([
      { questions: [q(0)] }, { questions: [] }, { questions: [] },
      { answers: [rightPick(0, 1)] },
    ]);
    const out = await gen(llm).generate(req(), signal());
    expect(out.note).toBe('Only 1 of 3 questions passed the checks.');
    expect(requests.filter((r) => r.user.includes('Write'))).toHaveLength(3);
  });

  it('refuses an unknown class', async () => {
    const { llm } = scripted([]);
    await expect(gen(llm).generate(req({ classId: randomUUID() }), signal())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('stops when the job is cancelled', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const { llm } = scripted([{ questions: [q(0)] }]);
    await expect(gen(llm).generate(req(), ctl.signal)).rejects.toThrow();
  });
});
