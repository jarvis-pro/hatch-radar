import { Inject, Injectable } from '@nestjs/common';
import { LocalDispatcher } from '@/modules/worker/local-dispatcher';
import {
  BlueprintsRepository,
  PostsRepository,
  ProvidersRepository,
  RunsRepository,
  TasksRepository,
  TaskStagesRepository,
  type BlueprintRow,
} from '@/database';
import { ValidationError } from '@/common/errors';
import type { Dispatcher } from '@/modules/worker/protocol';
import { nowSec } from '@/utils/time';
import {
  INSPECT_STEP_NAMES,
  type InspectJobView,
  type InspectStepView,
  type TaskKind,
} from '@hatch-radar/shared';

/**
 * 任务逐环节交互控制（流水线检视器：单条手动 / 逐环节暂停）。
 *
 * 从 {@link PipelineService} 抽出——后者专注「图纸触发 → 建 run → 派生 task」与进程调度 / sweep 收尾，
 * 本服务专注「已有任务的逐环节交互」：发起检视、组装视图、放行 / 运行到底 / 重试 / 取消 / 挂摘闸门。
 *
 * 检视 = 带闸门的 analyze 任务：复用 tasks/task_stages 同一执行内核（worker 逐环节落检查点、遇闸门置
 * paused）。取代旧 analysis_jobs(inspect=true) 专路；视图沿用 InspectJobView 契约。
 * dispatcher 为可选（接口令牌注入）——保持与 PipelineService 一致的进程内派发解耦契约。
 */
@Injectable()
export class TaskControlService {
  constructor(
    // 图纸仓储：惰性种子检视所属的默认 analyze 图纸
    private readonly blueprints: BlueprintsRepository,
    // 运行仓储：为检视任务建并收尾承载 run
    private readonly runs: RunsRepository,
    // 任务仓储：建检视任务、放行 / 重排 / 取消
    private readonly tasks: TasksRepository,
    // 环节仓储：组装环节轨迹、清 / 设闸门、复位失败环节
    private readonly taskStages: TaskStagesRepository,
    // 帖子仓储：校验目标帖存在、取帖子标题
    private readonly posts: PostsRepository,
    // 模型配置仓储：校验模型存在 / 启用、取模型名快照
    private readonly providers: ProvidersRepository,
    // 进程内派发器：放行 / 重试后触发认领泵（接口令牌、可选）
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
   * 发起检视任务：建 analyze 任务（检视器 6 环节）；stepGate=true 时每环节挂闸门（逐环节暂停），
   * false 则运行到底＋留痕。该帖已有活跃 analyze 任务时由 createTaskWithStages 去重拒绝（抛 400）。
   * @param postId 目标帖子 id
   * @param providerId 分析所用模型配置 id（model_providers.id）
   * @param stepGate true=每环节挂闸门逐步暂停；false=一口气运行到底
   * @returns 新建任务 id（成功）；校验 / 去重失败抛 {@link DomainError}（400）。
   */
  async enqueueInspect(
    postId: string,
    providerId: number,
    stepGate: boolean,
  ): Promise<{ taskId: number }> {
    const provider = await this.providers.getProvider(providerId);
    if (!provider) {
      throw new ValidationError('模型配置不存在');
    }

    if (!provider.enabled) {
      throw new ValidationError('该模型已停用');
    }

    const post = await this.posts.getPostById(postId);
    if (!post) {
      throw new ValidationError('帖子不存在');
    }

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
      throw new ValidationError(res.error);
    }

    await this.runs.incrementCounters(run.id, { total: 1 });
    await this.runs.finishRun(run.id, 'completed', nowSec());
    void this.dispatcher?.tryDispatch();

    return { taskId: res.taskId };
  }

  /**
   * 取检视任务视图：任务元信息 + 各环节轨迹（InspectJobView 形状，时间戳 number、output 已解析）。
   * @param taskId 任务 id
   * @returns 检视视图；任务不存在时返回 null
   */
  async getInspectView(taskId: number): Promise<InspectJobView | null> {
    const task = await this.tasks.getTask(taskId);
    if (!task) {
      return null;
    }

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

  /**
   * 放行下一环节：paused→queued + 派发。
   * @param taskId 任务 id
   * @returns 是否实际放行（false = 当前并非暂停态）
   */
  async resumeInspect(taskId: number): Promise<boolean> {
    const ok = await this.tasks.resumeTask(taskId);
    if (ok) {
      void this.dispatcher?.tryDispatch();
    }

    return ok;
  }

  /**
   * 运行到底：清除全部环节闸门、若暂停则放行；worker 回读已清的闸门后连续跑完剩余环节（仍留轨迹）。
   * @param taskId 任务 id
   */
  async runInspectToEnd(taskId: number): Promise<void> {
    await this.taskStages.clearGates(taskId);
    await this.tasks.resumeTask(taskId); // 暂停则放行；运行中为 no-op（worker 自会回读清掉的闸门续跑）
    void this.dispatcher?.tryDispatch();
  }

  /**
   * 重试当前失败环节：失败环节复位 pending、任务 failed→queued + 派发。
   * 当前不可重试（任务不存在 / 并非失败态 / 重排失败）时抛 {@link DomainError}（400）。
   * @param taskId 任务 id
   */
  async retryInspectStep(taskId: number): Promise<void> {
    const task = await this.tasks.getTask(taskId);
    if (!task) {
      throw new ValidationError('任务不存在');
    }

    if (task.status !== 'failed') {
      throw new ValidationError('当前不可重试（任务并非失败态）');
    }

    await this.taskStages.resetStageToPending(taskId, task.current_seq);
    const ok = await this.tasks.requeueFailedTask(taskId);
    if (!ok) {
      throw new ValidationError('当前不可重试');
    }

    void this.dispatcher?.tryDispatch();
  }

  /**
   * 取消检视任务：活跃态（queued/running/paused）→ canceled。
   * @param taskId 任务 id
   * @returns 是否取消（false = 当前已是终态）
   */
  async cancelInspect(taskId: number): Promise<boolean> {
    return this.tasks.cancelTask(taskId, nowSec());
  }

  /**
   * 运行前挂 / 摘某环节暂停点（仅 pending 环节可改）。
   * @param taskId 任务 id
   * @param seq 环节序号（task_stages.seq）
   * @param gate true=挂闸门（执行前暂停）；false=摘除
   * @returns 是否生效（false = 该环节非 pending、不可改）
   */
  async toggleStageGate(taskId: number, seq: number, gate: boolean): Promise<boolean> {
    return this.taskStages.setStageGate(taskId, seq, gate);
  }
}
