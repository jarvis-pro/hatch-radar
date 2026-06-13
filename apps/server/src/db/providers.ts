import { decryptSecret, encryptSecret } from '../crypto';
import { getDb } from './schema';

/** 支持的模型厂商 */
export type ProviderKind = 'anthropic' | 'openai' | 'deepseek';

/** model_providers 表的行结构（api_key 为密文） */
export interface ProviderRow {
  id: number;
  provider: ProviderKind;
  label: string;
  /** 密文（AES-256-GCM），切勿直接外发 */
  api_key: string;
  base_url: string | null;
  model: string;
  /** 0/1 */
  enabled: number;
  created_at: number;
  updated_at: number;
}

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

/** 列出全部模型配置（含密文，仅服务端内部使用） */
export function listProviders(): ProviderRow[] {
  return getDb().prepare(`SELECT * FROM model_providers ORDER BY id`).all() as ProviderRow[];
}

/** 按 ID 取单条模型配置 */
export function getProvider(id: number): ProviderRow | undefined {
  return getDb().prepare(`SELECT * FROM model_providers WHERE id = ?`).get(id) as
    | ProviderRow
    | undefined;
}

/**
 * 新建模型配置（密钥加密入库）。
 * @param input 明文输入
 * @param now 当前 Unix 时间戳（秒）
 * @returns 新建记录的自增 ID
 */
export function createProvider(input: ProviderInput, now: number): number {
  const info = getDb()
    .prepare(
      `INSERT INTO model_providers (provider, label, api_key, base_url, model, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.provider,
      input.label,
      encryptSecret(input.apiKey),
      input.baseUrl ?? null,
      input.model,
      input.enabled === false ? 0 : 1,
      now,
      now,
    );
  return Number(info.lastInsertRowid);
}

/**
 * 更新模型配置（仅更新提供的字段）。
 * - `apiKey` 留空/未提供时保留原密钥，否则重新加密入库
 * @param id 目标记录 ID
 * @param fields 待更新字段（均可选）
 * @param now 当前 Unix 时间戳（秒）
 * @returns 是否有记录被更新
 */
export function updateProvider(id: number, fields: Partial<ProviderInput>, now: number): boolean {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (fields.provider !== undefined) {
    sets.push('provider = ?');
    params.push(fields.provider);
  }
  if (fields.label !== undefined) {
    sets.push('label = ?');
    params.push(fields.label);
  }
  if (fields.apiKey !== undefined && fields.apiKey !== '') {
    sets.push('api_key = ?');
    params.push(encryptSecret(fields.apiKey));
  }
  if (fields.baseUrl !== undefined) {
    sets.push('base_url = ?');
    params.push(fields.baseUrl ?? null);
  }
  if (fields.model !== undefined) {
    sets.push('model = ?');
    params.push(fields.model);
  }
  if (fields.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(fields.enabled ? 1 : 0);
  }
  if (sets.length === 0) return false;
  sets.push('updated_at = ?');
  params.push(now, id);
  return (
    getDb()
      .prepare(`UPDATE model_providers SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params).changes > 0
  );
}

/** 删除模型配置 */
export function deleteProvider(id: number): boolean {
  return getDb().prepare(`DELETE FROM model_providers WHERE id = ?`).run(id).changes > 0;
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

/**
 * 把行转成脱敏 DTO（API 返回用）。
 */
export function toProviderDTO(row: ProviderRow): ProviderDTO {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    model: row.model,
    baseUrl: row.base_url,
    enabled: row.enabled === 1,
    hasKey: row.api_key.length > 0,
    keyMasked: maskKey(row.api_key),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
