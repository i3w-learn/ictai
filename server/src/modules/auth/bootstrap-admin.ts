import { existsSync, readFileSync, rmSync } from 'node:fs';
import { z } from 'zod';
import type { StaffAuthService } from './staff-auth.service.js';

const BootstrapAdmin = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(8).max(200),
});

// The installer drops this file with the first Super Admin's details. We create the
// account once and delete the file, so the password never stays on disk.
// Replaced by the signed field-person list in M4.
export async function consumeBootstrapAdmin(file: string, staffAuth: StaffAuthService): Promise<boolean> {
  if (!existsSync(file)) return false;
  try {
    const admin = BootstrapAdmin.parse(JSON.parse(readFileSync(file, 'utf8')));
    await staffAuth.upsertAccount({ ...admin, role: 'super_admin' });
    return true;
  } finally {
    rmSync(file, { force: true });
  }
}
