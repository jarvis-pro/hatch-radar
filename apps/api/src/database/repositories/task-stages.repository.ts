import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import {
  Prisma,
  toTaskStageRow,
  type AppDatabase,
  type TaskStagePg,
  type TaskStageRow,
} from '@/database/internal';

export type { TaskStageRow };

/** 错误信息落库长度上限 */
const MAX_ERROR_CHARS = 500;

/**
 * 任务环节（task_stages）数据访问（Prisma / PostgreSQL）：泛化到所有 kind（取代已删除的 job_steps）。
 *
 * 只承载 task_stages 行的读写：产物落库（检查点）、状态流转、重试复位、跳过。任务的「创建」
 * （task + N 个 pending 环节一次性原子插入）在 {@link TasksRepository.createTaskWithStages} 内完成。
 * output 既是展示内容，又是下游环节重认领时的检查点输入；error 仅 status=failed 时有值。
 */
@Injectable()
export class TaskStagesRepository {
  constructor(
    // 事务感知 Prisma 客户端（经 @Inject(PRISMA)，按 ALS 自动路由事务/根客户端）：读写任务环节（task_stages）表
    @Inject(PRISMA) private readonly db: AppDatabase,
  ) {}

  /**
   * 取某任务全部环节（按 seq 升序，决定执行与展示顺序）。
   * @param taskId 任务 id
   */
  async listStages(taskId: number): Promise<TaskStageRow[]> {
    const rows = await this.db.task_stages.findMany({
      where: { task_id: taskId },
      orderBy: { seq: 'asc' },
    });

    return rows.map((r: TaskStagePg) => toTaskStageRow(r));
  }

  /**
   * 批量取多个任务的环节，按 task_id 分组（一次查询 + 内存分组）——消除任务树逐任务查 listStages 的
   * N+1（进程详情页一次请求可有上百任务）。每组内按 seq 升序。
   * @param taskIds 任务 id 集合（空数组直接返回空 Map）
   * @returns 任务 id → 其环节列表（seq 升序）
   */
  async listStagesByTasks(taskIds: number[]): Promise<Map<number, TaskStageRow[]>> {
    const grouped = new Map<number, TaskStageRow[]>();
    if (taskIds.length === 0) {
      return grouped;
    }

    const rows = await this.db.task_stages.findMany({
      where: { task_id: { in: taskIds } },
      orderBy: [{ task_id: 'asc' }, { seq: 'asc' }],
    });
    for (const r of rows) {
      const list = grouped.get(r.task_id);
      if (list) {
        list.push(toTaskStageRow(r));
      } else {
        grouped.set(r.task_id, [toTaskStageRow(r)]);
      }
    }

    return grouped;
  }

  /**
   * 标记环节开始：status→running、记录开始时间与输入摘要（展示用）。
   * @param taskId 任务 id
   * @param seq 环节序号
   * @param inputSummary 输入摘要（展示用；null 写 JSON null）
   * @param now 开始时刻 Unix 时间戳（秒）
   */
  async markStageRunning(
    taskId: number,
    seq: number,
    inputSummary: unknown,
    now: number,
  ): Promise<void> {
    await this.db.task_stages.updateMany({
      where: { task_id: taskId, seq },
      data: {
        status: 'running',
        started_at: BigInt(now),
        input_summary:
          inputSummary == null ? Prisma.JsonNull : (inputSummary as Prisma.InputJsonValue),
        error: null,
      },
    });
  }

  /**
   * 标记环节完成：status→done、写入产物（检查点）与结束时间。
   * @param taskId 任务 id
   * @param seq 环节序号
   * @param output 产物（检查点；下游环节重认领时的输入。null 写 JSON null）
   * @param now 完成时刻 Unix 时间戳（秒）
   */
  async markStageDone(taskId: number, seq: number, output: unknown, now: number): Promise<void> {
    await this.db.task_stages.updateMany({
      where: { task_id: taskId, seq },
      data: {
        status: 'done',
        output: output == null ? Prisma.JsonNull : (output as Prisma.InputJsonValue),
        finished_at: BigInt(now),
      },
    });
  }

  /**
   * 标记环节跳过（如复查未变化时跳过 recrawl / persist 环节）。
   * @param taskId 任务 id
   * @param seq 环节序号
   * @param now 结束时刻 Unix 时间戳（秒）
   */
  async markStageSkipped(taskId: number, seq: number, now: number): Promise<void> {
    await this.db.task_stages.updateMany({
      where: { task_id: taskId, seq },
      data: { status: 'skipped', finished_at: BigInt(now) },
    });
  }

  /**
   * 标记环节失败：status→failed、记录失败原因与结束时间。
   * @param taskId 任务 id
   * @param seq 环节序号
   * @param error 失败原因（落库前截断至 500 字符）
   * @param now 结束时刻 Unix 时间戳（秒）
   */
  async markStageFailed(taskId: number, seq: number, error: string, now: number): Promise<void> {
    await this.db.task_stages.updateMany({
      where: { task_id: taskId, seq },
      data: { status: 'failed', error: error.slice(0, MAX_ERROR_CHARS), finished_at: BigInt(now) },
    });
  }

  /**
   * 单环节是否仍挂闸门（worker 在暂停决策前回读：使「运行到底」清闸对执行中的任务即时生效）。
   * @param taskId 任务 id
   * @param seq 环节序号
   */
  async isStageGated(taskId: number, seq: number): Promise<boolean> {
    const row = await this.db.task_stages.findFirst({
      where: { task_id: taskId, seq },
      select: { gate: true },
    });

    return row?.gate ?? false;
  }

  /**
   * 清除整条任务所有环节的闸门（「运行到底」：连续跑完剩余环节、不再逐环节暂停）。
   * @param taskId 任务 id
   */
  async clearGates(taskId: number): Promise<void> {
    await this.db.task_stages.updateMany({ where: { task_id: taskId }, data: { gate: false } });
  }

  /**
   * 运行前挂 / 摘某环节暂停点：仅 pending 环节可改（已跑过的不可改）。
   * @param taskId 任务 id
   * @param seq 环节序号
   * @param gate true=挂闸门；false=摘除
   * @returns 是否生效（false = 该环节非 pending）
   */
  async setStageGate(taskId: number, seq: number, gate: boolean): Promise<boolean> {
    const res = await this.db.task_stages.updateMany({
      where: { task_id: taskId, seq, status: 'pending' },
      data: { gate },
    });

    return res.count > 0;
  }

  /**
   * 重试复位：把失败环节退回 pending、清空产物 / 错误 / 时间戳，使重认领后从此环节重跑。
   * 调用方须随后把整条任务由 failed 置回 queued（见 {@link TasksRepository.requeueFailedTask}）。
   * @param taskId 任务 id
   * @param seq 环节序号（通常为当前失败环节 current_seq）
   */
  async resetStageToPending(taskId: number, seq: number): Promise<void> {
    await this.db.task_stages.updateMany({
      where: { task_id: taskId, seq },
      data: {
        status: 'pending',
        output: Prisma.JsonNull,
        error: null,
        started_at: null,
        finished_at: null,
      },
    });
  }
}
