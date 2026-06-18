import { Prisma, toTaskRow, type AppDatabase, type TaskPg, type TaskRow } from '../internal';

export type { TaskRow };

/** 新任务默认最大尝试次数（仅用于僵死 / 崩溃循环保护，正常失败即终态） */
const DEFAULT_MAX_ATTEMPTS = 3;
/** 错误信息落库长度上限，避免异常堆栈撑爆字段 */
const MAX_ERROR_CHARS = 500;
/** 活跃态：占据同帖同 kind 的唯一名额、可被认领、不可重复入队 */
const ACTIVE_STATUSES = ['queued', 'running', 'paused'] as const;

/** 成功任务可选附带的 token 用量（仅 analyze / translate，列式落库供成本聚合） */
export interface TaskUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

/** 新建任务入参（环节另由 stageDefs 给出） */
export interface NewTaskInput {
  /** 所属进程 */
  runId: number;
  /** 任务类型：discover | collect | recheck | analyze | translate */
  kind: string;
  /** 派生它的父任务（血缘）；根任务为空 */
  parentTaskId?: number | null;
  /** 目标帖子 id；discover 任务为空 */
  postId?: string | null;
  /** analyze / translate 的模型配置（软引用） */
  providerId?: number | null;
  /** 模型名快照 */
  model?: string | null;
  priority?: number;
  maxAttempts?: number;
  /** 任务级参数（JSON） */
  params?: unknown;
}

/** 环节定义：name + 是否默认挂闸门 */
export interface StageDef {
  name: string;
  gate?: boolean;
}

/**
 * 任务队列数据访问（Prisma / PostgreSQL）。取代旧 {@link JobsRepository}，泛化到所有 kind。
 *
 * 认领用 `FOR UPDATE SKIP LOCKED`（多 worker / 多进程并发认领不重不漏）；心跳 / 僵死回收 /
 * max_attempts 沿用旧机制。环节闸门把暂停下放到逐 task_stage（{@link TaskStagesRepository}）。
 */
export class TasksRepository {
  constructor(private readonly db: AppDatabase) {}

  /**
   * 原子建任务 + N 个 pending 环节（同事务，避免「有任务无环节」半成品）。
   * 带 post_id 时：同帖同 kind 已有活跃任务（queued/running/paused）则拒绝（去重第②层）；
   * 部分唯一索引 `uniq_tasks_active_post` 兜底并发竞态（去重第③层）。
   * @returns ok+taskId；被去重时 ok=false+error
   */
  async createTaskWithStages(
    input: NewTaskInput,
    stages: readonly StageDef[],
    now: number,
  ): Promise<{ ok: true; taskId: number } | { ok: false; error: string }> {
    return this.db.$transaction(async (tx) => {
      if (input.postId != null) {
        const active = await tx.tasks.findFirst({
          where: { post_id: input.postId, kind: input.kind, status: { in: [...ACTIVE_STATUSES] } },
          select: { id: true },
        });
        if (active) return { ok: false as const, error: `该帖已有活跃 ${input.kind} 任务，跳过` };
      }
      const task = await tx.tasks.create({
        data: {
          run_id: input.runId,
          kind: input.kind,
          parent_task_id: input.parentTaskId ?? null,
          post_id: input.postId ?? null,
          status: 'queued',
          attempts: 0,
          max_attempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
          current_seq: 0,
          priority: input.priority ?? 0,
          provider_id: input.providerId ?? null,
          model: input.model ?? null,
          params: input.params == null ? Prisma.JsonNull : (input.params as Prisma.InputJsonValue),
          enqueued_at: BigInt(now),
        },
      });
      if (stages.length > 0) {
        await tx.task_stages.createMany({
          data: stages.map((s, seq) => ({
            task_id: task.id,
            seq,
            name: s.name,
            status: 'pending',
            gate: s.gate ?? false,
          })),
        });
      }
      return { ok: true as const, taskId: task.id };
    });
  }

  /**
   * 原子认领下一条 queued 任务（FOR UPDATE SKIP LOCKED）：按 priority → enqueued_at → id 取队首，
   * 置 running + 心跳 + attempts++。队列为空返回 null。
   */
  async claimNextTask(now: number): Promise<TaskRow | null> {
    return this.db.$transaction(async (tx) => {
      const picked = await tx.$queryRaw<TaskPg[]>`
        SELECT * FROM tasks
        WHERE status = 'queued'
        ORDER BY priority ASC, enqueued_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const t = picked[0];
      if (!t) return null;
      await tx.tasks.update({
        where: { id: t.id },
        data: {
          status: 'running',
          started_at: BigInt(now),
          heartbeat_at: BigInt(now),
          attempts: { increment: 1 },
        },
      });
      return toTaskRow({
        ...t,
        status: 'running',
        started_at: BigInt(now),
        heartbeat_at: BigInt(now),
        attempts: t.attempts + 1,
      });
    });
  }

  /** 取一条任务（全字段）；不存在返回 null。 */
  async getTask(taskId: number): Promise<TaskRow | null> {
    const row = await this.db.tasks.findUnique({ where: { id: taskId } });
    return row ? toTaskRow(row) : null;
  }

  /** 刷新 running 任务心跳（worker 处理期周期调用，避免长任务被误判僵死）。 */
  async touchHeartbeat(taskId: number, now: number): Promise<void> {
    await this.db.tasks.updateMany({
      where: { id: taskId, status: 'running' },
      data: { heartbeat_at: BigInt(now) },
    });
  }

  /** 更新当前 / 下一个待执行环节 seq（展示与续跑参考）。 */
  async setCurrentSeq(taskId: number, seq: number): Promise<void> {
    await this.db.tasks.updateMany({ where: { id: taskId }, data: { current_seq: seq } });
  }

  /** 标记任务成功（可附 token 用量，写入列式字段供成本聚合）。 */
  async succeedTask(taskId: number, now: number, usage?: TaskUsage | null): Promise<void> {
    await this.db.tasks.update({
      where: { id: taskId },
      data: {
        status: 'succeeded',
        finished_at: BigInt(now),
        error: null,
        input_tokens: usage?.inputTokens ?? null,
        output_tokens: usage?.outputTokens ?? null,
        cache_write_tokens: usage?.cacheWriteTokens ?? null,
        cache_read_tokens: usage?.cacheReadTokens ?? null,
      },
    });
  }

  /** 标记任务跳过（终态，如复查判定未变化）。 */
  async skipTask(taskId: number, now: number): Promise<void> {
    await this.db.tasks.update({
      where: { id: taskId },
      data: { status: 'skipped', finished_at: BigInt(now), error: null },
    });
  }

  /** 标记任务失败（终态，error 截断）。 */
  async failTask(taskId: number, error: string, now: number): Promise<void> {
    await this.db.tasks.update({
      where: { id: taskId },
      data: { status: 'failed', finished_at: BigInt(now), error: error.slice(0, MAX_ERROR_CHARS) },
    });
  }

  /** 环节闸门：running→paused（worker 跑完一个挂闸门的环节后调用，随即正常结束本次认领）。 */
  async pauseTask(taskId: number): Promise<void> {
    await this.db.tasks.updateMany({
      where: { id: taskId, status: 'running' },
      data: { status: 'paused' },
    });
  }

  /**
   * 放行：paused→queued，重置 attempts / 时间戳（每次放行＝该环节全新尝试预算，
   * 避免逐环节重认领累加 attempts 触发僵死回收误判）。
   * @returns 是否实际放行（false = 当前并非 paused）
   */
  async resumeTask(taskId: number): Promise<boolean> {
    const res = await this.db.tasks.updateMany({
      where: { id: taskId, status: 'paused' },
      data: { status: 'queued', attempts: 0, started_at: null, heartbeat_at: null, error: null },
    });
    return res.count > 0;
  }

  /** 重试失败任务：failed→queued、重置 attempts / 时间戳（配合环节 resetStageToPending）。 */
  async requeueFailedTask(taskId: number): Promise<boolean> {
    const res = await this.db.tasks.updateMany({
      where: { id: taskId, status: 'failed' },
      data: {
        status: 'queued',
        attempts: 0,
        started_at: null,
        heartbeat_at: null,
        finished_at: null,
        error: null,
      },
    });
    return res.count > 0;
  }

  /** 取消任务：活跃态（queued/running/paused）→ canceled。 */
  async cancelTask(taskId: number, now: number): Promise<boolean> {
    const res = await this.db.tasks.updateMany({
      where: { id: taskId, status: { in: [...ACTIVE_STATUSES] } },
      data: { status: 'canceled', finished_at: BigInt(now) },
    });
    return res.count > 0;
  }

  /**
   * 回收僵死 running 任务：心跳超时或进程重启遗留。未超 max_attempts 回 queued 重排，否则判 failed。
   * paused 不在回收范围（静停于闸门）。
   * @param staleSeconds 心跳早于 now-staleSeconds 才回收；null 回收全部 running（进程启动时用）
   * @returns 被回收的任务数
   */
  async reclaimRunningTasks(now: number, staleSeconds: number | null): Promise<number> {
    const where: Prisma.tasksWhereInput =
      staleSeconds === null
        ? { status: 'running' }
        : {
            status: 'running',
            OR: [{ heartbeat_at: null }, { heartbeat_at: { lt: BigInt(now - staleSeconds) } }],
          };
    return this.db.$transaction(async (tx) => {
      const rows = await tx.tasks.findMany({
        where,
        select: { id: true, attempts: true, max_attempts: true },
      });
      if (rows.length === 0) return 0;
      for (const r of rows) {
        if (r.attempts >= r.max_attempts) {
          await tx.tasks.update({
            where: { id: r.id },
            data: {
              status: 'failed',
              finished_at: BigInt(now),
              error: '僵死回收：超过最大尝试次数',
            },
          });
        } else {
          await tx.tasks.update({
            where: { id: r.id },
            data: { status: 'queued', started_at: null, heartbeat_at: null },
          });
        }
      }
      return rows.length;
    });
  }

  /** 列出某进程的全部任务（id 升序），供进程详情的任务树。 */
  async listByRun(runId: number): Promise<TaskRow[]> {
    const rows = await this.db.tasks.findMany({ where: { run_id: runId }, orderBy: { id: 'asc' } });
    return rows.map((r: TaskPg) => toTaskRow(r));
  }
}
