import { Injectable } from '@nestjs/common';
import { TranslationService } from '@/modules/analysis/translation.service';
import { RuntimeSettingsService } from '@/modules/settings/settings.runtime-settings.service';
import type { PostRow, TaskRow, TaskStageRow } from '@/database';
import { TasksRepository } from '@/database';
import { TaskStagesRepository } from '@/database';
import { RunsRepository } from '@/database';
import { PostsRepository } from '@/database';
import { logger } from '@/logger';
import { nowSec } from '@/utils/time';
import { CollectionExecutor } from './internal/collection.executor';
import { AnalyzeExecutor } from './internal/analyze.executor';
import { usageFromSteps, type StageLike } from './internal/stage-usage';

/** running 期间的 DB 心跳间隔（毫秒），需远小于运行期设置 workerStaleSeconds（下界 30s） */
const HEARTBEAT_INTERVAL_MS = 15_000;
/** 周期性僵死回收间隔（毫秒） */
const RECLAIM_INTERVAL_MS = 60_000;

/** 给 promise 套硬超时：超过 ms 即 reject 并调 onTimeout（用于中止底层调用 / abort）。 */
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`job 处理超时（>${ms}ms）`));
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 任务执行器：接受派发器认领来的 task，按 kind 逐环节执行并写回数据库。
 *
 * 不含轮询——任务认领由 {@link LocalDispatcher} 负责（同进程认领后直接调 executeDispatchedTask）。
 * 僵死回收定时器处理进程崩溃遗留的 running 任务。
 * 生命周期：NestJS onApplicationBootstrap/Shutdown → 这里的 {@link start}/{@link stop}，由 WorkerStarter 调用。
 */
@Injectable()
export class WorkerService {
  private reclaimTimer: ReturnType<typeof setInterval> | null = null;
  private activeJobPromises: Promise<void>[] = [];

  constructor(
    // 任务仓储：认领/状态机/心跳/僵死回收/成功失败收尾
    private readonly tasks: TasksRepository,
    // 任务环节仓储：逐环节状态机 + 检查点（output）读写 + 闸门查询
    private readonly taskStages: TaskStagesRepository,
    // 运行仓储：run 级计数（total/done/failed）累加
    private readonly runs: RunsRepository,
    // 帖子仓储：取分析对象 + markAnalyzed + analyze_attempts 累加
    private readonly posts: PostsRepository,
    // 翻译服务：执行 translate 环节（按 content_hash 落译文）
    private readonly translation: TranslationService,
    // 运行期可调项服务：实时读单环节硬超时 / 僵死回收阈值
    private readonly runtimeSettings: RuntimeSettingsService,
    // 采集执行器：discover / collect / recheck 各环节执行
    private readonly collection: CollectionExecutor,
    // 分析执行器：analyze 任务的逐节点执行（6 节点）
    private readonly analyze: AnalyzeExecutor,
  ) {}

  /** 启动执行器（对应 NestJS onApplicationBootstrap）：回收遗留任务 + 起僵死回收定时器。 */
  async start(): Promise<void> {
    const orphaned = await this.tasks.reclaimRunningTasks(nowSec(), null);
    if (orphaned > 0) {
      logger.warn(`[worker] 启动回收 ${orphaned} 个遗留 running 任务`);
    }

    // 每轮实时读取回收阈值——设置页改 workerStaleSeconds 后下一轮即生效（含独立 worker 进程）
    this.reclaimTimer = setInterval(() => {
      void (async () => {
        const { staleSeconds } = await this.runtimeSettings.getWorkerTuning();
        const n = await this.tasks.reclaimRunningTasks(nowSec(), staleSeconds);
        if (n > 0) {
          logger.warn(`[worker] 回收 ${n} 个僵死任务（心跳超 ${staleSeconds}s）`);
        }
      })();
    }, RECLAIM_INTERVAL_MS);

    const stats = await this.tasks.taskStats();
    logger.info(
      `[worker] 执行器已就绪；当前任务 queued ${stats.queued} / running ${stats.running}`,
    );
  }

  /** 停止执行器（对应 NestJS onApplicationShutdown）：停回收定时器 + 排空在途任务。 */
  async stop(): Promise<void> {
    if (this.reclaimTimer) {
      clearInterval(this.reclaimTimer);
    }

    await Promise.allSettled(this.activeJobPromises);
  }

  /** 当前正在执行的任务数（供 WorkerAgentService 上报心跳） */
  get activeJobCount(): number {
    return this.activeJobPromises.length;
  }

  /**
   * 执行派发器认领来的任务（task 已被 LocalDispatcher 认领为 running；执行模型 blueprints→runs→tasks→task_stages）。
   * @param taskId 已认领任务的 id
   * @param onProgress 进度回调（每次心跳触发，传入任务 id）；供派发器上报活跃度
   */
  async executeDispatchedTask(taskId: number, onProgress?: (id: number) => void): Promise<void> {
    const p = this.runTask(taskId, onProgress);
    this.activeJobPromises.push(p);
    try {
      await p;
    } finally {
      this.activeJobPromises = this.activeJobPromises.filter((x) => x !== p);
    }
  }

  /**
   * 通用任务执行内核：一次认领只推进到下一个闸门。逐环节执行、每步落检查点（task_stages.output）；
   * 环节挂闸门（task_stages.gate）时跑完即置 paused、正常结束本次认领，由放行（paused→queued）重认领续跑。
   * 末环节完成则按 kind 收尾（analyze→markAnalyzed）+ succeedTask；环节失败则 failTask + 按 kind 善后。
   * 每个环节受 jobTimeoutMs 超时与 AbortSignal 约束，analyze 环节复用 {@link AnalyzeExecutor} 同一组节点函数。
   */
  private async runTask(taskId: number, onProgress?: (id: number) => void): Promise<void> {
    const task = await this.tasks.getTask(taskId);
    if (!task) {
      return;
    } // 任务已不存在（被清理）

    const post =
      task.post_id != null ? ((await this.posts.getPostById(task.post_id)) ?? null) : null;
    if (task.kind === 'analyze' && !post) {
      await this.tasks.failTask(task.id, '帖子不存在或已归档', nowSec());
      await this.runs.incrementCounters(task.run_id, { failed: 1 });

      return;
    }

    const heartbeat = setInterval(() => {
      // 心跳写入失败需可观测：连接池打满 / DB 抖动致心跳停摆，会让任务被误判僵死回收 → 重复执行。
      void this.tasks
        .touchHeartbeat(task.id, nowSec())
        .catch((e: unknown) =>
          logger.warn(
            `[worker] task#${task.id} 心跳写入失败：${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      onProgress?.(task.id);
    }, HEARTBEAT_INTERVAL_MS);
    const ac = new AbortController();
    const { jobTimeoutMs } = await this.runtimeSettings.getWorkerTuning();
    try {
      const stages = await this.taskStages.listStages(task.id);
      for (;;) {
        const next = stages.find((s) => s.status === 'pending');
        if (!next) {
          await this.finalizeTaskSuccess(task, post, stages); // 兜底：无 pending（理论不发生）

          return;
        }

        await this.taskStages.markStageRunning(task.id, next.seq, null, nowSec());
        await this.tasks.setCurrentSeq(task.id, next.seq);
        let output: unknown;
        try {
          output = await withTimeout(
            this.execStage(task, next.name, post, stages, ac.signal),
            jobTimeoutMs,
            () => ac.abort(new Error('环节执行超时，中止底层调用')),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await this.taskStages.markStageFailed(task.id, next.seq, msg, nowSec());
          await this.tasks.failTask(task.id, msg, nowSec());
          await this.onTaskError(task, post);
          await this.runs.incrementCounters(task.run_id, { failed: 1 });
          logger.error(`  ✗ [task#${task.id} ${task.kind}] 环节 ${next.name} 失败: ${msg}`);

          return;
        }

        await this.taskStages.markStageDone(task.id, next.seq, output ?? null, nowSec());
        next.status = 'done';
        next.output = (output ?? null) as TaskStageRow['output'];
        // 闸门 / 收尾决策前实时回读任务（取消 / 外部改状态即时生效）
        const fresh = await this.tasks.getTask(task.id);
        if (!fresh || fresh.status !== 'running') {
          return;
        }

        const isLast = next.seq === stages[stages.length - 1].seq;
        if (isLast) {
          await this.finalizeTaskSuccess(task, post, stages);

          return;
        }

        if (next.gate) {
          // 内存里闸门是开的——暂停前回读 DB 确认未被「运行到底」清闸（清闸对执行中的任务即时生效，
          // 对齐旧 step_gate 实时回读语义）。非检视任务 next.gate=false，走不到这里、零额外查询。
          if (await this.taskStages.isStageGated(task.id, next.seq)) {
            await this.tasks.pauseTask(task.id); // 静停于闸门，等放行重认领续跑

            return;
          }
        }
        // 闸门关闭：继续下一环节
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** 按 kind 把环节派发到对应执行逻辑。analyze 复用 {@link AnalyzeExecutor} 同一组节点函数；其余 kind 走采集 / 翻译执行器。 */
  private execStage(
    task: TaskRow,
    stageName: string,
    post: PostRow | null,
    stages: StageLike[],
    signal: AbortSignal,
  ): Promise<unknown> {
    switch (task.kind) {
      case 'analyze':
        if (!post) {
          return Promise.reject(new Error('analyze 任务缺少帖子'));
        }

        return this.analyze.runNode(
          stageName,
          task.provider_id,
          task.model ?? '',
          post,
          stages,
          signal,
        );
      case 'discover':
        return this.collection.runDiscoverStage(stageName, task, stages);
      case 'collect':
        if (!post) {
          return Promise.reject(new Error('collect 任务缺少帖子'));
        }

        return this.collection.runCollectStage(stageName, task, post, stages);
      case 'recheck':
        if (!post) {
          return Promise.reject(new Error('recheck 任务缺少帖子'));
        }

        return this.collection.runRecheckStage(stageName, task, post, stages);
      case 'translate':
        if (!post) {
          return Promise.reject(new Error('translate 任务缺少帖子'));
        }

        // 译文按 content_hash 落 translations 表；产物含 usage 供成本回填。
        return this.translation.translatePost(post.id, task.provider_id, signal);
      default: {
        // 穷尽性守卫：task.kind 现为 task_kind 枚举联合，新增 kind 未在此分支处理即编译失败。
        const _exhaustive: never = task.kind;

        return Promise.reject(new Error(`未实现的任务类型环节执行: ${String(_exhaustive)}`));
      }
    }
  }

  /** 任务成功收尾：按 kind 善后（analyze→markAnalyzed）+ succeedTask（带 token 用量）+ run 计数。 */
  private async finalizeTaskSuccess(
    task: TaskRow,
    post: PostRow | null,
    stages: StageLike[],
  ): Promise<void> {
    if (task.kind === 'analyze' && post) {
      await this.posts.markAnalyzed(post.id, nowSec());
    }

    await this.tasks.succeedTask(task.id, nowSec(), usageFromSteps(stages));
    await this.runs.incrementCounters(task.run_id, { done: 1 });
    logger.info(`  ✓ [task#${task.id} ${task.kind}] 完成`);
  }

  /** 任务失败善后（按 kind）：analyze 累加 analyze_attempts（与旧路径一致，达上限不再自动重分析）。 */
  private async onTaskError(task: TaskRow, post: PostRow | null): Promise<void> {
    if (task.kind === 'analyze' && post) {
      await this.posts.bumpAnalyzeAttempts(post.id);
    }
  }
}
