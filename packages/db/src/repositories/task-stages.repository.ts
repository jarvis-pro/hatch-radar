import {
  Prisma,
  toTaskStageRow,
  type AppDatabase,
  type TaskStagePg,
  type TaskStageRow,
} from '../internal';

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
export class TaskStagesRepository {
  constructor(private readonly db: AppDatabase) {}

  /** 取某任务全部环节（按 seq 升序，决定执行与展示顺序）。 */
  async listStages(taskId: number): Promise<TaskStageRow[]> {
    const rows = await this.db.task_stages.findMany({
      where: { task_id: taskId },
      orderBy: { seq: 'asc' },
    });
    return rows.map((r: TaskStagePg) => toTaskStageRow(r));
  }

  /** 标记环节开始：status→running、记录开始时间与输入摘要（展示用）。 */
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

  /** 标记环节完成：status→done、写入产物（检查点）与结束时间。 */
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

  /** 标记环节跳过（如复查未变化时跳过 recrawl / persist 环节）。 */
  async markStageSkipped(taskId: number, seq: number, now: number): Promise<void> {
    await this.db.task_stages.updateMany({
      where: { task_id: taskId, seq },
      data: { status: 'skipped', finished_at: BigInt(now) },
    });
  }

  /** 标记环节失败：status→failed、记录失败原因与结束时间。 */
  async markStageFailed(taskId: number, seq: number, error: string, now: number): Promise<void> {
    await this.db.task_stages.updateMany({
      where: { task_id: taskId, seq },
      data: { status: 'failed', error: error.slice(0, MAX_ERROR_CHARS), finished_at: BigInt(now) },
    });
  }

  /** 单环节是否仍挂闸门（worker 在暂停决策前回读：使「运行到底」清闸对执行中的任务即时生效）。 */
  async isStageGated(taskId: number, seq: number): Promise<boolean> {
    const row = await this.db.task_stages.findFirst({
      where: { task_id: taskId, seq },
      select: { gate: true },
    });
    return row?.gate ?? false;
  }

  /** 清除整条任务所有环节的闸门（「运行到底」：连续跑完剩余环节、不再逐环节暂停）。 */
  async clearGates(taskId: number): Promise<void> {
    await this.db.task_stages.updateMany({ where: { task_id: taskId }, data: { gate: false } });
  }

  /**
   * 重试复位：把失败环节退回 pending、清空产物 / 错误 / 时间戳，使重认领后从此环节重跑。
   * 调用方须随后把整条任务由 failed 置回 queued（见 {@link TasksRepository.requeueFailedTask}）。
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
