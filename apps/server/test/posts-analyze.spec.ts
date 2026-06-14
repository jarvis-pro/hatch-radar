import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle } from '@hatch-radar/db';
import { PostsRepository } from '../src/db/posts.repository';
import { setupTestDb, truncateAll } from './helpers';

/**
 * 待（重）分析谓词（PENDING_ANALYSIS_PREDICATE）的命中边界：
 * 首次分析 + 「分析后评论又变」的自动重分析命中；已分析且无新变化 / 失败到顶 / 尚无评论 不命中。
 */
describe('PostsRepository.getPostsToAnalyze（待分析谓词 / 评论变化触发重分析）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let posts: PostsRepository;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    posts = new PostsRepository(db);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  async function makePost(
    id: string,
    o: {
      comment_pass?: number;
      analyzed_at?: number | null;
      comments_changed_at?: number | null;
      analyze_attempts?: number;
    } = {},
  ): Promise<void> {
    await db.posts.create({
      data: {
        id,
        subreddit: 'SaaS',
        title: id,
        created_utc: 1000n,
        fetched_at: 1000n,
        comment_pass: o.comment_pass ?? 1,
        analyze_attempts: o.analyze_attempts ?? 0,
        analyzed_at: o.analyzed_at == null ? null : BigInt(o.analyzed_at),
        comments_changed_at: o.comments_changed_at == null ? null : BigInt(o.comments_changed_at),
      },
    });
  }

  it('命中首次分析与评论变化重分析；不命中已分析无变化 / 失败到顶 / 无评论', async () => {
    await makePost('p_new', { analyzed_at: null }); // 从未分析 → 命中
    await makePost('p_changed', { comment_pass: 2, analyzed_at: 100, comments_changed_at: 200 }); // 分析后评论又变 → 命中
    await makePost('p_stable', { comment_pass: 2, analyzed_at: 200, comments_changed_at: 100 }); // 变化早于分析 → 不命中
    await makePost('p_nochange', { comment_pass: 2, analyzed_at: 200, comments_changed_at: null }); // 已分析、无变化记录 → 不命中
    await makePost('p_exhausted', { analyzed_at: null, analyze_attempts: 3 }); // 失败到顶 → 不命中
    await makePost('p_nopass', { comment_pass: 0, analyzed_at: null }); // 尚未抓评论 → 不命中

    const got = (await posts.getPostsToAnalyze(50)).map((p) => p.id).sort();
    expect(got).toEqual(['p_changed', 'p_new']);
  });
});
