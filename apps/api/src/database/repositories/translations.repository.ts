import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import { Prisma, type AppDatabase, type TranslationRow } from '../internal';

/** 译文来源字段类型（post_title | post_selftext | comment_body） */
export type TranslationField = TranslationRow['source_field'];
/** 译文状态（pending | translating | done | failed | skipped） */
export type TranslationStatus = TranslationRow['status'];
/** 产出译文的 provider 类型（非空形态） */
export type TranslationProviderKind = NonNullable<TranslationRow['provider_kind']>;

/** 待翻译条目：worker 翻译输入（按内容哈希去重，同文只翻一次） */
export interface UntranslatedItem {
  /** 源文本内容哈希（= translations.content_hash，回写时的主键） */
  contentHash: string;
  /** 源字段类型（标注来源，便于 prompt 区分标题/正文/评论） */
  sourceField: TranslationField;
  /** 源文本（待译） */
  text: string;
}

/** 一帖的翻译进度：驱动 web 按钮「首次 / 增量 / 已翻」三态 */
export interface TranslationProgress {
  /** 可翻译条目总数（标题 + 正文 + 各评论，按内容哈希去重） */
  total: number;
  /** 已 done / skipped 的条目数 */
  translated: number;
  /** 待翻译条目数（total - translated；>0 且 translated=0 → 首次，>0 且 translated>0 → 增量） */
  untranslated: number;
}

/** worker 回写的译文结果行 */
export interface TranslationUpsert {
  /** 源文本内容哈希（= translations.content_hash 主键，upsert 据此覆盖） */
  contentHash: string;
  /** 源字段类型（标题 / 正文 / 评论） */
  sourceField: TranslationField;
  /** 检测出的源语种（zh → status=skipped；其余 → 译文落 text） */
  sourceLang: string | null;
  /** 中文译文（done 时非空；skipped/failed 为 null） */
  text: string | null;
  /** 产出译文的 provider 类型（skipped 时为 null） */
  providerKind: TranslationProviderKind | null;
  /** 产出译文的模型配置 id（skipped 时为 null） */
  providerId: number | null;
  /** 落库状态（done / skipped / failed 等） */
  status: TranslationStatus;
  /** 计费用源字符数 */
  charCount: number | null;
  /** 失败原因（status=failed 时有值） */
  lastError: string | null;
}

/**
 * 译文缓存数据访问（Prisma / PostgreSQL）。
 *
 * 译文按 `content_hash` 寻址而非挂列在 posts/comments：评论 replaceComments 整删整插会清列，
 * 而哈希寻址天然 ①扛评论行 churn ②同文去重 ③未命中=待翻译（首次/增量统一判定）。
 */
@Injectable()
export class TranslationsRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /**
   * 取某帖待翻译的源文本条目：标题 / 正文 / 各评论中，content_hash 在 translations
   * 尚无 done/skipped 记录者（pending/failed 视作仍需翻译）。按 content_hash 去重。
   * @param postId 目标帖子 ID
   */
  async getUntranslatedItems(postId: string): Promise<UntranslatedItem[]> {
    const rows = await this.db.$queryRaw<
      { content_hash: string; source_field: TranslationField; text: string }[]
    >`
      SELECT DISTINCT ON (h.content_hash) h.content_hash, h.source_field, h.text
      FROM (
        SELECT title_hash AS content_hash, 'post_title'::translation_field AS source_field, title AS text
          FROM posts WHERE id = ${postId} AND title_hash IS NOT NULL
        UNION ALL
        SELECT selftext_hash, 'post_selftext'::translation_field, selftext
          FROM posts WHERE id = ${postId} AND selftext_hash IS NOT NULL
        UNION ALL
        SELECT body_hash, 'comment_body'::translation_field, body
          FROM comments WHERE post_id = ${postId} AND body_hash IS NOT NULL
      ) h
      LEFT JOIN translations t ON t.content_hash = h.content_hash AND t.status IN ('done', 'skipped')
      WHERE t.id IS NULL
      ORDER BY h.content_hash
    `;

    return rows.map((r) => ({
      contentHash: r.content_hash,
      sourceField: r.source_field,
      text: r.text,
    }));
  }

  /**
   * 某帖翻译进度（按内容哈希去重后，已翻 vs 待翻数），驱动 web 按钮三态。
   * @param postId 目标帖子 ID
   */
  async getProgress(postId: string): Promise<TranslationProgress> {
    const rows = await this.db.$queryRaw<{ translated: boolean; n: bigint }[]>`
      SELECT (t.id IS NOT NULL) AS translated, count(DISTINCT h.content_hash)::bigint AS n
      FROM (
        SELECT title_hash AS content_hash FROM posts WHERE id = ${postId} AND title_hash IS NOT NULL
        UNION ALL
        SELECT selftext_hash FROM posts WHERE id = ${postId} AND selftext_hash IS NOT NULL
        UNION ALL
        SELECT body_hash FROM comments WHERE post_id = ${postId} AND body_hash IS NOT NULL
      ) h
      LEFT JOIN translations t ON t.content_hash = h.content_hash AND t.status IN ('done', 'skipped')
      GROUP BY (t.id IS NOT NULL)
    `;
    let translated = 0;
    let untranslated = 0;
    for (const r of rows) {
      const n = Number(r.n);
      if (r.translated) {
        translated += n;
      } else {
        untranslated += n;
      }
    }

    return { total: translated + untranslated, translated, untranslated };
  }

  /**
   * 取某帖已完成译文（content_hash → 中文），供详情页渲染与导出按内容哈希贴回原文。
   * @param postId 目标帖子 ID
   */
  async getDoneForPost(postId: string): Promise<Record<string, string>> {
    const rows = await this.db.$queryRaw<{ content_hash: string; text: string }[]>`
      SELECT t.content_hash, t.text
      FROM translations t
      WHERE t.status = 'done' AND t.text IS NOT NULL AND t.content_hash IN (
        SELECT title_hash FROM posts WHERE id = ${postId} AND title_hash IS NOT NULL
        UNION
        SELECT selftext_hash FROM posts WHERE id = ${postId} AND selftext_hash IS NOT NULL
        UNION
        SELECT body_hash FROM comments WHERE post_id = ${postId} AND body_hash IS NOT NULL
      )
    `;

    return Object.fromEntries(rows.map((r) => [r.content_hash, r.text]));
  }

  /**
   * 批量回写译文结果（worker 翻完调用）。按 content_hash upsert——重译 / 重复内容直接覆盖。
   * @param rows 译文结果行
   * @param now 写入 Unix 时间戳（秒）
   */
  async upsertTranslations(rows: TranslationUpsert[], now: number): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const ts = BigInt(now);
    const values = Prisma.join(
      rows.map(
        (r) =>
          Prisma.sql`(${r.contentHash}, ${r.sourceField}::translation_field, ${r.sourceLang}, ${r.text}, ${r.providerKind}::provider_kind, ${r.providerId}, ${r.status}::translation_status, ${r.charCount}, ${r.lastError}, ${ts}, ${ts})`,
      ),
    );
    await this.db.$executeRaw`
      INSERT INTO translations (content_hash, source_field, source_lang, text, provider_kind, provider_id, status, char_count, last_error, created_at, updated_at)
      VALUES ${values}
      ON CONFLICT (content_hash) DO UPDATE SET
        source_field = excluded.source_field,
        source_lang = excluded.source_lang,
        text = excluded.text,
        provider_kind = excluded.provider_kind,
        provider_id = excluded.provider_id,
        status = excluded.status,
        char_count = excluded.char_count,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `;
  }

  /**
   * 在给定帖子集合中筛出「仍有未翻译内容」的帖子 ID（标题/正文/评论任一内容哈希尚无
   * done/skipped 记录）。供导出前批量补翻：覆盖率 = 总数 − 本结果长度，批量入队 = 遍历本结果。
   * 逻辑与 {@link getProgress} 同口径（按 content_hash 去重，pending/failed 视作仍需翻译）。
   * @param postIds 目标帖子 ID 集合（通常来自一个导出筛选的 selectPostIds）
   */
  async getPostIdsNeedingTranslation(postIds: string[]): Promise<string[]> {
    if (postIds.length === 0) {
      return [];
    }

    const ids = Prisma.join(postIds);
    const rows = await this.db.$queryRaw<{ post_id: string }[]>`
      SELECT e.post_id
      FROM (
        SELECT id AS post_id, title_hash AS content_hash
          FROM posts WHERE id IN (${ids}) AND title_hash IS NOT NULL
        UNION ALL
        SELECT id, selftext_hash FROM posts WHERE id IN (${ids}) AND selftext_hash IS NOT NULL
        UNION ALL
        SELECT post_id, body_hash FROM comments WHERE post_id IN (${ids}) AND body_hash IS NOT NULL
      ) e
      LEFT JOIN translations t ON t.content_hash = e.content_hash AND t.status IN ('done', 'skipped')
      GROUP BY e.post_id
      HAVING count(DISTINCT e.content_hash) FILTER (WHERE t.id IS NULL) > 0
    `;

    return rows.map((r) => r.post_id);
  }

  /**
   * 一批内容哈希 → 中文译文（仅 status=done 且 text 非空）。供雷达视图按 posts.title_hash /
   * selftext_hash 批量 join 译文（同文去重已在内容哈希层面完成）。
   * @param hashes 内容哈希集合（自动去重）
   */
  async doneTextByHashes(hashes: string[]): Promise<Map<string, string>> {
    const uniq = [...new Set(hashes)];
    if (uniq.length === 0) {
      return new Map();
    }

    const rows = await this.db.translations.findMany({
      where: { content_hash: { in: uniq }, status: 'done', text: { not: null } },
      select: { content_hash: true, text: true },
    });

    return new Map(rows.map((r) => [r.content_hash, r.text as string]));
  }

  /**
   * 累计某 provider 类型自某时刻起 done 译文的源字符数（Azure 免费档月度配额监控用）。
   * 仅计 done（实际调用机翻消耗的字符）；skipped（本地判中文跳过，未调远端）不计入。
   * @param providerKind provider 类型（如 'azure'）
   * @param sinceSec 起始 Unix 时间戳（秒，含）；通常为当月起点
   */
  async getProviderCharUsageSince(
    providerKind: TranslationProviderKind,
    sinceSec: number,
  ): Promise<number> {
    const rows = await this.db.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(char_count), 0)::bigint AS total
      FROM translations
      WHERE status = 'done'
        AND provider_kind = ${providerKind}::provider_kind
        AND created_at >= ${BigInt(sinceSec)}
    `;

    return Number(rows[0]?.total ?? 0);
  }
}
