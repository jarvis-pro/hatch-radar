import { z } from 'zod';

/** AnalysisController（/api/analysis/*，流水线检视器）入参校验 schema（zod）+ 推导 DTO 类型。字段 `.describe()` 同步进 Swagger。 */

/** 发起检视任务入参：目标帖 + 用哪个模型 + 是否逐节点暂停。 */
export const inspectSchema = z.object({
  postId: z.string().min(1).describe('待检视的帖子 id（posts.id），非空'),
  providerId: z.number().int().describe('本次检视使用的模型 id（providers.id）'),
  stepGate: z
    .boolean()
    .optional()
    .default(true)
    .describe('逐节点闸门：缺省 true（逐步检视）；false 为运行到底＋留痕'),
});
export type InspectDto = z.infer<typeof inspectSchema>;
