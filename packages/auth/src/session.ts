/**
 * Web 会话 token（Node-only）：生成不透明随机 token（只下发到 cookie），库里只存其 sha256。
 * 即便数据库泄露，也无法据 token_hash 反推出可用的会话 token。
 */
import { randomBytes, createHash } from 'node:crypto';

/** 生成不透明会话 token（base64url，32 字节熵）。原始值仅写入用户 cookie。 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 会话 token 的存储哈希（sha256 hex）；sessions.token_hash 存此值、按此查会话。 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
