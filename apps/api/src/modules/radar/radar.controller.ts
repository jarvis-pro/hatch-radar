import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '@/modules/account/auth-user.decorator';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import { BlueprintService } from '@/modules/radar/blueprint.service';
import { ProcessService } from '@/modules/radar/process.service';
import { RadarService } from '@/modules/radar/radar.service';
import { logger } from '@/logger';
import type { RadarIntensity } from '@hatch-radar/shared';

/** 图纸的一个采集来源项：平台 + 该平台下的频道/版块清单。 */
const sourceSchema = z.object({
  /** 来源平台 */
  kind: z.enum(['reddit', 'hackernews', 'rss']),
  /** 该平台下要抓的频道 / 版块 / RSS 地址列表 */
  channels: z.array(z.string()),
});

/** 新建图纸（纯配方）入参：类型 + 标识 + 采集来源 + 参数 + 闸门 + 启用节点。 */
const createBlueprintSchema = z.object({
  /** 图纸类型：collect 采集 / recheck 复查 */
  kind: z.enum(['collect', 'recheck']),
  /** 图纸展示名，非空 */
  label: z.string().trim().min(1),
  /** 备注说明；省略=无 */
  note: z.string().trim().optional(),
  /** 采集来源清单（collect 用）；省略=无来源 */
  sources: z.array(sourceSchema).optional(),
  /** 图纸参数（间隔 / 退避 / 阈值等），自由 KV；省略=默认 */
  params: z.record(z.string(), z.unknown()).optional(),
  /** 默认开闸的节点 key 列表（逐节点暂停）；省略=不开闸 */
  gates: z.array(z.string()).optional(),
  /** 启用的执行节点 key 列表；省略=全部节点 */
  enabledStages: z.array(z.string()).optional(),
});

/** 更新图纸入参：每项可省略（不改）；kind 不可改（建后固定）。 */
const updateBlueprintSchema = z.object({
  /** 改展示名（非空）；省略=不改 */
  label: z.string().trim().min(1).optional(),
  /** 改备注；省略=不改 */
  note: z.string().trim().optional(),
  /** 改采集来源（整体覆盖）；省略=不改 */
  sources: z.array(sourceSchema).optional(),
  /** 改图纸参数（整体覆盖）；省略=不改 */
  params: z.record(z.string(), z.unknown()).optional(),
  /** 改开闸节点（整体覆盖）；省略=不改 */
  gates: z.array(z.string()).optional(),
  /** 改启用节点（整体覆盖）；省略=不改 */
  enabledStages: z.array(z.string()).optional(),
});

/** 进程触发节奏（按 kind 判别）：单次 / 固定间隔 / cron 表达式。 */
const triggerSchema = z.discriminatedUnion('kind', [
  /** once：手动单次触发，无额外参数 */
  z.object({ kind: z.literal('once') }),
  /** interval：每 everySec 秒触发一次 */
  z.object({ kind: z.literal('interval'), everySec: z.number().int().positive() }),
  /** cron：按 expr（cron 表达式）触发 */
  z.object({ kind: z.literal('cron'), expr: z.string().trim().min(1) }),
]);

/** 新建进程（图纸 + 触发节奏）入参。 */
const createProcessSchema = z.object({
  /** 绑定的图纸 id（blueprints.id） */
  blueprintId: z.number().int().positive(),
  /** 进程展示名，非空 */
  label: z.string().trim().min(1),
  /** 触发节奏 */
  trigger: triggerSchema,
});

/** 更新进程入参：每项可省略（不改）；不可改绑定图纸。 */
const updateProcessSchema = z.object({
  /** 改展示名（非空）；省略=不改 */
  label: z.string().trim().min(1).optional(),
  /** 改触发节奏；省略=不改 */
  trigger: triggerSchema.optional(),
});

/**
 * /api/blueprints/* —— 图纸（纯配方）CRUD。读 pipeline:run，写 pipeline:control。
 */
@RequirePermission('pipeline:run')
@Controller('blueprints')
export class BlueprintsController {
  constructor(private readonly blueprints: BlueprintService) {}

  @Get()
  list() {
    return this.blueprints.listBlueprints();
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const bp = await this.blueprints.getBlueprint(id);
    if (!bp) {
      throw new NotFoundException('图纸不存在');
    }

    return bp;
  }

  @Post()
  @RequirePermission('pipeline:control')
  async create(
    @Body(new ZodValidationPipe(createBlueprintSchema)) dto: z.infer<typeof createBlueprintSchema>,
  ) {
    const bp = await this.blueprints.createBlueprint(dto);
    logger.info(`[图纸] 新建 #${bp.id}：${bp.kind}/${bp.label}`);

    return bp;
  }

  @Patch(':id')
  @RequirePermission('pipeline:control')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateBlueprintSchema)) dto: z.infer<typeof updateBlueprintSchema>,
  ) {
    if (!(await this.blueprints.getBlueprint(id))) {
      throw new NotFoundException('图纸不存在');
    }

    await this.blueprints.updateBlueprint(id, dto);

    return { ok: true };
  }

  @Delete(':id')
  @RequirePermission('pipeline:control')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.blueprints.deleteBlueprint(id);
    logger.info(`[图纸] 删除 #${id}`);

    return { ok: true };
  }
}

/**
 * /api/processes/* —— 进程（图纸 + 触发节奏）CRUD + 暂停/恢复/触发。
 * 读 + 触发 pipeline:run；编辑/启停/删除 pipeline:control。
 */
@RequirePermission('pipeline:run')
@Controller('processes')
export class ProcessesController {
  constructor(private readonly processes: ProcessService) {}

  @Get()
  list() {
    return this.processes.listProcesses();
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const p = await this.processes.getProcess(id);
    if (!p) {
      throw new NotFoundException('进程不存在');
    }

    return p;
  }

  @Get(':id/runs')
  runs(@Param('id', ParseIntPipe) id: number) {
    return this.processes.processRuns(id);
  }

  @Post()
  @RequirePermission('pipeline:control')
  async create(
    @Body(new ZodValidationPipe(createProcessSchema)) dto: z.infer<typeof createProcessSchema>,
  ) {
    const res = await this.processes.createProcess(dto);
    logger.info(`[进程] 新建 #${res.id}：${res.label}`);

    return res;
  }

  @Patch(':id')
  @RequirePermission('pipeline:control')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateProcessSchema)) dto: z.infer<typeof updateProcessSchema>,
  ) {
    if (!(await this.processes.getProcess(id))) {
      throw new NotFoundException('进程不存在');
    }

    await this.processes.updateProcess(id, dto);

    return { ok: true };
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermission('pipeline:control')
  async pause(@Param('id', ParseIntPipe) id: number) {
    await this.processes.pauseProcess(id);

    return { ok: true };
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermission('pipeline:control')
  async resume(@Param('id', ParseIntPipe) id: number) {
    await this.processes.resumeProcess(id);

    return { ok: true };
  }

  @Post(':id/trigger')
  @HttpCode(200)
  async trigger(@Param('id', ParseIntPipe) id: number) {
    await this.processes.triggerProcess(id);
    logger.info(`[进程] 手动触发 #${id}`);

    return { ok: true };
  }

  @Delete(':id')
  @RequirePermission('pipeline:control')
  async remove(@Param('id', ParseIntPipe) id: number) {
    if (!(await this.processes.getProcess(id))) {
      throw new NotFoundException('进程不存在');
    }

    await this.processes.deleteProcess(id);
    logger.info(`[进程] 删除 #${id}`);

    return { ok: true };
  }
}

const INTENSITIES: readonly RadarIntensity[] = ['high', 'medium', 'low'];

/**
 * /api/radar/* —— 雷达指挥室只读 / 聚合视图（鉴权 pipeline:run）。
 * 指挥室聚合 / lane 概览 / 运行详情 / 收成洞察 / 帖子库 / 帖子一生。
 */
@RequirePermission('pipeline:run')
@Controller('radar')
export class RadarController {
  constructor(private readonly radar: RadarService) {}

  @Get('control-room')
  controlRoom() {
    return this.radar.controlRoom();
  }

  @Get('lanes')
  lanes() {
    return this.radar.lanes();
  }

  @Get('runs/:id')
  async runDetail(@Param('id', ParseIntPipe) id: number) {
    const res = await this.radar.runDetail(id);
    if (!res) {
      throw new NotFoundException('运行不存在');
    }

    return res;
  }

  // 浏览端点（洞察 / 帖子库）本质是数据浏览，方法级能力闸覆盖类级 pipeline:run，
  // 让仅有 insights:view / posts:view 的研判员也能查（写操作仍在各自 controller 收口）。

  /** 来源 / 版块去重清单（洞察库筛选 + 导出批次共用）。须先于 insights/:id 声明。 */
  @Get('insights/filters')
  @RequirePermission('insights:view')
  insightFilters() {
    return this.radar.filterOptions();
  }

  @Get('insights')
  @RequirePermission('insights:view')
  insights(@Query() q: Record<string, string>) {
    const intensity = INTENSITIES.includes(q.intensity as RadarIntensity)
      ? (q.intensity as RadarIntensity)
      : undefined;

    return this.radar.listInsights({
      source: q.source || undefined,
      subreddit: q.subreddit || undefined,
      intensity,
      q: q.q || undefined,
      sort: q.sort === 'pain' ? 'pain' : 'time',
      page: q.page ? Number(q.page) : undefined,
      size: q.size ? Number(q.size) : undefined,
    });
  }

  @Get('insights/:id')
  @RequirePermission('insights:view')
  async insightDetail(@Param('id', ParseIntPipe) id: number) {
    const res = await this.radar.insightDetail(id);
    if (!res) {
      throw new NotFoundException('洞察不存在');
    }

    return res;
  }

  @Get('posts')
  @RequirePermission('posts:view')
  posts(@Query() q: Record<string, string>) {
    const status =
      q.status === 'due' || q.status === 'quiet' || q.status === 'new' ? q.status : undefined;

    return this.radar.listPosts({
      source: q.source || undefined,
      subreddit: q.subreddit || undefined,
      status,
      q: q.q || undefined,
      page: q.page ? Number(q.page) : undefined,
      size: q.size ? Number(q.size) : undefined,
    });
  }

  @Get('posts/:id')
  @RequirePermission('posts:view')
  async postDetail(@Param('id') id: string) {
    const res = await this.radar.postDetail(id);
    if (!res) {
      throw new NotFoundException('帖子不存在');
    }

    return res;
  }
}
