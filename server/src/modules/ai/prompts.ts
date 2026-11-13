import type { AiLanguage } from '@ict/contracts';

const LANGUAGE = { en: 'English', hi: 'Hindi (Devanagari script)' } as const;

// Gemma thinks before it answers; the thinking counts against max tokens, so every request leaves room for it.
export const THINKING_ROOM = 4000;

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

export const ASK_SYSTEM =
  'You are a helpful assistant for teachers in an Indian school. Answer correctly and clearly in plain text: ' +
  'no markdown, no LaTeX, no special symbols. Keep it short unless the question needs detail.';

export function askPrompt(p: { question: string; language: AiLanguage }) {
  return [`Answer in ${LANGUAGE[p.language]}.`, '', p.question].join('\n');
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

// The student tutor. It explains and nudges; it is told not to do the child's work for them.
export function tutorSystem(className: string | null) {
  return [
    `You are a kind, patient tutor for a student in Class ${className ?? '5'} of an Indian school.`,
    'Explain the idea in very simple words and short sentences, with one everyday example.',
    'Give a hint or the first step, then ask the student to try the rest. Do not write out the finished answer to a piece of homework, a worksheet or an essay.',
    'For a plain fact (a meaning, a date, a spelling) just say it.',
    'Answer in the language the student wrote in. Plain text only: no markdown, no LaTeX, no special symbols. At most 120 words.',
    'If the question is not about school learning, or is unkind or unsafe, say gently that you can only help with school work.',
  ].join(' ');
}
