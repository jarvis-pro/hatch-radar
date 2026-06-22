/** 取错误信息文本：Error 取 message，否则 String 兜底（unknown catch 的统一归一） */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
