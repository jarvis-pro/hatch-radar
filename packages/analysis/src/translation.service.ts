import {
  ProvidersRepository,
  TranslationsRepository,
  type TranslationField,
  type TranslationProviderKind,
  type TranslationUpsert,
} from '@hatch-radar/db';
import { logger, nowSec } from '@hatch-radar/kernel';
import type { TokenUsage } from './analyzer/analyze';
import {
  looksChinese,
  translateItems,
  type TranslateConfig,
  type TranslateItem,
} from './translator/translate';

/** 单次翻译落库的结果概要（worker 日志与计费用） */
export interface TranslateOutcome {
  /** 本次新译成 done 的条目数 */
  translated: number;
  /** 本次判为中文跳过（skipped）的条目数 */
  skipped: number;
  /** 聚合 token 用量（usage 缺报或无可译条目时为 null） */
  usage: TokenUsage | null;
}

/**
 * 「翻译并落库」的编排服务：由 worker 处理单条 translation job 时调用。
 *
 * 流程：取该帖未翻译条目 → 本地粗判中文者直接 skipped（省额度） → 其余经 translateItems 译成中文 →
 * 按 content_hash upsert 回 translations。译文按内容哈希寻址，故评论 churn 后同文复用、新评论增量翻译。
 *
 * v1 仅支持 claude_cli（订阅额度、零边际成本、最高质量）；provider 非 claude_cli 时抛错（由队列计失败）。
 */
export class TranslationService {
  constructor(
    private readonly translations: TranslationsRepository,
    private readonly providers: ProvidersRepository,
  ) {}

  /** 解析翻译配置（v1 仅 claude_cli）。provider 缺失/停用/非 claude_cli 即抛错。 */
  private async resolveConfig(providerId: number | null): Promise<{
    config: TranslateConfig;
    providerKind: TranslationProviderKind;
    providerId: number;
  }> {
    if (providerId == null) throw new Error('翻译任务缺少 provider 配置');
    const provider = await this.providers.getProvider(providerId);
    if (!provider) throw new Error('翻译 provider 配置不存在');
    if (!provider.enabled) throw new Error('翻译 provider 已停用');
    if (provider.provider !== 'claude_cli') {
      throw new Error(`翻译暂仅支持 claude_cli（订阅模式），当前 provider 为 ${provider.provider}`);
    }
    return {
      config: { provider: 'claude_cli', model: provider.model },
      providerKind: provider.provider,
      providerId,
    };
  }

  /**
   * 翻译某帖全部未翻译内容并落库。
   * @param postId 目标帖子 ID
   * @param providerId 翻译用 model_providers.id（claude_cli）
   * @param signal 可选中止信号（job 超时即停在途 query）
   */
  async translatePost(
    postId: string,
    providerId: number | null,
    signal?: AbortSignal,
  ): Promise<TranslateOutcome> {
    const { config, providerKind, providerId: pid } = await this.resolveConfig(providerId);
    const items = await this.translations.getUntranslatedItems(postId);
    if (items.length === 0) return { translated: 0, skipped: 0, usage: null };

    const fieldByHash = new Map<string, TranslationField>();
    const toTranslate: TranslateItem[] = [];
    const upserts: TranslationUpsert[] = [];

    for (const it of items) {
      fieldByHash.set(it.contentHash, it.sourceField);
      // 本地粗判：已是中文 → 直接标 skipped，不调模型（省订阅额度）
      if (looksChinese(it.text)) {
        upserts.push({
          contentHash: it.contentHash,
          sourceField: it.sourceField,
          sourceLang: 'zh',
          text: null,
          providerKind: null,
          providerId: null,
          status: 'skipped',
          charCount: it.text.length,
          lastError: null,
        });
      } else {
        toTranslate.push({ key: it.contentHash, field: it.sourceField, text: it.text });
      }
    }

    let usage: TokenUsage | null = null;
    if (toTranslate.length > 0) {
      const { results, usage: u } = await translateItems(config, toTranslate, signal);
      usage = u;
      const byKey = new Map(results.map((r) => [r.key, r]));
      for (const item of toTranslate) {
        const r = byKey.get(item.key);
        // 模型漏返回某条 → 不写 done 行，留待下次翻译任务补（避免落入「已翻」假象）
        if (!r) continue;
        upserts.push({
          contentHash: item.key,
          sourceField: fieldByHash.get(item.key) ?? 'comment_body',
          sourceLang: r.lang || null,
          text: r.text,
          providerKind,
          providerId: pid,
          status: 'done',
          charCount: item.text.length,
          lastError: null,
        });
      }
    }

    await this.translations.upsertTranslations(upserts, nowSec());
    const translated = upserts.filter((u) => u.status === 'done').length;
    const skipped = upserts.filter((u) => u.status === 'skipped').length;
    logger.info(
      `  ✓ 翻译 ${postId}：新译 ${translated} / 跳过(中文) ${skipped} / 待续 ${toTranslate.length - translated}`,
    );
    return { translated, skipped, usage };
  }
}
