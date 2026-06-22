import { Injectable } from '@nestjs/common';
import {
  ProvidersRepository,
  TranslationsRepository,
  type ProviderRow,
  type TranslationField,
  type TranslationProviderKind,
  type TranslationUpsert,
} from '@/lib/db';
import { decryptSecret, logger, nowSec } from '@/lib/kernel';
import type { TokenUsage } from '@/lib/analysis/analyzer/analyze';
import { classifyKeyError, errMsg } from '@/lib/analysis/key-failover';
import {
  looksChinese,
  translateItems,
  type TranslateConfig,
  type TranslateItem,
  type TranslatedItem,
} from '@/lib/analysis/translator/translate';

/** 单次翻译落库的结果概要（worker 日志与计费用） */
export interface TranslateOutcome {
  /** 本次新译成 done 的条目数 */
  translated: number;
  /** 本次判为中文跳过（skipped）的条目数 */
  skipped: number;
  /** 聚合 token 用量（claude_cli 缺报或无可译条目时为 null；azure 按字符计费恒为 null） */
  usage: TokenUsage | null;
}

/**
 * 「翻译并落库」的编排服务：由 worker 处理单条 translation job 时调用。
 *
 * 流程：取该帖未翻译条目 → 本地粗判中文者直接 skipped（省成本） → 其余按 provider 译成中文 →
 * 按 content_hash upsert 回 translations。译文按内容哈希寻址，故评论 churn 后同文复用、新评论增量翻译。
 *
 * 支持两档 provider：azure（Azure Translator 机翻、免费档走量、日常默认）与 claude_cli（订阅额度、
 * 零边际成本、高质量、个别重要内容用）。Azure 仅单把 Key（不做多 Key 池故障转移）。其余类型抛错。
 */
@Injectable()
export class TranslationService {
  constructor(
    private readonly translations: TranslationsRepository,
    private readonly providers: ProvidersRepository,
  ) {}

  /** 解析翻译 provider：缺失/不存在/停用/非可翻译类型即抛错（仅 claude_cli / azure）。 */
  private async resolveProvider(providerId: number | null): Promise<ProviderRow> {
    if (providerId == null) throw new Error('翻译任务缺少 provider 配置');
    const provider = await this.providers.getProvider(providerId);
    if (!provider) throw new Error('翻译 provider 配置不存在');
    if (!provider.enabled) throw new Error('翻译 provider 已停用');
    if (provider.provider !== 'claude_cli' && provider.provider !== 'azure') {
      throw new Error(`翻译暂不支持 provider：${provider.provider}（仅 claude_cli / azure）`);
    }
    return provider;
  }

  /**
   * 翻译某帖全部未翻译内容并落库。
   * @param postId 目标帖子 ID
   * @param providerId 翻译用 model_providers.id（claude_cli / azure）
   * @param signal 可选中止信号（job 超时即停在途请求）
   */
  async translatePost(
    postId: string,
    providerId: number | null,
    signal?: AbortSignal,
  ): Promise<TranslateOutcome> {
    const provider = await this.resolveProvider(providerId);
    const providerKind: TranslationProviderKind = provider.provider;
    const items = await this.translations.getUntranslatedItems(postId);
    if (items.length === 0) return { translated: 0, skipped: 0, usage: null };

    const fieldByHash = new Map<string, TranslationField>();
    const toTranslate: TranslateItem[] = [];
    const upserts: TranslationUpsert[] = [];

    for (const it of items) {
      fieldByHash.set(it.contentHash, it.sourceField);
      // 本地粗判：已是中文 → 直接标 skipped，不调远端（省成本/额度）
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
      const { results, usage: u } = await this.runTranslate(provider, toTranslate, signal);
      usage = u;
      const byKey = new Map(results.map((r) => [r.key, r]));
      for (const item of toTranslate) {
        const r = byKey.get(item.key);
        // 远端漏返回某条 → 不写 done 行，留待下次翻译任务补（避免落入「已翻」假象）
        if (!r) continue;
        upserts.push({
          contentHash: item.key,
          sourceField: fieldByHash.get(item.key) ?? 'comment_body',
          sourceLang: r.lang || null,
          text: r.text,
          providerKind,
          providerId: provider.id,
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

  /** 按 provider 类型分发翻译：claude_cli 无 Key 直译；azure 用单把 Key。 */
  private runTranslate(
    provider: ProviderRow,
    items: TranslateItem[],
    signal?: AbortSignal,
  ): Promise<{ results: TranslatedItem[]; usage: TokenUsage | null }> {
    if (provider.provider === 'claude_cli') {
      return translateItems({ provider: 'claude_cli', model: provider.model }, items, signal);
    }
    if (provider.provider === 'azure') {
      return this.translateWithAzureKey(provider, items, signal);
    }
    // resolveProvider 已挡掉其余类型，此处仅为兜底
    throw new Error(`翻译不支持的 provider：${provider.provider}`);
  }

  /**
   * 用 Azure 的单把 Key 翻译一组条目（机翻、免费档走量，不做多 Key 池故障转移）。
   * 失败分类供清晰回报：鉴权失败/额度耗尽 → 标记 Key 失效（设置页提示更换）；限流/其余 → 冒泡交 job 重试。
   */
  private async translateWithAzureKey(
    provider: ProviderRow,
    items: TranslateItem[],
    signal?: AbortSignal,
  ): Promise<{ results: TranslatedItem[]; usage: TokenUsage | null }> {
    const [key] = await this.providers.listUsableKeys(provider.id, nowSec());
    if (!key) {
      throw new Error(
        `翻译 provider「${provider.label}」无可用 API Key（已失效或停用），请在设置页更换 Key`,
      );
    }
    let plain: string;
    try {
      plain = decryptSecret(key.api_key);
    } catch (err) {
      await this.providers.markKeyInvalid(key.id, `密钥解密失败：${errMsg(err)}`, nowSec());
      throw new Error(`翻译 provider「${provider.label}」密钥解密失败，请重设 Key`, { cause: err });
    }
    const config: TranslateConfig = {
      provider: 'azure',
      apiKey: plain,
      region: provider.region,
      endpoint: provider.base_url,
    };
    try {
      return await translateItems(config, items, signal);
    } catch (err) {
      if (signal?.aborted) throw err; // job 超时：直接冒泡
      const m = errMsg(err);
      if (classifyKeyError(err) === 'auth') {
        await this.providers.markKeyInvalid(key.id, m, nowSec());
        logger.warn(`[translation] Azure「${provider.label}」鉴权失败/额度耗尽，已标记 Key 失效`);
        throw new Error(`Azure 翻译鉴权失败或额度耗尽（${provider.label}）：${m}`, { cause: err });
      }
      throw err; // 限流/网络等：冒泡给 worker 重试
    }
  }
}
