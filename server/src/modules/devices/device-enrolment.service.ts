import { randomUUID } from 'node:crypto';
import type { DeviceEnrol, DeviceEnrolResult, EnrolWindow, StaffPrincipal } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import { MINUTE, type Clock } from '../../core/clock.js';
import { AppError, lockedOut } from '../../core/errors.js';
import type { FailureLimiter } from '../auth/limiter.js';
import { DEVICE_TOKEN_MS } from '../auth/principal.resolver.js';
import { hashToken, newToken, sixDigitCode } from '../auth/secrets.js';
import type { SchoolIdentity } from '../system/school-identity.js';
import type { DeviceRepository } from './device.repository.js';
import type { EnrolWindowRepository } from './enrol-window.repository.js';

// Spec 4.2: lab PCs and boards join only while staff keep an enrol window open (max 30 min).
export class DeviceEnrolmentService {
  constructor(
    private readonly now: Clock,
    private readonly windows: EnrolWindowRepository,
    private readonly devices: DeviceRepository,
    private readonly identity: SchoolIdentity,
    private readonly limiter: FailureLimiter,
    private readonly audit: AuditLog,
  ) {}

  openWindow(by: StaffPrincipal, minutes: number): EnrolWindow {
    const now = this.now();
    const window: EnrolWindow = { id: randomUUID(), code: sixDigitCode(), closesAt: now + minutes * MINUTE };
    this.windows.replaceOpen({ ...window, openedBy: by.userId, now });
    this.audit.record({ kind: 'staff', id: by.userId }, 'enrol_window.open', window.id, { minutes });
    return window;
  }

  closeWindow() {
    this.windows.closeAll(this.now());
  }

  enrol(req: DeviceEnrol, clientIp: string): DeviceEnrolResult {
    const key = `enrol:${clientIp}`;
    const wait = this.limiter.blockedFor(key);
    if (wait > 0) throw lockedOut(wait);

    const now = this.now();
    const window = this.windows.findOpen(now);
    if (!window) throw new AppError(409, 'ENROL_CLOSED', 'No enrol window is open. Open one on the console.');
    if (window.code !== req.code) {
      this.limiter.fail(key);
      throw new AppError(403, 'WRONG_CODE', 'That enrol code is not right.');
    }
    this.limiter.succeed(key);

    const id = randomUUID();
    const token = newToken();
    const expiresAt = now + DEVICE_TOKEN_MS;
    this.devices.insert({ id, kind: req.kind, name: req.name, tokenHash: hashToken(token), expiresAt, appVersion: req.appVersion, now });
    this.audit.record({ kind: 'device', id }, 'device.enrol', id, { kind: req.kind, name: req.name, window: window.id });

    const { serverId, certFp } = this.identity.current();
    return { deviceId: id, token, expiresAt, serverId, certFp };
  }

  list() {
    return this.devices.list();
  }
}
