// Times the quiz maker on this machine and writes a CSV for a teacher to mark.
// Usage: tsx scripts/ai-bench.ts <topics.txt> [en|hi] [count]
// topics.txt has one "class|subject|topic" per line, e.g. "7|Maths|Fractions".
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { LlamaServerLlm } from '../src/modules/ai/llm-client.js';
import { QuizGenerator } from '../src/modules/ai/quiz-generator.js';
import { AiRuntime, nodeSpawner } from '../src/modules/ai/runtime.js';

const [topicsFile, language = 'en', count = '10'] = process.argv.slice(2);
if (!topicsFile || (language !== 'en' && language !== 'hi')) throw new Error('Usage: ai-bench <topics.txt> [en|hi] [count]');

const config = loadConfig();
const runtime = new AiRuntime(config.ai, nodeSpawner(join(config.dataDir, 'ai.log')));
console.log(`Model: ${runtime.installed()?.name ?? 'not installed'}. Loading…`);
await runtime.ensureReady();

const llm = new LlamaServerLlm(runtime);
const csv = ['topic,language,question,options,right_answer,flagged,seconds,teacher_says_correct'];
const cell = (s: string | number) => `"${String(s).replaceAll('"', '""')}"`;
const times: number[] = [];

for (const line of readFileSync(topicsFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)) {
  const [cls = '', subject = '', topic = ''] = line.split('|');
  const classId = randomUUID();
  const started = Date.now();
  const out = await new QuizGenerator(llm, () => cls).generate(
    { classId, subject, topic, count: Number(count), language },
    AbortSignal.timeout(15 * 60_000),
  );
  const seconds = Math.round((Date.now() - started) / 1000);
  times.push(seconds);
  console.log(`${topic}: ${out.questions.length} questions, ${out.flags.filter((f) => !f.ok).length} flagged, ${seconds}s`);
  out.questions.forEach((q, i) =>
    csv.push([topic, language, q.text, q.options.join(' | '), q.options[q.correct]!, out.flags[i]!.ok ? '' : 'yes', seconds, ''].map(cell).join(',')));
}

const file = `ai-bench-${new Date().toISOString().slice(0, 10)}-${language}.csv`;
writeFileSync(file, csv.join('\n'));
console.log(`Average ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}s per quiz. Wrote ${file}.`);
runtime.stop();
