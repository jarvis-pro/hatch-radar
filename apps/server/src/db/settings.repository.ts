import { Inject, Injectable } from '@nestjs/common';
import type { AppDatabase } from '@hatch-radar/db';
import { PRISMA } from '../common/tokens';

/** app_settings 中「当前使用的模型配置 ID」键 */
const ACTIVE_PROVIDER_KEY = 'active_provider_id';

/**
 * 全局键值配置数据访问（Prisma / PostgreSQL）。
 */
@Injectable()
export class SettingsRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /** 读取一个全局配置项 */
  async getSetting(key: string): Promise<string | undefined> {
    const row = await this.db.app_settings.findUnique({ where: { key }, select: { value: true } });
    return row?.value;
  }

  /** 写入（或覆盖）一个全局配置项 */
  async setSetting(key: string, value: string): Promise<void> {
    await this.db.app_settings.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  /** 删除一个全局配置项 */
  async deleteSetting(key: string): Promise<void> {
    await this.db.app_settings.deleteMany({ where: { key } });
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
