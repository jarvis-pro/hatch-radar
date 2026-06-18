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
import type { JobRow, JobStepRow, PostRow, TaskRow, TaskStageRow } from '@hatch-radar/db';
import { CommentsRepository } from '@hatch-radar/db';
import { JobsRepository } from '@hatch-radar/db';
import { JobStepsRepository } from '@hatch-radar/db';
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

/** 供 WorkerAgentService 分发时传入的最小 job 信息 */
export interface DispatchedJobInfo {
  id: number;
  post_id: string;
  provider_id: number | null;
}

/**
 * 分析 job 执行器（与 NestJS 版逐字等价）：接受 Gateway 分发的任务，执行 AI 分析并写回数据库。
 *
 * 不含轮询——任务认领由 GatewayService 负责（Push 模式）。僵死回收定时器处理进程崩溃遗留的 running 任务。
 * 生命周期：NestJS onApplicationBootstrap/Shutdown → 这里的 {@link start}/{@link stop}，由配置类按进程拓扑调用。
 */
export class WorkerService {
  private reclaimTimer: ReturnType<typeof setInterval> | null = null;
  private activeJobPromises: Promise<void>[] = [];

  constructor(
    private readonly jobs: JobsRepository,
    private readonly jobSteps: JobStepsRepository,
    private readonly tasks: TasksRepository,
    private readonly taskStages: TaskStagesRepository,
    private readonly runs: RunsRepository,
    private readonly posts: PostsRepository,
    private readonly comments: CommentsRepository,
    private readonly analysis: AnalysisService,
    private readonly analysisConfig: AnalysisConfigService,
    private readonly translation: TranslationService,
    private readonly runtimeSettings: RuntimeSettingsService,
  ) {}

  /** 启动执行器（对应 NestJS onApplicationBootstrap）：回收遗留任务 + 起僵死回收定时器。 */
  async start(): Promise<void> {
    const orphaned =
      (await this.jobs.reclaimRunningJobs(nowSec(), null)) +
      (await this.tasks.reclaimRunningTasks(nowSec(), null));
    if (orphaned > 0) logger.warn(`[worker] 启动回收 ${orphaned} 个遗留 running 任务`);

    // 每轮实时读取回收阈值——设置页改 workerStaleSeconds 后下一轮即生效（含独立 worker 进程）
    this.reclaimTimer = setInterval(() => {
      void (async () => {
        const { staleSeconds } = await this.runtimeSettings.getWorkerTuning();
        const n =
          (await this.jobs.reclaimRunningJobs(nowSec(), staleSeconds)) +
          (await this.tasks.reclaimRunningTasks(nowSec(), staleSeconds));
        if (n > 0) logger.warn(`[worker] 回收 ${n} 个僵死任务（心跳超 ${staleSeconds}s）`);
      })();
    }, RECLAIM_INTERVAL_MS);

    const stats = await this.jobs.getJobStats();
    logger.info(
      `[worker] 分析执行器已就绪；当前队列 queued ${stats.queued} / running ${stats.running}`,
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
   * 执行由 Gateway 分发来的任务（job 已被 Gateway 认领为 running）。
   */
  async executeDispatchedJob(
    job: DispatchedJobInfo,
    onProgress?: (jobId: number) => void,
  ): Promise<void> {
    const p = this.runJob(job, onProgress);
    this.activeJobPromises.push(p);
    try {
      await p;
    } finally {
      this.activeJobPromises = this.activeJobPromises.filter((x) => x !== p);
    }
  }

  /**
   * 执行由调度 / 分发分配来的任务（新执行模型：blueprints→runs→tasks→task_stages）。
   * 与 {@link executeDispatchedJob}（旧 analysis_jobs 路径）过渡期并存；后续切换后取代之。
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
   * 每个环节受 jobTimeoutMs 超时与 AbortSignal 约束。是 {@link runInspectJob} 的泛化，复用同一组节点函数。
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
          await this.tasks.pauseTask(task.id); // 静停于闸门，等放行重认领续跑
          return;
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

  private async runJob(
    job: DispatchedJobInfo,
    onProgress?: (jobId: number) => void,
  ): Promise<void> {
    const post = await this.posts.getPostById(job.post_id);
    if (!post) {
      await this.jobs.failJob(job.id, '帖子不存在或已归档', nowSec());
      return;
    }
    // Gateway 分发的最小信息不含 job_type / inspect 标志，按 id 回查整行再路由（一次 PK 查找）
    const full = await this.jobs.getJob(job.id);
    if (!full) return; // 任务已不存在（被清理）——无事可做
    if (full.inspect) await this.runInspectJob(full, post, onProgress);
    else if (full.job_type === 'translation') await this.runTranslationJob(job, post, onProgress);
    else await this.runAnalysisJob(job, post, onProgress);
  }

  /** 执行分析任务：解析处理器 → AI 分析 → 落库洞察 → markAnalyzed。 */
  private async runAnalysisJob(
    job: DispatchedJobInfo,
    post: PostRow,
    onProgress?: (jobId: number) => void,
  ): Promise<void> {
    const processor =
      job.provider_id != null
        ? await this.analysisConfig.getProcessorForProvider(job.provider_id)
        : null;
    if (!processor) {
      await this.jobs.failJob(
        job.id,
        `无法解析模型配置（provider_id=${job.provider_id ?? 'null'}），请检查设置`,
        nowSec(),
      );
      return;
    }
    const commentsData = await this.comments.getCommentsForPost(job.post_id);
    const heartbeat = setInterval(() => {
      void this.jobs.touchHeartbeat(job.id, nowSec());
      onProgress?.(job.id);
    }, HEARTBEAT_INTERVAL_MS);
    const ac = new AbortController();
    const { jobTimeoutMs } = await this.runtimeSettings.getWorkerTuning();
    try {
      const { saved, usage } = await withTimeout(
        this.analysis.analyzeAndPersist(processor, post, commentsData, ac.signal),
        jobTimeoutMs,
        () => ac.abort(new Error('job 超时，中止底层调用')),
      );
      await this.posts.markAnalyzed(post.id, nowSec());
      await this.jobs.succeedJob(job.id, nowSec(), usage);
      if (saved) {
        logger.info(`  ✓ [job#${job.id}] r/${post.subreddit}「${post.title.slice(0, 40)}」已落库`);
      }
    } catch (err) {
      await this.posts.bumpAnalyzeAttempts(post.id);
      const msg = err instanceof Error ? err.message : String(err);
      await this.jobs.failJob(job.id, msg, nowSec());
      logger.error(`  ✗ [job#${job.id}] ${post.id} 失败: ${msg}`);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** 执行翻译任务：翻译该帖未翻译内容并按内容哈希回写 translations（不动 analyzed_at / analyze_attempts）。 */
  private async runTranslationJob(
    job: DispatchedJobInfo,
    post: PostRow,
    onProgress?: (jobId: number) => void,
  ): Promise<void> {
    const heartbeat = setInterval(() => {
      void this.jobs.touchHeartbeat(job.id, nowSec());
      onProgress?.(job.id);
    }, HEARTBEAT_INTERVAL_MS);
    const ac = new AbortController();
    const { jobTimeoutMs } = await this.runtimeSettings.getWorkerTuning();
    try {
      const { translated, skipped, usage } = await withTimeout(
        this.translation.translatePost(post.id, job.provider_id, ac.signal),
        jobTimeoutMs,
        () => ac.abort(new Error('job 超时，中止底层调用')),
      );
      await this.jobs.succeedJob(job.id, nowSec(), usage);
      logger.info(
        `  ✓ [job#${job.id}] 翻译 ${post.id} 完成（新译 ${translated} / 跳过 ${skipped}）`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.jobs.failJob(job.id, msg, nowSec());
      logger.error(`  ✗ [job#${job.id}] 翻译 ${post.id} 失败: ${msg}`);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * 执行检视任务（inspect=true）：一次认领只推进到下一个闸门。
   *
   * 每跑完一个节点把产物落库（检查点）；逐节点闸门开启时置 paused 后正常结束本次认领，由控制面放行
   * （paused→queued）触发重认领、从下一节点续跑（见 docs/pipeline-inspector-design.md 决策 1）。闸门关闭
   * （运行到底）时连续跑完剩余节点。每个节点受 jobTimeoutMs 超时与 AbortSignal 约束（沿用 withTimeout）。
   */
  private async runInspectJob(
    job: JobRow,
    post: PostRow,
    onProgress?: (jobId: number) => void,
  ): Promise<void> {
    const heartbeat = setInterval(() => {
      void this.jobs.touchHeartbeat(job.id, nowSec());
      onProgress?.(job.id);
    }, HEARTBEAT_INTERVAL_MS);
    const ac = new AbortController();
    const { jobTimeoutMs } = await this.runtimeSettings.getWorkerTuning();
    try {
      const steps = await this.jobSteps.listSteps(job.id);
      // 连续推进，直至：遇闸门（paused 返回）、末节点成功、节点失败、或被取消
      for (;;) {
        const next = steps.find((s) => s.status === 'pending');
        if (!next) {
          // 兜底：无 pending 节点（理论不发生）。仍 running 则按成功收尾。
          await this.jobs.succeedJob(job.id, nowSec(), usageFromSteps(steps));
          return;
        }
        await this.jobSteps.markStepRunning(job.id, next.seq, null, nowSec());
        let output: unknown;
        try {
          output = await withTimeout(
            this.execNode(next.name, job.provider_id, job.model, post, steps, ac.signal),
            jobTimeoutMs,
            () => ac.abort(new Error('节点执行超时，中止底层调用')),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await this.jobSteps.markStepFailed(job.id, next.seq, msg, nowSec());
          await this.jobs.failJob(job.id, msg, nowSec());
          logger.error(`  ✗ [inspect job#${job.id}] 节点 ${next.name} 失败: ${msg}`);
          return;
        }
        await this.jobSteps.markStepDone(job.id, next.seq, output, nowSec());
        // 同步本地副本，供「运行到底」连续跑时下游节点读上游产物
        next.status = 'done';
        next.output = output as JobStepRow['output'];

        // 闸门/收尾决策前实时回读最新 job（status + step_gate）——使「运行到底」「取消」对执行中的任务即时生效
        const fresh = await this.jobs.getJob(job.id);
        if (!fresh || fresh.status !== 'running') return; // 被取消 / 外部改状态 → 停手，不写终态
        if (next.name === 'persist') {
          await this.posts.markAnalyzed(post.id, nowSec()); // 末节点：标记已分析 + 整条 job 成功
          await this.jobs.succeedJob(job.id, nowSec(), usageFromSteps(steps));
          logger.info(`  ✓ [inspect job#${job.id}] 全部节点完成`);
          return;
        }
        if (fresh.step_gate) {
          await this.jobs.pauseJob(job.id); // 静停于闸门，等放行 → 重认领续跑
          return;
        }
        // 闸门关闭：继续跑下一节点
      }
    } finally {
      clearInterval(heartbeat);
    }
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

/** 环节产物读取的最小形状：JobStepRow / TaskStageRow 均满足（普通检视与新任务内核共用节点函数）。 */
type StageLike = { name: string; output: unknown };

/** 取某环节已落库的产物并按目标形状读取（上游检查点；未跑/无产物为 undefined）。 */
function stepOutput<T>(stages: StageLike[], name: string): T | undefined {
  const out = stages.find((s) => s.name === name)?.output;
  return (out ?? undefined) as T | undefined;
}

/** 从 ai_call 环节产物提取 token 用量，供整条任务计费（缺则 null）。 */
function usageFromSteps(stages: StageLike[]): {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
} | null {
  return stepOutput<AiCallOutput>(stages, 'ai_call')?.usage ?? null;
}
