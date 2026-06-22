/** 返回当前 Unix 时间戳（秒） */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** 延时 `ms` 毫秒后 resolve（退避 / 限速等场景的非阻塞等待） */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
