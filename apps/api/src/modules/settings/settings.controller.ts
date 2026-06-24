import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@/common/auth-user.decorator';
import { type KeyInput, type KeyUpdate } from '@/database';
import { SettingsService } from '@/modules/settings/settings.service';
import { type RuntimeSettingsPatch } from '@/modules/settings/settings.runtime-settings.service';
import {
  ActiveProviderDto,
  CreateKeyDto,
  CreateProviderDto,
  RuntimeSettingsDto,
  UpdateKeyDto,
  UpdateProviderDto,
} from './settings.schema';

/**
 * /api/settings/* —— 模型清单 CRUD + Key 池管理 + 选用 active（密钥加密入库，仅脱敏外发）。
 * 编排与业务规则（含「改 baseUrl 须重填 Key」安全闸、写后热重载）在 {@link SettingsService}；
 * 本控制器仅做入参校验，业务失败由服务抛 DomainError、全局过滤器映射成 HTTP。
 */
@ApiTags('settings')
@RequirePermission('settings:manage')
@Controller('settings')
export class SettingsController {
  constructor(
    // 设置领域服务：模型/Key 池 CRUD + active 选用 + 运行期可调项编排
    private readonly settings: SettingsService,
  ) {}

  // ── 运行期可调项 ────────────────────────────────────────────────────────────

  /** GET /api/settings/runtime —— 五项运行期可调项有效态（当前值 / env 默认 / 是否覆盖） */
  @Get('runtime')
  runtime() {
    return this.settings.getRuntimeOverview();
  }

  /** PUT /api/settings/runtime —— 写入运行期参数（整数），保存即生效。 */
  @Put('runtime')
  updateRuntime(@Body() dto: RuntimeSettingsDto) {
    return this.settings.applyRuntimeSettings(dto satisfies RuntimeSettingsPatch);
  }

  /** GET /api/settings —— providers（含 Key 池脱敏）+ activeProviderId + secretConfigured */
  @Get()
  overview() {
    return this.settings.getOverview();
  }

  /** GET /api/settings/providers —— 模型清单（含 Key 池脱敏） */
  @Get('providers')
  list() {
    return this.settings.listProviders();
  }

  /** POST /api/settings/providers —— 新建模型（含第一把 Key，密钥加密入库），201 { id } */
  @Post('providers')
  async create(@Body() dto: CreateProviderDto) {
    return this.settings.createProvider(dto);
  }

  /** PUT /api/settings/providers/:id —— 更新模型标量字段（密钥走 Key 池端点）。 */
  @Put('providers/:id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProviderDto,
  ) {
    await this.settings.updateProvider(id, dto);

    return { ok: true };
  }

  /** DELETE /api/settings/providers/:id —— 删除模型（Key 池级联删除；若为 active 则清空 active） */
  @Delete('providers/:id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.settings.deleteProvider(id);

    return { ok: true };
  }

  /** POST /api/settings/providers/:id/test —— 用最优可用 Key 探测连通性，始终 200 + { ok, error? }。 */
  @Post('providers/:id/test')
  test(@Param('id', ParseIntPipe) id: number) {
    return this.settings.testProvider(id);
  }

  // ── API Key 池 ────────────────────────────────────────────────────────

  /** POST /api/settings/providers/:id/keys —— 新增一把备用 Key（密钥加密入库），201 { id } */
  @Post('providers/:id/keys')
  async addKey(
    @Param('id', ParseIntPipe) providerId: number,
    @Body() dto: CreateKeyDto,
  ) {
    return this.settings.addKey(providerId, dto satisfies KeyInput);
  }

  /** PUT /api/settings/providers/:id/keys/:keyId —— 改备注/优先级/启停；reset 复位 invalid/cooling */
  @Put('providers/:id/keys/:keyId')
  async updateKey(
    @Param('id', ParseIntPipe) providerId: number,
    @Param('keyId', ParseIntPipe) keyId: number,
    @Body() dto: UpdateKeyDto,
  ) {
    await this.settings.updateKey(providerId, keyId, dto satisfies KeyUpdate);

    return { ok: true };
  }

  /** DELETE /api/settings/providers/:id/keys/:keyId —— 删除一把 Key */
  @Delete('providers/:id/keys/:keyId')
  async removeKey(
    @Param('id', ParseIntPipe) providerId: number,
    @Param('keyId', ParseIntPipe) keyId: number,
  ) {
    await this.settings.deleteKey(providerId, keyId);

    return { ok: true };
  }

  /** POST /api/settings/providers/:id/keys/:keyId/test —— 测试指定 Key，始终 200 + { ok, error? } */
  @Post('providers/:id/keys/:keyId/test')
  async testKey(
    @Param('id', ParseIntPipe) providerId: number,
    @Param('keyId', ParseIntPipe) keyId: number,
  ) {
    return this.settings.testKey(providerId, keyId);
  }

  /** PUT /api/settings/active —— 选用模型 { providerId: number|null }，即时热重载并触发一轮入队 */
  @Put('active')
  async setActive(@Body() dto: ActiveProviderDto) {
    return this.settings.setActive(dto.providerId);
  }

  /** PUT /api/settings/translation-provider —— 选用翻译模型 { providerId: number|null }。 */
  @Put('translation-provider')
  async setTranslationProvider(@Body() dto: ActiveProviderDto) {
    return this.settings.setTranslationProvider(dto.providerId);
  }
}
