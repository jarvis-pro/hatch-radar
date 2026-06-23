import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import type { AuditRow } from '@hatch-radar/shared';
import { Prisma, type AppDatabase } from '@/database/internal';
import { nowSec } from '@/utils/time';

/** 一条审计记录的输入。 */
export interface AuditEntry {
  /** 操作者 users.id；系统动作或匿名（登录失败）为空。 */
  actorId?: string | null;
  /** 操作类型，如 auth.login / account.create / permission.update。 */
  action: string;
  /** 操作目标的类型，如 user；无目标时为空。 */
  targetType?: string | null;
  /** 操作目标的 id；无目标时为空。 */
  targetId?: string | null;
  /** 附加上下文（JSON），如改动详情 / 受影响字段。 */
  metadata?: Record<string, unknown>;
  /** 发起请求的客户端 IP；不可得时为空。 */
  ip?: string | null;
}

/** 审计日志分页每页条数 */
const AUDIT_PAGE = 50;

/** 审计日志数据访问：写入（失败不阻断）+ 分页查询（actor_id 解析为邮箱）。 */
@Injectable()
export class AuditLogsRepository {
  constructor(
    // 事务感知 Prisma 客户端（经 @Inject(PRISMA)，按 ALS 自动路由事务/根客户端）：读写审计日志表
    @Inject(PRISMA) private readonly db: AppDatabase,
  ) {}

  /**
   * 写一条审计；失败只吞掉、绝不阻断主流程。
   * @param entry 审计条目（见 {@link AuditEntry}）
   */
  async write(entry: AuditEntry): Promise<void> {
    try {
      await this.db.audit_logs.create({
        data: {
          actor_id: entry.actorId ?? null,
          action: entry.action,
          target_type: entry.targetType ?? null,
          target_id: entry.targetId ?? null,
          ...(entry.metadata !== undefined
            ? { metadata: entry.metadata as Prisma.InputJsonValue }
            : {}),
          ip: entry.ip ?? null,
          created_at: BigInt(nowSec()),
        },
      });
    } catch {
      // 审计失败不影响主流程
    }
  }

  /**
   * 审计日志分页（按 action 关键词可选过滤，时间倒序；actor_id 批量解析为邮箱）。
   * @param opts.q action 关键词（大小写不敏感子串）；省略则不过滤
   * @param opts.page 页码（1 起；越界自动夹到 [1, pageCount]）
   * @returns 当前页审计行 + total / page / pageCount
   */
  async listPaged(opts: {
    q?: string;
    page: number;
  }): Promise<{ items: AuditRow[]; total: number; page: number; pageCount: number }> {
    const where = opts.q ? { action: { contains: opts.q, mode: 'insensitive' as const } } : {};
    const total = await this.db.audit_logs.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE));
    const page = Math.min(Math.max(1, opts.page), pageCount);
    const rows = await this.db.audit_logs.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (page - 1) * AUDIT_PAGE,
      take: AUDIT_PAGE,
    });
    const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))];
    const actors = actorIds.length
      ? await this.db.users.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true },
        })
      : [];
    const emailById = new Map(actors.map((a) => [a.id, a.email]));

    return {
      items: rows.map((r) => ({
        id: r.id,
        actorEmail: r.actor_id ? (emailById.get(r.actor_id) ?? '(已删除账户)') : null,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        ip: r.ip,
        createdAt: Number(r.created_at),
      })),
      total,
      page,
      pageCount,
    };
  }
}
