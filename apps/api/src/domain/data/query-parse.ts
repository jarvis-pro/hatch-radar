import type { Intensity } from '@hatch-radar/shared';

/** 解析页码：非正整数一律回落到 1。 */
export function parsePage(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** 解析强度筛选：仅接受 HIGH/MEDIUM/LOW（大小写不敏感），否则 undefined。 */
export function parseIntensity(value: string | undefined): Intensity | undefined {
  const v = value?.toUpperCase();
  return v === 'HIGH' || v === 'MEDIUM' || v === 'LOW' ? v : undefined;
}

/** 去空白后非空才返回，否则 undefined（统一处理可选字符串查询参数）。 */
export function trimmed(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}
