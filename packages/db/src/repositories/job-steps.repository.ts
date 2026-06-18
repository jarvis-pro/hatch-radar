import {
  Prisma,
  toJobStepRow,
  type AppDatabase,
  type JobStepPg,
  type JobStepRow,
} from '../internal';

export type { JobStepRow };

/**
 * 流水线检视器的逐节点轨迹（job_steps）数据访问（Prisma / PostgreSQL）。
 *
 * 只承载 job_steps 表的读写：节点产物落库（检查点）、状态流转、重试复位。检视任务的「创建」
 * （job + 6 个 pending 节点一次性原子插入）在 {@link JobsRepository.createInspectJob} 内完成，
 * 此处只管创建之后的节点更新——见 docs/pipeline-inspector-design.md 决策 3。
 *
 * output 既是展示内容，又是下游节点重认领时的检查点输入；error 仅 status=failed 时有值。
 */
export class JobStepsRepository {
  constructor(private readonly db: AppDatabase) {}

  /** 取某任务的全部节点（按 seq 升序，决定执行与展示顺序）。 */
  async listSteps(jobId: number): Promise<JobStepRow[]> {
    const rows = await this.db.job_steps.findMany({
      where: { job_id: jobId },
      orderBy: { seq: 'asc' },
    });
    return rows.map((r: JobStepPg) => toJobStepRow(r));
  }

  /**
   * 标记节点开始执行：status→running、记录开始时间与输入摘要（展示用）。
   * @param inputSummary 节点输入摘要（如 provider 标签、评论数）；无则传 null
   */
  async markStepRunning(
    jobId: number,
    seq: number,
    inputSummary: unknown,
    now: number,
  ): Promise<void> {
    await this.db.job_steps.updateMany({
      where: { job_id: jobId, seq },
      data: {
        status: 'running',
        started_at: BigInt(now),
        // jsonb 列存任意 JSON 值，节点产物/摘要保证可序列化 → 收窄到 Prisma 输入类型
        input_summary:
          inputSummary == null ? Prisma.JsonNull : (inputSummary as Prisma.InputJsonValue),
        error: null,
      },
    });
  }

  /**
   * 标记节点完成：status→done、写入产物（检查点）与结束时间。
   * @param output 节点产物（jsonb）；下游节点据此读取，亦是 web 展示内容
   */
  async markStepDone(jobId: number, seq: number, output: unknown, now: number): Promise<void> {
    await this.db.job_steps.updateMany({
      where: { job_id: jobId, seq },
      // jsonb 列存任意 JSON 值，节点产物保证可序列化 → 收窄到 Prisma 输入类型
      data: { status: 'done', output: output as Prisma.InputJsonValue, finished_at: BigInt(now) },
    });
  }

  /** 标记节点失败：status→failed、记录失败原因与结束时间。 */
  async markStepFailed(jobId: number, seq: number, error: string, now: number): Promise<void> {
    await this.db.job_steps.updateMany({
      where: { job_id: jobId, seq },
      data: { status: 'failed', error: error.slice(0, 500), finished_at: BigInt(now) },
    });
  }

  /**
   * 重试复位：把失败节点退回 pending、清空产物/错误/时间戳，使重认领后从此节点重跑。
   * 调用方须随后把整条 job 由 failed 置回 queued（见 {@link JobsRepository.requeueFailedJob}）。
   */
  async resetStepToPending(jobId: number, seq: number): Promise<void> {
    await this.db.job_steps.updateMany({
      where: { job_id: jobId, seq },
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
