import type { AiLanguage } from '@ict/contracts';

const LANGUAGE = { en: 'English', hi: 'Hindi (Devanagari script)' } as const;

export const WRITE_SYSTEM =
  'You write multiple-choice quiz questions for Indian school students. You are careful: every fact must be correct, ' +
  'and exactly one option must be right.';

export function writeQuizPrompt(p: { className: string; subject: string; topic: string; count: number; language: AiLanguage; avoid: string[] }) {
  return [
    `Write ${p.count} multiple-choice questions for Class ${p.className} students.`,
    `Subject: ${p.subject}`,
    `Topic: ${p.topic}`,
    `Language: write every question and every option in ${LANGUAGE[p.language]}.`,
    'Rules:',
    '- Each question has exactly 4 options. Exactly one is right; the other three are believable but clearly wrong.',
    '- Keep the words simple enough for this class.',
    '- Do not use "all of the above", "none of the above" or trick questions.',
    '- Write maths as plain text, e.g. 3/4 or 1 1/2. No LaTeX, no special symbols.',
    '- Do not refer to a picture or figure; students only see the text.',
    '- "correct" is the position (0, 1, 2 or 3) of the right option.',
    ...(p.avoid.length ? ['Do not repeat these questions:', ...p.avoid.map((t) => `- ${t}`)] : []),
  ].join('\n');
}

export const ANSWER_SYSTEM = 'You are a careful teacher checking a quiz. Work out each answer yourself.';

// The questions are shown with their options in a new order and no hint of the right one.
export function answerPrompt(questions: { text: string; options: string[] }[]) {
  return [
    'Answer each question below. For each one give the position (0, 1, 2 or 3) of the one right option.',
    'Give -1 if no option is right, or if more than one option is right.',
    '',
    ...questions.map((q, i) => [`Question ${i + 1}: ${q.text}`, ...q.options.map((o, k) => `  ${k}. ${o}`)].join('\n')),
  ].join('\n');
}
