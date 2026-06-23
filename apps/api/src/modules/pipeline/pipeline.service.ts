import { Inject, Injectable } from '@nestjs/common';
import { LocalDispatcher } from '../worker/local-dispatcher';
import {
  BlueprintsRepository,
  PostsRepository,
  ProcessesRepository,
  RunsRepository,
  TasksRepository,
  type BlueprintRow,
  type ProcessRow,
  type NewTaskInput,
} from '@/database';
import { CronExpressionParser } from 'cron-parser';
import { RuntimeSettingsService } from '../settings/runtime-settings.service';
import { AnalysisConfigService } from '../analysis/analysis-config.service';
import type { Dispatcher } from '@/modules/worker/protocol';
import { logger } from '@/logger';
import { nowSec } from '@/utils/time';
import { buildStages, type StageRecipe, type TaskKind } from '@hatch-radar/shared';

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
  if (process.status !== 'active' || process.trigger_kind === 'once') {
    return null;
  }
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
 * 图纸执行编排：把一次图纸触发落成「建 run → 派生 task」，再交 dispatcher 在同进程认领执行。
 *
 * 取代旧 {@link AnalysisConfigService.enqueueAutoAnalysisRound}（直接入 analysis_jobs）——
 * 自动分析改由 tasks 承载、归属 run/blueprint，可在「图纸 / 进程」视图回看，成本经 UNION 进看板。
 * collect / recheck 图纸在后续里程碑接入本服务。
 */
@Injectable()
export class PipelineService {
  constructor(
    private readonly blueprints: BlueprintsRepository,
    private readonly runs: RunsRepository,
    private readonly tasks: TasksRepository,
    private readonly posts: PostsRepository,
    private readonly analysisConfig: AnalysisConfigService,
    private readonly runtimeSettings: RuntimeSettingsService,
    private readonly processes: ProcessesRepository,
    @Inject(LocalDispatcher) private readonly dispatcher?: Dispatcher,
  ) {}

  /** 找或建一张指定 kind 的默认图纸（首次触发时惰性种子，免单独 seeder）。 */
  private async ensureBlueprint(kind: TaskKind, label: string): Promise<BlueprintRow> {
    const existing = (await this.blueprints.listBlueprints(kind))[0];
    if (existing) {
      return existing;
    }
    return this.blueprints.createBlueprint({ kind, label }, nowSec());
  }

  /**
   * 自动分析一轮（取代旧 enqueueAutoAnalysisRound）：选 active 模型 → 取待分析帖 → 建 analyze 进程 +
   * 逐帖派生 analyze 任务（同帖已有活跃任务则由 createTaskWithStages 去重跳过）→ 触发派发。
   * @param triggerSource 触发来源（cron / manual）
   */
  async runAnalyzeSweep(triggerSource = 'cron'): Promise<AnalyzeSweepResult> {
    const active = await this.analysisConfig.getActiveProvider();
    if (!active) {
      return { active: null, runId: null, created: 0, pending: 0 };
    }

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
    try {
      const inputs = posts.map(
        (p): NewTaskInput => ({
          runId: run.id,
          kind: 'analyze',
          postId: p.id,
          providerId: active.id,
          model: active.model,
        }),
      );
      ({ created } = await this.tasks.createTasksBatchSameStages(inputs, ANALYZE_STAGES, nowSec()));
    } finally {
      // 收尾恒执行：即使派生循环中途抛错，也要让 sweep run 落终态——否则无任务的 run 会永久 running
      // （finalizeRunningRuns 对 total===0 的 run 不收尾）。sweep run = 派生批次，派生即 completed。
      await this.runs.incrementCounters(run.id, { total: created });
      await this.runs.finishRun(run.id, 'completed', nowSec());
      if (created > 0) {
        void this.dispatcher?.tryDispatch();
        logger.info(`[pipeline] analyze 进程#${run.id} 派生 ${created} 个分析任务`);
      }
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
    if (!bp) {
      throw new Error(`进程#${process?.id} 绑定的图纸不存在`);
    }
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
    if (res.ok) {
      await this.runs.incrementCounters(run.id, { total: 1 });
      void this.dispatcher?.tryDispatch();
      logger.info(`[pipeline] collect 运行#${run.id} 已创建 discover 任务`);
    } else {
      // discover 被去重（已有活跃任务）：本运行无任务，即时收尾免留永久 running（finalize 不收尾空 run）。
      await this.runs.finishRun(run.id, 'completed', nowSec());
    }
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
    if (!bp) {
      throw new Error(`进程#${process?.id} 绑定的图纸不存在`);
    }
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
    try {
      const inputs = posts.map(
        (p): NewTaskInput => ({
          runId: run.id,
          processId: process?.id ?? null,
          kind: 'recheck',
          postId: p.id,
          params: { sweep },
        }),
      );
      ({ created } = await this.tasks.createTasksBatchSameStages(
        inputs,
        buildStages('recheck', recipe),
        nowSec(),
      ));
    } finally {
      // 收尾恒执行：派生循环抛错时，空轮（created===0）必须即时收尾，否则无任务的 run 永久 running
      // （finalizeRunningRuns 对 total===0 不收尾）；非空运行交 finalizeRunningRuns 在任务全终结后收尾。
      await this.runs.incrementCounters(run.id, { total: created });
      if (created === 0) {
        await this.runs.finishRun(run.id, 'completed', nowSec());
      } else {
        void this.dispatcher?.tryDispatch();
        logger.info(
          `[pipeline] recheck sweep#${sweep} 运行#${run.id} 派生 ${created} 复查任务（${posts.length} 到期）`,
        );
      }
    }
    return { runId: run.id, sweep, due: posts.length };
  }

  // ─── 进程调度（取代旧 4 个 @Cron；由 SchedulerService 心跳每若干秒调用）──────────────────

  /** 触发所有到期进程：active 且 next_run_at ≤ now、且当前无进行中运行（按进程非重入）。 */
  async fireDueProcesses(): Promise<void> {
    const due = await this.processes.listDue(nowSec());
    for (const process of due) {
      if (await this.runs.hasRunningRunForProcess(process.id)) {
        continue;
      }
      // 单个进程触发失败不应中断整轮——隔离记错，余下到期进程照常触发。
      try {
        await this.fireProcess(process);
      } catch (e) {
        logger.error(
          `[scheduler] 进程#${process.id} 触发失败：${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  /** 触发单个进程：按图纸 kind 开 collect / recheck 运行 + 记账（markFired）；空轮即时重排下一轮。 */
  async fireProcess(process: ProcessRow, triggerSource?: string): Promise<void> {
    const bp = await this.blueprints.getBlueprint(process.blueprint_id);
    if (!bp) {
      logger.warn(`[scheduler] 进程#${process.id} 绑定图纸缺失，跳过`);
      return;
    }
    if (bp.kind !== 'collect' && bp.kind !== 'recheck') {
      logger.warn(`[scheduler] 进程#${process.id} 图纸 kind=${bp.kind} 不可调度，跳过`);
      return;
    }
    const src = triggerSource ?? (process.trigger_kind === 'cron' ? 'cron' : 'interval');
    try {
      if (bp.kind === 'collect') {
        await this.runCollectSweep(src, process);
      } else {
        await this.runRecheckSweep(src, process);
      }
    } finally {
      // 记账恒执行：即使 sweep 抛错，也要 markFired + 重排——否则 next_run_at 停在过去，该进程会被
      // 反复当作到期触发，或被 hasRunningRunForProcess 永久挡住从此卡死。
      await this.processes.markFired(process.id, nowSec());
      // 空轮已收尾（进程无 running run）→ 立即重排；非空运行仍在跑 → 交 finalizeRunningRuns 完成后重排。
      if (!(await this.runs.hasRunningRunForProcess(process.id))) {
        await this.scheduleNext(process);
      }
    }
  }

  /** 收尾所有任务已全部终结的运行（completed / failed），并为其进程重排下一轮。 */
  async finalizeRunningRuns(): Promise<void> {
    const running = await this.runs.listRunningRuns();
    for (const run of running) {
      try {
        const counts = await this.tasks.countByRun(run.id);
        // 仍有未终结任务（含 paused 闸门停等）或运行暂无任务 → 继续等下一轮心跳
        if (counts.total === 0 || counts.active > 0) {
          continue;
        }
        const status = counts.failed > 0 ? 'failed' : 'completed';
        await this.runs.finishRun(
          run.id,
          status,
          nowSec(),
          status === 'failed' ? '部分任务失败（见任务树）' : null,
        );
        if (run.process_id != null) {
          const proc = await this.processes.getProcess(run.process_id);
          if (proc) {
            await this.scheduleNext(proc);
          }
        }
      } catch (e) {
        // 单个 run 收尾失败不阻断其余 run（下一轮心跳重试本 run）。
        logger.error(
          `[scheduler] 运行#${run.id} 收尾失败：${e instanceof Error ? e.message : String(e)}`,
        );
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
    if (postIds.length === 0) {
      return { enqueued: 0 };
    }
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
    try {
      const inputs = [...new Set(postIds)].map(
        (id): NewTaskInput => ({
          runId: run.id,
          kind: 'translate',
          postId: id,
          providerId,
          model,
        }),
      );
      ({ created: enqueued } = await this.tasks.createTasksBatchSameStages(
        inputs,
        buildStages('translate'),
        nowSec(),
      ));
    } finally {
      // 收尾恒执行（同 analyze sweep）：派生抛错也让 run 落终态，免空 run 永久 running。
      await this.runs.incrementCounters(run.id, { total: enqueued });
      await this.runs.finishRun(run.id, 'completed', nowSec());
      if (enqueued > 0) {
        void this.dispatcher?.tryDispatch();
      }
    }
    return { enqueued };
  }
}
