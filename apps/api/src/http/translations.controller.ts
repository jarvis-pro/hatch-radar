import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, RequirePermission, type AuthedUser } from '@/account/auth-user.decorator';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import {
  AuditLogsRepository,
  GatewayService,
  JobsRepository,
  ProvidersRepository,
  SettingsRepository,
  TranslationsRepository,
  nowSec,
} from '@/domain';

/** 翻译进度三态（驱动 web 按钮文案）：none 无可译 / first 首次 / incremental 增量 / translating 进行中 / done 已全译 */
type TranslationState = 'none' | 'first' | 'incremental' | 'translating' | 'done';

/**
 * /api/translations/* —— 帖子内容翻译：查询某帖翻译进度（按钮三态）+ 入队翻译（首次/增量）。
 *
 * 译文按 content_hash 寻址，故「增量」= 评论刷新后新增的未翻条目，由进度查询自然得出（无需额外检测）。
 * 默认走 claude_cli（订阅额度、零边际成本）；翻译 provider 未单独配置时回落 active provider。
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
  }> {
    const [progress, active] = await Promise.all([
      this.translations.getProgress(postId),
      this.jobs.hasActiveTranslationJob(postId),
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
    return { ...progress, active, state };
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
   * POST /api/translations/posts/:id —— 入队翻译该帖未翻译内容（首次或增量），202。
   * 解析翻译 provider（translation_provider_id 优先，否则回落 active）；v1 仅 claude_cli。
   * 同帖已有活跃翻译任务时去重（enqueued=false）。
   */
  @Post('posts/:id')
  @HttpCode(202)
  @RequirePermission('analyze:run')
  async enqueue(
    @AuthUser() actor: AuthedUser,
    @Param('id') postId: string,
  ): Promise<{ enqueued: boolean }> {
    const providerId =
      (await this.settings.getTranslationProviderId()) ??
      (await this.settings.getActiveProviderId());
    if (providerId == null) {
      throw new BadRequestException(
        '未配置翻译 provider（请在设置页选择翻译模型或设定 active 模型）',
      );
    }
    const provider = await this.providers.getProvider(providerId);
    if (!provider || !provider.enabled) {
      throw new BadRequestException('翻译 provider 不存在或已停用');
    }
    if (provider.provider !== 'claude_cli') {
      throw new BadRequestException(
        `翻译暂仅支持 claude_cli（订阅模式），当前为 ${provider.provider}`,
      );
    }
    const enqueued = await this.jobs.enqueueTranslationJob(
      postId,
      providerId,
      provider.model,
      nowSec(),
    );
    if (enqueued) void this.gateway.tryDispatch();
    await this.audit.write({
      actorId: actor.id,
      action: 'translation.enqueue',
      targetType: 'post',
      targetId: postId,
      metadata: { providerId, model: provider.model },
    });
    return { enqueued };
  }
}
