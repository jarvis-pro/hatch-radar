import {
  ProvidersRepository,
  TranslationsRepository,
  type ProviderRow,
  type TranslationField,
  type TranslationProviderKind,
  type TranslationUpsert,
} from '@hatch-radar/db';
import { decryptSecret, logger, nowSec } from '@hatch-radar/kernel';
import type { TokenUsage } from './analyzer/analyze';
import { classifyKeyError, errMsg, COOLDOWN_SECONDS } from './key-failover';
import {
  looksChinese,
  translateItems,
  type TranslateConfig,
  type TranslateItem,
  type TranslatedItem,
} from './translator/translate';

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
 * 支持两档 provider：claude_cli（订阅额度、零边际成本、最高质量）与 azure（Azure Translator 机翻，
 * 按字符计费、走 Key 池故障转移以降订阅额度消耗）。其余类型抛错（由队列计失败）。
 */
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

  /** 按 provider 类型分发翻译：claude_cli 无 Key 直译；azure 走 Key 池故障转移。 */
  private runTranslate(
    provider: ProviderRow,
    items: TranslateItem[],
    signal?: AbortSignal,
  ): Promise<{ results: TranslatedItem[]; usage: TokenUsage | null }> {
    if (provider.provider === 'claude_cli') {
      return translateItems({ provider: 'claude_cli', model: provider.model }, items, signal);
    }
    if (provider.provider === 'azure') {
      return this.translateWithKeyFailover(provider, items, signal);
    }
    // resolveProvider 已挡掉其余类型，此处仅为兜底
    throw new Error(`翻译不支持的 provider：${provider.provider}`);
  }

  /**
   * 走 Key 池故障转移翻译一组条目（azure 等 API-Key 机翻用）：按 priority 取可用 Key 逐把尝试，
   * 限流→冷却切下一把、鉴权失败/额度耗尽→失效切下一把、其余冒泡（交 job 重试）。
   * 与分析路径共用同一套 active/cooling/invalid 状态机（见 {@link classifyKeyError}）。
   */
  private async translateWithKeyFailover(
    provider: ProviderRow,
    items: TranslateItem[],
    signal?: AbortSignal,
  ): Promise<{ results: TranslatedItem[]; usage: TokenUsage | null }> {
    const keys = await this.providers.listUsableKeys(provider.id, nowSec());
    if (keys.length === 0) {
      throw new Error(
        `翻译 provider「${provider.label}」无可用 API Key（全部停用/限流/失效），请在设置页补充或复位`,
      );
    }
    let lastErr: unknown;
    for (const key of keys) {
      signal?.throwIfAborted(); // job 超时后不再尝试下一把
      let plain: string;
      try {
        plain = decryptSecret(key.api_key);
      } catch (err) {
        await this.providers.markKeyInvalid(key.id, `密钥解密失败：${errMsg(err)}`, nowSec());
        lastErr = err;
        continue;
      }
      const config: TranslateConfig = {
        provider: 'azure',
        apiKey: plain,
        region: provider.region,
        endpoint: provider.base_url,
      };
      try {
        const out = await translateItems(config, items, signal);
        if (key.status !== 'active') {
          await this.providers.updateKey(key.id, { reset: true }, nowSec()); // 冷却后成功 → 自愈为 active
        }
        return out;
      } catch (err) {
        if (signal?.aborted) throw err; // job 超时：不再切换，直接冒泡
        const kind = classifyKeyError(err);
        const m = errMsg(err);
        if (kind === 'rate_limit') {
          await this.providers.markKeyCooling(key.id, nowSec() + COOLDOWN_SECONDS, m, nowSec());
          logger.warn(
            `[translation] Key#${key.id}（${provider.label}）限流，冷却 ${COOLDOWN_SECONDS}s，切下一把`,
          );
          lastErr = err;
          continue;
        }
        if (kind === 'auth') {
          await this.providers.markKeyInvalid(key.id, m, nowSec());
          logger.warn(
            `[translation] Key#${key.id}（${provider.label}）鉴权失败/额度耗尽，标记失效，切下一把`,
          );
          lastErr = err;
          continue;
        }
        throw err; // 非 Key 问题：冒泡给 worker（交 job 重试）
      }
    }
    throw new Error(
      `翻译 provider「${provider.label}」所有可用 API Key 均失败：${errMsg(lastErr)}`,
    );
  }
}
