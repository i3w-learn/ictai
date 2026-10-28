import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';

// Spec 7.1: two copies would fight over the port and database, so only one may run.
export function acquireSingleInstance(file: string): () => void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => {
        try { unlinkSync(file); } catch { /* already gone */ }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const pid = Number(readFileSync(file, 'utf8'));
      if (pid && isAlive(pid)) throw new Error(`Another ICT server is already running (pid ${pid}).`);
      unlinkSync(file); // stale lock from a crash
    }
  }
  throw new Error('Could not take the single-instance lock.');
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
