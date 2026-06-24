import { z } from 'zod';

/** PipelineController（/api/pipeline/*）入参校验 schema（zod）+ 推导 DTO 类型。字段 `.describe()` 同步进 Swagger。 */

/** 挂/摘某环节暂停点入参：gate=true 挂点，false / 省略 摘点。 */
export const stageGateSchema = z.object({
  gate: z.boolean().optional().describe('是否在该环节挂暂停点；省略 / false=摘点'),
});
export type StageGateDto = z.infer<typeof stageGateSchema>;
