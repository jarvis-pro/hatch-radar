import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import { Prisma, toSourceRow, type AppDatabase, type SourceRow } from '@/database/internal';

/** 数据来源平台 */
export type SourcePlatform = SourceRow['platform'];
export type { SourceRow };

/** 新建/更新采集来源的输入 */
export interface SourceInput {
  /** 数据来源平台（reddit / hackernews / rss） */
  platform: SourcePlatform;
  /** 来源标识（如 subreddit 名 / RSS URL） */
  identifier: string;
  /** 展示名；省略为空串 */
  label?: string;
  /** 平台特定参数(JSON)：reddit={sorts:["hot","new"],limit:25} */
  config?: unknown;
  /** 是否启用；省略按启用处理 */
  enabled?: boolean;
}

/**
 * 采集来源（「爬虫计划」）数据访问。一行 = 一个要轮询的来源；enabled 即后台勾选。
 * 调度器每轮按平台查 enabled 来源，不再读硬编码常量。
 */
@Injectable()
export class SourcesRepository {
  constructor(
    // 事务感知 Prisma 客户端（经 @Inject(PRISMA)，按 ALS 自动路由事务/根客户端）：读写采集来源（sources）表
    @Inject(PRISMA) private readonly db: AppDatabase,
  ) {}

  /** 列出全部来源（按平台、id 排序） */
  async listSources(): Promise<SourceRow[]> {
    const rows = await this.db.sources.findMany({ orderBy: [{ platform: 'asc' }, { id: 'asc' }] });

    return rows.map(toSourceRow);
  }

  /**
   * 列出某平台「已启用」的来源（调度抓取用）。
   * @param platform 数据来源平台
   */
  async listEnabledByPlatform(platform: SourcePlatform): Promise<SourceRow[]> {
    const rows = await this.db.sources.findMany({
      where: { platform, enabled: true },
      orderBy: { id: 'asc' },
    });

    return rows.map(toSourceRow);
  }

  /**
   * 按 ID 取单条来源。
   * @param id 来源 id
   * @returns 来源行；不存在时返回 undefined
   */
  async getSource(id: number): Promise<SourceRow | undefined> {
    const row = await this.db.sources.findUnique({ where: { id } });

    return row ? toSourceRow(row) : undefined;
  }

  /** 来源总数（供 seedSourcesIfEmpty 判断是否首启播种） */
  async countSources(): Promise<number> {
    return this.db.sources.count();
  }

  /**
   * 新建来源。
   * @param input 来源配置（见 {@link SourceInput}）
   * @param now 创建时刻 Unix 时间戳（秒）
   * @returns 新建来源的 id
   */
  async createSource(input: SourceInput, now: number): Promise<number> {
    const row = await this.db.sources.create({
      data: {
        platform: input.platform,
        identifier: input.identifier,
        label: input.label ?? '',
        config: input.config == null ? Prisma.DbNull : (input.config as Prisma.InputJsonValue),
        enabled: input.enabled !== false,
        created_at: BigInt(now),
        updated_at: BigInt(now),
      },
      select: { id: true },
    });

    return row.id;
  }

  /**
   * 更新来源（仅更新提供的字段）。
   * @param id 来源 id
   * @param fields 仅含需更新的字段
   * @param now 更新时刻 Unix 时间戳（秒）
   * @returns 是否写入（false = 无可更新字段，或来源不存在）
   */
  async updateSource(id: number, fields: Partial<SourceInput>, now: number): Promise<boolean> {
    const data: Record<string, unknown> = {};
    if (fields.platform !== undefined) {
      data.platform = fields.platform;
    }

    if (fields.identifier !== undefined) {
      data.identifier = fields.identifier;
    }

    if (fields.label !== undefined) {
      data.label = fields.label;
    }

    if (fields.config !== undefined) {
      data.config = fields.config;
    }

    if (fields.enabled !== undefined) {
      data.enabled = fields.enabled;
    }

    if (Object.keys(data).length === 0) {
      return false;
    }

    data.updated_at = BigInt(now);
    const res = await this.db.sources.updateMany({ where: { id }, data });

    return res.count > 0;
  }

  /**
   * 删除来源。
   * @param id 来源 id
   * @returns 是否删除（false = 来源不存在）
   */
  async deleteSource(id: number): Promise<boolean> {
    const res = await this.db.sources.deleteMany({ where: { id } });

    return res.count > 0;
  }
}
