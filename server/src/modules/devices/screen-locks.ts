import { deviceRoom, type StaffPrincipal } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import { AppError } from '../../core/errors.js';
import type { Relay } from '../../relay/relay.js';
import type { DeviceRepository } from './device.repository.js';

// Spec 4.2: a teacher locks one screen, or every lab PC at once. A locked PC shows "Look at your
// teacher" over everything until it is unlocked.
// The locks are kept in memory only, on purpose: the Server PC is switched off at night, so no screen
// is still locked the next morning because someone forgot to unlock it.
export class ScreenLocks {
  private readonly locked = new Set<string>();

  constructor(
    private readonly devices: DeviceRepository,
    private readonly relay: Relay,
    private readonly audit: AuditLog,
  ) {
    relay.register({
      prefix: 'device',
      // A PC hears about its own screen only: as itself before anyone signs in, and as the student on it after.
      canJoin: (p, deviceId) => (p.kind === 'device' || p.kind === 'student') && p.deviceId === deviceId,
      snapshot: (_p, deviceId) => ({ locked: this.locked.has(deviceId) }),
    });
  }

  has(deviceId: string): boolean {
    return this.locked.has(deviceId);
  }

  setOne(by: StaffPrincipal, deviceId: string, locked: boolean) {
    if (!this.devices.isActive(deviceId)) throw new AppError(404, 'NOT_FOUND', 'That device is not in the lab.');
    this.put(deviceId, locked);
    this.audit.record({ kind: 'staff', id: by.userId }, locked ? 'screen.lock' : 'screen.unlock', deviceId, {});
  }

  // Locking is for the students' PCs; a board is locked on its own line. Unlocking opens everything.
  setAll(by: StaffPrincipal, locked: boolean) {
    const ids = locked ? this.devices.list().filter((d) => d.kind === 'lab_pc').map((d) => d.id) : [...this.locked];
    for (const id of ids) this.put(id, locked);
    this.audit.record({ kind: 'staff', id: by.userId }, locked ? 'screens.lock' : 'screens.unlock', null, { screens: ids.length });
  }

  // A PC taken out of the lab is forgotten here too.
  forget(deviceId: string) {
    this.locked.delete(deviceId);
  }

  private put(deviceId: string, locked: boolean) {
    if (locked === this.locked.has(deviceId)) return;
    if (locked) this.locked.add(deviceId);
    else this.locked.delete(deviceId);
    this.relay.notify(deviceRoom(deviceId));
  }
}
