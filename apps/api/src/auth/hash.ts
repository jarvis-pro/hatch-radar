/**
 * 通用哈希与设备激活码（Node-only）。web 生成激活码并存其哈希，server 据哈希校验。
 */
import { createHash, randomBytes } from 'node:crypto';

/** sha256 十六进制（用于会话/激活码等不可逆比对）。 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 生成设备激活码（base64url，约 16 字符，便于转述 / 二维码）。明文只显示一次，库里只存其 sha256。 */
export function generateEnrollmentCode(): string {
  return randomBytes(12).toString('base64url');
}
