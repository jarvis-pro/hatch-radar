import {
  Prisma,
  toBlueprintRow,
  type AppDatabase,
  type BlueprintPg,
  type BlueprintRow,
} from '../internal';

export type { BlueprintRow };

/** 新建图纸入参 */
export interface NewBlueprintInput {
  /** collect | recheck | maintenance | analyze */
  kind: string;
  label: string;
  enabled?: boolean;
  /** once | cron | interval */
  triggerKind: string;
  /** cron 表达式 / interval 行为 / batch_* 等（JSON） */
  triggerConfig?: unknown;
  /** 业务参数（JSON） */
  params?: unknown;
}

/** 更新图纸入参（均可选，未给的字段不动） */
export interface UpdateBlueprintInput {
  label?: string;
  enabled?: boolean;
  triggerKind?: string;
  triggerConfig?: unknown;
  params?: unknown;
}

/**
 * 图纸（blueprints）数据访问。图纸是可复用、可调度的流程定义；代码常量仅作首启种子，运行期以本表为准。
 * 调度器从 {@link listSchedulable} 读 enabled 且 cron/interval 的图纸去触发进程。
 */
export class BlueprintsRepository {
  constructor(private readonly db: AppDatabase) {}

  async createBlueprint(input: NewBlueprintInput, now: number): Promise<BlueprintRow> {
    const row = await this.db.blueprints.create({
      data: {
        kind: input.kind,
        label: input.label,
        enabled: input.enabled ?? true,
        trigger_kind: input.triggerKind,
        trigger_config:
          input.triggerConfig == null
            ? Prisma.JsonNull
            : (input.triggerConfig as Prisma.InputJsonValue),
        params: input.params == null ? Prisma.JsonNull : (input.params as Prisma.InputJsonValue),
        created_at: BigInt(now),
        updated_at: BigInt(now),
      },
    });
    return toBlueprintRow(row);
  }

  async getBlueprint(id: number): Promise<BlueprintRow | null> {
    const row = await this.db.blueprints.findUnique({ where: { id } });
    return row ? toBlueprintRow(row) : null;
  }

  /** 列出图纸（可按 kind 过滤），id 倒序。 */
  async listBlueprints(kind?: string): Promise<BlueprintRow[]> {
    const rows = await this.db.blueprints.findMany({
      where: kind ? { kind } : {},
      orderBy: { id: 'desc' },
    });
    return rows.map((r: BlueprintPg) => toBlueprintRow(r));
  }

  /** 列出启用且可调度（cron / interval）的图纸——供 BlueprintScheduler 轮询触发。 */
  async listSchedulable(): Promise<BlueprintRow[]> {
    const rows = await this.db.blueprints.findMany({
      where: { enabled: true, trigger_kind: { in: ['cron', 'interval'] } },
      orderBy: { id: 'asc' },
    });
    return rows.map((r: BlueprintPg) => toBlueprintRow(r));
  }

  async updateBlueprint(id: number, patch: UpdateBlueprintInput, now: number): Promise<void> {
    const data: Prisma.blueprintsUpdateInput = { updated_at: BigInt(now) };
    if (patch.label !== undefined) data.label = patch.label;
    if (patch.enabled !== undefined) data.enabled = patch.enabled;
    if (patch.triggerKind !== undefined) data.trigger_kind = patch.triggerKind;
    if (patch.triggerConfig !== undefined) {
      data.trigger_config =
        patch.triggerConfig == null
          ? Prisma.JsonNull
          : (patch.triggerConfig as Prisma.InputJsonValue);
    }
    if (patch.params !== undefined) {
      data.params =
        patch.params == null ? Prisma.JsonNull : (patch.params as Prisma.InputJsonValue);
    }
    await this.db.blueprints.update({ where: { id }, data });
  }

  async deleteBlueprint(id: number): Promise<void> {
    await this.db.blueprints.delete({ where: { id } });
  }
}
