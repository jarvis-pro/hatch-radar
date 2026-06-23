import type { TokenUsage } from '../analyzer/analyze';
import type { TranslateItem, TranslatedItem } from './translate';

/** Azure Translator 全局端点（区域资源亦可用，配合 Ocp-Apim-Subscription-Region 头）。 */
const DEFAULT_ENDPOINT = 'https://api.cognitive.microsofttranslator.com';
/** Translator REST 版本（稳定版，固定）。 */
const API_VERSION = '3.0';
/** 目标语：简体中文。 */
const TARGET_LANG = 'zh-Hans';

/** 已解析的 Azure 翻译配置（由 translation.service 从 model_providers 行 + 解密 Key 组装） */
export interface AzureTranslateConfig {
  provider: 'azure';
  /** 订阅密钥（明文，已解密） */
  apiKey: string;
  /** 资源区域（如 eastasia）；区域资源必填，全局资源可空 */
  region: string | null;
  /** 自定义端点；为空用全局端点 */
  endpoint?: string | null;
}

/** Azure /translate 单条返回结构里本处理器关心的字段 */
interface AzureTranslateResponseItem {
  detectedLanguage?: { language?: string };
  translations?: { text?: string }[];
}

/** 带 HTTP 状态码的错误，供 {@link classifyKeyError} 按 status 归类（429 冷却 / 401·403 失效） */
class AzureHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AzureHttpError';
  }
}

/** 拼出 /translate 请求 URL（去掉自定义端点尾部斜杠） */
function buildUrl(endpoint: string | null | undefined): string {
  const base = (endpoint?.trim() || DEFAULT_ENDPOINT).replace(/\/+$/, '');

  return `${base}/translate?api-version=${API_VERSION}&to=${TARGET_LANG}`;
}

/** 组装鉴权请求头（区域资源需带 region 头） */
function buildHeaders(config: AzureTranslateConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Ocp-Apim-Subscription-Key': config.apiKey,
    'Content-Type': 'application/json',
  };
  // Azure 区域头要的是区域代码（如 centralus），用户常误填显示名（Central US）→ 归一：小写、去空格
  const region = config.region?.trim().toLowerCase().replace(/\s+/g, '');
  if (region) {
    headers['Ocp-Apim-Subscription-Region'] = region;
  }

  return headers;
}

/**
 * 调一次 Azure /translate。非 2xx 抛 {@link AzureHttpError}（带 status，供故障转移归类）。
 * @returns 与入参等长、同序的返回数组
 */
async function callAzure(
  config: AzureTranslateConfig,
  texts: string[],
  signal?: AbortSignal,
): Promise<AzureTranslateResponseItem[]> {
  const res = await fetch(buildUrl(config.endpoint), {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify(texts.map((t) => ({ Text: t }))),
    signal,
  });
  if (!res.ok) {
    // Azure 错误体形如 { error: { code, message } }；连同状态码一并带出便于排查
    const detail = await res.text().catch(() => '');
    throw new AzureHttpError(`Azure Translator ${res.status}：${detail.slice(0, 300)}`, res.status);
  }

  return (await res.json()) as AzureTranslateResponseItem[];
}

/**
 * 用 Azure AI Translator 翻译一批条目（已在上游按体量分批，单批远在 Azure 1000 条 / 5 万字符上限内）。
 * 按返回数组顺序与入参对回（Azure 保证同序）；漏返回的条目跳过（不写 done，留待下次补）。
 * Azure 无 token 概念、按字符计费，故 usage 恒为 null（成本由 translations.char_count 另计）。
 * @param config 已解析的 Azure 配置（含解密后的 Key）
 * @param items 本批待译条目
 * @param signal 可选中止信号（job 超时）
 */
export async function translateBatchWithAzure(
  config: AzureTranslateConfig,
  items: TranslateItem[],
  signal?: AbortSignal,
): Promise<{ results: TranslatedItem[]; usage: TokenUsage | null }> {
  signal?.throwIfAborted();
  if (items.length === 0) {
    return { results: [], usage: null };
  }

  const resp = await callAzure(
    config,
    items.map((it) => it.text),
    signal,
  );
  const results: TranslatedItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const text = resp[i]?.translations?.[0]?.text;
    if (text == null) {
      continue;
    } // 漏返回 → 跳过，下次翻译任务补

    results.push({
      key: items[i].key,
      lang: resp[i]?.detectedLanguage?.language ?? '',
      text,
    });
  }

  return { results, usage: null };
}

/**
 * 连通性自测：翻一个极短词，校验 key + region 是否可用。供设置页「测试」按钮。
 * @throws 非 2xx（带 status）或网络错误
 */
export async function testAzureTranslator(
  apiKey: string,
  region: string | null,
  endpoint?: string | null,
): Promise<void> {
  await callAzure({ provider: 'azure', apiKey, region, endpoint }, ['ping']);
}
