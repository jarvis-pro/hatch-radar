import { Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { RequirePermission } from '@/common/auth-user.decorator';
import { ZodBody } from '@/common/zod-body.decorator';
import { type ConnectorInput } from '@/database';
import { SourcesService } from '@/modules/sources/sources.service';
import {
  createConnectorSchema,
  createSourceSchema,
  updateConnectorSchema,
  updateSourceSchema,
} from './sources.schema';
import type {
  CreateConnectorDto,
  CreateSourceDto,
  UpdateConnectorDto,
  UpdateSourceDto,
} from './sources.schema';

/**
 * /api/sources/* —— 采集来源（爬虫计划）CRUD + 概览。
 * 编排与 Reddit 服务端闸在 {@link SourcesService}；本控制器仅做入参校验，业务失败由服务抛 DomainError。
 */
@RequirePermission('settings:manage')
@Controller('sources')
export class SourcesController {
  constructor(
    // 来源/连接器领域服务：采集来源 CRUD + Reddit 服务端闸编排
    private readonly sources: SourcesService,
  ) {}

  /** GET /api/sources —— 来源列表 + 连接器（脱敏）+ redditUsable + secretConfigured */
  @Get()
  overview() {
    return this.sources.overview();
  }

  /** POST /api/sources —— 新建来源，201 { id } */
  @Post()
  async create(@ZodBody(createSourceSchema) dto: CreateSourceDto) {
    return this.sources.createSource(dto);
  }

  /** PUT /api/sources/:id —— 更新来源（含勾选 enabled，走 Reddit 门禁） */
  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @ZodBody(updateSourceSchema) dto: UpdateSourceDto,
  ) {
    await this.sources.updateSource(id, dto);

    return { ok: true };
  }

  /** DELETE /api/sources/:id */
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.sources.deleteSource(id);

    return { ok: true };
  }
}

/**
 * /api/source-connectors/* —— 采集连接器（需鉴权平台的凭据）CRUD + 连通性测试。
 * 凭据加密入库、仅脱敏外发；改 secret 会清空上次测试结果（须重测才可用）。
 */
@RequirePermission('settings:manage')
@Controller('source-connectors')
export class SourceConnectorsController {
  constructor(
    // 来源/连接器领域服务：连接器凭据 CRUD + 加密入库 + 连通性测试编排
    private readonly sources: SourcesService,
  ) {}

  /** POST /api/source-connectors —— 新建连接器（凭据加密入库），201 { id } */
  @Post()
  async create(@ZodBody(createConnectorSchema) dto: CreateConnectorDto) {
    const input: ConnectorInput = {
      platform: dto.platform,
      authKind: dto.authKind,
      secret: dto.secret,
      label: dto.label,
      priority: dto.priority,
      enabled: dto.enabled,
    };

    return this.sources.createConnector(input);
  }

  /** PUT /api/source-connectors/:id —— 更新（改 secret 会清空测试结果，须重测） */
  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @ZodBody(updateConnectorSchema) dto: UpdateConnectorDto,
  ) {
    await this.sources.updateConnector(id, dto);

    return { ok: true };
  }

  /** DELETE /api/source-connectors/:id */
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.sources.deleteConnector(id);

    return { ok: true };
  }

  /** POST /api/source-connectors/:id/test —— 连通性测试并记录结果，始终 200 + { ok, error? } */
  @Post(':id/test')
  async test(@Param('id', ParseIntPipe) id: number) {
    return this.sources.testConnector(id);
  }
}
