import { Inject, Injectable } from '@nestjs/common';
import type { TaskKind } from '@hatch-radar/shared';
import { PRISMA } from '@/common/tokens';
import {
  Prisma,
  toRunRow,
  type AppDatabase,
  type RunPg,
  type RunRow,
  type run_status as RunStatus,
} from '@/database/internal';

export type { RunRow };

/** 进程任务计数增量（派生 / 完成 / 略过 / 失败） */
export interface RunCounters {
  /** 新派生任务数增量 */
  total?: number;
  /** 完成（成功）任务数增量 */
  done?: number;
  /** 略过任务数增量 */
  skipped?: number;
  /** 失败任务数增量 */
  failed?: number;
}

/** 开进程入参 */
export interface NewRunInput {
  /** 绑定的图纸 id */
  blueprintId: number;
  /** 触发它的进程（processes.id）；事件派生 run（analyze/translate/inspect）为空 */
  processId?: number | null;
  /** 复用 task_kind；runs 实际仅用 collect / recheck / analyze / translate。 */
  kind: TaskKind;
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
@Injectable()
export class RunsRepository {
  constructor(
    // 事务感知 Prisma 客户端（经 @Inject(PRISMA)，按 ALS 自动路由事务/根客户端）：读写运行（runs）表
    @Inject(PRISMA) private readonly db: AppDatabase,
  ) {}

  /**
   * 开一条进程（status=running）。
   * @param input 图纸 + 触发节奏快照（见 {@link NewRunInput}）
   * @param now 创建时刻 Unix 时间戳（秒），写入 started_at
   * @returns 新建的运行行
   */
  async createRun(input: NewRunInput, now: number): Promise<RunRow> {
    const row = await this.db.runs.create({
      data: {
        blueprint_id: input.blueprintId,
        process_id: input.processId ?? null,
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

  /**
   * 按 id 取单条运行。
   * @param id 运行 id
   * @returns 运行行；不存在时返回 null
   */
  async getRun(id: number): Promise<RunRow | null> {
    const row = await this.db.runs.findUnique({ where: { id } });

    return row ? toRunRow(row) : null;
  }

  /**
   * 累加任务计数（派生 / 完成 / 略过 / 失败）。
   * @param id 运行 id
   * @param c 各类计数的增量（见 {@link RunCounters}；省略的项按 0 处理）
   */
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

  /**
   * 置进程状态（running / paused 等非终态切换）。
   * @param id 运行 id
   * @param status 目标状态（用于非终态切换；收尾走 {@link finishRun}）
   */
  async setStatus(id: number, status: RunStatus): Promise<void> {
    await this.db.runs.update({ where: { id }, data: { status } });
  }

  /**
   * 收尾进程（completed / failed / canceled）+ 结束时间 + 可选错误。
   * @param id 运行 id
   * @param status 终态（completed / failed / canceled）
   * @param now 结束时刻 Unix 时间戳（秒），写入 finished_at
   * @param error 失败原因；省略 / null 表示无错误
   */
  async finishRun(
    id: number,
    status: RunStatus,
    now: number,
    error?: string | null,
  ): Promise<void> {
    await this.db.runs.update({
      where: { id },
      data: { status, finished_at: BigInt(now), error: error ?? null },
    });
  }

  /**
   * 列出某图纸最近的进程（id 倒序），供看板与树形进度。
   * @param blueprintId 图纸 id
   * @param limit 最多返回条数
   * @returns 运行行列表（id 倒序）；无则空数组
   */
  async listRecentRuns(blueprintId: number, limit: number): Promise<RunRow[]> {
    const rows = await this.db.runs.findMany({
      where: { blueprint_id: blueprintId },
      orderBy: { id: 'desc' },
      take: limit,
    });

    return rows.map((r: RunPg) => toRunRow(r));
  }

  /**
   * 列出全部图纸最近的进程（id 倒序），供「进程」总览页。
   * @param limit 最多返回条数
   * @returns 运行行列表（id 倒序）；无则空数组
   */
  async listAllRecent(limit: number): Promise<RunRow[]> {
    const rows = await this.db.runs.findMany({ orderBy: { id: 'desc' }, take: limit });

    return rows.map((r: RunPg) => toRunRow(r));
  }

  /**
   * 某进程是否有进行中的运行（running）——调度器据此「按进程非重入」。
   * @param processId 进程 id
   * @returns 存在 running 运行时为 true
   */
  async hasRunningRunForProcess(processId: number): Promise<boolean> {
    const row = await this.db.runs.findFirst({
      where: { process_id: processId, status: 'running' },
      select: { id: true },
    });

    return row != null;
  }

  /** 列出所有进行中的运行（status=running），供心跳逐个判断是否终结。 */
  async listRunningRuns(): Promise<RunRow[]> {
    const rows = await this.db.runs.findMany({
      where: { status: 'running' },
      orderBy: { id: 'asc' },
    });

    return rows.map((r: RunPg) => toRunRow(r));
  }

  /**
   * 某图纸已用的最大 sweep 序号（无则 0），供复查推算下一 sweep。
   * @param blueprintId 图纸 id
   * @returns 最大 sweep 序号；该图纸从无运行时为 0
   */
  async maxSweep(blueprintId: number): Promise<number> {
    const agg = await this.db.runs.aggregate({
      where: { blueprint_id: blueprintId },
      _max: { sweep_seq: true },
    });

    return agg._max.sweep_seq ?? 0;
  }

  /**
   * 起始时间 ≥ sinceSec 的运行数（指挥室「今日运行」）。
   * @param sinceSec 起始 Unix 时间戳（秒，含下界）
   * @returns started_at ≥ sinceSec 的运行数
   */
  async countSince(sinceSec: number): Promise<number> {
    return this.db.runs.count({ where: { started_at: { gte: BigInt(sinceSec) } } });
  }

  /**
   * 最近失败的运行（id 倒序），供指挥室告警条。
   * @param limit 最多返回条数
   * @returns 失败运行列表（id 倒序）；无则空数组
   */
  async listFailedRuns(limit: number): Promise<RunRow[]> {
    const rows = await this.db.runs.findMany({
      where: { status: 'failed' },
      orderBy: { id: 'desc' },
      take: limit,
    });

    return rows.map((r: RunPg) => toRunRow(r));
  }

  /** 全部复查运行的最大 sweep 序号（无则 0），供指挥室 / 帖子库判定「到期复查」。 */
  async maxRecheckSweep(): Promise<number> {
    const agg = await this.db.runs.aggregate({
      where: { kind: 'recheck' },
      _max: { sweep_seq: true },
    });

    return agg._max.sweep_seq ?? 0;
  }

  /**
   * 一批运行的 sweep 序号（id → sweep_seq），供帖子一生时间线标注复查轮次。
   * @param runIds 运行 id 集合（空数组直接返回空 Map）
   * @returns 运行 id → sweep_seq 的映射（非复查运行其值为 null）
   */
  async sweepSeqByRunIds(runIds: number[]): Promise<Map<number, number | null>> {
    if (runIds.length === 0) {
      return new Map();
    }

    const rows = await this.db.runs.findMany({
      where: { id: { in: runIds } },
      select: { id: true, sweep_seq: true },
    });

    return new Map(rows.map((r) => [r.id, r.sweep_seq]));
  }

  /**
   * 单进程的运行历史（id 倒序）。
   * @param processId 进程 id
   * @param limit 最多返回条数
   * @returns 运行行列表（id 倒序）；无则空数组
   */
  async listByProcess(processId: number, limit: number): Promise<RunRow[]> {
    const rows = await this.db.runs.findMany({
      where: { process_id: processId },
      orderBy: { id: 'desc' },
      take: limit,
    });

    return rows.map((r: RunPg) => toRunRow(r));
  }
}
