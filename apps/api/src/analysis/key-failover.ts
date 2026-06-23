/**
 * Key 故障转移的共享原语：错误归类 + 冷却窗。
 *
 * analysis（多 Key 模型分析）与 translation（Azure 机翻）两条路径共用同一套
 * 「限流冷却 / 鉴权失效 / 其余冒泡」判定，保证两处的 active/cooling/invalid 状态机口径一致。
 */

import { errMsg } from '@/utils/error';

/** 一把 Key 失败的归类：rate_limit=限流可冷却重试 / auth=鉴权失败或额度耗尽需人工 / other=非 Key 问题 */
export type KeyErrorKind = 'rate_limit' | 'auth' | 'other';

/**
 * 一把 Key 触发限流后的冷却窗（秒）：此窗内不再选用，到点自动当可用。
 * 注：当前为固定窗；指数退避（按连续冷却次数递增、上限封顶）留作后续细化。
 */
export const COOLDOWN_SECONDS = 300;

/**
 * 归类一次远端调用失败是否「该把 Key 的问题」。
 * - Anthropic SDK 抛 APIError 带 `status`；openai 兼容路径与 Azure fetch 抛带 `status` 或消息含状态码的错误
 * - 仅在明确的限流(429)/鉴权(401/403)/额度信号下降级该 Key；其余（网络/超时/5xx）归 other，冒泡重试，不冤枉 Key
 */
export function classifyKeyError(err: unknown): KeyErrorKind {
  const status = (err as { status?: number })?.status;
  const m = errMsg(err);
  if (status === 429 || /\b429\b|rate.?limit|too many requests/i.test(m)) {
    return 'rate_limit';
  }
  if (
    status === 401 ||
    status === 403 ||
    /\b401\b|\b403\b|unauthor|invalid.*api.?key|insufficient_quota|exceeded.*quota|额度/i.test(m)
  ) {
    return 'auth';
  }
  return 'other';
}
