import { appendFileSync, mkdirSync } from 'node:fs';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { systemClock } from './core/clock.js';
import { openDb } from './infra/db/index.js';
import { acquireSingleInstance } from './infra/lock.js';
import { lanAddresses } from './infra/net/addresses.js';
import { startBeacon } from './infra/net/beacon.js';
import { acceptPrivateOnly } from './infra/net/private-only.js';
import { loadOrCreateTls } from './infra/net/tls.js';
import { consumeBootstrapAdmin } from './modules/auth/bootstrap-admin.js';

const config = loadConfig();

// Spec 7.1 startup order: lock, database + migrations, identity, TLS, API, beacon.
async function main() {
  mkdirSync(config.dataDir, { recursive: true });
  const release = acquireSingleInstance(config.lockFile);

  const db = openDb(config.dbFile);
  const c = createContainer({ db, now: systemClock, version: config.version });
  if (config.devAdmin) await c.staffAuth.upsertAccount({ ...config.devAdmin, role: 'super_admin' });
  await consumeBootstrapAdmin(config.bootstrapAdminFile, c.staffAuth);

  const { serverId } = c.identity.current();
  const tls = await loadOrCreateTls(config.tlsDir, serverId);
  c.identity.setCertFingerprint(tls.fingerprint);

  const app = buildApp(c, { https: { key: tls.key, cert: tls.cert }, logger: true });
  acceptPrivateOnly(app.server);
  try {
    await app.listen({ port: config.apiPort, host: '0.0.0.0' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new Error(`Port ${config.apiPort} is already used by another program. Close it, then start the server again.`);
    }
    throw err;
  }

  const beacon = await startBeacon({
    port: config.beaconPort,
    here: () => {
      const id = c.identity.current();
      return { serverId: id.serverId, schoolId: id.schoolId, name: id.name, addrs: lanAddresses(), port: config.apiPort, certFp: id.certFp };
    },
  });
  app.log.info({ serverId, certFp: tls.fingerprint, addrs: lanAddresses(), beacon: beacon.port }, 'ICT server ready');

  const stop = async () => {
    await beacon.close();
    await app.close();
    db.close();
    release();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  // Spec 7.1: startup errors go to startup.log next to the database.
  mkdirSync(config.dataDir, { recursive: true });
  appendFileSync(config.startupLog, `${new Date().toISOString()} ${err?.stack ?? err}\n`);
  console.error(err?.message ?? err);
  process.exit(1);
});
