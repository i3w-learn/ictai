import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localeOf, translate } from './i18n';
import { mr } from './mr';
import { placeholders, sentencesIn } from './sentences';

describe('saying a sentence in the chosen language', () => {
  const [known, marathi] = Object.entries(mr)[0]!;

  it('gives English as it is written, and Marathi from the list', () => {
    expect(translate('en', known)).toBe(known);
    expect(translate('mr', known)).toBe(marathi);
  });

  it('falls back to English for a sentence with no Marathi yet', () => {
    expect(translate('mr', 'A sentence nobody has translated.')).toBe('A sentence nobody has translated.');
  });

  it('fills in the changing parts, in whatever order the language puts them', () => {
    expect(translate('en', 'You got {score} of {max}.', { score: 7, max: 10 })).toBe('You got 7 of 10.');
    expect(translate('mr', 'You got {score} of {max}.', { score: 7, max: 10 })).toBe(mr['You got {score} of {max}.']!.replace('{score}', '7').replace('{max}', '10'));
    expect(translate('mr', 'You got {score} of {max}.', { score: 7, max: 10 })).not.toMatch(/[{}]/);
    // A part nobody gave stays visible, so the mistake is seen.
    expect(translate('en', 'Hello {name}', {})).toBe('Hello {name}');
  });

  it('writes Marathi dates with Marathi month names and the same digits as the rest of the app', () => {
    expect(localeOf('en')).toBeUndefined();
    const said = new Date(2026, 10, 23).toLocaleDateString(localeOf('mr'), { day: 'numeric', month: 'long' });
    expect(said).toMatch(/23/);
    expect(said).toMatch(/[\u0900-\u097F]/);
  });
});

describe('the Marathi list', () => {
  const used = sentencesIn(resolve(__dirname, '..'));

  it('has a line for every sentence the screens say', () => {
    const missing = [...used.keys()].filter((s) => !(s in mr));
    expect(missing, `No Marathi for:\n${missing.map((s) => `  ${JSON.stringify(s)}  (${used.get(s)![0]})`).join('\n')}`).toEqual([]);
  });

  it('has no line left over from a sentence the screens no longer say', () => {
    expect(Object.keys(mr).filter((s) => !used.has(s))).toEqual([]);
  });

  it('keeps the changing parts of every sentence, and is really in Marathi', () => {
    for (const [english, marathi] of Object.entries(mr)) {
      expect(placeholders(marathi), english).toEqual(placeholders(english));
      expect(marathi.trim(), english).not.toBe('');
      // Devanagari letters, unless the sentence is only a name, a number or a sign.
      if (/[A-Za-z]{3,}/.test(english.replace(/\{\w+\}/g, '')) && english !== 'ICT App') expect(marathi, english).toMatch(/[\u0900-\u097F]/);
    }
  });
});
