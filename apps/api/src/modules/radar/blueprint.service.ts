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
    // 图纸仓储：图纸增删改查
    private readonly blueprints: BlueprintsRepository,
    // 进程仓储：删除前校验图纸是否仍被进程引用
    private readonly processes: ProcessesRepository,
  ) {}

  /**
   * 列出全部图纸。
   * @returns 图纸 DTO 列表；无图纸时为空数组
   */
  async listBlueprints(): Promise<BlueprintDTO[]> {
    return (await this.blueprints.listBlueprints()).map(toBlueprintDTO);
  }

  /**
   * 按 id 取单个图纸。
   * @param id 图纸 id
   * @returns 图纸 DTO；不存在时返回 null
   */
  async getBlueprint(id: number): Promise<BlueprintDTO | null> {
    const b = await this.blueprints.getBlueprint(id);

    return b ? toBlueprintDTO(b) : null;
  }

  /**
   * 新建一份图纸（纯配方，不绑定到任何进程）。
   * @param input.kind 图纸类型（采集 / 分析 / 复查 / 翻译等），决定 params 与各环节的语义
   * @param input.label 展示名
   * @param input.note 备注；可空
   * @param input.sources 数据源配置，按图纸类型解释（jsonb 原样存储）
   * @param input.params 该类型的执行参数（jsonb 原样存储）
   * @param input.gates 开启后在该环节前暂停的闸门环节 key 列表
   * @param input.enabledStages 启用的环节 key 列表
   * @returns 落库后的图纸 DTO（含分配的 id 与创建时间）
   */
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

  /**
   * 局部更新图纸字段。
   * - 仅覆盖 patch 中给出的键，省略的字段保持原值
   * - 不校验是否被进程引用；改动即时对后续新建的任务生效
   * @param id 图纸 id
   * @param patch 仅含需更新的字段
   */
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

  /**
   * 删除图纸；仍被进程引用时拒绝删除。
   * @param id 图纸 id
   * @throws ValidationError 该图纸仍被至少一个进程引用（需先删除其进程）
   */
  async deleteBlueprint(id: number): Promise<void> {
    const used = (await this.processes.listProcesses(id)).length > 0;
    if (used) {
      throw new ValidationError('该图纸仍被进程引用，请先删除其进程');
    }

    await this.blueprints.deleteBlueprint(id);
  }
}
