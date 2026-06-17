/**
 * @hatch-radar/analysis —— AI 分析能力。
 *
 * analyzer 引擎（prompt / 洞察 schema / Anthropic·OpenAI 兼容客户端 / 处理器装配）
 * + analysis-config（模型解析·热重载·入队，依赖 Dispatcher 派发）+ analysis.service（洞察落库）。
 * 依赖 db(仓储) + kernel(Dispatcher / crypto / 日志) + shared(域类型)。
 * api 侧只用配置片入队，worker 侧用引擎执行。
 */
export * from './analysis.service';
export * from './analysis-config.service';
export * from './analyzer/analyze';
export * from './analyzer/prompt';
export { insightFromMessage } from './analyzer/claude-agent';
export { buildContext } from './analyzer/context';
