import { Inject, Injectable } from '@nestjs/common';
import type { TaskKind } from '@hatch-radar/shared';
import { PRISMA } from '@/common/tokens';
import {
  Prisma,
  toBlueprintRow,
  type AppDatabase,
  type BlueprintPg,
  type BlueprintRow,
} from '@/database/internal';

export type { BlueprintRow };

/** 新建图纸入参（纯配方：来源 / 参数 / 暂停点 / 可选环节；触发节奏在 processes） */
export interface NewBlueprintInput {
  /** 复用 task_kind；实际仅用 collect / recheck / analyze / translate（不会是 discover）。 */
  kind: TaskKind;
  /** 展示名 */
  label: string;
  /** 备注 */
  note?: string | null;
  /** 是否启用；省略为 true */
  enabled?: boolean;
  /** 来源筛选：[{kind,channels[]}]（JSON） */
  sources?: unknown;
  /** 业务参数（JSON） */
  params?: unknown;
  /** 暂停点复合键数组 kind:stage（JSON） */
  gates?: unknown;
  /** 已启用的可选环节复合键数组（JSON） */
  enabledStages?: unknown;
}

/**
 * 更新图纸入参（均可选，未给的字段不动）。
 * 语义同 {@link NewBlueprintInput} 对应字段。
 */
export interface UpdateBlueprintInput {
  label?: string;
  note?: string | null;
  enabled?: boolean;
  sources?: unknown;
  params?: unknown;
  gates?: unknown;
  enabledStages?: unknown;
}

/**
 * 图纸（blueprints）数据访问。图纸是可复用的流程**纯配方**（来源 + 环节 + 暂停点），不含触发节奏；
 * 节奏由 processes 承载。代码常量仅作首启种子，运行期以本表为准。
 */
@Injectable()
export class BlueprintsRepository {
  constructor(
    // 事务感知 Prisma 客户端（经 @Inject(PRISMA)，按 ALS 自动路由事务/根客户端）：读写图纸（blueprints）表
    @Inject(PRISMA) private readonly db: AppDatabase,
  ) {}

  /**
   * 新建一份图纸；未给的 JSON 配方字段（sources/gates/enabledStages）走 DB 默认 []。
   * @param input 图纸字段（见 {@link NewBlueprintInput}）
   * @param now 创建时刻 Unix 时间戳（秒）
   * @returns 新建的图纸行
   */
  async createBlueprint(input: NewBlueprintInput, now: number): Promise<BlueprintRow> {
    const row = await this.db.blueprints.create({
      data: {
        kind: input.kind,
        label: input.label,
        note: input.note ?? null,
        enabled: input.enabled ?? true,
        // sources / gates / enabled_stages 为 NOT NULL JSON（默认 []）：未给时传 undefined 走 DB 默认，勿用 JsonNull
        sources: input.sources == null ? undefined : (input.sources as Prisma.InputJsonValue),
        params: input.params == null ? Prisma.JsonNull : (input.params as Prisma.InputJsonValue),
        gates: input.gates == null ? undefined : (input.gates as Prisma.InputJsonValue),
        enabled_stages:
          input.enabledStages == null ? undefined : (input.enabledStages as Prisma.InputJsonValue),
        created_at: BigInt(now),
        updated_at: BigInt(now),
      },
    });

    return toBlueprintRow(row);
  }

  /**
   * 按 id 取图纸。
   * @param id 图纸 id
   * @returns 图纸行；不存在时返回 null
   */
  async getBlueprint(id: number): Promise<BlueprintRow | null> {
    const row = await this.db.blueprints.findUnique({ where: { id } });

    return row ? toBlueprintRow(row) : null;
  }

  /**
   * 列出图纸（可按 kind 过滤），id 倒序。
   * @param kind 仅列该类型；省略则列全部
   */
  async listBlueprints(kind?: TaskKind): Promise<BlueprintRow[]> {
    const rows = await this.db.blueprints.findMany({
      where: kind ? { kind } : {},
      orderBy: { id: 'desc' },
    });

    return rows.map((r: BlueprintPg) => toBlueprintRow(r));
  }

  /**
   * 局部更新图纸（仅覆盖 patch 中给出的字段）。
   * @param id 图纸 id
   * @param patch 仅含需更新的字段（见 {@link UpdateBlueprintInput}）
   * @param now 更新时刻 Unix 时间戳（秒）
   */
  async updateBlueprint(id: number, patch: UpdateBlueprintInput, now: number): Promise<void> {
    const data: Prisma.blueprintsUpdateInput = { updated_at: BigInt(now) };
    if (patch.label !== undefined) {
      data.label = patch.label;
    }

    if (patch.note !== undefined) {
      data.note = patch.note;
    }

    if (patch.enabled !== undefined) {
      data.enabled = patch.enabled;
    }

    if (patch.sources !== undefined) {
      data.sources = patch.sources as Prisma.InputJsonValue;
    }

    if (patch.params !== undefined) {
      data.params =
        patch.params == null ? Prisma.JsonNull : (patch.params as Prisma.InputJsonValue);
    }

    if (patch.gates !== undefined) {
      data.gates = patch.gates as Prisma.InputJsonValue;
    }

    if (patch.enabledStages !== undefined) {
      data.enabled_stages = patch.enabledStages as Prisma.InputJsonValue;
    }

    await this.db.blueprints.update({ where: { id }, data });
  }

  /**
   * 删除图纸（是否仍被进程引用的校验在服务层）。
   * @param id 图纸 id
   */
  async deleteBlueprint(id: number): Promise<void> {
    await this.db.blueprints.delete({ where: { id } });
  }
}
