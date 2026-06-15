import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle } from '@hatch-radar/db';
import { RuntimeSettingsService } from '@hatch-radar/db';
import { SettingsRepository } from '@hatch-radar/db';
import { RuntimeSettingsSeeder } from '@/domain/seed/runtime-settings.seeder';
import { setupTestDb, truncateAll } from './helpers';

describe('RuntimeSettingsSeeder', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let seeder: RuntimeSettingsSeeder;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    seeder = new RuntimeSettingsSeeder(new RuntimeSettingsService(new SettingsRepository(db)));
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it('空库 → seeded（写入默认值）', async () => {
    expect((await seeder.run()).status).toBe('seeded');
  });

  it('默认值已存在 → skipped（幂等）', async () => {
    await seeder.run();
    expect((await seeder.run()).status).toBe('skipped');
  });
});
