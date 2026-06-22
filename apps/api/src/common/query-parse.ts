/**
 * HTTP 查询参数解析小工具（跨控制器共用，无依赖）。
 */

/** 解析页码：非正整数一律回落到 1。 */
export function parsePage(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** 去空白后非空才返回，否则 undefined（统一处理可选字符串查询参数）。 */
export function trimmed(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}
