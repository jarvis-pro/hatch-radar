import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { ExportFilter, Intensity } from '@hatch-radar/shared';
import { AuthUser, RequirePermission, type AuthedUser } from '@/account/auth-user.decorator';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import {
  AuditLogsRepository,
  ExportService,
  GatewayService,
  JobsRepository,
  ProvidersRepository,
  SettingsRepository,
  TranslationsRepository,
  nowSec,
} from '@/domain';

/** Azure Translator 免费档月度配额（字符/月）——用量表参照线。 */
const AZURE_FREE_CHARS_PER_MONTH = 2_000_000;

/** 翻译进度三态（驱动 web 按钮文案）：none 无可译 / first 首次 / incremental 增量 / translating 进行中 / done 已全译 */
type TranslationState = 'none' | 'first' | 'incremental' | 'translating' | 'done';

/** 入队翻译入参：可选 providerId——无默认翻译模型时由前端弹窗选定，一次性指定本次用模型。 */
const enqueueSchema = z.object({ providerId: z.number().int().positive().optional() });

/** 批量补翻入参：导出同款筛选（since/强度/版块/上限）+ 可选 providerId（不传走默认翻译模型）。 */
const batchSchema = z.object({
  since: z.number().int().positive().optional(),
  minIntensity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  subreddit: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().optional(),
  providerId: z.number().int().positive().optional(),
});

/** 解析查询串中的导出筛选条件（与 export.controller parseExportFilter 同口径）；非法值按未提供处理。 */
function parseExportFilter(q: Record<string, string | undefined>): ExportFilter {
  const filter: ExportFilter = {};
  const since = Number(q.since);
  if (Number.isInteger(since) && since > 0) filter.since = since;
  const limit = Number(q.limit);
  if (Number.isInteger(limit) && limit > 0) filter.limit = limit;
  const intensity = q.minIntensity?.toUpperCase();
  if (intensity === 'HIGH' || intensity === 'MEDIUM' || intensity === 'LOW') {
    filter.minIntensity = intensity as Intensity;
  }
  const subreddit = q.subreddit?.trim();
  if (subreddit) filter.subreddit = subreddit;
  return filter;
}

/** 当月起点（UTC）的 Unix 秒——Azure 免费档按自然月重置，用量统计据此取窗。 */
function startOfMonthSec(): number {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
}

/**
 * /api/translations/* —— 帖子内容翻译：查询某帖翻译进度（按钮三态）+ 入队翻译（首次/增量）。
 *
 * 译文按 content_hash 寻址，故「增量」= 评论刷新后新增的未翻条目，由进度查询自然得出（无需额外检测）。
 * 翻译走 claude_cli（订阅额度、零边际成本）或 azure（机翻、按字符计费）；未单独配置时回落 active provider。
 */
@UseGuards(SessionAuthGuard)
@Controller('translations')
export class TranslationsController {
  constructor(
    private readonly jobs: JobsRepository,
    private readonly translations: TranslationsRepository,
    private readonly providers: ProvidersRepository,
    private readonly settings: SettingsRepository,
    private readonly gateway: GatewayService,
    private readonly audit: AuditLogsRepository,
    private readonly exportSvc: ExportService,
  ) {}

  /** GET /api/translations/posts/:id —— 某帖翻译进度与按钮状态（含活跃翻译任务 → translating）。 */
  @Get('posts/:id')
  @RequirePermission('posts:view')
  async status(@Param('id') postId: string): Promise<{
    total: number;
    translated: number;
    untranslated: number;
    active: boolean;
    state: TranslationState;
    lastError: string | null;
  }> {
    const [progress, active, lastError] = await Promise.all([
      this.translations.getProgress(postId),
      this.jobs.hasActiveTranslationJob(postId),
      this.jobs.getRecentTranslationError(postId),
    ]);
    const state: TranslationState = active
      ? 'translating'
      : progress.total === 0
        ? 'none'
        : progress.untranslated === 0
          ? 'done'
          : progress.translated === 0
            ? 'first'
            : 'incremental';
    return { ...progress, active, state, lastError };
  }

  /**
   * GET /api/translations/posts/:id/content —— 该帖已完成译文（content_hash → 中文）。
   * 前端据此把帖子正文/评论按内容哈希贴成中文（未命中的条目回退原文）。
   */
  @Get('posts/:id/content')
  @RequirePermission('posts:view')
  async content(@Param('id') postId: string): Promise<{ translations: Record<string, string> }> {
    return { translations: await this.translations.getDoneForPost(postId) };
  }

  /**
   * GET /api/translations/providers —— 可选翻译模型（启用的 claude_cli / azure）+ 当前默认。
   * 默认 = translation_provider_id ?? active（须为启用的 claude_cli / azure）；为 null 时前端弹窗让用户选。
   * 仅返回 id/label/model（无密钥），analyze:run 即可读。
   */
  @Get('providers')
  @RequirePermission('analyze:run')
  async models(): Promise<{
    defaultId: number | null;
    providers: { id: number; label: string; model: string; kind: 'claude_cli' | 'azure' }[];
  }> {
    const usable = (await this.providers.listProviders()).filter(
      (p) => p.enabled && (p.provider === 'claude_cli' || p.provider === 'azure'),
    );
    const resolved =
      (await this.settings.getTranslationProviderId()) ??
      (await this.settings.getActiveProviderId());
    const defaultId = usable.some((p) => p.id === resolved) ? resolved : null;
    return {
      defaultId,
      providers: usable.map((p) => ({
        id: p.id,
        label: p.label,
        model: p.model,
        kind: p.provider as 'claude_cli' | 'azure',
      })),
    };
  }

  /**
   * POST /api/translations/posts/:id —— 入队翻译该帖未翻译内容（首次或增量），202。
   * provider 解析：入参 providerId（前端弹窗选定）> translation_provider_id > active；支持 claude_cli / azure。
   * 同帖已有活跃翻译任务时去重（enqueued=false）。
   */
  @Post('posts/:id')
  @HttpCode(202)
  @RequirePermission('analyze:run')
  async enqueue(
    @AuthUser() actor: AuthedUser,
    @Param('id') postId: string,
    @Body(new ZodValidationPipe(enqueueSchema)) dto: z.infer<typeof enqueueSchema>,
  ): Promise<{ enqueued: boolean }> {
    const provider = await this.resolveTranslationProvider(dto.providerId);
    const enqueued = await this.jobs.enqueueTranslationJob(
      postId,
      provider.id,
      provider.model,
      nowSec(),
    );
    if (enqueued) void this.gateway.tryDispatch();
    await this.audit.write({
      actorId: actor.id,
      action: 'translation.enqueue',
      targetType: 'post',
      targetId: postId,
      metadata: { providerId: provider.id, model: provider.model },
    });
    return { enqueued };
  }

  /**
   * GET /api/translations/coverage —— 一个导出筛选（since/minIntensity/subreddit/limit）命中帖子的译文覆盖率。
   * 供导出面板在「直接导出 / 先补翻」之间决策：translated = 全部内容已译的帖子数，untranslated = 仍需补翻数。
   */
  @Get('coverage')
  @RequirePermission('analyze:run')
  async coverage(
    @Query() q: Record<string, string | undefined>,
  ): Promise<{ posts: number; translated: number; untranslated: number }> {
    const ids = await this.exportSvc.selectPostIds(parseExportFilter(q));
    const needing = await this.translations.getPostIdsNeedingTranslation(ids);
    return {
      posts: ids.length,
      translated: ids.length - needing.length,
      untranslated: needing.length,
    };
  }

  /**
   * POST /api/translations/batch —— 对一个导出筛选命中、仍有未翻内容的帖子批量入队翻译，202。
   * provider 解析同单帖：入参 providerId > translation_provider_id > active。同帖已有活跃翻译任务时自动去重。
   */
  @Post('batch')
  @HttpCode(202)
  @RequirePermission('analyze:run')
  async enqueueBatch(
    @AuthUser() actor: AuthedUser,
    @Body(new ZodValidationPipe(batchSchema)) dto: z.infer<typeof batchSchema>,
  ): Promise<{ enqueued: number; posts: number }> {
    const provider = await this.resolveTranslationProvider(dto.providerId);
    const filter: ExportFilter = {
      since: dto.since,
      minIntensity: dto.minIntensity,
      subreddit: dto.subreddit,
      limit: dto.limit,
    };
    const ids = await this.exportSvc.selectPostIds(filter);
    const needing = await this.translations.getPostIdsNeedingTranslation(ids);
    const now = nowSec();
    let enqueued = 0;
    for (const postId of needing) {
      if (await this.jobs.enqueueTranslationJob(postId, provider.id, provider.model, now))
        enqueued++;
    }
    if (enqueued > 0) void this.gateway.tryDispatch();
    await this.audit.write({
      actorId: actor.id,
      action: 'translation.batchEnqueue',
      targetType: 'translation_batch',
      targetId: null,
      metadata: { providerId: provider.id, model: provider.model, posts: needing.length, enqueued },
    });
    return { enqueued, posts: needing.length };
  }

  /**
   * GET /api/translations/usage —— Azure 机翻当月已消耗字符数 + 免费档参照线（监控别溢出到收费）。
   * 仅统计 done 译文的源字符（skipped 本地判中文未调远端，不计）。
   */
  @Get('usage')
  @RequirePermission('analyze:run')
  async usage(): Promise<{ azureCharsThisMonth: number; azureFreeLimit: number }> {
    const azureCharsThisMonth = await this.translations.getProviderCharUsageSince(
      'azure',
      startOfMonthSec(),
    );
    return { azureCharsThisMonth, azureFreeLimit: AZURE_FREE_CHARS_PER_MONTH };
  }

  /**
   * 解析本次翻译用 provider：优先入参 chosenId（前端弹窗选定），否则
   * translation_provider_id ?? active。校验存在 / 启用 / 类型（claude_cli | azure），不满足即 400。
   */
  private async resolveTranslationProvider(chosenId?: number) {
    const providerId =
      chosenId ??
      (await this.settings.getTranslationProviderId()) ??
      (await this.settings.getActiveProviderId());
    if (providerId == null) {
      throw new BadRequestException(
        '未配置翻译模型，请在弹窗中选择，或在设置页设定翻译/active 模型',
      );
    }
    const provider = await this.providers.getProvider(providerId);
    if (!provider || !provider.enabled) {
      throw new BadRequestException('翻译模型不存在或已停用');
    }
    if (provider.provider !== 'claude_cli' && provider.provider !== 'azure') {
      throw new BadRequestException(
        `翻译暂仅支持 claude_cli（订阅）/ azure（机翻），当前为 ${provider.provider}`,
      );
    }
    return provider;
  }
}
