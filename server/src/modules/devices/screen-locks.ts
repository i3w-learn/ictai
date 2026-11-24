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
  // True while the lab is locked because the timetable has no class in it (see lock-policy.ts) and no
  // teacher has locked or unlocked every screen by hand since.
  private byPolicy = false;

  constructor(
    private readonly devices: DeviceRepository,
    private readonly relay: Relay,
    private readonly audit: AuditLog,
  ) {
    relay.register({
      prefix: 'device',
      // A PC hears about its own screen only: as itself before anyone signs in, and as the student on it after.
      canJoin: (p, deviceId) => (p.kind === 'device' || p.kind === 'student') && p.deviceId === deviceId,
      snapshot: (_p, deviceId) => ({ locked: this.locked.has(deviceId), byTimetable: this.byPolicy && this.locked.has(deviceId) }),
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
    this.putAll(ids, locked, false);
    this.audit.record({ kind: 'staff', id: by.userId }, locked ? 'screens.lock' : 'screens.unlock', null, { screens: ids.length });
  }

  // The timetable locks the students' PCs, or opens every screen. Nobody pressed a button, so the
  // activity log names the system. Nothing is written when no screen changed.
  setAllByPolicy(locked: boolean) {
    const ids = locked ? this.devices.list().filter((d) => d.kind === 'lab_pc').map((d) => d.id) : [...this.locked];
    const changed = this.putAll(ids, locked, locked);
    if (changed.length) this.audit.record({ kind: 'system', id: null }, locked ? 'screens.autolock' : 'screens.autounlock', null, { screens: changed.length });
  }

  lockedByPolicy(): boolean {
    return this.byPolicy;
  }

  // A PC that joins the lab while the timetable has it locked is locked like the rest.
  joined(deviceId: string, kind: 'lab_pc' | 'board') {
    if (this.byPolicy && kind === 'lab_pc') this.put(deviceId, true);
  }

  // A PC taken out of the lab is forgotten here too.
  forget(deviceId: string) {
    this.locked.delete(deviceId);
  }

  // Locks or opens many screens at once and notes who did it (the timetable or a person). The note
  // is set first, so each screen hears the right reason. A screen that stays locked but whose reason
  // changed is told again. Returns the screens that changed.
  private putAll(ids: string[], locked: boolean, byPolicy: boolean): string[] {
    const reasonChanged = byPolicy !== this.byPolicy;
    this.byPolicy = byPolicy;
    const changed = ids.filter((id) => this.put(id, locked));
    if (reasonChanged) for (const id of this.locked) if (!changed.includes(id)) this.relay.notify(deviceRoom(id));
    return changed;
  }

  private put(deviceId: string, locked: boolean): boolean {
    if (locked === this.locked.has(deviceId)) return false;
    if (locked) this.locked.add(deviceId);
    else this.locked.delete(deviceId);
    this.relay.notify(deviceRoom(deviceId));
    return true;
  }
}
