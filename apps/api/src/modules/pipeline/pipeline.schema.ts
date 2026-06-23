import { z } from 'zod';

/** PipelineController（/api/pipeline/*）入参校验 schema（zod）+ 推导 DTO 类型。 */

/** 挂/摘某环节暂停点入参：gate=true 挂点，false / 省略 摘点。 */
export const stageGateSchema = z.object({
  /** 是否在该环节挂暂停点；省略 / false=摘点 */
  gate: z.boolean().optional(),
});
export type StageGateDto = z.infer<typeof stageGateSchema>;
