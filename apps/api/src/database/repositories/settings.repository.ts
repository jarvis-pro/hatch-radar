import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import type { AppDatabase } from '../internal';

/** app_settings 中「当前使用的模型配置 ID」键 */
const ACTIVE_PROVIDER_KEY = 'active_provider_id';
/** app_settings 中「翻译用模型配置 ID」键（与分析 active 解耦；未设时回落 active provider） */
const TRANSLATION_PROVIDER_KEY = 'translation_provider_id';
/** app_settings 中「分析配置版本号」键：模型/选用任一写操作即 +1，供跨进程缓存失效 */
const CONFIG_VERSION_KEY = 'analysis_config_version';

/**
 * 全局键值配置数据访问（Prisma / PostgreSQL）。
 */
@Injectable()
export class SettingsRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /**
   * 读取一个全局配置项。
   * @param key 配置键
   * @returns 配置值；不存在时返回 undefined
   */
  async getSetting(key: string): Promise<string | undefined> {
    const row = await this.db.app_settings.findUnique({ where: { key }, select: { value: true } });

    return row?.value;
  }

  /**
   * 写入（或覆盖）一个全局配置项。
   * @param key 配置键
   * @param value 配置值
   */
  async setSetting(key: string, value: string): Promise<void> {
    await this.db.app_settings.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  /**
   * 仅当 key 不存在时插入（ON CONFLICT DO NOTHING），用于幂等播种——绝不覆盖已有值。
   * @param key 配置键
   * @param value 初始值（仅 key 不存在时写入）
   * @returns 实际插入的行数（1=新播种 / 0=已存在），供调用方统计
   */
  insertSettingIfAbsent(key: string, value: string): Promise<number> {
    return this.db.$executeRaw`
      INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
      ON CONFLICT (key) DO NOTHING
    `;
  }

  /**
   * 删除一个全局配置项。
   * @param key 配置键
   */
  async deleteSetting(key: string): Promise<void> {
    await this.db.app_settings.deleteMany({ where: { key } });
  }

  /**
   * 当前选用的模型配置 ID（自动分析使用）。
   * @returns 配置 ID；未选用任何模型时返回 null（→ 不做自动分析，仅手动运行）
   */
  async getActiveProviderId(): Promise<number | null> {
    const value = await this.getSetting(ACTIVE_PROVIDER_KEY);
    if (value == null) {
      return null;
    }

    const n = Number(value);

    return Number.isInteger(n) ? n : null;
  }

  /**
   * 设置（或清空）当前选用的模型配置 ID。
   * @param id 模型配置 id；传 null 清空（停止自动分析）
   */
  async setActiveProviderId(id: number | null): Promise<void> {
    if (id == null) {
      await this.deleteSetting(ACTIVE_PROVIDER_KEY);
    } else {
      await this.setSetting(ACTIVE_PROVIDER_KEY, String(id));
    }
  }

  /**
   * 翻译用模型配置 ID（与分析 active 解耦，可单独指更省额度的档）。
   * @returns 配置 ID；未单独指定时返回 null（调用方回落 active provider）
   */
  async getTranslationProviderId(): Promise<number | null> {
    const value = await this.getSetting(TRANSLATION_PROVIDER_KEY);
    if (value == null) {
      return null;
    }

    const n = Number(value);

    return Number.isInteger(n) ? n : null;
  }

  /**
   * 设置（或清空）翻译用模型配置 ID。
   * @param id 模型配置 id；传 null 清空（翻译回落 active）
   */
  async setTranslationProviderId(id: number | null): Promise<void> {
    if (id == null) {
      await this.deleteSetting(TRANSLATION_PROVIDER_KEY);
    } else {
      await this.setSetting(TRANSLATION_PROVIDER_KEY, String(id));
    }
  }

  /**
   * 读取分析配置版本号。
   * @returns 当前版本；从未写过任何模型/选用时返回 0
   */
  async getConfigVersion(): Promise<number> {
    const value = await this.getSetting(CONFIG_VERSION_KEY);
    if (value == null) {
      return 0;
    }

    const n = Number(value);

    return Number.isFinite(n) ? n : 0;
  }

  /**
   * 原子递增分析配置版本号（单语句 upsert + 自增，多进程并发安全）。
   * 在任意模型/选用写操作后调用——其它进程的处理器缓存据此感知失效。
   * @returns 递增后的新版本号
   */
  async bumpConfigVersion(): Promise<number> {
    const rows = await this.db.$queryRaw<{ value: string }[]>`
      INSERT INTO app_settings (key, value) VALUES (${CONFIG_VERSION_KEY}, '1')
      ON CONFLICT (key) DO UPDATE SET value = (app_settings.value::bigint + 1)::text
      RETURNING value
    `;

    return Number(rows[0]?.value ?? 0);
  }
}
