import {
  PAGE_SIZE,
  type CostByModel,
  type DailyCostPoint,
  type Paged,
  type ThroughputPoint,
} from '@hatch-radar/shared';
import { toJobRow, type AppDatabase, type JobPg, type JobRow, type Prisma } from '../internal';

/** 任务触发来源：auto=定时调度入队，manual=管理员在工作台手动入队 */
export type JobTrigger = JobRow['trigger'];
/** 任务状态机：queued → running →（succeeded | failed）。canceled 为预留态——当前无取消入口，getJobStats 仍计数以备将来 */
export type JobStatus = JobRow['status'];
export type { JobRow };

/** 新任务默认的最大尝试次数（仅用于僵死/崩溃循环保护，正常失败即终态） */
const DEFAULT_MAX_ATTEMPTS = 3;
/** 错误信息落库长度上限，避免异常堆栈撑爆字段 */
const MAX_ERROR_CHARS = 500;

/**
 * 各 provider 缓存 token 相对「输入单价」的计费倍率（厂商固定口径，非自定义）：
 * - anthropic / claude_cli：写入缓存 1.25×、命中 0.1×
 * - openai：自动缓存无独立写入计费（0），命中约 0.5×
 * - deepseek：命中约 0.1×、无独立写入计费
 * 未知 provider 回退 1×（按普通输入计）。普通输入与输出各按其单价 1× 计。
 */
const CACHE_MULT: Record<string, { write: number; read: number }> = {
  anthropic: { write: 1.25, read: 0.1 },
  claude_cli: { write: 1.25, read: 0.1 },
  openai: { write: 0, read: 0.5 },
  deepseek: { write: 0, read: 0.1 },
};

/** 一组 token 用量（按类型拆分） */
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

/**
 * 按 provider 单价 + 缓存倍率把 token 用量折算成本（美元）。普通输入/输出各按其单价 1× 计，
 * 缓存写入 / 命中按 {@link CACHE_MULT} 相对输入单价计；单价缺失（input/output 任一为空）返回
 * null（该模型只统计用量、不折算）。getCostStats / getDailyCost 共用，保证两处口径一致。
 */
function computeCost(
  provider: string,
  inputPrice: number | null,
  outputPrice: number | null,
  t: TokenUsage,
): number | null {
  if (inputPrice == null || outputPrice == null) return null;
  const m = CACHE_MULT[provider] ?? { write: 1, read: 1 };
  return (
    (t.inputTokens * inputPrice +
      t.cacheWriteTokens * inputPrice * m.write +
      t.cacheReadTokens * inputPrice * m.read +
      t.outputTokens * outputPrice) /
    1_000_000
  );
}

/** 队列看板行：任务字段 + 帖子标题（左连接，帖子归档后为 null） */
export interface JobView {
  id: number;
  post_id: string;
  post_title: string | null;
  model: string;
  trigger: JobTrigger;
  status: JobStatus;
  attempts: number;
  error: string | null;
  enqueued_at: number;
  started_at: number | null;
  finished_at: number | null;
  /** 非缓存输入 token 数（成功且采集到时有值，否则 null） */
  input_tokens: number | null;
  /** 输出 token 数（同上） */
  output_tokens: number | null;
  /** 写入缓存的输入 token 数 */
  cache_write_tokens: number | null;
  /** 命中缓存的输入 token 数 */
  cache_read_tokens: number | null;
}

/** 队列分页筛选条件（均可空 = 不限） */
export interface JobFilter {
  status?: JobStatus;
  trigger?: JobTrigger;
}

/** 队列任务视图：JobView + 展示期按 provider 单价折算的成本（无 provider/未配单价/未采集 token → null） */
export interface QueueJobView extends JobView {
  cost: number | null;
}

/** listRecentJobs 的原始行（时间戳为 bigint，待折回 number） */
type JobViewRaw = Omit<JobView, 'enqueued_at' | 'started_at' | 'finished_at'> & {
  enqueued_at: bigint;
  started_at: bigint | null;
  finished_at: bigint | null;
};

/**
 * 分析任务队列数据访问（Prisma / PostgreSQL）。
 *
 * 认领用 `FOR UPDATE SKIP LOCKED`（Prisma 无一等 API → $queryRaw）：多 worker / 多进程并发
 * 认领互不冲突、不重不漏，同时解锁「worker 独立成进程」。心跳 / 僵死回收 / max_attempts 原样保留。
 */
export class JobsRepository {
  constructor(private readonly db: AppDatabase) {}

  /**
   * 批量入队分析任务。
   * - 幂等去重：同一帖子已有 queued / running 任务时跳过，避免重复入队；并发竞态由部分唯一
   *   索引 `uniq_jobs_active_post`（post_id WHERE status IN queued/running，见 db 迁移）兜底，
   *   保证同帖同时至多一条活跃任务（否则会被双 worker 认领、双次 AI 调用）
   * - 任务携带 model 快照与 provider_id（软引用），便于 worker 落库与溯源
   * @param postIds 目标帖子 ID 列表
   * @param providerId 使用的模型配置 ID
   * @param model 模型 ID 快照
   * @param trigger 触发来源（auto / manual）
   * @param now 入队 Unix 时间戳（秒）
   * @returns 实际新入队的任务数
   */
  async enqueueJobs(
    postIds: string[],
    providerId: number | null,
    model: string,
    trigger: JobTrigger,
    now: number,
  ): Promise<number> {
    const unique = [...new Set(postIds)];
    if (unique.length === 0) return 0;
    return this.db.$transaction(async (tx) => {
      const active = await tx.analysis_jobs.findMany({
        where: { post_id: { in: unique }, status: { in: ['queued', 'running'] } },
        select: { post_id: true },
      });
      const activeSet = new Set(active.map((r) => r.post_id));
      const toInsert = unique.filter((id) => !activeSet.has(id));
      if (toInsert.length === 0) return 0;
      // skipDuplicates → ON CONFLICT DO NOTHING：上面的预检查命中常态去重，此处兜住并发竞态
      // （两轮入队同时跳过预检查后撞部分唯一索引）。取真实插入数为「实际入队数」。
      const res = await tx.analysis_jobs.createMany({
        data: toInsert.map((post_id) => ({
          post_id,
          provider_id: providerId,
          model,
          trigger,
          status: 'queued' as const,
          attempts: 0,
          max_attempts: DEFAULT_MAX_ATTEMPTS,
          enqueued_at: BigInt(now),
        })),
        skipDuplicates: true,
      });
      return res.count;
    });
  }

  /**
   * 原子认领下一条待处理任务：取最老的 queued，置为 running 并 +1 尝试次数。
   * - `FOR UPDATE SKIP LOCKED`：并发认领跳过已被他人锁定的行，绝不认领到同一条
   * @param now 当前 Unix 时间戳（秒）
   * @returns 认领到的任务（已更新为 running）；队列为空时返回 null
   */
  async claimNextJob(now: number): Promise<JobRow | null> {
    return this.db.$transaction(async (tx) => {
      const picked = await tx.$queryRaw<JobPg[]>`
        SELECT * FROM analysis_jobs
        WHERE status = 'queued'
        ORDER BY enqueued_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const job = picked[0];
      if (!job) return null;
      await tx.analysis_jobs.update({
        where: { id: job.id },
        data: {
          status: 'running',
          started_at: BigInt(now),
          heartbeat_at: BigInt(now),
          attempts: { increment: 1 },
        },
      });
      return toJobRow({
        ...job,
        status: 'running',
        started_at: BigInt(now),
        heartbeat_at: BigInt(now),
        attempts: job.attempts + 1,
      });
    });
  }

  /**
   * 更新 running 任务的心跳时间（worker 处理期间周期调用，避免长任务被误判僵死）。
   * @param jobId 任务 ID
   * @param now 当前 Unix 时间戳（秒）
   */
  async touchHeartbeat(jobId: number, now: number): Promise<void> {
    await this.db.analysis_jobs.updateMany({
      where: { id: jobId, status: 'running' },
      data: { heartbeat_at: BigInt(now) },
    });
  }

  /**
   * 标记任务成功。
   * @param jobId 任务 ID
   * @param now 完成 Unix 时间戳（秒）
   */
  async succeedJob(
    jobId: number,
    now: number,
    usage?: {
      inputTokens: number;
      outputTokens: number;
      cacheWriteTokens: number;
      cacheReadTokens: number;
    } | null,
  ): Promise<void> {
    await this.db.analysis_jobs.update({
      where: { id: jobId },
      data: {
        status: 'succeeded',
        finished_at: BigInt(now),
        error: null,
        input_tokens: usage?.inputTokens ?? null,
        output_tokens: usage?.outputTokens ?? null,
        cache_write_tokens: usage?.cacheWriteTokens ?? null,
        cache_read_tokens: usage?.cacheReadTokens ?? null,
      },
    });
  }

  /**
   * 标记任务失败（终态）。
   * @param jobId 任务 ID
   * @param error 失败原因（截断存储）
   * @param now 完成 Unix 时间戳（秒）
   */
  async failJob(jobId: number, error: string, now: number): Promise<void> {
    await this.db.analysis_jobs.update({
      where: { id: jobId },
      data: { status: 'failed', finished_at: BigInt(now), error: error.slice(0, MAX_ERROR_CHARS) },
    });
  }

  /**
   * 回收 running 任务：心跳超时（或进程重启后遗留）的任务被认定为僵死。
   * - 未超 max_attempts 的回 queued 重排（清空 started_at / heartbeat_at），否则判失败
   * @param now 当前 Unix 时间戳（秒）
   * @param staleSeconds 心跳早于 `now - staleSeconds` 才回收；传 null 回收全部 running（进程启动时用）
   * @returns 被回收的任务数
   */
  async reclaimRunningJobs(now: number, staleSeconds: number | null): Promise<number> {
    const where: Prisma.analysis_jobsWhereInput =
      staleSeconds === null
        ? { status: 'running' }
        : {
            status: 'running',
            OR: [{ heartbeat_at: null }, { heartbeat_at: { lt: BigInt(now - staleSeconds) } }],
          };
    return this.db.$transaction(async (tx) => {
      const rows = await tx.analysis_jobs.findMany({
        where,
        select: { id: true, attempts: true, max_attempts: true },
      });
      if (rows.length === 0) return 0;
      for (const r of rows) {
        if (r.attempts >= r.max_attempts) {
          await tx.analysis_jobs.update({
            where: { id: r.id },
            data: {
              status: 'failed',
              finished_at: BigInt(now),
              error: '僵死回收：超过最大尝试次数',
            },
          });
        } else {
          await tx.analysis_jobs.update({
            where: { id: r.id },
            data: { status: 'queued', started_at: null, heartbeat_at: null },
          });
        }
      }
      return rows.length;
    });
  }

  /**
   * 删除早于 cutoff 的终态任务（succeeded / failed / canceled），用于归档时控制队列表规模。
   * queued / running 不受影响。
   * @param cutoff Unix 秒；finished_at 早于此值的终态任务将被删除
   * @returns 删除的任务数
   */
  async deleteFinishedJobsBefore(cutoff: number): Promise<number> {
    const res = await this.db.analysis_jobs.deleteMany({
      where: {
        status: { in: ['succeeded', 'failed', 'canceled'] },
        finished_at: { lt: BigInt(cutoff) },
      },
    });
    return res.count;
  }

  /** 各状态任务数汇总，用于启动 / worker 日志与队列看板 */
  async getJobStats(): Promise<Record<JobStatus, number>> {
    const rows = await this.db.analysis_jobs.groupBy({ by: ['status'], _count: { _all: true } });
    const stats: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      canceled: 0,
    };
    for (const r of rows) stats[r.status] = r._count._all;
    return stats;
  }

  /** 取最近的任务（按 id 倒序），供 web 队列看板轮询展示 */
  async listRecentJobs(limit: number): Promise<JobView[]> {
    const rows = await this.db.$queryRaw<JobViewRaw[]>`
      SELECT j.id, j.post_id, p.title AS post_title, j.model, j.trigger, j.status,
             j.attempts, j.error, j.enqueued_at, j.started_at, j.finished_at,
             j.input_tokens, j.output_tokens, j.cache_write_tokens, j.cache_read_tokens
      FROM analysis_jobs j
      LEFT JOIN posts p ON p.id = j.post_id
      ORDER BY j.id DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      ...r,
      enqueued_at: Number(r.enqueued_at),
      started_at: r.started_at === null ? null : Number(r.started_at),
      finished_at: r.finished_at === null ? null : Number(r.finished_at),
    }));
  }

  /**
   * 队列分页查询（按状态 / 来源筛选，id 倒序）。供「任务队列」页全宽表格分类查看用。
   * 帖子标题二次查询补齐（analysis_jobs 与 posts 软引用、无 FK 关系，不能 include）。
   */
  async listJobsPaged(filter: JobFilter, page: number): Promise<Paged<QueueJobView>> {
    const where: Prisma.analysis_jobsWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.trigger) where.trigger = filter.trigger;

    const total = await this.db.analysis_jobs.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const pageNum = Math.min(Math.max(1, page), pageCount);
    const rows = await this.db.analysis_jobs.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (pageNum - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });

    // 标题二次查询（软引用，帖子归档后为 null）
    const postIds = [...new Set(rows.map((r) => r.post_id))];
    const posts =
      postIds.length === 0
        ? []
        : await this.db.posts.findMany({
            where: { id: { in: postIds } },
            select: { id: true, title: true },
          });
    const titleById = new Map(posts.map((p) => [p.id, p.title]));

    // 成本展示期计算：按任务的 provider 当前单价折算；provider 已删 / 未配单价 / 未采集 token → null
    const providerIds = [
      ...new Set(rows.map((r) => r.provider_id).filter((id): id is number => id != null)),
    ];
    const prices =
      providerIds.length === 0
        ? []
        : await this.db.model_providers.findMany({
            where: { id: { in: providerIds } },
            select: { id: true, provider: true, input_price: true, output_price: true },
          });
    const priceById = new Map(prices.map((p) => [p.id, p]));
    // 精确成本：普通输入/输出按各自单价，缓存写入/命中按输入单价 × 厂商固定倍率（CACHE_MULT）
    const costOf = (r: (typeof rows)[number]): number | null => {
      if (r.provider_id == null || r.input_tokens == null) return null;
      const price = priceById.get(r.provider_id);
      if (!price || price.input_price == null || price.output_price == null) return null;
      const mult = CACHE_MULT[price.provider] ?? { write: 1, read: 1 };
      return (
        (r.input_tokens * price.input_price +
          (r.cache_write_tokens ?? 0) * price.input_price * mult.write +
          (r.cache_read_tokens ?? 0) * price.input_price * mult.read +
          (r.output_tokens ?? 0) * price.output_price) /
        1_000_000
      );
    };

    return {
      items: rows.map((r) => ({
        id: r.id,
        post_id: r.post_id,
        post_title: titleById.get(r.post_id) ?? null,
        model: r.model,
        trigger: r.trigger,
        status: r.status,
        attempts: r.attempts,
        error: r.error,
        enqueued_at: Number(r.enqueued_at),
        started_at: r.started_at === null ? null : Number(r.started_at),
        finished_at: r.finished_at === null ? null : Number(r.finished_at),
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        cache_write_tokens: r.cache_write_tokens,
        cache_read_tokens: r.cache_read_tokens,
        cost: costOf(r),
      })),
      total,
      page: pageNum,
      pageCount,
    };
  }

  /**
   * 成本统计（finished_at ≥ sinceSec 的成功任务）：按 (provider, model) 汇总四类 token，
   * 按各 provider 单价 + 缓存倍率（CACHE_MULT）折算成本；未配单价的模型 cost 为 null。
   */
  async getCostStats(sinceSec: number): Promise<{
    totals: {
      inputTokens: number;
      outputTokens: number;
      cacheWriteTokens: number;
      cacheReadTokens: number;
      cost: number | null;
    };
    byModel: CostByModel[];
  }> {
    const groups = await this.db.analysis_jobs.groupBy({
      by: ['provider_id', 'model'],
      where: {
        status: 'succeeded',
        finished_at: { gte: BigInt(sinceSec) },
        input_tokens: { not: null },
      },
      _sum: {
        input_tokens: true,
        output_tokens: true,
        cache_write_tokens: true,
        cache_read_tokens: true,
      },
      _count: { _all: true },
    });
    const priceById = await this.loadPriceMap([
      ...new Set(groups.map((g) => g.provider_id).filter((id): id is number => id != null)),
    ]);

    const byModel: CostByModel[] = groups
      .map((g) => {
        const inputTokens = g._sum.input_tokens ?? 0;
        const outputTokens = g._sum.output_tokens ?? 0;
        const cacheWriteTokens = g._sum.cache_write_tokens ?? 0;
        const cacheReadTokens = g._sum.cache_read_tokens ?? 0;
        const price = g.provider_id != null ? priceById.get(g.provider_id) : undefined;
        const cost = price
          ? computeCost(price.provider, price.input_price, price.output_price, {
              inputTokens,
              outputTokens,
              cacheWriteTokens,
              cacheReadTokens,
            })
          : null;
        return {
          provider: price?.provider ?? 'unknown',
          model: g.model,
          jobs: g._count._all,
          inputTokens,
          outputTokens,
          cacheWriteTokens,
          cacheReadTokens,
          cost,
        };
      })
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || b.inputTokens - a.inputTokens);

    const totals = byModel.reduce(
      (acc, m) => ({
        inputTokens: acc.inputTokens + m.inputTokens,
        outputTokens: acc.outputTokens + m.outputTokens,
        cacheWriteTokens: acc.cacheWriteTokens + m.cacheWriteTokens,
        cacheReadTokens: acc.cacheReadTokens + m.cacheReadTokens,
        cost: m.cost == null ? acc.cost : (acc.cost ?? 0) + m.cost,
      }),
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        cost: null as number | null,
      },
    );
    return { totals, byModel };
  }

  /** 批量取 provider 单价表（id → {provider, 输入单价, 输出单价}），供成本折算复用。 */
  private async loadPriceMap(providerIds: number[]) {
    if (providerIds.length === 0) {
      return new Map<
        number,
        { provider: string; input_price: number | null; output_price: number | null }
      >();
    }
    const prices = await this.db.model_providers.findMany({
      where: { id: { in: providerIds } },
      select: { id: true, provider: true, input_price: true, output_price: true },
    });
    return new Map(prices.map((p) => [p.id, p]));
  }

  /**
   * 近 days 天每日 token 用量与折算成本（0 填充的密集序列，服务端按统一时区分桶）。
   * 成本口径与 {@link getCostStats} 完全一致（按 provider 单价 + 缓存倍率折算）；当天没有任何
   * 带单价模型的任务时 cost 为 null（只有用量、不折算）。前端按 7/14/30 天切片即可画走势。
   */
  async getDailyCost(days: number): Promise<DailyCostPoint[]> {
    // 密集日期轴（DB 时区；与下方分桶同源 to_char，保证 key 对齐）
    const axis = await this.db.$queryRaw<{ date: string }[]>`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS date
      FROM generate_series(
        date_trunc('day', now()) - make_interval(days => ${days - 1}),
        date_trunc('day', now()),
        interval '1 day'
      ) AS d(day)
      ORDER BY d.day
    `;
    // 窗口内 succeeded 且带 token 的任务，按「日 × provider」聚合用量（cost 需按 provider 单价折算）
    const rows = await this.db.$queryRaw<
      {
        date: string;
        provider_id: number | null;
        input_tokens: number;
        output_tokens: number;
        cache_write_tokens: number;
        cache_read_tokens: number;
      }[]
    >`
      SELECT
        to_char(date_trunc('day', to_timestamp(finished_at::double precision)), 'YYYY-MM-DD') AS date,
        provider_id,
        sum(input_tokens)::int AS input_tokens,
        sum(coalesce(output_tokens, 0))::int AS output_tokens,
        sum(coalesce(cache_write_tokens, 0))::int AS cache_write_tokens,
        sum(coalesce(cache_read_tokens, 0))::int AS cache_read_tokens
      FROM analysis_jobs
      WHERE status = 'succeeded'
        AND input_tokens IS NOT NULL
        AND finished_at >= extract(epoch FROM (date_trunc('day', now()) - make_interval(days => ${days - 1})))
      GROUP BY 1, provider_id
    `;
    const priceById = await this.loadPriceMap([
      ...new Set(rows.map((r) => r.provider_id).filter((id): id is number => id != null)),
    ]);

    // 折算每组成本并按日累加（cost null 语义同 getCostStats：当天无带单价模型则保持 null）
    const empty = (date: string): DailyCostPoint => ({
      date,
      cost: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const byDate = new Map<string, DailyCostPoint>();
    for (const r of rows) {
      const acc = byDate.get(r.date) ?? empty(r.date);
      acc.inputTokens += r.input_tokens;
      acc.outputTokens += r.output_tokens;
      acc.cacheWriteTokens += r.cache_write_tokens;
      acc.cacheReadTokens += r.cache_read_tokens;
      const price = r.provider_id != null ? priceById.get(r.provider_id) : undefined;
      const cost = price
        ? computeCost(price.provider, price.input_price, price.output_price, {
            inputTokens: r.input_tokens,
            outputTokens: r.output_tokens,
            cacheWriteTokens: r.cache_write_tokens,
            cacheReadTokens: r.cache_read_tokens,
          })
        : null;
      if (cost != null) acc.cost = (acc.cost ?? 0) + cost;
      byDate.set(r.date, acc);
    }
    // 密集填充：无数据的日期补零（cost=null）
    return axis.map(({ date }) => byDate.get(date) ?? empty(date));
  }

  /** 近 days 天每日完成的分析任务数（0 填充的密集序列，服务端按统一时区分桶）。 */
  async getThroughput(days: number): Promise<ThroughputPoint[]> {
    return this.db.$queryRaw<ThroughputPoint[]>`
      SELECT
        to_char(d.day, 'YYYY-MM-DD') AS date,
        COALESCE(j.succeeded, 0)::int AS succeeded,
        COALESCE(j.failed, 0)::int AS failed,
        COALESCE(i.high, 0)::int AS "insightsHigh",
        COALESCE(i.medium, 0)::int AS "insightsMedium",
        COALESCE(i.low, 0)::int AS "insightsLow"
      FROM generate_series(
        date_trunc('day', now()) - make_interval(days => ${days - 1}),
        date_trunc('day', now()),
        interval '1 day'
      ) AS d(day)
      LEFT JOIN (
        SELECT
          date_trunc('day', to_timestamp(finished_at::double precision)) AS day,
          count(*) FILTER (WHERE status = 'succeeded') AS succeeded,
          count(*) FILTER (WHERE status = 'failed') AS failed
        FROM analysis_jobs
        WHERE status IN ('succeeded', 'failed')
          AND finished_at >= extract(epoch FROM (now() - make_interval(days => ${days})))
        GROUP BY 1
      ) AS j ON j.day = d.day
      LEFT JOIN (
        SELECT
          date_trunc('day', to_timestamp(created_at::double precision)) AS day,
          count(*) FILTER (WHERE intensity = 'HIGH') AS high,
          count(*) FILTER (WHERE intensity = 'MEDIUM') AS medium,
          count(*) FILTER (WHERE intensity = 'LOW') AS low
        FROM insights
        WHERE created_at >= extract(epoch FROM (now() - make_interval(days => ${days})))
        GROUP BY 1
      ) AS i ON i.day = d.day
      ORDER BY d.day
    `;
  }
}
