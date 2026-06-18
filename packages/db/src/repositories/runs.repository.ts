import { Prisma, toRunRow, type AppDatabase, type RunPg, type RunRow } from '../internal';

export type { RunRow };

/** 进程任务计数增量（派生 / 完成 / 略过 / 失败） */
export interface RunCounters {
  total?: number;
  done?: number;
  skipped?: number;
  failed?: number;
}

/** 开进程入参 */
export interface NewRunInput {
  blueprintId: number;
  kind: string;
  /** manual | cron | interval */
  triggerSource: string;
  /** 复查 sweep 序号（间隔模式）；非复查为空 */
  sweepSeq?: number | null;
  /** 启动时图纸参数快照（JSON） */
  params?: unknown;
}

/**
 * 进程（runs）数据访问。一条 run = 一张图纸的一次执行；承载状态、计数、起止时间、（复查的）sweep 序号。
 */
export class RunsRepository {
  constructor(private readonly db: AppDatabase) {}

  /** 开一条进程（status=running）。 */
  async createRun(input: NewRunInput, now: number): Promise<RunRow> {
    const row = await this.db.runs.create({
      data: {
        blueprint_id: input.blueprintId,
        kind: input.kind,
        status: 'running',
        trigger_source: input.triggerSource,
        sweep_seq: input.sweepSeq ?? null,
        params: input.params == null ? Prisma.JsonNull : (input.params as Prisma.InputJsonValue),
        started_at: BigInt(now),
      },
    });
    return toRunRow(row);
  }

  async getRun(id: number): Promise<RunRow | null> {
    const row = await this.db.runs.findUnique({ where: { id } });
    return row ? toRunRow(row) : null;
  }

  /** 累加任务计数（派生 / 完成 / 略过 / 失败）。 */
  async incrementCounters(id: number, c: RunCounters): Promise<void> {
    await this.db.runs.update({
      where: { id },
      data: {
        tasks_total: { increment: c.total ?? 0 },
        tasks_done: { increment: c.done ?? 0 },
        tasks_skipped: { increment: c.skipped ?? 0 },
        tasks_failed: { increment: c.failed ?? 0 },
      },
    });
  }

  /** 置进程状态（running / paused 等非终态切换）。 */
  async setStatus(id: number, status: string): Promise<void> {
    await this.db.runs.update({ where: { id }, data: { status } });
  }

  /** 收尾进程（completed / failed / canceled）+ 结束时间 + 可选错误。 */
  async finishRun(id: number, status: string, now: number, error?: string | null): Promise<void> {
    await this.db.runs.update({
      where: { id },
      data: { status, finished_at: BigInt(now), error: error ?? null },
    });
  }

  /** 列出某图纸最近的进程（id 倒序），供看板与树形进度。 */
  async listRecentRuns(blueprintId: number, limit: number): Promise<RunRow[]> {
    const rows = await this.db.runs.findMany({
      where: { blueprint_id: blueprintId },
      orderBy: { id: 'desc' },
      take: limit,
    });
    return rows.map((r: RunPg) => toRunRow(r));
  }

  /** 列出全部图纸最近的进程（id 倒序），供「进程」总览页。 */
  async listAllRecent(limit: number): Promise<RunRow[]> {
    const rows = await this.db.runs.findMany({ orderBy: { id: 'desc' }, take: limit });
    return rows.map((r: RunPg) => toRunRow(r));
  }
}
