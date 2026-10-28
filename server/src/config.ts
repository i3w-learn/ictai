import { join, resolve } from 'node:path';
import { PORTS } from '@ict/contracts';

export interface Config {
  version: string;
  dataDir: string;
  dbFile: string;
  tlsDir: string;
  lockFile: string;
  startupLog: string;
  bootstrapAdminFile: string;
  apiPort: number;
  beaconPort: number;
  devAdmin: { username: string; password: string } | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.ICT_DATA_DIR ?? '.data');
  return {
    version: '0.1.0',
    dataDir,
    dbFile: join(dataDir, 'ict.db'),
    tlsDir: join(dataDir, 'tls'),
    lockFile: join(dataDir, 'server.lock'),
    startupLog: join(dataDir, 'startup.log'),
    bootstrapAdminFile: join(dataDir, 'bootstrap-admin.json'),
    apiPort: Number(env.ICT_PORT ?? PORTS.api),
    beaconPort: Number(env.ICT_BEACON_PORT ?? PORTS.beacon),
    devAdmin:
      env.ICT_DEV_ADMIN_USER && env.ICT_DEV_ADMIN_PASSWORD
        ? { username: env.ICT_DEV_ADMIN_USER, password: env.ICT_DEV_ADMIN_PASSWORD }
        : null,
  };
}
