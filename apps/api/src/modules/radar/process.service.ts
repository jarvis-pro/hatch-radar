import { Injectable } from '@nestjs/common';
import {
  BlueprintsRepository,
  ProcessesRepository,
  RunsRepository,
  type UpdateProcessInput,
} from '@/database';
import { ValidationError } from '@/common/errors';
import { nowSec } from '@/utils/time';
import type { BlueprintKind, ProcessDTO, RunDTO, TriggerConfig } from '@hatch-radar/shared';
import { PipelineService } from '../pipeline/pipeline.service';
import { toProcessDTO, toRunDTO, triggerToRepo } from './radar.mappers';

const PROCESS_RUNS_LIMIT = 50;

/**
 * 进程（图纸 + 触发节奏）CRUD + 启停 / 手动触发 + 运行历史服务。
 *
 * 从原 RadarService 拆出（关注点：进程编排）。触发委托 {@link PipelineService.fireProcess}；
 * 图纸 CRUD 见 {@link BlueprintService}，指挥室聚合 / 只读视图见 RadarService。
 */
@Injectable()
export class ProcessService {
  constructor(
    private readonly processes: ProcessesRepository,
    private readonly blueprints: BlueprintsRepository,
    private readonly runs: RunsRepository,
    private readonly pipeline: PipelineService,
  ) {}

  /**
   * 列出全部进程（已合成所属图纸的 kind）。
   * - 图纸缺失时 kind 回退为 'collect'
   * @returns 进程 DTO 列表；无进程时为空数组
   */
  async listProcesses(): Promise<ProcessDTO[]> {
    const [procs, bps] = await Promise.all([
      this.processes.listProcesses(),
      this.blueprints.listBlueprints(),
    ]);
    const kindById = new Map(bps.map((b) => [b.id, b.kind as BlueprintKind]));

    return procs.map((p) => toProcessDTO(p, kindById.get(p.blueprint_id) ?? 'collect'));
  }

  /**
   * 按 id 取单个进程（已合成图纸 kind，缺失时回退 'collect'）。
   * @param id 进程 id
   * @returns 进程 DTO；不存在时返回 null
   */
  async getProcess(id: number): Promise<ProcessDTO | null> {
    const p = await this.processes.getProcess(id);
    if (!p) {
      return null;
    }

    const bp = await this.blueprints.getBlueprint(p.blueprint_id);

    return toProcessDTO(p, (bp?.kind as BlueprintKind) ?? 'collect');
  }

  /**
   * 新建进程：绑定一份图纸 + 触发节奏。
   * - once 触发不自动开跑（next_run_at 置空）；interval/cron 置为「即刻到期」，由首个调度心跳触发
   * @param input.blueprintId 绑定的图纸 id（必须存在）
   * @param input.label 展示名
   * @param input.trigger 触发配置（once / interval / cron）
   * @returns 落库后的进程 DTO
   * @throws ValidationError 绑定的图纸不存在
   */
  async createProcess(input: {
    blueprintId: number;
    label: string;
    trigger: TriggerConfig;
  }): Promise<ProcessDTO> {
    const bp = await this.blueprints.getBlueprint(input.blueprintId);
    if (!bp) {
      throw new ValidationError('绑定的图纸不存在');
    }

    const { triggerKind, triggerConfig } = triggerToRepo(input.trigger);
    // once 不自动触发；interval/cron 稍后即到期（首个心跳触发）
    const nextRunAt = input.trigger.kind === 'once' ? null : nowSec();
    const p = await this.processes.createProcess(
      { blueprintId: input.blueprintId, label: input.label, triggerKind, triggerConfig, nextRunAt },
      nowSec(),
    );

    return toProcessDTO(p, bp.kind as BlueprintKind);
  }

  /**
   * 局部更新进程的标签 / 触发节奏。
   * - 仅覆盖 patch 中给出的字段
   * - 改触发节奏时，active 进程会被重排下次触发（once 置空、其余置即刻到期）；非 active 进程不重排
   * @param id 进程 id
   * @param patch 仅含需更新的字段
   */
  async updateProcess(
    id: number,
    patch: { label?: string; trigger?: TriggerConfig },
  ): Promise<void> {
    const repoPatch: UpdateProcessInput = {};
    if (patch.label !== undefined) {
      repoPatch.label = patch.label;
    }

    if (patch.trigger) {
      const { triggerKind, triggerConfig } = triggerToRepo(patch.trigger);
      repoPatch.triggerKind = triggerKind;
      repoPatch.triggerConfig = triggerConfig;
      // 改了节奏：active 进程重排到「即将触发」，once 置空
      const p = await this.processes.getProcess(id);
      if (p?.status === 'active') {
        repoPatch.nextRunAt = patch.trigger.kind === 'once' ? null : nowSec();
      }
    }

    await this.processes.updateProcess(id, repoPatch, nowSec());
  }

  /**
   * 暂停进程：status=paused + next_run_at=null（停止自动触发）。
   * @param id 进程 id
   */
  async pauseProcess(id: number): Promise<void> {
    await this.processes.setStatus(id, 'paused', nowSec());
    await this.processes.setNextRunAt(id, null, nowSec());
  }

  /**
   * 恢复进程：status=active + 重排下次触发（once 仍置空）。
   * @param id 进程 id
   */
  async resumeProcess(id: number): Promise<void> {
    const p = await this.processes.getProcess(id);
    if (!p) {
      return;
    }

    await this.processes.setStatus(id, 'active', nowSec());
    await this.processes.setNextRunAt(id, p.trigger_kind === 'once' ? null : nowSec(), nowSec());
  }

  /**
   * 手动触发进程一次（绕过节奏，委托 PipelineService.fireProcess(manual)）。
   * - 已有进行中运行时拒绝，避免并发重复触发
   * @param id 进程 id
   * @throws ValidationError 进程不存在，或该进程已有进行中的运行
   */
  async triggerProcess(id: number): Promise<void> {
    const p = await this.processes.getProcess(id);
    if (!p) {
      throw new ValidationError('进程不存在');
    }

    if (await this.runs.hasRunningRunForProcess(id)) {
      throw new ValidationError('该进程已有进行中的运行');
    }

    await this.pipeline.fireProcess(p, 'manual');
  }

  /**
   * 删除进程。
   * - 不校验是否有进行中的运行
   * @param id 进程 id
   */
  async deleteProcess(id: number): Promise<void> {
    await this.processes.deleteProcess(id);
  }

  /**
   * 单个进程的运行历史（最多 50 条）。
   * @param processId 进程 id
   * @returns process=进程 DTO（不存在时为 null）；runs=运行列表（已合成图纸 / 进程标签）
   */
  async processRuns(processId: number): Promise<{ process: ProcessDTO | null; runs: RunDTO[] }> {
    const process = await this.getProcess(processId);
    const rows = await this.runs.listByProcess(processId, PROCESS_RUNS_LIMIT);
    const bp = process ? await this.blueprints.getBlueprint(process.blueprintId) : null;

    return {
      process,
      runs: rows.map((r) => toRunDTO(r, bp?.label ?? null, process?.label ?? null)),
    };
  }
}
