import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { settingsSecret } from '@/config/env';

/**
 * 模型 API Key 的对称加解密（AES-256-GCM）。
 *
 * 密钥由 env `SETTINGS_SECRET` 经 scrypt 派生——只在 server 进程可得；web 即便直读同一个
 * PostgreSQL 库，看到的也只是密文，无法还原。盐固定（强度由 SETTINGS_SECRET 提供），
 * 每次加密用随机 IV，密文格式为 `iv:authTag:ciphertext`（均 base64）。
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
/** 固定派生盐：真正的强度来自高熵的 SETTINGS_SECRET */
const SALT = 'hatch-radar/settings/v1';

/** 派生密钥缓存：SETTINGS_SECRET 进程内固定、scryptSync 故意慢，按 secret 记忆化，避免每次加解密重复派生 */
let cachedKey: { secret: string; key: Buffer } | null = null;

function deriveKey(): Buffer {
  const secret = settingsSecret();
  if (!secret) {
    throw new Error(
      '未配置 SETTINGS_SECRET：模型密钥加密入库需要它，请在 .env 设一个高强度随机串（如 openssl rand -hex 32）',
    );
  }
  if (cachedKey?.secret === secret) {
    return cachedKey.key;
  }
  const key = scryptSync(secret, SALT, 32);
  cachedKey = { secret, key };
  return key;
}

/** 是否已配置 SETTINGS_SECRET（未配置则无法加密/解密模型密钥） */
export function isSecretConfigured(): boolean {
  return !!settingsSecret();
}

/**
 * 加密明文密钥。
 * @param plaintext 模型 API Key 明文
 * @returns `iv:authTag:ciphertext`（base64）形式的密文串
 * @throws 未配置 SETTINGS_SECRET 时抛出
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/**
 * 解密密文密钥。
 * @param payload `encryptSecret` 产出的密文串
 * @returns 还原的明文密钥
 * @throws 未配置 SETTINGS_SECRET、密文格式非法或校验失败（密钥不匹配/被篡改）时抛出
 */
export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('密文格式非法');
  }
  const decipher = createDecipheriv(ALGORITHM, deriveKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
