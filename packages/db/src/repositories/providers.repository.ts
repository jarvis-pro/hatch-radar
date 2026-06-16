import {
  toProviderApiKeyRow,
  toProviderRow,
  type AppDatabase,
  type ProviderApiKeyRow,
  type ProviderRow,
} from '../internal';
import { decryptSecret, encryptSecret } from '@hatch-radar/kernel';

/** 支持的模型厂商 */
export type ProviderKind = ProviderRow['provider'];
/** API Key 运行期健康态：active 可用 / cooling 限流冷却中 / invalid 鉴权失败需人工 */
export type ApiKeyStatus = ProviderApiKeyRow['status'];
export type { ProviderRow, ProviderApiKeyRow };

/** 新建/更新模型接入配置的标量字段（不含密钥——密钥走 Key 池） */
export interface ProviderInput {
  provider: ProviderKind;
  label: string;
  baseUrl?: string | null;
  model: string;
  enabled?: boolean;
  /** 输入/输出 token 单价（美元 / 1M tokens）；undefined=不改，null=清除 */
  inputPrice?: number | null;
  outputPrice?: number | null;
}

/** 新建一把 Key 的输入（apiKey 为明文，入库前加密） */
export interface KeyInput {
  apiKey: string;
  label?: string;
  priority?: number;
}

/** 更新一把 Key 的可改字段；reset=true 时把 cooling/invalid 复位为 active */
export interface KeyUpdate {
  label?: string;
  priority?: number;
  enabled?: boolean;
  reset?: boolean;
}

/** 脱敏的单把 Key 视图：API 返回用，永不含明文密钥 */
export interface ProviderKeyDTO {
  id: number;
  label: string;
  priority: number;
  enabled: boolean;
  status: ApiKeyStatus;
  /** 仅供展示的脱敏密钥，如 `sk-a…wxyz` */
  keyMasked: string;
  /** cooling 的解冻时刻（epoch 秒），active/invalid 时为 null */
  cooldownUntil: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 脱敏的模型接入配置视图：含 Key 池摘要，永不含明文密钥 */
export interface ProviderDTO {
  id: number;
  provider: ProviderKind;
  label: string;
  model: string;
  baseUrl: string | null;
  enabled: boolean;
  /** 输入 token 单价（美元 / 1M tokens），未配置为 null */
  inputPrice: number | null;
  /** 输出 token 单价（美元 / 1M tokens），未配置为 null */
  outputPrice: number | null;
  /** Key 池（已脱敏，按 priority 升序） */
  keys: ProviderKeyDTO[];
  createdAt: number;
  updatedAt: number;
}

/** 模型接入配置 + 其 Key 池（仅服务端内部使用，keys 含密文） */
export interface ProviderWithKeys {
  provider: ProviderRow;
  keys: ProviderApiKeyRow[];
}

/**
 * 生成脱敏密钥串：解密后取首尾片段展示，如 `sk-a…wxyz`。
 * - 解密仅为做掩码展示；失败（SETTINGS_SECRET 变更/密文损坏）时给出占位提示
 */
function maskKey(cipher: string): string {
  try {
    const plain = decryptSecret(cipher);
    return plain.length <= 8 ? '••••' : `${plain.slice(0, 4)}…${plain.slice(-4)}`;
  } catch {
    return '(无法解密，请重填)';
  }
}

/** 把一把 Key 行转成脱敏 DTO（API 返回用）。 */
export function toProviderKeyDTO(k: ProviderApiKeyRow): ProviderKeyDTO {
  return {
    id: k.id,
    label: k.label,
    priority: k.priority,
    enabled: k.enabled,
    status: k.status,
    keyMasked: maskKey(k.api_key),
    cooldownUntil: k.cooldown_until,
    lastError: k.last_error,
    createdAt: k.created_at,
    updatedAt: k.updated_at,
  };
}

/** 把「模型 + Key 池」转成脱敏 DTO（API 返回用）。 */
export function toProviderDTO({ provider, keys }: ProviderWithKeys): ProviderDTO {
  return {
    id: provider.id,
    provider: provider.provider,
    label: provider.label,
    model: provider.model,
    baseUrl: provider.base_url,
    enabled: provider.enabled,
    inputPrice: provider.input_price,
    outputPrice: provider.output_price,
    keys: keys.map(toProviderKeyDTO),
    createdAt: provider.created_at,
    updatedAt: provider.updated_at,
  };
}

/**
 * 模型清单 + Key 池数据访问（Prisma / PostgreSQL）。
 * api_key 始终以密文存取；脱敏由 {@link toProviderDTO} 在边界完成，明文永不外发。
 */
export class ProvidersRepository {
  constructor(private readonly db: AppDatabase) {}

  // ── 模型接入配置（标量） ───────────────────────────────────────────────

  /** 列出全部模型配置（标量，不含 Key） */
  async listProviders(): Promise<ProviderRow[]> {
    const rows = await this.db.model_providers.findMany({ orderBy: { id: 'asc' } });
    return rows.map(toProviderRow);
  }

  /** 按 ID 取单条模型配置（标量） */
  async getProvider(id: number): Promise<ProviderRow | undefined> {
    const row = await this.db.model_providers.findUnique({ where: { id } });
    return row ? toProviderRow(row) : undefined;
  }

  /** 列出全部模型配置及其 Key 池（脱敏前的内部视图，供 DTO 组装） */
  async listProvidersWithKeys(): Promise<ProviderWithKeys[]> {
    const providers = await this.listProviders();
    const allKeys = (
      await this.db.provider_api_keys.findMany({
        orderBy: [{ provider_id: 'asc' }, { priority: 'asc' }, { id: 'asc' }],
      })
    ).map(toProviderApiKeyRow);
    const byProvider = new Map<number, ProviderApiKeyRow[]>();
    for (const k of allKeys) {
      const arr = byProvider.get(k.provider_id);
      if (arr) arr.push(k);
      else byProvider.set(k.provider_id, [k]);
    }
    return providers.map((provider) => ({ provider, keys: byProvider.get(provider.id) ?? [] }));
  }

  /** 取单条模型配置及其 Key 池；不存在时返回 undefined */
  async getProviderWithKeys(id: number): Promise<ProviderWithKeys | undefined> {
    const provider = await this.getProvider(id);
    if (!provider) return undefined;
    return { provider, keys: await this.listKeysForProvider(id) };
  }

  /**
   * 新建模型配置（同时落第一把 Key，整体在事务内完成）。
   * @param input 标量字段
   * @param firstKey 第一把 API Key 明文（加密入库，priority 0、label 'primary'）；
   *   传 `null` 表示无 Key 接入（claude_cli 订阅模式，靠本机登录态，不入 Key 池）。
   * @param now 当前 Unix 时间戳（秒）
   * @returns 新建记录的自增 ID
   */
  async createProvider(
    input: ProviderInput,
    firstKey: string | null,
    now: number,
  ): Promise<number> {
    return this.db.$transaction(async (tx) => {
      const row = await tx.model_providers.create({
        data: {
          provider: input.provider,
          label: input.label,
          base_url: input.baseUrl ?? null,
          model: input.model,
          enabled: input.enabled !== false,
          input_price: input.inputPrice ?? null,
          output_price: input.outputPrice ?? null,
          created_at: BigInt(now),
          updated_at: BigInt(now),
        },
        select: { id: true },
      });
      // 订阅模式（firstKey=null）不落 Key 行：其 Key 池恒空，调用经 query() 复用本机登录态。
      if (firstKey !== null) {
        await tx.provider_api_keys.create({
          data: {
            provider_id: row.id,
            label: 'primary',
            api_key: encryptSecret(firstKey),
            priority: 0,
            enabled: true,
            status: 'active',
            created_at: BigInt(now),
            updated_at: BigInt(now),
          },
        });
      }
      return row.id;
    });
  }

  /**
   * 更新模型配置标量字段（不含密钥；密钥走 Key 池端点）。
   * @returns 是否有记录被更新
   */
  async updateProvider(id: number, fields: Partial<ProviderInput>, now: number): Promise<boolean> {
    const data: Record<string, unknown> = {};
    if (fields.provider !== undefined) data.provider = fields.provider;
    if (fields.label !== undefined) data.label = fields.label;
    if (fields.baseUrl !== undefined) data.base_url = fields.baseUrl ?? null;
    if (fields.model !== undefined) data.model = fields.model;
    if (fields.enabled !== undefined) data.enabled = fields.enabled;
    if (fields.inputPrice !== undefined) data.input_price = fields.inputPrice;
    if (fields.outputPrice !== undefined) data.output_price = fields.outputPrice;
    if (Object.keys(data).length === 0) return false;
    data.updated_at = BigInt(now);
    const res = await this.db.model_providers.updateMany({ where: { id }, data });
    return res.count > 0;
  }

  /**
   * 改 base_url 的安全闸用：更新标量字段并把整个 Key 池替换成一把新 Key（事务内）。
   * 改 base_url 时若不重置密钥，旧密钥会被发往新地址——故强制连同重填，旧 Key 全清。
   * @param newKey 新的唯一 API Key 明文（加密入库为 priority 0 主 Key）
   */
  async updateProviderAndResetKeys(
    id: number,
    fields: Partial<ProviderInput>,
    newKey: string,
    now: number,
  ): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const data: Record<string, unknown> = { updated_at: BigInt(now) };
      if (fields.provider !== undefined) data.provider = fields.provider;
      if (fields.label !== undefined) data.label = fields.label;
      if (fields.baseUrl !== undefined) data.base_url = fields.baseUrl ?? null;
      if (fields.model !== undefined) data.model = fields.model;
      if (fields.enabled !== undefined) data.enabled = fields.enabled;
      if (fields.inputPrice !== undefined) data.input_price = fields.inputPrice;
      if (fields.outputPrice !== undefined) data.output_price = fields.outputPrice;
      const res = await tx.model_providers.updateMany({ where: { id }, data });
      if (res.count === 0) return false;
      await tx.provider_api_keys.deleteMany({ where: { provider_id: id } });
      await tx.provider_api_keys.create({
        data: {
          provider_id: id,
          label: 'primary',
          api_key: encryptSecret(newKey),
          priority: 0,
          enabled: true,
          status: 'active',
          created_at: BigInt(now),
          updated_at: BigInt(now),
        },
      });
      return true;
    });
  }

  /** 删除模型配置（其 Key 池随外键级联删除） */
  async deleteProvider(id: number): Promise<boolean> {
    const res = await this.db.model_providers.deleteMany({ where: { id } });
    return res.count > 0;
  }

  // ── API Key 池 ────────────────────────────────────────────────────────

  /** 列出某模型的全部 Key（按 priority 升序；含密文，仅内部用） */
  async listKeysForProvider(providerId: number): Promise<ProviderApiKeyRow[]> {
    const rows = await this.db.provider_api_keys.findMany({
      where: { provider_id: providerId },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toProviderApiKeyRow);
  }

  /** 按 ID 取单把 Key（含密文，仅内部用） */
  async getKey(keyId: number): Promise<ProviderApiKeyRow | undefined> {
    const row = await this.db.provider_api_keys.findUnique({ where: { id: keyId } });
    return row ? toProviderApiKeyRow(row) : undefined;
  }

  /**
   * 取某模型当前「可用」的 Key（按优先级升序）：enabled 且 status=active，
   * 或 status=cooling 但已过 cooldown_until（视为已解冻）。供故障转移选取与逐把切换。
   * @param now 当前 Unix 时间戳（秒）
   */
  async listUsableKeys(providerId: number, now: number): Promise<ProviderApiKeyRow[]> {
    const rows = await this.db.provider_api_keys.findMany({
      where: {
        provider_id: providerId,
        enabled: true,
        OR: [{ status: 'active' }, { status: 'cooling', cooldown_until: { lte: BigInt(now) } }],
      },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toProviderApiKeyRow);
  }

  /** 新增一把 Key（密钥加密入库），返回自增 ID */
  async createKey(providerId: number, input: KeyInput, now: number): Promise<number> {
    const row = await this.db.provider_api_keys.create({
      data: {
        provider_id: providerId,
        label: input.label ?? '',
        api_key: encryptSecret(input.apiKey),
        priority: input.priority ?? 0,
        enabled: true,
        status: 'active',
        created_at: BigInt(now),
        updated_at: BigInt(now),
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * 更新一把 Key 的备注/优先级/启停；reset=true 时把状态复位为 active 并清冷却/错误。
   * @returns 是否有记录被更新
   */
  async updateKey(keyId: number, fields: KeyUpdate, now: number): Promise<boolean> {
    const data: Record<string, unknown> = {};
    if (fields.label !== undefined) data.label = fields.label;
    if (fields.priority !== undefined) data.priority = fields.priority;
    if (fields.enabled !== undefined) data.enabled = fields.enabled;
    if (fields.reset) {
      data.status = 'active';
      data.cooldown_until = null;
      data.last_error = null;
    }
    if (Object.keys(data).length === 0) return false;
    data.updated_at = BigInt(now);
    const res = await this.db.provider_api_keys.updateMany({ where: { id: keyId }, data });
    return res.count > 0;
  }

  /** 删除一把 Key */
  async deleteKey(keyId: number): Promise<boolean> {
    const res = await this.db.provider_api_keys.deleteMany({ where: { id: keyId } });
    return res.count > 0;
  }

  /** 统计某模型「可用」Key 数（enabled 且 active/已解冻 cooling），用于设为 active 前的校验 */
  async countUsableKeys(providerId: number, now: number): Promise<number> {
    return this.db.provider_api_keys.count({
      where: {
        provider_id: providerId,
        enabled: true,
        OR: [{ status: 'active' }, { status: 'cooling', cooldown_until: { lte: BigInt(now) } }],
      },
    });
  }

  /**
   * 标记一把 Key 进入限流冷却：到 cooldownUntil 前不再选用，之后自动恢复可用。
   * @param cooldownUntil 解冻时刻（epoch 秒）
   */
  async markKeyCooling(
    keyId: number,
    cooldownUntil: number,
    error: string,
    now: number,
  ): Promise<void> {
    await this.db.provider_api_keys.update({
      where: { id: keyId },
      data: {
        status: 'cooling',
        cooldown_until: BigInt(cooldownUntil),
        last_error: error.slice(0, 500),
        updated_at: BigInt(now),
      },
    });
  }

  /** 标记一把 Key 失效（鉴权失败/额度耗尽，需人工复位），不自动恢复 */
  async markKeyInvalid(keyId: number, error: string, now: number): Promise<void> {
    await this.db.provider_api_keys.update({
      where: { id: keyId },
      data: {
        status: 'invalid',
        cooldown_until: null,
        last_error: error.slice(0, 500),
        updated_at: BigInt(now),
      },
    });
  }
}
