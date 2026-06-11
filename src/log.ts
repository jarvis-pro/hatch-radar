function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * 带 ISO 时间戳前缀的全局日志工具。
 * - INFO 输出到 stdout；WARN / ERROR 输出到 stderr
 */
export const log = {
  /** 输出 INFO 级别消息 */
  info(msg: string): void {
    console.log(`[${ts()}] ${msg}`);
  },
  /** 输出 WARN 级别消息 */
  warn(msg: string): void {
    console.warn(`[${ts()}] WARN ${msg}`);
  },
  /** 输出 ERROR 级别消息 */
  error(msg: string): void {
    console.error(`[${ts()}] ERROR ${msg}`);
  },
};
