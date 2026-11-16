import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eventLine, fileEventLog } from '../src/core/event-log.js';

describe("the server's diary", () => {
  it('writes one plain line per event: the time, what happened, then the details', () => {
    const at = new Date(2026, 10, 16, 13, 5, 2).getTime();
    expect(eventLine(at, 'show.started', { video: 'Fractions', class: '7', screens: 3, pc: undefined })).toBe(
      '2026-11-16 13:05:02  show.started  video="Fractions"  class="7"  screens=3',
    );
  });

  it('keeps a title with a line break on one line, so it cannot fake a second entry', () => {
    const line = eventLine(0, 'show.started', { video: 'Two\n2026-01-01 00:00:00  show.stopped' });
    expect(line.split('\n')).toHaveLength(1);
  });

  it('adds each line to the file and hands it to the terminal too', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ict-log-')), 'events.log');
    const seen: string[] = [];
    const log = fileEventLog(file, () => 0, (line) => seen.push(line));
    log('show.started', { video: 'A' });
    log('show.stopped');
    expect(readFileSync(file, 'utf8').trimEnd().split('\n')).toEqual(seen);
    expect(seen).toHaveLength(2);
  });

  it('puts a diary that has grown too big aside when the server starts', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ict-log-')), 'events.log');
    writeFileSync(file, 'x'.repeat(5 * 1024 * 1024 + 1));
    fileEventLog(file, () => 0)('show.started');
    expect(readFileSync(file, 'utf8')).toMatch(/show\.started\n$/);
    expect(readFileSync(`${file}.1`, 'utf8')).toHaveLength(5 * 1024 * 1024 + 1);
  });
});
