import { z } from 'zod';

/** BlueprintsController / ProcessesController（/api/blueprints/*、/api/processes/*）入参校验 schema（zod）+ 推导 DTO 类型。字段 `.describe()` 同步进 Swagger。 */

/** 图纸的一个采集来源项：平台 + 该平台下的频道/版块清单。 */
const sourceSchema = z.object({
  kind: z.enum(['reddit', 'hackernews', 'rss']).describe('来源平台'),
  channels: z.array(z.string()).describe('该平台下要抓的频道 / 版块 / RSS 地址列表'),
});

/** 新建图纸（纯配方）入参：类型 + 标识 + 采集来源 + 参数 + 闸门 + 启用节点。 */
export const createBlueprintSchema = z.object({
  kind: z.enum(['collect', 'recheck']).describe('图纸类型：collect 采集 / recheck 复查'),
  label: z.string().trim().min(1).describe('图纸展示名，非空'),
  note: z.string().trim().optional().describe('备注说明；省略=无'),
  sources: z.array(sourceSchema).optional().describe('采集来源清单（collect 用）；省略=无来源'),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('图纸参数（间隔 / 退避 / 阈值等），自由 KV；省略=默认'),
  gates: z.array(z.string()).optional().describe('默认开闸的节点 key 列表（逐节点暂停）；省略=不开闸'),
  enabledStages: z.array(z.string()).optional().describe('启用的执行节点 key 列表；省略=全部节点'),
});
export type CreateBlueprintDto = z.infer<typeof createBlueprintSchema>;

/** 更新图纸入参：每项可省略（不改）；kind 不可改（建后固定）。 */
export const updateBlueprintSchema = z.object({
  label: z.string().trim().min(1).optional().describe('改展示名（非空）；省略=不改'),
  note: z.string().trim().optional().describe('改备注；省略=不改'),
  sources: z.array(sourceSchema).optional().describe('改采集来源（整体覆盖）；省略=不改'),
  params: z.record(z.string(), z.unknown()).optional().describe('改图纸参数（整体覆盖）；省略=不改'),
  gates: z.array(z.string()).optional().describe('改开闸节点（整体覆盖）；省略=不改'),
  enabledStages: z.array(z.string()).optional().describe('改启用节点（整体覆盖）；省略=不改'),
});
export type UpdateBlueprintDto = z.infer<typeof updateBlueprintSchema>;

/** 进程触发节奏（按 kind 判别）：单次 / 固定间隔 / cron 表达式。 */
const triggerSchema = z.discriminatedUnion('kind', [
  /** once：手动单次触发，无额外参数 */
  z.object({ kind: z.literal('once') }),
  /** interval：每 everySec 秒触发一次 */
  z.object({
    kind: z.literal('interval'),
    everySec: z.number().int().positive().describe('触发间隔秒数'),
  }),
  /** cron：按 expr（cron 表达式）触发 */
  z.object({
    kind: z.literal('cron'),
    expr: z.string().trim().min(1).describe('cron 表达式'),
  }),
]);

/** 新建进程（图纸 + 触发节奏）入参。 */
export const createProcessSchema = z.object({
  blueprintId: z.number().int().positive().describe('绑定的图纸 id（blueprints.id）'),
  label: z.string().trim().min(1).describe('进程展示名，非空'),
  trigger: triggerSchema.describe('触发节奏（once / interval / cron）'),
});
export type CreateProcessDto = z.infer<typeof createProcessSchema>;

/** 更新进程入参：每项可省略（不改）；不可改绑定图纸。 */
export const updateProcessSchema = z.object({
  label: z.string().trim().min(1).optional().describe('改展示名（非空）；省略=不改'),
  trigger: triggerSchema.optional().describe('改触发节奏；省略=不改'),
});
export type UpdateProcessDto = z.infer<typeof updateProcessSchema>;
