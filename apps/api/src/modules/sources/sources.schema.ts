import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** SourcesController / SourceConnectorsController（/api/sources/*、/api/source-connectors/*）入参校验 schema（zod）+ 推导 DTO 类型。字段 `.describe()` 同步进 Swagger。 */

/** 采集平台：Reddit / HackerNews / RSS。 */
const platformEnum = z.enum(['reddit', 'hackernews', 'rss']);

/** 连接器凭据：自由字符串 KV（如 clientId/clientSecret/...），加密入库后仅脱敏外发。 */
const secretSchema = z.record(z.string(), z.string());

/** 新建采集来源（爬虫计划）入参。 */
export const createSourceSchema = z.object({
  platform: platformEnum.describe('来源所属平台'),
  identifier: z.string().trim().min(1).describe('来源标识（版块名 / RSS 地址 / 频道），非空'),
  label: z.string().trim().optional().describe('展示名；省略=用 identifier'),
  config: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('平台特定配置（如抓取范围 / 排序），自由 KV；省略=默认'),
  enabled: z.boolean().optional().describe('是否启用采集；省略走服务默认'),
});
export class CreateSourceDto extends createZodDto(createSourceSchema) {}

/** 更新采集来源入参：每项可省略（不改）。 */
export const updateSourceSchema = z.object({
  identifier: z.string().trim().min(1).optional().describe('改来源标识（非空）；省略=不改'),
  label: z.string().trim().optional().describe('改展示名；省略=不改'),
  config: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('改平台配置（整体覆盖）；省略=不改'),
  enabled: z.boolean().optional().describe('改启停（启用走 Reddit 门禁）；省略=不改'),
});
export class UpdateSourceDto extends createZodDto(updateSourceSchema) {}

/** 新建采集连接器入参：平台 + 鉴权方式 + 凭据（oauth 凭据完整性见 superRefine）。 */
export const createConnectorSchema = z
  .object({
    platform: platformEnum.describe('连接器服务的平台'),
    authKind: z
      .enum(['oauth', 'scrape'])
      .describe('鉴权方式：oauth（官方 API 凭据）/ scrape（爬虫，无需凭据）'),
    label: z.string().trim().optional().describe('展示名；省略=自动命名'),
    priority: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('故障转移优先级，数字越小越优先；省略走服务默认'),
    enabled: z.boolean().optional().describe('是否启用；省略走服务默认'),
    secret: secretSchema.describe(
      '凭据 KV（加密入库）；oauth 必须含 clientId/clientSecret/username/password/userAgent',
    ),
  })
  .superRefine((d, ctx) => {
    if (d.authKind === 'oauth') {
      for (const k of ['clientId', 'clientSecret', 'username', 'password', 'userAgent']) {
        if (!d.secret[k]?.trim()) {
          ctx.addIssue({ code: 'custom', message: `oauth 凭据缺少 ${k}`, path: ['secret', k] });
        }
      }
    }
  });
export class CreateConnectorDto extends createZodDto(createConnectorSchema) {}

/** 更新采集连接器入参：每项可省略（不改）；改 secret 会清空上次测试结果。 */
export const updateConnectorSchema = z.object({
  label: z.string().trim().optional().describe('改展示名；省略=不改'),
  priority: z.number().int().min(0).optional().describe('改优先级；省略=不改'),
  enabled: z.boolean().optional().describe('改启停；省略=不改'),
  secret: secretSchema
    .optional()
    .describe('改凭据（整体覆盖，加密入库，清空测试结果须重测）；省略=不改'),
});
export class UpdateConnectorDto extends createZodDto(updateConnectorSchema) {}
