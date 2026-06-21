/** 返回当前 Unix 时间戳（秒） */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
