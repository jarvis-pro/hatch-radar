import {
  Prisma,
  toProcessRow,
  type AppDatabase,
  type ProcessPg,
  type ProcessRow,
} from '../internal';

export type { ProcessRow };

/** 新建进程入参（图纸 + 触发节奏） */
export interface NewProcessInput {
  blueprintId: number;
  label: string;
  /** once | interval | cron */
  triggerKind: string;
  /** interval={everySec} | cron={expr}（JSON） */
  triggerConfig?: unknown;
  /** active | paused（默认 active） */
  status?: string;
  /** 下次到期触发时刻（epoch 秒）；null=不自动触发 */
  nextRunAt?: number | null;
}

/** 更新进程入参（均可选，未给的字段不动） */
export interface UpdateProcessInput {
  label?: string;
  triggerKind?: string;
  triggerConfig?: unknown;
  status?: string;
  nextRunAt?: number | null;
}

/**
 * 进程（processes）数据访问。进程 = 图纸 + 触发节奏的长驻绑定；调度器据 status + next_run_at 决定何时开 run。
 * 仅操作本表（runs / tasks 的跨表查询在各自仓储）。
 */
export class ProcessesRepository {
  constructor(private readonly db: AppDatabase) {}

  async createProcess(input: NewProcessInput, now: number): Promise<ProcessRow> {
    const row = await this.db.processes.create({
      data: {
        blueprint_id: input.blueprintId,
        label: input.label,
        trigger_kind: input.triggerKind,
        trigger_config:
          input.triggerConfig == null
            ? Prisma.JsonNull
            : (input.triggerConfig as Prisma.InputJsonValue),
        status: input.status ?? 'active',
        next_run_at: input.nextRunAt == null ? null : BigInt(input.nextRunAt),
        created_at: BigInt(now),
        updated_at: BigInt(now),
      },
    });
    return toProcessRow(row);
  }

  async getProcess(id: number): Promise<ProcessRow | null> {
    const row = await this.db.processes.findUnique({ where: { id } });
    return row ? toProcessRow(row) : null;
  }

  /** 列出进程（可按图纸过滤），id 倒序。 */
  async listProcesses(blueprintId?: number): Promise<ProcessRow[]> {
    const rows = await this.db.processes.findMany({
      where: blueprintId != null ? { blueprint_id: blueprintId } : {},
      orderBy: { id: 'desc' },
    });
    return rows.map((r: ProcessPg) => toProcessRow(r));
  }

  /** 到期可触发的进程：active 且 next_run_at ≤ now，按到期时刻升序（供调度心跳）。 */
  async listDue(now: number): Promise<ProcessRow[]> {
    const rows = await this.db.processes.findMany({
      where: { status: 'active', next_run_at: { not: null, lte: BigInt(now) } },
      orderBy: { next_run_at: 'asc' },
    });
    return rows.map((r: ProcessPg) => toProcessRow(r));
  }

  async updateProcess(id: number, patch: UpdateProcessInput, now: number): Promise<void> {
    const data: Prisma.processesUpdateInput = { updated_at: BigInt(now) };
    if (patch.label !== undefined) data.label = patch.label;
    if (patch.triggerKind !== undefined) data.trigger_kind = patch.triggerKind;
    if (patch.triggerConfig !== undefined) {
      data.trigger_config =
        patch.triggerConfig == null
          ? Prisma.JsonNull
          : (patch.triggerConfig as Prisma.InputJsonValue);
    }
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.nextRunAt !== undefined) {
      data.next_run_at = patch.nextRunAt == null ? null : BigInt(patch.nextRunAt);
    }
    await this.db.processes.update({ where: { id }, data });
  }

  /** 置状态（active / paused）。 */
  async setStatus(id: number, status: string, now: number): Promise<void> {
    await this.db.processes.update({
      where: { id },
      data: { status, updated_at: BigInt(now) },
    });
  }

  /** 置下次触发时刻（null=不自动触发）。 */
  async setNextRunAt(id: number, nextRunAt: number | null, now: number): Promise<void> {
    await this.db.processes.update({
      where: { id },
      data: { next_run_at: nextRunAt == null ? null : BigInt(nextRunAt), updated_at: BigInt(now) },
    });
  }

  /** 触发记账：runs_total++、last_run_at=now、next_run_at=null（待运行完成后重排）。 */
  async markFired(id: number, now: number): Promise<void> {
    await this.db.processes.update({
      where: { id },
      data: {
        runs_total: { increment: 1 },
        last_run_at: BigInt(now),
        next_run_at: null,
        updated_at: BigInt(now),
      },
    });
  }

  /** sweep 自增并返回新值（复查每开一轮调用，驱动退避到期判定）。 */
  async bumpSweep(id: number): Promise<number> {
    const row = await this.db.processes.update({
      where: { id },
      data: { sweep_seq: { increment: 1 } },
    });
    return row.sweep_seq;
  }

  async deleteProcess(id: number): Promise<void> {
    await this.db.processes.delete({ where: { id } });
  }
}
