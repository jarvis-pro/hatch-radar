import {
  BlueprintsRepository,
  PostsRepository,
  RunsRepository,
  RuntimeSettingsService,
  TasksRepository,
  type BlueprintRow,
} from '@hatch-radar/db';
import { AnalysisConfigService } from '@hatch-radar/analysis';
import type { Dispatcher } from '@hatch-radar/kernel';
import { logger, nowSec } from '@hatch-radar/kernel';
import { INSPECT_STEP_NAMES } from '@hatch-radar/shared';

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
    private readonly posts: PostsRepository,
    private readonly analysisConfig: AnalysisConfigService,
    private readonly runtimeSettings: RuntimeSettingsService,
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
}
