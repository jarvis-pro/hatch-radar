import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import {
  toSourceConnectorRow,
  type AppDatabase,
  type SourceConnectorRow,
} from '@/database/internal';
import { decryptSecret, encryptSecret } from '@/utils/crypto';

/** 数据来源平台 */
export type SourcePlatform = SourceConnectorRow['platform'];
/** 连接器鉴权方式：oauth(官方 API) | scrape(自托管爬虫) */
export type ConnectorAuthKind = SourceConnectorRow['auth_kind'];
export type { SourceConnectorRow };

/** Reddit OAuth 凭据：连接器 secret 的 JSON 明文形状（auth_kind=oauth） */
export interface RedditOAuthSecret {
  /** Reddit 应用 client id */
  clientId: string;
  /** Reddit 应用 client secret */
  clientSecret: string;
  /** Reddit 账号用户名 */
  username: string;
  /** Reddit 账号密码 */
  password: string;
  /** 请求 User-Agent（Reddit 要求唯一标识，缺失会被限流 / 拒绝） */
  userAgent: string;
}

/** 新建连接器的输入（secret 为明文凭据，入库前加密为 JSON 密文） */
export interface ConnectorInput {
  /** 平台（目前仅 reddit 需凭据连接器） */
  platform: SourcePlatform;
  /** 鉴权方式：oauth（官方 API）/ scrape（自托管爬虫） */
  authKind: ConnectorAuthKind;
  /** 明文凭据对象（按 authKind 解释，如 RedditOAuthSecret）；入库前整体加密为 JSON 密文 */
  secret: Record<string, unknown>;
  /** 备注名；省略为空串 */
  label?: string;
  /** 同平台多连接器的选取优先级（越小越先用）；省略为 0 */
  priority?: number;
  /** 是否启用；省略按启用处理 */
  enabled?: boolean;
}

/** 更新连接器：secret 提供时整体重设并清空上次连通性结果（需重新测试才可用） */
export interface ConnectorUpdate {
  /** 备注名 */
  label?: string;
  /** 选取优先级（越小越先用） */
  priority?: number;
  /** 是否启用 */
  enabled?: boolean;
  /** 明文凭据对象；提供即整体覆盖并清空上次连通性结果（须重新测试通过才可再用） */
  secret?: Record<string, unknown>;
}

/** 脱敏连接器视图：永不含明文凭据 */
export interface ConnectorDTO {
  id: number;
  /** 平台（reddit / …） */
  platform: SourcePlatform;
  /** 备注名 */
  label: string;
  /** 鉴权方式：oauth / scrape */
  authKind: ConnectorAuthKind;
  /** 是否启用 */
  enabled: boolean;
  /** 选取优先级（越小越先用） */
  priority: number;
  /** 脱敏摘要，如 `clientId abc…xyz · u/username` */
  summary: string;
  /** 最近测试结果；null=从未测试（未测则不可用，门禁不放行其来源） */
  lastCheckOk: boolean | null;
  /** 最近测试时刻（epoch 秒）；从未测试为 null */
  lastCheckAt: number | null;
  /** 最近测试失败原因；通过 / 从未测试为 null */
  lastCheckError: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * 把连接器密文凭据解密为明文对象（仅服务端内部用，如构建 Reddit 客户端）。
 * @param row 连接器行（取其 secret 密文解密）
 */
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

/**
 * 把连接器行转成脱敏 DTO（API 返回用）。
 * @param row 连接器行
 */
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
@Injectable()
export class SourceConnectorsRepository {
  constructor(
    // 事务感知 Prisma 客户端（经 @Inject(PRISMA)，按 ALS 自动路由事务/根客户端）：读写采集连接器凭据（source_connectors）表
    @Inject(PRISMA) private readonly db: AppDatabase,
  ) {}

  /** 列出全部连接器（按平台、优先级排序；含密文，仅内部用） */
  async listConnectors(): Promise<SourceConnectorRow[]> {
    const rows = await this.db.source_connectors.findMany({
      orderBy: [{ platform: 'asc' }, { priority: 'asc' }, { id: 'asc' }],
    });

    return rows.map(toSourceConnectorRow);
  }

  /**
   * 按 ID 取单个连接器。
   * @param id 连接器 id
   * @returns 连接器行；不存在时返回 undefined
   */
  async getConnector(id: number): Promise<SourceConnectorRow | undefined> {
    const row = await this.db.source_connectors.findUnique({ where: { id } });

    return row ? toSourceConnectorRow(row) : undefined;
  }

  /**
   * 取某平台当前「可用」的连接器（enabled 且最近测试通过），按优先级升序取第一条。
   * 用于抓取时选取凭据，以及来源门禁判定。
   * @param platform 数据来源平台
   * @returns 可用连接器（优先级最高的一条）；无则 undefined
   */
  async getUsableConnector(platform: SourcePlatform): Promise<SourceConnectorRow | undefined> {
    const row = await this.db.source_connectors.findFirst({
      where: { platform, enabled: true, last_check_ok: true },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });

    return row ? toSourceConnectorRow(row) : undefined;
  }

  /**
   * 某平台是否有可用连接器（门禁：放行该平台的来源 enabled）。
   * @param platform 数据来源平台
   */
  async hasUsableConnector(platform: SourcePlatform): Promise<boolean> {
    const count = await this.db.source_connectors.count({
      where: { platform, enabled: true, last_check_ok: true },
    });

    return count > 0;
  }

  /**
   * 新建连接器（凭据 JSON 加密入库；last_check_* 留空，须测试通过后才可用）。
   * @param input 连接器配置（见 {@link ConnectorInput}）
   * @param now 创建时刻 Unix 时间戳（秒）
   * @returns 新建连接器的 id
   */
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
   * @param id 连接器 id
   * @param fields 仅含需更新的字段（见 {@link ConnectorUpdate}）
   * @param now 更新时刻 Unix 时间戳（秒）
   * @returns 是否有记录被更新
   */
  async updateConnector(id: number, fields: ConnectorUpdate, now: number): Promise<boolean> {
    const data: Record<string, unknown> = {};
    if (fields.label !== undefined) {
      data.label = fields.label;
    }

    if (fields.priority !== undefined) {
      data.priority = fields.priority;
    }

    if (fields.enabled !== undefined) {
      data.enabled = fields.enabled;
    }

    if (fields.secret !== undefined) {
      data.secret = encryptSecret(JSON.stringify(fields.secret));
      data.last_check_ok = null;
      data.last_check_at = null;
      data.last_check_error = null;
    }

    if (Object.keys(data).length === 0) {
      return false;
    }

    data.updated_at = BigInt(now);
    const res = await this.db.source_connectors.updateMany({ where: { id }, data });

    return res.count > 0;
  }

  /**
   * 删除连接器。
   * @param id 连接器 id
   * @returns 是否删除（false = 连接器不存在）
   */
  async deleteConnector(id: number): Promise<boolean> {
    const res = await this.db.source_connectors.deleteMany({ where: { id } });

    return res.count > 0;
  }

  /**
   * 记录一次连通性测试结果（门禁依赖 last_check_ok）。
   * @param id 连接器 id
   * @param ok 是否测试通过
   * @param error 失败原因；ok 时忽略（落库前截断至 500 字符）
   * @param now 测试时刻 Unix 时间戳（秒）
   */
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
