import type { Band } from '@ict/contracts';

// A quiz can be edited after it was run, so a score may exceed today's total; cap at 100.
export const percentOf = (score: number, total: number) => (total > 0 ? Math.min(100, Math.round((score * 100) / total)) : 0);

export const averageOf = (percents: number[]) =>
  percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : null;

export const bandOf = (average: number | null): Band =>
  average == null ? 'none' : average >= 60 ? 'great' : average >= 30 ? 'growing' : 'needs';

export const gradeOf = (p: number) => (p >= 90 ? 'A+' : p >= 80 ? 'A' : p >= 70 ? 'B' : p >= 60 ? 'C' : p >= 50 ? 'D' : 'E');
