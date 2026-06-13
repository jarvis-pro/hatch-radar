import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { appSettings, type AppDatabase } from '@hatch-radar/db';
import { DRIZZLE } from '../common/tokens';

/** app_settings 中「当前使用的模型配置 ID」键 */
const ACTIVE_PROVIDER_KEY = 'active_provider_id';

/**
 * 全局键值配置数据访问（异步 Drizzle / PostgreSQL）。
 */
@Injectable()
export class SettingsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: AppDatabase) {}

  /** 读取一个全局配置项 */
  async getSetting(key: string): Promise<string | undefined> {
    const rows = await this.db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .limit(1);
    return rows[0]?.value;
  }

  /** 写入（或覆盖）一个全局配置项 */
  async setSetting(key: string, value: string): Promise<void> {
    await this.db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`excluded.value` } });
  }

  /** 删除一个全局配置项 */
  async deleteSetting(key: string): Promise<void> {
    await this.db.delete(appSettings).where(eq(appSettings.key, key));
  }

  /**
   * 当前选用的模型配置 ID（自动分析使用）。
   * @returns 配置 ID；未选用任何模型时返回 null（→ 不做自动分析，仅手动运行）
   */
  async getActiveProviderId(): Promise<number | null> {
    const value = await this.getSetting(ACTIVE_PROVIDER_KEY);
    if (value == null) return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
  }

  /** 设置（或清空）当前选用的模型配置 ID */
  async setActiveProviderId(id: number | null): Promise<void> {
    if (id == null) await this.deleteSetting(ACTIVE_PROVIDER_KEY);
    else await this.setSetting(ACTIVE_PROVIDER_KEY, String(id));
  }
}
