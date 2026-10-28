import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt } from 'node:crypto';

// Spec 3: bcrypt cost 10 for passwords and PINs; tokens are 32 random bytes, stored as SHA-256.
const BCRYPT_COST = 10;

export const hashSecret = (plain: string) => bcrypt.hash(plain, BCRYPT_COST);
export const hashSecretSync = (plain: string) => bcrypt.hashSync(plain, BCRYPT_COST);
export const checkSecret = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const sixDigitCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
