import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle } from '@hatch-radar/db';
import { SourcesRepository } from '@/db/sources.repository';
import { HN_SECTIONS, RSS_FEEDS, SUBREDDITS } from '@/seed/source-lists';
import { SourcesSeeder } from '@/seed/sources.seeder';
import { setupTestDb, truncateAll } from './helpers';

const CTX = { now: 1_700_000_000 };
const EXPECTED = SUBREDDITS.length + HN_SECTIONS.length + RSS_FEEDS.length;

describe('SourcesSeeder', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let sources: SourcesRepository;
  let seeder: SourcesSeeder;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    sources = new SourcesRepository(db);
    seeder = new SourcesSeeder(sources);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it('空表 → 写入全部来源常量（reddit + hackernews + rss）', async () => {
    expect((await seeder.run(CTX)).status).toBe('seeded');
    expect(await sources.countSources()).toBe(EXPECTED);
  });

  it('非空 → skipped；幂等复跑不重复写', async () => {
    await seeder.run(CTX);
    expect((await seeder.run(CTX)).status).toBe('skipped');
    expect(await sources.countSources()).toBe(EXPECTED);
  });
});
