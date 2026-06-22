import { Injectable } from '@nestjs/common';
import { BlueprintsRepository, ProcessesRepository } from '@/database';
import { ValidationError } from '@/common/errors';
import { nowSec } from '@/utils/time';
import type { BlueprintDTO, BlueprintKind } from '@hatch-radar/shared';
import { toBlueprintDTO } from './radar.mappers';

/**
 * 图纸（纯配方）CRUD 服务。
 *
 * 从原 RadarService 拆出（关注点：图纸定义）。删除时校验是否仍被进程引用（经 ProcessesRepository）。
 * 进程 CRUD/触发见 {@link ProcessService}，指挥室聚合 / 只读视图见 RadarService。
 */
@Injectable()
export class BlueprintService {
  constructor(
    private readonly blueprints: BlueprintsRepository,
    private readonly processes: ProcessesRepository,
  ) {}

  async listBlueprints(): Promise<BlueprintDTO[]> {
    return (await this.blueprints.listBlueprints()).map(toBlueprintDTO);
  }

  async getBlueprint(id: number): Promise<BlueprintDTO | null> {
    const b = await this.blueprints.getBlueprint(id);
    return b ? toBlueprintDTO(b) : null;
  }

  async createBlueprint(input: {
    kind: BlueprintKind;
    label: string;
    note?: string | null;
    sources?: unknown;
    params?: unknown;
    gates?: string[];
    enabledStages?: string[];
  }): Promise<BlueprintDTO> {
    const b = await this.blueprints.createBlueprint(input, nowSec());
    return toBlueprintDTO(b);
  }

  async updateBlueprint(
    id: number,
    patch: {
      label?: string;
      note?: string | null;
      sources?: unknown;
      params?: unknown;
      gates?: string[];
      enabledStages?: string[];
    },
  ): Promise<void> {
    await this.blueprints.updateBlueprint(id, patch, nowSec());
  }

  /** 删图纸：被进程引用则拒绝（抛 400），否则删除。 */
  async deleteBlueprint(id: number): Promise<void> {
    const used = (await this.processes.listProcesses(id)).length > 0;
    if (used) throw new ValidationError('该图纸仍被进程引用，请先删除其进程');
    await this.blueprints.deleteBlueprint(id);
  }
}
