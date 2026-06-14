/**
 * 鉴权常量与纯工具（不引 server-only：middleware/edge 也要 import 会话 cookie 名）。
 */

/** 会话 cookie 名。 */
export const SESSION_COOKIE = 'radar_session';

/** 当前 Unix 秒（与全库 BigInt 时间戳同口径）。 */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
