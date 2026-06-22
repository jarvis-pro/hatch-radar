import { Injectable } from '@nestjs/common';
import {
  AuditLogsRepository,
  ProvidersRepository,
  SettingsRepository,
  TasksRepository,
  TranslationsRepository,
} from '@/lib/db';
import { DomainError } from '@/lib/kernel';
import type { ExportFilter } from '@hatch-radar/shared';
import { ExportService } from '../export/export.service';
import { PipelineService } from '../pipeline/pipeline.service';

/** Azure Translator 免费档月度配额（字符/月）——用量表参照线。 */
const AZURE_FREE_CHARS_PER_MONTH = 2_000_000;

/** 翻译进度三态（驱动 web 按钮文案）：none 无可译 / first 首次 / incremental 增量 / translating 进行中 / done 已全译 */
type TranslationState = 'none' | 'first' | 'incremental' | 'translating' | 'done';

/** 当月起点（UTC）的 Unix 秒——Azure 免费档按自然月重置，用量统计据此取窗。 */
function startOfMonthSec(): number {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
}

/**
 * 帖子内容翻译编排服务。
 *
 * 从 TranslationsController 抽出的多仓储 / 多服务编排：翻译进度三态、可选翻译模型解析、
 * 单帖 / 批量入队（含审计落档）、导出筛选覆盖率、Azure 当月用量。译文按 content_hash 寻址，
 * 故「增量」= 评论刷新后新增的未翻条目，由进度查询自然得出。业务失败一律抛 DomainError，
 * 由全局异常过滤器按 status 映射成 HTTP。
 */
@Injectable()
export class TranslationOrchestrator {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly tasks: TasksRepository,
    private readonly translations: TranslationsRepository,
    private readonly providers: ProvidersRepository,
    private readonly settings: SettingsRepository,
    private readonly audit: AuditLogsRepository,
    private readonly exportSvc: ExportService,
  ) {}

  /** 某帖翻译进度与按钮状态（含活跃翻译任务 → translating）。 */
  async getStatus(postId: string): Promise<{
    total: number;
    translated: number;
    untranslated: number;
    active: boolean;
    state: TranslationState;
    lastError: string | null;
  }> {
    const [progress, active, lastError] = await Promise.all([
      this.translations.getProgress(postId),
      this.tasks.hasActiveTask(postId, 'translate'),
      this.tasks.getRecentError(postId, 'translate'),
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

  /** 该帖已完成译文（content_hash → 中文）。 */
  async getContent(postId: string): Promise<{ translations: Record<string, string> }> {
    return { translations: await this.translations.getDoneForPost(postId) };
  }

  /**
   * 可选翻译模型（启用的 claude_cli / azure）+ 当前默认。
   * 默认 = translation_provider_id ?? active（须为启用的 claude_cli / azure）；为 null 时前端弹窗让用户选。
   */
  async listModels(): Promise<{
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
   * 入队翻译该帖未翻译内容（首次或增量）。同帖已有活跃翻译任务时去重（enqueued=false）。
   * provider 解析：chosenId（前端弹窗选定）> translation_provider_id > active；支持 claude_cli / azure。
   */
  async enqueue(
    actorId: string,
    postId: string,
    chosenId?: number,
  ): Promise<{ enqueued: boolean }> {
    const provider = await this.resolveTranslationProvider(chosenId);
    const { enqueued } = await this.pipeline.enqueueTranslation(
      [postId],
      provider.id,
      provider.model,
    );
    await this.audit.write({
      actorId,
      action: 'translation.enqueue',
      targetType: 'post',
      targetId: postId,
      metadata: { providerId: provider.id, model: provider.model },
    });
    return { enqueued: enqueued > 0 };
  }

  /**
   * 一个导出筛选命中帖子的译文覆盖率（供导出面板在「直接导出 / 先补翻」之间决策）。
   * translated = 全部内容已译的帖子数，untranslated = 仍需补翻数。
   */
  async coverage(
    filter: ExportFilter,
  ): Promise<{ posts: number; translated: number; untranslated: number }> {
    const ids = await this.exportSvc.selectPostIds(filter);
    const needing = await this.translations.getPostIdsNeedingTranslation(ids);
    return {
      posts: ids.length,
      translated: ids.length - needing.length,
      untranslated: needing.length,
    };
  }

  /**
   * 对一个导出筛选命中、仍有未翻内容的帖子批量入队翻译。同帖已有活跃翻译任务时自动去重。
   * provider 解析同单帖：chosenId > translation_provider_id > active。
   */
  async enqueueBatch(
    actorId: string,
    filter: ExportFilter,
    chosenId?: number,
  ): Promise<{ enqueued: number; posts: number }> {
    const provider = await this.resolveTranslationProvider(chosenId);
    const ids = await this.exportSvc.selectPostIds(filter);
    const needing = await this.translations.getPostIdsNeedingTranslation(ids);
    const { enqueued } = await this.pipeline.enqueueTranslation(
      needing,
      provider.id,
      provider.model,
    );
    await this.audit.write({
      actorId,
      action: 'translation.batchEnqueue',
      targetType: 'translation_batch',
      targetId: null,
      metadata: { providerId: provider.id, model: provider.model, posts: needing.length, enqueued },
    });
    return { enqueued, posts: needing.length };
  }

  /**
   * Azure 机翻当月已消耗字符数 + 免费档参照线（监控别溢出到收费）。
   * 仅统计 done 译文的源字符（skipped 本地判中文未调远端，不计）。
   */
  async usage(): Promise<{ azureCharsThisMonth: number; azureFreeLimit: number }> {
    const azureCharsThisMonth = await this.translations.getProviderCharUsageSince(
      'azure',
      startOfMonthSec(),
    );
    return { azureCharsThisMonth, azureFreeLimit: AZURE_FREE_CHARS_PER_MONTH };
  }

  /**
   * 解析本次翻译用 provider：优先 chosenId（前端弹窗选定），否则 translation_provider_id ?? active。
   * 校验存在 / 启用 / 类型（claude_cli | azure），不满足即抛 DomainError(400)。
   */
  private async resolveTranslationProvider(chosenId?: number) {
    const providerId =
      chosenId ??
      (await this.settings.getTranslationProviderId()) ??
      (await this.settings.getActiveProviderId());
    if (providerId == null) {
      throw new DomainError('未配置翻译模型，请在弹窗中选择，或在设置页设定翻译/active 模型', 400);
    }
    const provider = await this.providers.getProvider(providerId);
    if (!provider || !provider.enabled) {
      throw new DomainError('翻译模型不存在或已停用', 400);
    }
    if (provider.provider !== 'claude_cli' && provider.provider !== 'azure') {
      throw new DomainError(
        `翻译暂仅支持 claude_cli（订阅）/ azure（机翻），当前为 ${provider.provider}`,
        400,
      );
    }
    return provider;
  }
}
