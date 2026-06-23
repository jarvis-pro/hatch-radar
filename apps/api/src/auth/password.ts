/**
 * 口令哈希（Node-only）：node:crypto scrypt，每用户随机盐 + timingSafeEqual 比对。
 *
 * 入库格式 `scrypt:N:r:p:saltB64:hashB64` 自带参数，便于将来调强度而不影响旧哈希校验。
 * 复用 server utils/crypto.ts 的 scrypt 范式；web 与 server 共用本模块，mobile 不引。
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// N=16384（2^14，约 16MiB，低于默认 maxmem 32MiB）与既有 crypto.ts 默认一致；r/p 取标准值。
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

/** Promise 化的 scrypt（避免 promisify 重载类型歧义）。 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derived) => {
      if (err) {
        reject(err);
      } else {
        resolve(derived);
      }
    });
  });
}

/**
 * 派生口令哈希串（含参数与随机盐）。
 * @param plain 明文口令（先 NFKC 归一，避免同形不同码点）
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(plain.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P });

  return `scrypt:${N}:${R}:${P}:${salt.toString('base64')}:${key.toString('base64')}`;
}

/**
 * 校验明文口令与入库哈希。
 * @param plain 待校验明文
 * @param stored `hashPassword` 产出的哈希串
 * @returns 匹配为 true；格式非法或不匹配均为 false（不抛、时序安全比对）
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }

  const key = await scryptAsync(plain.normalize('NFKC'), salt, expected.length, { N: n, r, p });

  return key.length === expected.length && timingSafeEqual(key, expected);
}
