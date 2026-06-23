import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import { Prisma, toSourceRow, type AppDatabase, type SourceRow } from '../internal';

/** 数据来源平台 */
export type SourcePlatform = SourceRow['platform'];
export type { SourceRow };

/** 新建/更新采集来源的输入 */
export interface SourceInput {
  platform: SourcePlatform;
  identifier: string;
  label?: string;
  /** 平台特定参数(JSON)：reddit={sorts:["hot","new"],limit:25} */
  config?: unknown;
  enabled?: boolean;
}

/**
 * 采集来源（「爬虫计划」）数据访问。一行 = 一个要轮询的来源；enabled 即后台勾选。
 * 调度器每轮按平台查 enabled 来源，不再读硬编码常量。
 */
@Injectable()
export class SourcesRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /** 列出全部来源（按平台、id 排序） */
  async listSources(): Promise<SourceRow[]> {
    const rows = await this.db.sources.findMany({ orderBy: [{ platform: 'asc' }, { id: 'asc' }] });
    return rows.map(toSourceRow);
  }

  /** 列出某平台「已启用」的来源（调度抓取用） */
  async listEnabledByPlatform(platform: SourcePlatform): Promise<SourceRow[]> {
    const rows = await this.db.sources.findMany({
      where: { platform, enabled: true },
      orderBy: { id: 'asc' },
    });
    return rows.map(toSourceRow);
  }

  /** 按 ID 取单条来源 */
  async getSource(id: number): Promise<SourceRow | undefined> {
    const row = await this.db.sources.findUnique({ where: { id } });
    return row ? toSourceRow(row) : undefined;
  }

  /** 来源总数（供 seedSourcesIfEmpty 判断是否首启播种） */
  async countSources(): Promise<number> {
    return this.db.sources.count();
  }

  /** 新建来源 */
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

  /** 更新来源（仅更新提供的字段） */
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

  /** 删除来源 */
  async deleteSource(id: number): Promise<boolean> {
    const res = await this.db.sources.deleteMany({ where: { id } });
    return res.count > 0;
  }
}
