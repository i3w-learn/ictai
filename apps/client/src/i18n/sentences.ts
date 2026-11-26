import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Finds every sentence the screens hand to t('…') or tk('…'), by reading the source files. Used by
// the test that checks each one has a Marathi line. Not part of the app itself.
const CALL = /\b(?:t|tk)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'i18n' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// Sentence -> the files that say it.
export function sentencesIn(srcDir: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles(srcDir)) {
    for (const m of readFileSync(file, 'utf8').matchAll(CALL)) {
      const text = m[2]!.replace(/\\(['"\\])/g, '$1');
      found.set(text, [...(found.get(text) ?? []), file.slice(srcDir.length + 1)]);
    }
  }
  return found;
}

export const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
