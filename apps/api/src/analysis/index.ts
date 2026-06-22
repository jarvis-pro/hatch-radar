/**
 * @/analysis —— AI 分析能力（无状态引擎 / 适配）。
 *
 * analyzer 引擎（prompt / 洞察 schema / Anthropic·OpenAI 兼容客户端 / 处理器装配）+ 翻译引擎
 * （translator）+ 多 Key 故障转移分类（key-failover）。依赖 kernel(crypto / 日志) + shared(域类型)。
 * 含业务编排的 service（AnalysisConfigService / AnalysisService / TranslationService）在
 * `@/modules/analysis`（本层只留无状态能力，业务规则与跨仓储编排归各 feature module）。
 */
export * from './analyzer/analyze';
export * from './analyzer/prompt';
export { insightFromMessage } from './analyzer/claude-agent';
export { buildContext } from './analyzer/context';

// 翻译能力（translator 引擎）
export {
  looksChinese,
  translateItems,
  type TranslateConfig,
  type TranslateItem,
  type TranslatedItem,
} from './translator/translate';
export { translationFromMessage } from './translator/claude-agent';
