import { z } from 'zod';

/** SourcesController / SourceConnectorsController（/api/sources/*、/api/source-connectors/*）入参校验 schema（zod）+ 推导 DTO 类型。 */

/** 采集平台：Reddit / HackerNews / RSS。 */
const platformEnum = z.enum(['reddit', 'hackernews', 'rss']);

/** 连接器凭据：自由字符串 KV（如 clientId/clientSecret/...），加密入库后仅脱敏外发。 */
const secretSchema = z.record(z.string(), z.string());

/** 新建采集来源（爬虫计划）入参。 */
export const createSourceSchema = z.object({
  /** 来源所属平台 */
  platform: platformEnum,
  /** 来源标识（版块名 / RSS 地址 / 频道），非空 */
  identifier: z.string().trim().min(1),
  /** 展示名；省略=用 identifier */
  label: z.string().trim().optional(),
  /** 平台特定配置（如抓取范围 / 排序），自由 KV；省略=默认 */
  config: z.record(z.string(), z.unknown()).optional(),
  /** 是否启用采集；省略走服务默认 */
  enabled: z.boolean().optional(),
});
export type CreateSourceDto = z.infer<typeof createSourceSchema>;

/** 更新采集来源入参：每项可省略（不改）。 */
export const updateSourceSchema = z.object({
  /** 改来源标识（非空）；省略=不改 */
  identifier: z.string().trim().min(1).optional(),
  /** 改展示名；省略=不改 */
  label: z.string().trim().optional(),
  /** 改平台配置（整体覆盖）；省略=不改 */
  config: z.record(z.string(), z.unknown()).optional(),
  /** 改启停（启用走 Reddit 门禁）；省略=不改 */
  enabled: z.boolean().optional(),
});
export type UpdateSourceDto = z.infer<typeof updateSourceSchema>;

/** 新建采集连接器入参：平台 + 鉴权方式 + 凭据（oauth 凭据完整性见 superRefine）。 */
export const createConnectorSchema = z
  .object({
    /** 连接器服务的平台 */
    platform: platformEnum,
    /** 鉴权方式：oauth（官方 API 凭据）/ scrape（爬虫，无需凭据） */
    authKind: z.enum(['oauth', 'scrape']),
    /** 展示名；省略=自动命名 */
    label: z.string().trim().optional(),
    /** 故障转移优先级，数字越小越优先；省略走服务默认 */
    priority: z.number().int().min(0).optional(),
    /** 是否启用；省略走服务默认 */
    enabled: z.boolean().optional(),
    /** 凭据 KV（加密入库）；oauth 必须含 clientId/clientSecret/username/password/userAgent */
    secret: secretSchema,
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
export type CreateConnectorDto = z.infer<typeof createConnectorSchema>;

/** 更新采集连接器入参：每项可省略（不改）；改 secret 会清空上次测试结果。 */
export const updateConnectorSchema = z.object({
  /** 改展示名；省略=不改 */
  label: z.string().trim().optional(),
  /** 改优先级；省略=不改 */
  priority: z.number().int().min(0).optional(),
  /** 改启停；省略=不改 */
  enabled: z.boolean().optional(),
  /** 改凭据（整体覆盖，加密入库，清空测试结果须重测）；省略=不改 */
  secret: secretSchema.optional(),
});
export type UpdateConnectorDto = z.infer<typeof updateConnectorSchema>;
