import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { ExportFilter } from '@hatch-radar/shared';
import type { AuthedUser } from '@/types/auth-context';
import { AuthUser, RequirePermission } from '@/modules/account/auth-user.decorator';
import { ZodBody } from '@/common/zod-body.decorator';
import { parseExportFilter } from '@/modules/export/export-query';
import { TranslationOrchestrator } from '@/modules/translation/translation-orchestrator.service';
import { batchSchema, enqueueSchema } from './translations.schema';
import type { BatchDto, EnqueueDto } from './translations.schema';

/**
 * /api/translations/* —— 帖子内容翻译：查询某帖翻译进度（按钮三态）+ 入队翻译（首次/增量）。
 *
 * 编排在 {@link TranslationOrchestrator}；本控制器仅做入参校验、导出筛选解析，业务失败由服务抛 DomainError。
 * 翻译走 claude_cli（订阅额度、零边际成本）或 azure（机翻、按字符计费）；未单独配置时回落 active provider。
 */
@Controller('translations')
export class TranslationsController {
  constructor(
    // 翻译编排服务：翻译进度三态 + 模型解析 + 单帖/批量入队 + 覆盖率/用量
    private readonly translations: TranslationOrchestrator,
  ) {}

  /** GET /api/translations/posts/:id —— 某帖翻译进度与按钮状态。 */
  @Get('posts/:id')
  @RequirePermission('posts:view')
  status(@Param('id') postId: string) {
    return this.translations.getStatus(postId);
  }

  /** GET /api/translations/posts/:id/content —— 该帖已完成译文（content_hash → 中文）。 */
  @Get('posts/:id/content')
  @RequirePermission('posts:view')
  content(@Param('id') postId: string) {
    return this.translations.getContent(postId);
  }

  /** GET /api/translations/providers —— 可选翻译模型（启用的 claude_cli / azure）+ 当前默认。 */
  @Get('providers')
  @RequirePermission('analyze:run')
  models() {
    return this.translations.listModels();
  }

  /** POST /api/translations/posts/:id —— 入队翻译该帖未翻译内容（首次或增量），202。 */
  @Post('posts/:id')
  @HttpCode(202)
  @RequirePermission('analyze:run')
  async enqueue(
    @AuthUser() actor: AuthedUser,
    @Param('id') postId: string,
    @ZodBody(enqueueSchema) dto: EnqueueDto,
  ): Promise<{ enqueued: boolean }> {
    return this.translations.enqueue(actor.id, postId, dto.providerId);
  }

  /** GET /api/translations/coverage —— 一个导出筛选命中帖子的译文覆盖率（供导出面板决策）。 */
  @Get('coverage')
  @RequirePermission('analyze:run')
  coverage(@Query() q: Record<string, string | undefined>) {
    return this.translations.coverage(parseExportFilter(q));
  }

  /** POST /api/translations/batch —— 对一个导出筛选命中、仍有未翻内容的帖子批量入队翻译，202。 */
  @Post('batch')
  @HttpCode(202)
  @RequirePermission('analyze:run')
  async enqueueBatch(
    @AuthUser() actor: AuthedUser,
    @ZodBody(batchSchema) dto: BatchDto,
  ): Promise<{ enqueued: number; posts: number }> {
    const filter: ExportFilter = {
      since: dto.since,
      minIntensity: dto.minIntensity,
      subreddit: dto.subreddit,
      limit: dto.limit,
    };

    return this.translations.enqueueBatch(actor.id, filter, dto.providerId);
  }

  /** GET /api/translations/usage —— Azure 机翻当月已消耗字符数 + 免费档参照线。 */
  @Get('usage')
  @RequirePermission('analyze:run')
  usage() {
    return this.translations.usage();
  }
}
