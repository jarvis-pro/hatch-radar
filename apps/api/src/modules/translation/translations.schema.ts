import { z } from 'zod';

/** TranslationsController（/api/translations/*）入参校验 schema（zod）+ 推导 DTO 类型。 */

/** 入队翻译入参：可选 providerId——无默认翻译模型时由前端弹窗选定，一次性指定本次用模型。 */
export const enqueueSchema = z.object({
  /** 本次翻译用的模型 id；省略走默认翻译模型（再回落 active provider） */
  providerId: z.number().int().positive().optional(),
});
export type EnqueueDto = z.infer<typeof enqueueSchema>;

/** 批量补翻入参：导出同款筛选（since/强度/版块/上限）+ 可选 providerId（不传走默认翻译模型）。 */
export const batchSchema = z.object({
  /** 只翻该 Unix 秒之后产生的洞察对应帖子；省略=不限时间 */
  since: z.number().int().positive().optional(),
  /** 最低痛点强度过滤；省略=各强度都翻 */
  minIntensity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  /** 限定版块；省略=全部版块 */
  subreddit: z.string().trim().min(1).optional(),
  /** 命中帖子数上限；省略=不设上限 */
  limit: z.number().int().positive().optional(),
  /** 本次翻译用的模型 id；省略走默认翻译模型 */
  providerId: z.number().int().positive().optional(),
});
export type BatchDto = z.infer<typeof batchSchema>;
