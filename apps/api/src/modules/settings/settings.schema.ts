import { z } from 'zod';

/** SettingsController（/api/settings/*）入参校验 schema（zod）+ 推导 DTO 类型。 */

/** AI / 翻译 provider 的 5 种类型：前三为 API Key 模式，claude_cli 为订阅模式，azure 仅翻译。 */
const providerKind = z.enum(['anthropic', 'openai', 'deepseek', 'claude_cli', 'azure']);

/** 新建模型入参：provider 类型 + 标量字段 + 第一把 Key（密钥加密入库）。 */
export const createProviderSchema = z.object({
  /** provider 类型，决定 Key 模式 / 调用客户端 */
  provider: providerKind,
  /** 模型展示名（列表 / 下拉用），非空 */
  label: z.string().trim().min(1),
  /** claude_cli 订阅模式无需 Key（复用本机登录态）；其余 provider 在服务内强制必填 */
  apiKey: z.string().trim().min(1).optional(),
  /** 自定义 API 基址（自建网关 / 兼容端点）；省略走 provider 默认 */
  baseUrl: z.string().trim().optional(),
  /** Azure Translator 资源区域（如 eastasia）；仅 azure 用 */
  region: z.string().trim().optional(),
  /** 调用的模型 ID（如 claude-opus-4-8 / gpt-4o），非空 */
  model: z.string().trim().min(1),
  /** 是否启用；省略走服务默认（一般启用） */
  enabled: z.boolean().optional(),
  /** 输入 token 单价（美元 / 1M tokens）；省略=不设，用于成本核算 */
  inputPrice: z.number().nonnegative().nullable().optional(),
  /** 输出 token 单价（美元 / 1M tokens）；省略=不设 */
  outputPrice: z.number().nonnegative().nullable().optional(),
});
export type CreateProviderDto = z.infer<typeof createProviderSchema>;

/** 更新模型标量字段入参：每项可省略（不改）；密钥走 Key 池端点，不在此处改。 */
export const updateProviderSchema = z.object({
  /** 改 provider 类型；省略=不改 */
  provider: providerKind.optional(),
  /** 改展示名（非空）；省略=不改 */
  label: z.string().trim().min(1).optional(),
  /** 改默认 Key（兼容旧单 Key 写法）；省略=不改 */
  apiKey: z.string().trim().optional(),
  /** 改 API 基址（改后服务强制要求重填 Key 防错配）；省略=不改 */
  baseUrl: z.string().trim().optional(),
  /** Azure Translator 资源区域；仅 azure 用，'' 清除 */
  region: z.string().trim().optional(),
  /** 改模型 ID（非空）；省略=不改 */
  model: z.string().trim().min(1).optional(),
  /** 改启停；省略=不改 */
  enabled: z.boolean().optional(),
  /** 输入 token 单价（美元 / 1M tokens）；null=清除、省略=不改 */
  inputPrice: z.number().nonnegative().nullable().optional(),
  /** 输出 token 单价（美元 / 1M tokens）；null=清除、省略=不改 */
  outputPrice: z.number().nonnegative().nullable().optional(),
});
export type UpdateProviderDto = z.infer<typeof updateProviderSchema>;

/** 新增一把备用 Key 入参（密钥加密入库）。 */
export const createKeySchema = z.object({
  /** API Key 明文（加密入库，仅脱敏外发），非空 */
  apiKey: z.string().trim().min(1),
  /** Key 备注（区分多把 Key）；省略=无备注 */
  label: z.string().trim().optional(),
  /** 故障转移优先级，数字越小越优先；省略走服务默认 */
  priority: z.number().int().min(0).optional(),
});
export type CreateKeyDto = z.infer<typeof createKeySchema>;

/** 更新一把 Key 入参：改备注 / 优先级 / 启停，或人工复位状态。 */
export const updateKeySchema = z.object({
  /** 改备注；省略=不改 */
  label: z.string().trim().optional(),
  /** 改优先级；省略=不改 */
  priority: z.number().int().min(0).optional(),
  /** 改启停；省略=不改 */
  enabled: z.boolean().optional(),
  /** 把 cooling/invalid 的 Key 复位为 active（人工排障后恢复使用） */
  reset: z.boolean().optional(),
});
export type UpdateKeyDto = z.infer<typeof updateKeySchema>;

/** 选用模型 / 翻译模型入参：providerId 为目标模型，null 表示清空选用。 */
export const activeProviderSchema = z.object({
  /** 目标模型 id；null=不选用任何模型（停掉对应自动流程） */
  providerId: z.number().int().nullable(),
});
export type ActiveProviderDto = z.infer<typeof activeProviderSchema>;

/**
 * 运行期参数写入入参：每项可省略（不变）/ 给整数（写入）。下界与 RuntimeSettingsService 一致，
 * 避免从设置页填出会让 worker / 会话失常的值。「恢复默认」由前端以默认值发起，等同普通写入。
 */
export const runtimeSettingsSchema = z
  .object({
    /** 每轮入队的分析任务条数上限 */
    analyzeBatchSize: z.number().int().min(1),
    /** 会话空闲过期天数（无活动多久登出） */
    sessionIdleDays: z.number().int().min(1),
    /** 会话绝对过期天数（无论是否活动的硬上限） */
    sessionAbsoluteDays: z.number().int().min(1),
    /** 单个任务执行超时（毫秒），超时判定僵死回收 */
    workerJobTimeoutMs: z.number().int().min(1000),
    /** 认领后多少秒无心跳判为僵死、可被重认领 */
    workerStaleSeconds: z.number().int().min(30),
    /** 翻译任务并发上限 */
    translationConcurrency: z.number().int().min(1),
  })
  .partial();
export type RuntimeSettingsDto = z.infer<typeof runtimeSettingsSchema>;
