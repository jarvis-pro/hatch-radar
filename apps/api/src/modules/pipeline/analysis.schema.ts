import { z } from 'zod';

/** AnalysisController（/api/analysis/*，流水线检视器）入参校验 schema（zod）+ 推导 DTO 类型。 */

/** 发起检视任务入参：目标帖 + 用哪个模型 + 是否逐节点暂停。 */
export const inspectSchema = z.object({
  /** 待检视的帖子 id（posts.id），非空 */
  postId: z.string().min(1),
  /** 本次检视使用的模型 id（providers.id） */
  providerId: z.number().int(),
  /** 逐节点闸门：缺省 true（逐步检视）；false 为运行到底＋留痕 */
  stepGate: z.boolean().optional().default(true),
});
export type InspectDto = z.infer<typeof inspectSchema>;
