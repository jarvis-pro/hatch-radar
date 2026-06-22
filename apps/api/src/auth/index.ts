/**
 * @/auth —— 认证 crypto（Node-only，web 与 server 共用；mobile 不引）。
 *
 * 仅依赖 node:crypto，无第三方依赖：
 * - password：scrypt 口令哈希 / 校验
 * - session：Web 会话 token 生成 / 哈希
 * - device：Ed25519 设备挑战-应答验签 + nonce
 */
export * from './password';
export * from './session';
export * from './device';
export * from './hash';
