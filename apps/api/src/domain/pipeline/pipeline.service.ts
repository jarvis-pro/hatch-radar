import {
  BlueprintsRepository,
  PostsRepository,
  ProvidersRepository,
  RunsRepository,
  RuntimeSettingsService,
  TasksRepository,
  TaskStagesRepository,
  type BlueprintRow,
} from '@hatch-radar/db';
import { AnalysisConfigService } from '@hatch-radar/analysis';
import type { Dispatcher } from '@hatch-radar/kernel';
import { logger, nowSec } from '@hatch-radar/kernel';
import { INSPECT_STEP_NAMES, type InspectJobView, type InspectStepView } from '@hatch-radar/shared';

/** analyze 任务的环节模板（= 检视器 6 节点；无闸门→worker 一口气运行到底）。 */
const ANALYZE_STAGES = INSPECT_STEP_NAMES.map((name) => ({ name }));
/** 单次复查 sweep 最多纳入的到期帖数 */
const RECHECK_BATCH = 50;

/** runAnalyzeSweep 结果（供调度日志） */
export interface AnalyzeSweepResult {
  /** 本轮 active 模型；null = 未配置、未派生 */
  active: { id: number; model: string; label: string } | null;
  /** 本轮 analyze 进程 id；未派生时 null */
  runId: number | null;
  /** 实际新派生的 analyze 任务数 */
  created: number;
  /** 待分析帖子数（含已有活跃任务被跳过的） */
  pending: number;
}

/**
 * 图纸执行编排（控制面）：把一次图纸触发落成「建 run → 派生 task」，再交 gateway 派发给 worker。
 *
 * 取代旧 {@link AnalysisConfigService.enqueueAutoAnalysisRound}（直接入 analysis_jobs）——
 * 自动分析改由 tasks 承载、归属 run/blueprint，可在「图纸 / 进程」视图回看，成本经 UNION 进看板。
 * collect / recheck 图纸在后续里程碑接入本服务。
 */
export class PipelineService {
  constructor(
    private readonly blueprints: BlueprintsRepository,
    private readonly runs: RunsRepository,
    private readonly tasks: TasksRepository,
    private readonly taskStages: TaskStagesRepository,
    private readonly posts: PostsRepository,
    private readonly analysisConfig: AnalysisConfigService,
    private readonly runtimeSettings: RuntimeSettingsService,
    private readonly providers: ProvidersRepository,
    private readonly gateway?: Dispatcher,
  ) {}

  /** 找或建一张指定 kind 的默认图纸（首次触发时惰性种子，免单独 seeder）。 */
  private async ensureBlueprint(
    kind: string,
    label: string,
    triggerKind = 'cron',
  ): Promise<BlueprintRow> {
    const existing = (await this.blueprints.listBlueprints(kind))[0];
    if (existing) return existing;
    return this.blueprints.createBlueprint({ kind, label, triggerKind }, nowSec());
  }

  /**
   * 自动分析一轮（取代旧 enqueueAutoAnalysisRound）：选 active 模型 → 取待分析帖 → 建 analyze 进程 +
   * 逐帖派生 analyze 任务（同帖已有活跃任务则由 createTaskWithStages 去重跳过）→ 触发派发。
   * @param triggerSource 触发来源（cron / manual）
   */
  async runAnalyzeSweep(triggerSource = 'cron'): Promise<AnalyzeSweepResult> {
    const active = await this.analysisConfig.getActiveProvider();
    if (!active) return { active: null, runId: null, created: 0, pending: 0 };

    const batch = await this.runtimeSettings.getAnalyzeBatchSize();
    const posts = await this.posts.getPostsToAnalyze(batch);
    const bp = await this.ensureBlueprint('analyze', '自动分析');
    const run = await this.runs.createRun(
      {
        blueprintId: bp.id,
        kind: 'analyze',
        triggerSource,
        params: { providerId: active.id, model: active.model },
      },
      nowSec(),
    );

    let created = 0;
    for (const p of posts) {
      const res = await this.tasks.createTaskWithStages(
        {
          runId: run.id,
          kind: 'analyze',
          postId: p.id,
          providerId: active.id,
          model: active.model,
        },
        ANALYZE_STAGES,
        nowSec(),
      );
      if (res.ok) created += 1;
    }
    await this.runs.incrementCounters(run.id, { total: created });
    // sweep run = 一次派生批次：派生即收尾（各 task 异步执行、完成时各自累加 run 计数）。
    await this.runs.finishRun(run.id, 'completed', nowSec());
    if (created > 0) {
      void this.gateway?.tryDispatch();
      logger.info(`[pipeline] analyze 进程#${run.id} 派生 ${created} 个分析任务`);
    }
    return { active, runId: run.id, created, pending: posts.length };
  }

  /**
   * 采集一轮：建 collect 进程 + 一个 discover 根任务。worker 认领 discover 后抓列表 → 去重 →
   * 为新帖派生 collect 任务 → collect 抓评论 → 派生 analyze。整链路在「进程」页可见。
   * @param triggerSource 触发来源（cron / manual）
   */
  async runCollectSweep(triggerSource = 'cron'): Promise<{ runId: number }> {
    const bp = await this.ensureBlueprint('collect', '采集');
    const run = await this.runs.createRun(
      { blueprintId: bp.id, kind: 'collect', triggerSource },
      nowSec(),
    );
    const res = await this.tasks.createTaskWithStages(
      { runId: run.id, kind: 'discover' },
      [{ name: 'discover' }],
      nowSec(),
    );
    if (res.ok) await this.runs.incrementCounters(run.id, { total: 1 });
    void this.gateway?.tryDispatch();
    logger.info(`[pipeline] collect 进程#${run.id} 已创建 discover 任务`);
    return { runId: run.id };
  }

  /**
   * 复查一轮（sweep）：sweep 序号 = 该图纸已用最大值 + 1；选 recheck_due_sweep ≤ sweep 的到期旧帖，
   * 逐帖派生 recheck 任务（params 带 sweep 供退避计算）。worker 复查时变则重抓+重新分析、否则指数退避。
   * @param triggerSource 触发来源（cron / manual）
   */
  async runRecheckSweep(
    triggerSource = 'cron',
  ): Promise<{ runId: number; sweep: number; due: number }> {
    const bp = await this.ensureBlueprint('recheck', '复查');
    const sweep = (await this.runs.maxSweep(bp.id)) + 1;
    const run = await this.runs.createRun(
      { blueprintId: bp.id, kind: 'recheck', triggerSource, sweepSeq: sweep },
      nowSec(),
    );
    const posts = await this.posts.getPostsToRecheck(sweep, RECHECK_BATCH);
    let created = 0;
    for (const p of posts) {
      const res = await this.tasks.createTaskWithStages(
        { runId: run.id, kind: 'recheck', postId: p.id, params: { sweep } },
        [{ name: 'recheck' }],
        nowSec(),
      );
      if (res.ok) created += 1;
    }
    await this.runs.incrementCounters(run.id, { total: created });
    await this.runs.finishRun(run.id, 'completed', nowSec());
    if (created > 0) {
      void this.gateway?.tryDispatch();
      logger.info(
        `[pipeline] recheck sweep#${sweep} 进程#${run.id} 派生 ${created} 复查任务（${posts.length} 到期）`,
      );
    }
    return { runId: run.id, sweep, due: posts.length };
  }

  /**
   * 手动分析选中帖子（取代旧 enqueueManualRun 直入 analysis_jobs）：建 manual analyze 进程 +
   * 逐帖派生 analyze 任务（同帖已有活跃 analyze 任务则去重跳过）。
   * @param postIds 选中的帖子 id
   * @param providerId 指定模型配置 id
   */
  async enqueueManualAnalyze(
    postIds: string[],
    providerId: number,
  ): Promise<{ ok: boolean; enqueued: number; error?: string }> {
    const provider = await this.providers.getProvider(providerId);
    if (!provider) return { ok: false, enqueued: 0, error: '模型配置不存在' };
    if (!provider.enabled) return { ok: false, enqueued: 0, error: '该模型已停用' };

    const bp = await this.ensureBlueprint('analyze', '自动分析');
    const run = await this.runs.createRun(
      {
        blueprintId: bp.id,
        kind: 'analyze',
        triggerSource: 'manual',
        params: { providerId, model: provider.model },
      },
      nowSec(),
    );
    let enqueued = 0;
    for (const id of [...new Set(postIds)]) {
      const res = await this.tasks.createTaskWithStages(
        { runId: run.id, kind: 'analyze', postId: id, providerId, model: provider.model },
        ANALYZE_STAGES,
        nowSec(),
      );
      if (res.ok) enqueued += 1;
    }
    await this.runs.incrementCounters(run.id, { total: enqueued });
    await this.runs.finishRun(run.id, 'completed', nowSec());
    if (enqueued > 0) void this.gateway?.tryDispatch();
    return { ok: true, enqueued };
  }

  /**
   * 入队翻译（取代旧 jobs.enqueueTranslationJob）：建 translate 进程 + 逐帖派生 translate 任务
   * （同帖已有活跃 translate 任务则去重跳过）。provider 类型校验在调用方（仅 claude_cli / azure）。
   * @param postIds 目标帖子 id（单帖传 1 个，批量传多个）
   * @param providerId 翻译 provider 配置 id
   * @param model 模型名快照
   * @returns 实际派生的翻译任务数
   */
  async enqueueTranslation(
    postIds: string[],
    providerId: number,
    model: string,
  ): Promise<{ enqueued: number }> {
    if (postIds.length === 0) return { enqueued: 0 };
    const bp = await this.ensureBlueprint('translate', '翻译');
    const run = await this.runs.createRun(
      {
        blueprintId: bp.id,
        kind: 'translate',
        triggerSource: 'manual',
        params: { providerId, model },
      },
      nowSec(),
    );
    let enqueued = 0;
    for (const id of [...new Set(postIds)]) {
      const res = await this.tasks.createTaskWithStages(
        { runId: run.id, kind: 'translate', postId: id, providerId, model },
        [{ name: 'translate' }],
        nowSec(),
      );
      if (res.ok) enqueued += 1;
    }
    await this.runs.incrementCounters(run.id, { total: enqueued });
    await this.runs.finishRun(run.id, 'completed', nowSec());
    if (enqueued > 0) void this.gateway?.tryDispatch();
    return { enqueued };
  }

  // ─── 流水线检视器（单条手动 / 逐环节暂停）──────────────────────────────────────────
  // 检视 = 带闸门的 analyze 任务：复用 tasks/task_stages 同一执行内核（worker 逐环节落检查点、
  // 遇闸门置 paused）。取代旧 analysis_jobs(inspect=true) 专路；视图沿用 InspectJobView 契约。

  /**
   * 发起检视任务：建 analyze 任务（检视器 6 环节）；stepGate=true 时每环节挂闸门（逐环节暂停），
   * false 则运行到底＋留痕。该帖已有活跃 analyze 任务时由 createTaskWithStages 去重拒绝。
   */
  async enqueueInspect(
    postId: string,
    providerId: number,
    stepGate: boolean,
  ): Promise<{ ok: true; taskId: number } | { ok: false; error: string }> {
    const provider = await this.providers.getProvider(providerId);
    if (!provider) return { ok: false, error: '模型配置不存在' };
    if (!provider.enabled) return { ok: false, error: '该模型已停用' };
    const post = await this.posts.getPostById(postId);
    if (!post) return { ok: false, error: '帖子不存在' };

    const bp = await this.ensureBlueprint('analyze', '自动分析');
    const run = await this.runs.createRun(
      {
        blueprintId: bp.id,
        kind: 'analyze',
        triggerSource: 'inspect',
        params: { providerId, model: provider.model },
      },
      nowSec(),
    );
    const stages = INSPECT_STEP_NAMES.map((name) => ({ name, gate: stepGate }));
    const res = await this.tasks.createTaskWithStages(
      { runId: run.id, kind: 'analyze', postId, providerId, model: provider.model },
      stages,
      nowSec(),
    );
    if (!res.ok) {
      await this.runs.finishRun(run.id, 'completed', nowSec());
      return { ok: false, error: res.error };
    }
    await this.runs.incrementCounters(run.id, { total: 1 });
    await this.runs.finishRun(run.id, 'completed', nowSec());
    void this.gateway?.tryDispatch();
    return { ok: true, taskId: res.taskId };
  }

  /** 取检视任务视图：任务元信息 + 各环节轨迹（InspectJobView 形状，时间戳 number、output 已解析）。 */
  async getInspectView(taskId: number): Promise<InspectJobView | null> {
    const task = await this.tasks.getTask(taskId);
    if (!task) return null;
    const [stages, post, provider] = await Promise.all([
      this.taskStages.listStages(taskId),
      task.post_id != null ? this.posts.getPostById(task.post_id) : Promise.resolve(null),
      task.provider_id != null
        ? this.providers.getProvider(task.provider_id)
        : Promise.resolve(null),
    ]);
    const steps: InspectStepView[] = stages.map((s) => ({
      seq: s.seq,
      name: s.name,
      status: s.status,
      inputSummary: s.input_summary ?? null,
      output: s.output ?? null,
      error: s.error,
      startedAt: s.started_at,
      finishedAt: s.finished_at,
    }));
    return {
      id: task.id,
      postId: task.post_id ?? '',
      postTitle: post?.title ?? null,
      model: task.model ?? '',
      provider: provider?.provider ?? null,
      status: task.status,
      // 仍有未清的闸门即「逐节点暂停」模式（「运行到底」清闸后转 false、隐藏该按钮）
      stepGate: stages.some((s) => s.gate),
      trigger: 'inspect',
      error: task.error,
      enqueuedAt: task.enqueued_at,
      startedAt: task.started_at,
      finishedAt: task.finished_at,
      steps,
    };
  }

  /** 放行下一环节：paused→queued + 派发。返回 false = 当前并非暂停态。 */
  async resumeInspect(taskId: number): Promise<boolean> {
    const ok = await this.tasks.resumeTask(taskId);
    if (ok) void this.gateway?.tryDispatch();
    return ok;
  }

  /** 运行到底：清除全部环节闸门、若暂停则放行；worker 回读已清的闸门后连续跑完剩余环节（仍留轨迹）。 */
  async runInspectToEnd(taskId: number): Promise<void> {
    await this.taskStages.clearGates(taskId);
    await this.tasks.resumeTask(taskId); // 暂停则放行；运行中为 no-op（worker 自会回读清掉的闸门续跑）
    void this.gateway?.tryDispatch();
  }

  /** 重试当前失败环节：失败环节复位 pending、任务 failed→queued + 派发。返回 ok=false = 当前不可重试。 */
  async retryInspectStep(taskId: number): Promise<{ ok: boolean; error?: string }> {
    const task = await this.tasks.getTask(taskId);
    if (!task) return { ok: false, error: '任务不存在' };
    if (task.status !== 'failed') return { ok: false, error: '当前不可重试（任务并非失败态）' };
    await this.taskStages.resetStageToPending(taskId, task.current_seq);
    const ok = await this.tasks.requeueFailedTask(taskId);
    if (ok) void this.gateway?.tryDispatch();
    return { ok };
  }

  /** 取消检视任务：活跃态（queued/running/paused）→ canceled。返回 false = 当前已是终态。 */
  async cancelInspect(taskId: number): Promise<boolean> {
    return this.tasks.cancelTask(taskId, nowSec());
  }
}
