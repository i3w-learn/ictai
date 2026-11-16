import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import type { Clock } from './clock.js';

// The server's diary: one plain line per thing that happens in the lab, for whoever looks after the
// server. It is for reading while a lesson runs ("did the video reach every PC?"), unlike the audit
// log, which is the lasting record of who did what. It stays on the Server PC.
export type EventLog = (event: string, detail?: Record<string, unknown>) => void;

export const noEventLog: EventLog = () => {};

const MAX_BYTES = 5 * 1024 * 1024;
const two = (n: number) => String(n).padStart(2, '0');

// "2026-11-16 13:05:02  show.started  video="Fractions" class="7" by="Ravi K""
export function eventLine(at: number, event: string, detail: Record<string, unknown> = {}): string {
  const d = new Date(at);
  const when = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  const words = Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== null)
    // Text goes in quotes on one line, so a title with a line break in it cannot fake a second entry.
    .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : String(v)}`);
  return [when, event, ...words].join('  ');
}

// Writes each line to `file`, and hands it to `echo` as well (the server's own terminal). A diary
// that has grown past 5 MB is put aside as "<file>.1" when the server starts, so it never fills the disk.
export function fileEventLog(file: string, now: Clock, echo: (line: string) => void = () => {}): EventLog {
  if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
  return (event, detail) => {
    const line = eventLine(now(), event, detail);
    echo(line);
    try {
      appendFileSync(file, line + '\n');
    } catch {
      // A full or locked disk must never stop a lesson.
    }
  };
}
