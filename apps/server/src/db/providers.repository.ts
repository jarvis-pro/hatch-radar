import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { modelProviders, type AppDatabase, type ProviderRow } from '@hatch-radar/db';
import { decryptSecret, encryptSecret } from '../crypto';
import { DRIZZLE } from '../common/tokens';

/** 支持的模型厂商 */
export type ProviderKind = ProviderRow['provider'];
export type { ProviderRow };

/** 新建/更新模型时的输入（apiKey 为明文，入库前加密） */
export interface ProviderInput {
  provider: ProviderKind;
  label: string;
  apiKey: string;
  baseUrl?: string | null;
  model: string;
  enabled?: boolean;
}

/** 脱敏视图：API 返回用，永不含明文密钥 */
export interface ProviderDTO {
  id: number;
  provider: ProviderKind;
  label: string;
  model: string;
  baseUrl: string | null;
  enabled: boolean;
  /** 是否已存密钥 */
  hasKey: boolean;
  /** 仅供展示的脱敏密钥，如 `sk-a…wxyz` */
  keyMasked: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 生成脱敏密钥串：解密后取首尾片段展示，如 `sk-a…wxyz`。
 * - 解密仅为做掩码展示；失败（密钥变更/损坏）时给出占位提示
 */
function maskKey(cipher: string): string {
  try {
    const plain = decryptSecret(cipher);
    return plain.length <= 8 ? '••••' : `${plain.slice(0, 4)}…${plain.slice(-4)}`;
  } catch {
    return '(无法解密，请重填)';
  }
}

/** 把行转成脱敏 DTO（API 返回用）。 */
export function toProviderDTO(row: ProviderRow): ProviderDTO {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    model: row.model,
    baseUrl: row.base_url,
    enabled: row.enabled,
    hasKey: row.api_key.length > 0,
    keyMasked: maskKey(row.api_key),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 模型清单数据访问（异步 Drizzle / PostgreSQL）。
 * api_key 始终以密文存取；脱敏由 {@link toProviderDTO} 在边界完成。
 */
@Injectable()
export class ProvidersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: AppDatabase) {}

  /** 列出全部模型配置（含密文，仅服务端内部使用） */
  listProviders(): Promise<ProviderRow[]> {
    return this.db.select().from(modelProviders).orderBy(asc(modelProviders.id));
  }

  /** 按 ID 取单条模型配置 */
  async getProvider(id: number): Promise<ProviderRow | undefined> {
    const rows = await this.db
      .select()
      .from(modelProviders)
      .where(eq(modelProviders.id, id))
      .limit(1);
    return rows[0];
  }

  /**
   * 新建模型配置（密钥加密入库）。
   * @param input 明文输入
   * @param now 当前 Unix 时间戳（秒）
   * @returns 新建记录的自增 ID
   */
  async createProvider(input: ProviderInput, now: number): Promise<number> {
    const [row] = await this.db
      .insert(modelProviders)
      .values({
        provider: input.provider,
        label: input.label,
        api_key: encryptSecret(input.apiKey),
        base_url: input.baseUrl ?? null,
        model: input.model,
        enabled: input.enabled !== false,
        created_at: now,
        updated_at: now,
      })
      .returning({ id: modelProviders.id });
    return row.id;
  }

  /**
   * 更新模型配置（仅更新提供的字段）。
   * - `apiKey` 留空/未提供时保留原密钥，否则重新加密入库
   * @param id 目标记录 ID
   * @param fields 待更新字段（均可选）
   * @param now 当前 Unix 时间戳（秒）
   * @returns 是否有记录被更新
   */
  async updateProvider(id: number, fields: Partial<ProviderInput>, now: number): Promise<boolean> {
    const set: Partial<typeof modelProviders.$inferInsert> = {};
    if (fields.provider !== undefined) set.provider = fields.provider;
    if (fields.label !== undefined) set.label = fields.label;
    if (fields.apiKey !== undefined && fields.apiKey !== '')
      set.api_key = encryptSecret(fields.apiKey);
    if (fields.baseUrl !== undefined) set.base_url = fields.baseUrl ?? null;
    if (fields.model !== undefined) set.model = fields.model;
    if (fields.enabled !== undefined) set.enabled = fields.enabled;
    if (Object.keys(set).length === 0) return false;
    set.updated_at = now;
    const res = await this.db
      .update(modelProviders)
      .set(set)
      .where(eq(modelProviders.id, id))
      .returning({ id: modelProviders.id });
    return res.length > 0;
  }

  /** 删除模型配置 */
  async deleteProvider(id: number): Promise<boolean> {
    const res = await this.db
      .delete(modelProviders)
      .where(eq(modelProviders.id, id))
      .returning({ id: modelProviders.id });
    return res.length > 0;
  }
}
