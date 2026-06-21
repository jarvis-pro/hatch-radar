import { AnalysisConfigService } from '@hatch-radar/analysis';
import { AnalysisService } from '@hatch-radar/analysis';
import { TranslationService } from '@hatch-radar/analysis';
import {
  buildContext,
  normalizeInsight,
  parseLooseJson,
  SYSTEM_PROMPT,
} from '@hatch-radar/analysis';
import { RuntimeSettingsService } from '@hatch-radar/db';
import type { PostRow, TaskRow, TaskStageRow } from '@hatch-radar/db';
import { CommentsRepository } from '@hatch-radar/db';
import { TasksRepository } from '@hatch-radar/db';
import { TaskStagesRepository } from '@hatch-radar/db';
import { RunsRepository } from '@hatch-radar/db';
import { PostsRepository } from '@hatch-radar/db';
import type {
  AiCallOutput,
  ContextOutput,
  FetchOutput,
  InspectStepName,
  NormalizeOutput,
  PersistOutput,
} from '@hatch-radar/shared';
import { logger } from '@hatch-radar/kernel';
import { nowSec } from '@hatch-radar/kernel';
import { CollectionExecutor } from './collection.executor';

/** running 期间的 DB 心跳间隔（毫秒），需远小于运行期设置 workerStaleSeconds（下界 30s） */
const HEARTBEAT_INTERVAL_MS = 15_000;
/** 周期性僵死回收间隔（毫秒） */
const RECLAIM_INTERVAL_MS = 60_000;

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
 * 任务执行器：接受 Gateway 分发的 task，按 kind 逐环节执行并写回数据库。
 *
 * 不含轮询——任务认领由 GatewayService 负责（Push 模式）。僵死回收定时器处理进程崩溃遗留的 running 任务。
 * 生命周期：NestJS onApplicationBootstrap/Shutdown → 这里的 {@link start}/{@link stop}，由配置类按进程拓扑调用。
 */
export class WorkerService {
  private reclaimTimer: ReturnType<typeof setInterval> | null = null;
  private activeJobPromises: Promise<void>[] = [];

  constructor(
    private readonly tasks: TasksRepository,
    private readonly taskStages: TaskStagesRepository,
    private readonly runs: RunsRepository,
    private readonly posts: PostsRepository,
    private readonly comments: CommentsRepository,
    private readonly analysis: AnalysisService,
    private readonly analysisConfig: AnalysisConfigService,
    private readonly translation: TranslationService,
    private readonly runtimeSettings: RuntimeSettingsService,
    private readonly collection: CollectionExecutor,
  ) {}

  /** 启动执行器（对应 NestJS onApplicationBootstrap）：回收遗留任务 + 起僵死回收定时器。 */
  async start(): Promise<void> {
    const orphaned = await this.tasks.reclaimRunningTasks(nowSec(), null);
    if (orphaned > 0) logger.warn(`[worker] 启动回收 ${orphaned} 个遗留 running 任务`);

    // 每轮实时读取回收阈值——设置页改 workerStaleSeconds 后下一轮即生效（含独立 worker 进程）
    this.reclaimTimer = setInterval(() => {
      void (async () => {
        const { staleSeconds } = await this.runtimeSettings.getWorkerTuning();
        const n = await this.tasks.reclaimRunningTasks(nowSec(), staleSeconds);
        if (n > 0) logger.warn(`[worker] 回收 ${n} 个僵死任务（心跳超 ${staleSeconds}s）`);
      })();
    }, RECLAIM_INTERVAL_MS);

    const stats = await this.tasks.taskStats();
    logger.info(
      `[worker] 执行器已就绪；当前任务 queued ${stats.queued} / running ${stats.running}`,
    );
  }

  /** 停止执行器（对应 NestJS onApplicationShutdown）：停回收定时器 + 排空在途任务。 */
  async stop(): Promise<void> {
    if (this.reclaimTimer) clearInterval(this.reclaimTimer);
    await Promise.allSettled(this.activeJobPromises);
  }

  /** 当前正在执行的任务数（供 WorkerAgentService 上报心跳） */
  get activeJobCount(): number {
    return this.activeJobPromises.length;
  }

  /**
   * 执行由 Gateway 分发来的任务（task 已被 Gateway 认领为 running；执行模型 blueprints→runs→tasks→task_stages）。
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
   * 每个环节受 jobTimeoutMs 超时与 AbortSignal 约束，复用 {@link execNode} 同一组节点函数。
   */
  private async runTask(taskId: number, onProgress?: (id: number) => void): Promise<void> {
    const task = await this.tasks.getTask(taskId);
    if (!task) return; // 任务已不存在（被清理）
    const post =
      task.post_id != null ? ((await this.posts.getPostById(task.post_id)) ?? null) : null;
    if (task.kind === 'analyze' && !post) {
      await this.tasks.failTask(task.id, '帖子不存在或已归档', nowSec());
      await this.runs.incrementCounters(task.run_id, { failed: 1 });
      return;
    }
    const heartbeat = setInterval(() => {
      void this.tasks.touchHeartbeat(task.id, nowSec());
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
        if (!fresh || fresh.status !== 'running') return;
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

  /** 按 kind 把环节派发到对应执行逻辑。analyze 复用检视器同一组节点函数；其余 kind 在后续里程碑接入。 */
  private execStage(
    task: TaskRow,
    stageName: string,
    post: PostRow | null,
    stages: StageLike[],
    signal: AbortSignal,
  ): Promise<unknown> {
    switch (task.kind) {
      case 'analyze':
        if (!post) return Promise.reject(new Error('analyze 任务缺少帖子'));
        return this.execNode(stageName, task.provider_id, task.model ?? '', post, stages, signal);
      case 'discover':
        return this.collection.runDiscoverStage(stageName, task, stages);
      case 'collect':
        if (!post) return Promise.reject(new Error('collect 任务缺少帖子'));
        return this.collection.runCollectStage(stageName, task, post, stages);
      case 'recheck':
        if (!post) return Promise.reject(new Error('recheck 任务缺少帖子'));
        return this.collection.runRecheckStage(stageName, task, post, stages);
      case 'translate':
        if (!post) return Promise.reject(new Error('translate 任务缺少帖子'));
        // 译文按 content_hash 落 translations 表；产物含 usage 供成本回填。
        return this.translation.translatePost(post.id, task.provider_id, signal);
      default:
        return Promise.reject(new Error(`未实现的任务类型环节执行: ${task.kind}`));
    }
  }

  /** 任务成功收尾：按 kind 善后（analyze→markAnalyzed）+ succeedTask（带 token 用量）+ run 计数。 */
  private async finalizeTaskSuccess(
    task: TaskRow,
    post: PostRow | null,
    stages: StageLike[],
  ): Promise<void> {
    if (task.kind === 'analyze' && post) await this.posts.markAnalyzed(post.id, nowSec());
    await this.tasks.succeedTask(task.id, nowSec(), usageFromSteps(stages));
    await this.runs.incrementCounters(task.run_id, { done: 1 });
    logger.info(`  ✓ [task#${task.id} ${task.kind}] 完成`);
  }

  /** 任务失败善后（按 kind）：analyze 累加 analyze_attempts（与旧路径一致，达上限不再自动重分析）。 */
  private async onTaskError(task: TaskRow, post: PostRow | null): Promise<void> {
    if (task.kind === 'analyze' && post) await this.posts.bumpAnalyzeAttempts(post.id);
  }

  /**
   * 按节点名执行单个流水线节点，返回其产物（落 job_steps.output）。
   * 输入按 docs/pipeline-inspector-design.md §三 表，从 job / 重新拉取（幂等）/ 上游 output 检查点取。
   */
  private execNode(
    name: string,
    providerId: number | null,
    model: string,
    post: PostRow,
    stages: StageLike[],
    signal: AbortSignal,
  ): Promise<unknown> {
    switch (name as InspectStepName) {
      case 'resolve':
        return this.nodeResolve(providerId);
      case 'fetch':
        return this.nodeFetch(post);
      case 'context':
        return this.nodeContext(post);
      case 'ai_call':
        return this.nodeAiCall(providerId, stages, signal);
      case 'normalize':
        return Promise.resolve(this.nodeNormalize(stages));
      case 'persist':
        return this.nodePersist(model, post, stages);
      default:
        return Promise.reject(new Error(`未知检视节点: ${name}`));
    }
  }

  /** 节点 0 resolve：解析模型配置（幂等）。 */
  private async nodeResolve(providerId: number | null) {
    if (providerId == null) throw new Error('任务未绑定模型（provider_id 为空）');
    const info = await this.analysisConfig.getProviderInspectInfo(providerId);
    if (!info) throw new Error('模型配置不存在或已停用');
    return info;
  }

  /** 节点 1 fetch：拉取原始数据规模（幂等）。 */
  private async nodeFetch(post: PostRow): Promise<FetchOutput> {
    const comments = await this.comments.getCommentsForPost(post.id);
    const maxDepth = comments.reduce((m, c) => Math.max(m, c.depth), 0);
    return {
      title: post.title,
      selftextChars: post.selftext.length,
      commentCount: comments.length,
      numComments: post.num_comments,
      maxDepth,
    };
  }

  /** 节点 2 context：构建并落库完整上下文（检查点——避免两次认领间评论改写导致「所见≠所跑」）。 */
  private async nodeContext(post: PostRow): Promise<ContextOutput> {
    const comments = await this.comments.getCommentsForPost(post.id);
    const contextText = buildContext(post, comments);
    return {
      systemPrompt: SYSTEM_PROMPT,
      contextText,
      chars: contextText.length,
      estimatedTokens: Math.ceil(contextText.length / EST_CHARS_PER_TOKEN),
    };
  }

  /** 节点 3 ai_call：读 context 检查点 + 解析处理器 → 调 AI 拿原始响应（不可重算，整设计落检查点的根因）。 */
  private async nodeAiCall(
    providerId: number | null,
    stages: StageLike[],
    signal: AbortSignal,
  ): Promise<AiCallOutput> {
    if (providerId == null) throw new Error('任务未绑定模型（provider_id 为空）');
    const ctx = stepOutput<ContextOutput>(stages, 'context');
    if (!ctx?.contextText) throw new Error('上游 context 节点产物缺失，无法调用 AI');
    const processor = await this.analysisConfig.getProcessorForProvider(providerId);
    if (!processor) throw new Error('模型配置不存在或已停用');
    const raw = await processor.callRaw(ctx.contextText, signal);
    return {
      raw: raw.raw,
      usage: raw.usage,
      keyId: raw.keyId ?? null,
      keySwitched: raw.keySwitched ?? false,
    };
  }

  /** 节点 4 normalize：读 ai_call 检查点 → 归一化（纯函数）+ 统计归一化丢弃的非法条目。 */
  private nodeNormalize(stages: StageLike[]): NormalizeOutput {
    const ai = stepOutput<AiCallOutput>(stages, 'ai_call');
    if (ai?.raw == null) throw new Error('上游 ai_call 节点产物缺失，无法归一化');
    const parsed = typeof ai.raw === 'string' ? parseLooseJson(ai.raw) : ai.raw;
    const insight = normalizeInsight(parsed);
    const p = parsed as { pain_points?: unknown[]; opportunities?: unknown[] };
    const rawPain = Array.isArray(p?.pain_points) ? p.pain_points.length : 0;
    const rawOpp = Array.isArray(p?.opportunities) ? p.opportunities.length : 0;
    return {
      insight,
      droppedPainPoints: Math.max(0, rawPain - insight.pain_points.length),
      droppedOpportunities: Math.max(0, rawOpp - insight.opportunities.length),
    };
  }

  /** 节点 5 persist：读 normalize 检查点 → 落库（saveInsight 按 post_id 幂等，重认领重跑安全）。 */
  private async nodePersist(
    model: string,
    post: PostRow,
    stages: StageLike[],
  ): Promise<PersistOutput> {
    const norm = stepOutput<NormalizeOutput>(stages, 'normalize');
    if (!norm?.insight) throw new Error('上游 normalize 节点产物缺失，无法落库');
    const { saved } = await this.analysis.persistInsight(post, model, norm.insight);
    return {
      saved,
      painPointCount: norm.insight.pain_points.length,
      opportunityCount: norm.insight.opportunities.length,
    };
  }
}

/** 粗略估算每 token 字符数（仅用于检视展示，不参与计费） */
const EST_CHARS_PER_TOKEN = 4;

/** 环节产物读取的最小形状（TaskStageRow 满足；节点函数据此读上游检查点）。 */
type StageLike = { name: string; output: unknown };

/** 取某环节已落库的产物并按目标形状读取（上游检查点；未跑/无产物为 undefined）。 */
function stepOutput<T>(stages: StageLike[], name: string): T | undefined {
  const out = stages.find((s) => s.name === name)?.output;
  return (out ?? undefined) as T | undefined;
}

/** token 用量形状（ai_call / translate 环节产物的 usage 字段同形）。 */
type StageUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

/** 从 ai_call 或 translate 环节产物提取 token 用量，供整条任务计费（缺则 null）。 */
function usageFromSteps(stages: StageLike[]): StageUsage | null {
  const fromAi = stepOutput<AiCallOutput>(stages, 'ai_call')?.usage;
  if (fromAi) return fromAi;
  return stepOutput<{ usage: StageUsage | null }>(stages, 'translate')?.usage ?? null;
}
