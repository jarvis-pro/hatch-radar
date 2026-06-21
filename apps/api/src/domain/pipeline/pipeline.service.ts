import {
  BlueprintsRepository,
  PostsRepository,
  ProcessesRepository,
  ProvidersRepository,
  RunsRepository,
  RuntimeSettingsService,
  TasksRepository,
  TaskStagesRepository,
  type BlueprintRow,
  type ProcessRow,
} from '@hatch-radar/db';
import { CronExpressionParser } from 'cron-parser';
import { AnalysisConfigService } from '@hatch-radar/analysis';
import type { Dispatcher } from '@hatch-radar/kernel';
import { logger, nowSec } from '@hatch-radar/kernel';
import {
  buildStages,
  INSPECT_STEP_NAMES,
  type InspectJobView,
  type InspectStepView,
  type StageRecipe,
} from '@hatch-radar/shared';

/** analyze 任务的环节模板（= 检视器 6 节点；无闸门→worker 一口气运行到底）。 */
const ANALYZE_STAGES = buildStages('analyze');
/** 单次复查 sweep 最多纳入的到期帖数 */
const RECHECK_BATCH = 50;

/** 把 JsonValue 安全读成字符串数组（gates / enabledStages 复合键）。 */
function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** 从图纸读出建环节配方（gates=暂停点 / enabledStages=已启用可选环节）。 */
function recipeFromBlueprint(bp: BlueprintRow): StageRecipe {
  return { gates: asStrArr(bp.gates), enabledStages: asStrArr(bp.enabled_stages) };
}

/** 据进程触发配置算下次到期时刻（epoch 秒）；once / 非 active 为 null。 */
function computeNextRunAt(process: ProcessRow, now: number): number | null {
  if (process.status !== 'active' || process.trigger_kind === 'once') return null;
  const cfg = (process.trigger_config ?? {}) as { everySec?: unknown; expr?: unknown };
  if (process.trigger_kind === 'interval') {
    const everySec = typeof cfg.everySec === 'number' && cfg.everySec > 0 ? cfg.everySec : 1800;
    return now + everySec;
  }
  if (process.trigger_kind === 'cron' && typeof cfg.expr === 'string') {
    try {
      const it = CronExpressionParser.parse(cfg.expr, { currentDate: new Date(now * 1000) });
      return Math.floor(it.next().getTime() / 1000);
    } catch {
      return now + 3600; // cron 表达式非法兜底：1 小时后
    }
  }
  return null;
}

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
    private readonly processes: ProcessesRepository,
    private readonly gateway?: Dispatcher,
  ) {}

  /** 找或建一张指定 kind 的默认图纸（首次触发时惰性种子，免单独 seeder）。 */
  private async ensureBlueprint(kind: string, label: string): Promise<BlueprintRow> {
    const existing = (await this.blueprints.listBlueprints(kind))[0];
    if (existing) return existing;
    return this.blueprints.createBlueprint({ kind, label }, nowSec());
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
   * 采集一轮：建 collect 运行 + 一个 discover 根任务。worker 认领 discover 后抓列表 → 去重 →
   * 为新帖派生 collect 任务 → collect 抓评论 → 派生 analyze。整链路在「运行」页可见。
   * @param triggerSource 触发来源（manual / cron / interval）
   * @param process 进程调度触发时传入（带 process_id + 图纸配方）；手动触发省略（惰性默认图纸）
   */
  async runCollectSweep(triggerSource = 'cron', process?: ProcessRow): Promise<{ runId: number }> {
    const bp = process
      ? await this.blueprints.getBlueprint(process.blueprint_id)
      : await this.ensureBlueprint('collect', '采集');
    if (!bp) throw new Error(`进程#${process?.id} 绑定的图纸不存在`);
    const recipe = recipeFromBlueprint(bp);
    const run = await this.runs.createRun(
      {
        blueprintId: bp.id,
        processId: process?.id ?? null,
        kind: 'collect',
        triggerSource,
        params: recipe,
      },
      nowSec(),
    );
    const res = await this.tasks.createTaskWithStages(
      { runId: run.id, processId: process?.id ?? null, kind: 'discover' },
      buildStages('discover', recipe),
      nowSec(),
    );
    if (res.ok) await this.runs.incrementCounters(run.id, { total: 1 });
    void this.gateway?.tryDispatch();
    logger.info(`[pipeline] collect 运行#${run.id} 已创建 discover 任务`);
    return { runId: run.id };
  }

  /**
   * 复查一轮（sweep）：进程模式 sweep = process.sweep_seq++，手动模式 = 该图纸已用最大值 + 1；
   * 选 recheck_due_sweep ≤ sweep 的到期旧帖，逐帖派生 recheck 任务（params 带 sweep 供退避计算）。
   * worker 复查时变则重抓 + 重新分析、否则指数退避。
   * @param triggerSource 触发来源（manual / cron / interval）
   * @param process 进程调度触发时传入；手动触发省略
   */
  async runRecheckSweep(
    triggerSource = 'cron',
    process?: ProcessRow,
  ): Promise<{ runId: number; sweep: number; due: number }> {
    const bp = process
      ? await this.blueprints.getBlueprint(process.blueprint_id)
      : await this.ensureBlueprint('recheck', '复查');
    if (!bp) throw new Error(`进程#${process?.id} 绑定的图纸不存在`);
    const recipe = recipeFromBlueprint(bp);
    const sweep = process
      ? await this.processes.bumpSweep(process.id)
      : (await this.runs.maxSweep(bp.id)) + 1;
    const run = await this.runs.createRun(
      {
        blueprintId: bp.id,
        processId: process?.id ?? null,
        kind: 'recheck',
        triggerSource,
        sweepSeq: sweep,
        params: recipe,
      },
      nowSec(),
    );
    const posts = await this.posts.getPostsToRecheck(sweep, RECHECK_BATCH);
    let created = 0;
    for (const p of posts) {
      const res = await this.tasks.createTaskWithStages(
        {
          runId: run.id,
          processId: process?.id ?? null,
          kind: 'recheck',
          postId: p.id,
          params: { sweep },
        },
        buildStages('recheck', recipe),
        nowSec(),
      );
      if (res.ok) created += 1;
    }
    await this.runs.incrementCounters(run.id, { total: created });
    // 空轮（无到期帖）即时完成；非空运行交 finalizeRunningRuns 在任务全终结后收尾（驱动进程重排）。
    if (created === 0) await this.runs.finishRun(run.id, 'completed', nowSec());
    else void this.gateway?.tryDispatch();
    if (created > 0) {
      logger.info(
        `[pipeline] recheck sweep#${sweep} 运行#${run.id} 派生 ${created} 复查任务（${posts.length} 到期）`,
      );
    }
    return { runId: run.id, sweep, due: posts.length };
  }

  // ─── 进程调度（取代旧 4 个 @Cron；由 SchedulerService 心跳每若干秒调用）──────────────────

  /** 触发所有到期进程：active 且 next_run_at ≤ now、且当前无进行中运行（按进程非重入）。 */
  async fireDueProcesses(): Promise<void> {
    const due = await this.processes.listDue(nowSec());
    for (const process of due) {
      if (await this.runs.hasRunningRunForProcess(process.id)) continue;
      await this.fireProcess(process);
    }
  }

  /** 触发单个进程：按图纸 kind 开 collect / recheck 运行 + 记账（markFired）；空轮即时重排下一轮。 */
  async fireProcess(process: ProcessRow, triggerSource?: string): Promise<void> {
    const bp = await this.blueprints.getBlueprint(process.blueprint_id);
    if (!bp) {
      logger.warn(`[scheduler] 进程#${process.id} 绑定图纸缺失，跳过`);
      return;
    }
    const src = triggerSource ?? (process.trigger_kind === 'cron' ? 'cron' : 'interval');
    if (bp.kind === 'collect') await this.runCollectSweep(src, process);
    else if (bp.kind === 'recheck') await this.runRecheckSweep(src, process);
    else {
      logger.warn(`[scheduler] 进程#${process.id} 图纸 kind=${bp.kind} 不可调度，跳过`);
      return;
    }
    // 记账：runs_total++ / last_run_at / next_run_at=null（防本次运行完成前被重复触发）
    await this.processes.markFired(process.id, nowSec());
    // 空轮已收尾（进程无 running run）→ 立即重排；非空运行仍在跑 → 交 finalizeRunningRuns 完成后重排。
    if (!(await this.runs.hasRunningRunForProcess(process.id))) await this.scheduleNext(process);
  }

  /** 收尾所有任务已全部终结的运行（completed / failed），并为其进程重排下一轮。 */
  async finalizeRunningRuns(): Promise<void> {
    const running = await this.runs.listRunningRuns();
    for (const run of running) {
      const counts = await this.tasks.countByRun(run.id);
      // 仍有未终结任务（含 paused 闸门停等）或运行暂无任务 → 继续等下一轮心跳
      if (counts.total === 0 || counts.active > 0) continue;
      const status = counts.failed > 0 ? 'failed' : 'completed';
      await this.runs.finishRun(
        run.id,
        status,
        nowSec(),
        status === 'failed' ? '部分任务失败（见任务树）' : null,
      );
      if (run.process_id != null) {
        const proc = await this.processes.getProcess(run.process_id);
        if (proc) await this.scheduleNext(proc);
      }
    }
  }

  /** 为进程排下一轮触发时刻（interval / cron 续期；once / 已暂停则置空）。 */
  private async scheduleNext(process: ProcessRow): Promise<void> {
    await this.processes.setNextRunAt(process.id, computeNextRunAt(process, nowSec()), nowSec());
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
        buildStages('translate'),
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

  /** 运行前挂 / 摘某环节暂停点（仅 pending 环节可改）。返回是否生效。 */
  async toggleStageGate(taskId: number, seq: number, gate: boolean): Promise<boolean> {
    return this.taskStages.setStageGate(taskId, seq, gate);
  }
}
