import { getDb } from './schema';

/** app_settings 中「当前使用的模型配置 ID」键 */
const ACTIVE_PROVIDER_KEY = 'active_provider_id';

/** 读取一个全局配置项 */
export function getSetting(key: string): string | undefined {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

/** 写入（或覆盖）一个全局配置项 */
export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

/** 删除一个全局配置项 */
export function deleteSetting(key: string): void {
  getDb().prepare(`DELETE FROM app_settings WHERE key = ?`).run(key);
}

/**
 * 当前选用的模型配置 ID（自动分析使用）。
 * @returns 配置 ID；未选用任何模型时返回 null（→ 不做自动分析，仅手动运行）
 */
export function getActiveProviderId(): number | null {
  const value = getSetting(ACTIVE_PROVIDER_KEY);
  if (value == null) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** 设置（或清空）当前选用的模型配置 ID */
export function setActiveProviderId(id: number | null): void {
  if (id == null) deleteSetting(ACTIVE_PROVIDER_KEY);
  else setSetting(ACTIVE_PROVIDER_KEY, String(id));
}
