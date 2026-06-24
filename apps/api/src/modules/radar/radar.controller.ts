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
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@/common/auth-user.decorator';
import { BlueprintService } from '@/modules/radar/blueprint.service';
import { ProcessService } from '@/modules/radar/process.service';
import { RadarService } from '@/modules/radar/radar.service';
import { logger } from '@/logger';
import type { RadarIntensity } from '@hatch-radar/shared';
import {
  CreateBlueprintDto,
  CreateProcessDto,
  UpdateBlueprintDto,
  UpdateProcessDto,
} from './radar.schema';

/**
 * /api/blueprints/* —— 图纸（纯配方）CRUD。读 pipeline:run，写 pipeline:control。
 */
@ApiTags('radar')
@RequirePermission('pipeline:run')
@Controller('blueprints')
export class BlueprintsController {
  constructor(
    // 图纸 CRUD 服务：图纸列举 / 读取 / 增删改
    private readonly blueprints: BlueprintService,
  ) {}

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
  async create(@Body() dto: CreateBlueprintDto) {
    const bp = await this.blueprints.createBlueprint(dto);
    logger.info(`[图纸] 新建 #${bp.id}：${bp.kind}/${bp.label}`);

    return bp;
  }

  @Patch(':id')
  @RequirePermission('pipeline:control')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBlueprintDto) {
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
@ApiTags('radar')
@RequirePermission('pipeline:run')
@Controller('processes')
export class ProcessesController {
  constructor(
    // 进程 CRUD + 启停 / 触发 / 运行历史服务
    private readonly processes: ProcessService,
  ) {}

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
  async create(@Body() dto: CreateProcessDto) {
    const res = await this.processes.createProcess(dto);
    logger.info(`[进程] 新建 #${res.id}：${res.label}`);

    return res;
  }

  @Patch(':id')
  @RequirePermission('pipeline:control')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProcessDto) {
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
@ApiTags('radar')
@RequirePermission('pipeline:run')
@Controller('radar')
export class RadarController {
  constructor(
    // 雷达只读 / 聚合服务：指挥室 / lane / 运行详情 / 洞察 / 帖子库
    private readonly radar: RadarService,
  ) {}

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
