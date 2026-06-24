import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** TranslationsController（/api/translations/*）入参校验 schema（zod）+ 推导 DTO 类型。字段 `.describe()` 同步进 Swagger。 */

/** 入队翻译入参：可选 providerId——无默认翻译模型时由前端弹窗选定，一次性指定本次用模型。 */
export const enqueueSchema = z.object({
  providerId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('本次翻译用的模型 id；省略走默认翻译模型（再回落 active provider）'),
});
export class EnqueueDto extends createZodDto(enqueueSchema) {}

/** 批量补翻入参：导出同款筛选（since/强度/版块/上限）+ 可选 providerId（不传走默认翻译模型）。 */
export const batchSchema = z.object({
  since: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('只翻该 Unix 秒之后产生的洞察对应帖子；省略=不限时间'),
  minIntensity: z
    .enum(['LOW', 'MEDIUM', 'HIGH'])
    .optional()
    .describe('最低痛点强度过滤；省略=各强度都翻'),
  subreddit: z.string().trim().min(1).optional().describe('限定版块；省略=全部版块'),
  limit: z.number().int().positive().optional().describe('命中帖子数上限；省略=不设上限'),
  providerId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('本次翻译用的模型 id；省略走默认翻译模型'),
});
export class BatchDto extends createZodDto(batchSchema) {}
