import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma, type AppDatabase, type DbHandle } from '@hatch-radar/db';
import { ExportService } from '@/domain/export/export.service';
import { setupTestDb, truncateAll } from './helpers';

async function seedPost(db: AppDatabase, id: string, createdUtc: number): Promise<void> {
  await db.posts.create({
    data: {
      id,
      source: 'reddit',
      subreddit: 'SaaS',
      title: `t-${id}`,
      selftext: '',
      created_utc: BigInt(createdUtc),
      fetched_at: BigInt(createdUtc),
    },
  });
}

async function seedComment(
  db: AppDatabase,
  id: string,
  postId: string,
  createdUtc: number,
): Promise<void> {
  await db.comments.create({
    data: {
      id,
      post_id: postId,
      parent_id: null,
      author: 'u',
      body: `b-${id}`,
      score: 0,
      depth: 0,
      created_utc: BigInt(createdUtc),
      fetched_at: BigInt(createdUtc),
    },
  });
}

async function seedInsight(db: AppDatabase, postId: string, createdAt: number): Promise<void> {
  await db.insights.create({
    data: {
      post_id: postId,
      source: 'reddit',
      subreddit: 'SaaS',
      post_title: `t-${postId}`,
      permalink: null,
      model: 'm',
      intensity: 'HIGH',
      pain_points: [
        { description: 'd', evidence: 'e', intensity: 'HIGH' },
      ] as Prisma.InputJsonValue,
      opportunities: [] as Prisma.InputJsonValue,
      tags: ['x'] as Prisma.InputJsonValue,
      created_at: BigInt(createdAt),
    },
  });
}

/**
 * 导出批次收集：批量取数（无 N+1）后，产出顺序须与原逐条实现字节级一致——
 * 帖子按洞察 created_at 降序、评论按帖分组且组内 created_utc 升序；缺帖（已归档）仅留洞察。
 */
describe('ExportService.collectBatch（批量取数 / 顺序与缺帖处理）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let svc: ExportService;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    svc = new ExportService(db);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it('按洞察 created_at 降序排帖，评论按帖分组且组内按 created_utc 升序', async () => {
    await seedPost(db, 'pA', 100);
    await seedPost(db, 'pB', 200);
    await seedComment(db, 'cA2', 'pA', 20);
    await seedComment(db, 'cA1', 'pA', 10);
    await seedComment(db, 'cB1', 'pB', 5);
    await seedInsight(db, 'pA', 1000);
    await seedInsight(db, 'pB', 2000);

    const batch = await svc.collectBatch({});

    expect(batch.meta.counts).toEqual({ insights: 2, posts: 2, comments: 3 });
    // 洞察按 created_at DESC → [pB, pA]；帖子同序
    expect(batch.insights.map((i) => i.post_id)).toEqual(['pB', 'pA']);
    expect(batch.posts.map((p) => p.id)).toEqual(['pB', 'pA']);
    // 评论按帖（洞察顺序）分组、组内 created_utc 升序 → [cB1, cA1, cA2]
    expect(batch.comments.map((c) => c.id)).toEqual(['cB1', 'cA1', 'cA2']);
  });

  it('洞察关联帖子已归档（缺失）时仅导出洞察本身', async () => {
    await seedInsight(db, 'gone', 1000); // 只建洞察，不建帖子
    const batch = await svc.collectBatch({});
    expect(batch.meta.counts).toEqual({ insights: 1, posts: 0, comments: 0 });
    expect(batch.insights.map((i) => i.post_id)).toEqual(['gone']);
  });
});
