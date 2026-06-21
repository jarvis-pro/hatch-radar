import { toSourceConnectorRow, type AppDatabase, type SourceConnectorRow } from '../internal';
import { decryptSecret, encryptSecret } from '@/lib/kernel';

/** 数据来源平台 */
export type SourcePlatform = SourceConnectorRow['platform'];
/** 连接器鉴权方式：oauth(官方 API) | scrape(自托管爬虫) */
export type ConnectorAuthKind = SourceConnectorRow['auth_kind'];
export type { SourceConnectorRow };

/** Reddit OAuth 凭据：连接器 secret 的 JSON 明文形状（auth_kind=oauth） */
export interface RedditOAuthSecret {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent: string;
}

/** 新建连接器的输入（secret 为明文凭据，入库前加密为 JSON 密文） */
export interface ConnectorInput {
  platform: SourcePlatform;
  authKind: ConnectorAuthKind;
  secret: Record<string, unknown>;
  label?: string;
  priority?: number;
  enabled?: boolean;
}

/** 更新连接器：secret 提供时整体重设并清空上次连通性结果（需重新测试才可用） */
export interface ConnectorUpdate {
  label?: string;
  priority?: number;
  enabled?: boolean;
  secret?: Record<string, unknown>;
}

/** 脱敏连接器视图：永不含明文凭据 */
export interface ConnectorDTO {
  id: number;
  platform: SourcePlatform;
  label: string;
  authKind: ConnectorAuthKind;
  enabled: boolean;
  priority: number;
  /** 脱敏摘要，如 `clientId abc…xyz · u/username` */
  summary: string;
  /** 最近测试结果；null=从未测试（未测则不可用，门禁不放行其来源） */
  lastCheckOk: boolean | null;
  lastCheckAt: number | null;
  lastCheckError: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 把连接器密文凭据解密为明文对象（仅服务端内部用，如构建 Reddit 客户端） */
export function decryptConnectorSecret(row: SourceConnectorRow): Record<string, unknown> {
  return JSON.parse(decryptSecret(row.secret)) as Record<string, unknown>;
}

/** 生成连接器脱敏摘要：解密后只露非敏感片段（clientId 掩码 + 账号名）；失败给占位 */
function summarize(row: SourceConnectorRow): string {
  try {
    const s = decryptConnectorSecret(row);
    if (row.auth_kind === 'oauth') {
      const cid = String(s.clientId ?? '');
      const masked = cid.length <= 6 ? '••••' : `${cid.slice(0, 3)}…${cid.slice(-3)}`;
      const user = s.username ? ` · u/${String(s.username)}` : '';
      return `clientId ${masked}${user}`;
    }
    return '已配置';
  } catch {
    return '(无法解密，请重填)';
  }
}

/** 把连接器行转成脱敏 DTO（API 返回用）。 */
export function toConnectorDTO(row: SourceConnectorRow): ConnectorDTO {
  return {
    id: row.id,
    platform: row.platform,
    label: row.label,
    authKind: row.auth_kind,
    enabled: row.enabled,
    priority: row.priority,
    summary: summarize(row),
    lastCheckOk: row.last_check_ok,
    lastCheckAt: row.last_check_at,
    lastCheckError: row.last_check_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 采集连接器数据访问。需鉴权平台（Reddit）的凭据以加密 JSON 存取；脱敏由 {@link toConnectorDTO}
 * 在边界完成，明文永不外发。门禁判定「可用」= enabled 且 last_check_ok=true。
 */
export class SourceConnectorsRepository {
  constructor(private readonly db: AppDatabase) {}

  /** 列出全部连接器（按平台、优先级排序；含密文，仅内部用） */
  async listConnectors(): Promise<SourceConnectorRow[]> {
    const rows = await this.db.source_connectors.findMany({
      orderBy: [{ platform: 'asc' }, { priority: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toSourceConnectorRow);
  }

  /** 按 ID 取单个连接器 */
  async getConnector(id: number): Promise<SourceConnectorRow | undefined> {
    const row = await this.db.source_connectors.findUnique({ where: { id } });
    return row ? toSourceConnectorRow(row) : undefined;
  }

  /**
   * 取某平台当前「可用」的连接器（enabled 且最近测试通过），按优先级升序取第一条。
   * 用于抓取时选取凭据，以及来源门禁判定。
   */
  async getUsableConnector(platform: SourcePlatform): Promise<SourceConnectorRow | undefined> {
    const row = await this.db.source_connectors.findFirst({
      where: { platform, enabled: true, last_check_ok: true },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
    return row ? toSourceConnectorRow(row) : undefined;
  }

  /** 某平台是否有可用连接器（门禁：放行该平台的来源 enabled） */
  async hasUsableConnector(platform: SourcePlatform): Promise<boolean> {
    const count = await this.db.source_connectors.count({
      where: { platform, enabled: true, last_check_ok: true },
    });
    return count > 0;
  }

  /** 新建连接器（凭据 JSON 加密入库；last_check_* 留空，须测试通过后才可用） */
  async createConnector(input: ConnectorInput, now: number): Promise<number> {
    const row = await this.db.source_connectors.create({
      data: {
        platform: input.platform,
        label: input.label ?? '',
        auth_kind: input.authKind,
        secret: encryptSecret(JSON.stringify(input.secret)),
        enabled: input.enabled !== false,
        priority: input.priority ?? 0,
        created_at: BigInt(now),
        updated_at: BigInt(now),
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * 更新连接器。重填 secret 时整体覆盖，并清空上次连通性结果（last_check_* 置空）——
   * 凭据变了必须重新测试通过才能再被选用，避免旧「测试通过」状态放行新凭据。
   * @returns 是否有记录被更新
   */
  async updateConnector(id: number, fields: ConnectorUpdate, now: number): Promise<boolean> {
    const data: Record<string, unknown> = {};
    if (fields.label !== undefined) data.label = fields.label;
    if (fields.priority !== undefined) data.priority = fields.priority;
    if (fields.enabled !== undefined) data.enabled = fields.enabled;
    if (fields.secret !== undefined) {
      data.secret = encryptSecret(JSON.stringify(fields.secret));
      data.last_check_ok = null;
      data.last_check_at = null;
      data.last_check_error = null;
    }
    if (Object.keys(data).length === 0) return false;
    data.updated_at = BigInt(now);
    const res = await this.db.source_connectors.updateMany({ where: { id }, data });
    return res.count > 0;
  }

  /** 删除连接器 */
  async deleteConnector(id: number): Promise<boolean> {
    const res = await this.db.source_connectors.deleteMany({ where: { id } });
    return res.count > 0;
  }

  /** 记录一次连通性测试结果（门禁依赖 last_check_ok） */
  async recordCheck(id: number, ok: boolean, error: string | null, now: number): Promise<void> {
    await this.db.source_connectors.updateMany({
      where: { id },
      data: {
        last_check_ok: ok,
        last_check_at: BigInt(now),
        last_check_error: ok ? null : (error?.slice(0, 500) ?? '测试失败'),
        updated_at: BigInt(now),
      },
    });
  }
}
