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

  async listProcesses(): Promise<ProcessDTO[]> {
    const [procs, bps] = await Promise.all([
      this.processes.listProcesses(),
      this.blueprints.listBlueprints(),
    ]);
    const kindById = new Map(bps.map((b) => [b.id, b.kind as BlueprintKind]));
    return procs.map((p) => toProcessDTO(p, kindById.get(p.blueprint_id) ?? 'collect'));
  }

  async getProcess(id: number): Promise<ProcessDTO | null> {
    const p = await this.processes.getProcess(id);
    if (!p) {
      return null;
    }
    const bp = await this.blueprints.getBlueprint(p.blueprint_id);
    return toProcessDTO(p, (bp?.kind as BlueprintKind) ?? 'collect');
  }

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

  /** 暂停进程：status=paused + next_run_at=null（停止自动触发）。 */
  async pauseProcess(id: number): Promise<void> {
    await this.processes.setStatus(id, 'paused', nowSec());
    await this.processes.setNextRunAt(id, null, nowSec());
  }

  /** 恢复进程：status=active + 重排下次触发（once 仍置空）。 */
  async resumeProcess(id: number): Promise<void> {
    const p = await this.processes.getProcess(id);
    if (!p) {
      return;
    }
    await this.processes.setStatus(id, 'active', nowSec());
    await this.processes.setNextRunAt(id, p.trigger_kind === 'once' ? null : nowSec(), nowSec());
  }

  /** 手动触发一次：已有进行中运行则拒绝；否则 fireProcess(manual)。 */
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

  async deleteProcess(id: number): Promise<void> {
    await this.processes.deleteProcess(id);
  }

  /** 单进程的运行历史。 */
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
